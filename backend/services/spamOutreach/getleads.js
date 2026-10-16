const { config } = require('./config');

/**
 * GetLeads contact lookup: sender domain → the people the forward goes to.
 *
 * Billing is one credit per row returned, so each search is narrow and capped rather
 * than pulling a company's whole org chart.
 */

const SEARCH_ENDPOINT = '/api/v1/contacts/search';

// What each department search asks GetLeads for. The index matches titles loosely, so
// these only decide which rows come back (and are billed); who is actually chosen is
// decided by the rank functions further down.
const SALES_TITLES = [
  'Chief Revenue Officer',
  'CRO',
  'Chief Sales Officer',
  'VP of Sales',
  'VP Sales',
  'Vice President of Sales',
  'SVP Sales',
  'Head of Sales',
  'Sales Director',
  'Director of Sales',
  'Sales Manager',
];
const OPERATIONS_TITLES = [
  'Chief Operating Officer',
  'COO',
  'VP of Operations',
  'VP Operations',
  'Vice President of Operations',
  'Head of Operations',
  'Director of Operations',
  'Operations Director',
  'Operations Manager',
];
const FOUNDER_TITLES = [
  'Founder',
  'Co-Founder',
  'CEO',
  'Chief Executive Officer',
  'Owner',
  'President',
  'Managing Partner',
  'Managing Director',
];

/** Rows pulled per role. Small on purpose: every row returned bills a credit. */
const ROWS_PER_ROLE = 10;

/**
 * Raised when GetLeads refuses a call for a reason that clears on its own — out of
 * credits, rate limited, its own server errors. These must not spend a message's retry
 * budget, or an outage would abandon every message permanently.
 */
class GetLeadsTransientError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GetLeadsTransientError';
  }
}

/**
 * GetLeads accounts do not all answer in the same shape. Older accounts return
 * email_address / job_title / job_level / org_company_name; the current one returns
 * work_email / current_title / current_seniority / current_company_name. Read against the
 * wrong names, every contact looks email-less and is silently discarded — so both shapes
 * are mapped onto one here.
 */
function normalizeContact(raw) {
  const str = (...keys) => {
    for (const key of keys) {
      const value = raw[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
  };
  return {
    first_name: str('first_name'),
    last_name: str('last_name'),
    job_title: str('job_title', 'current_title'),
    job_level: str('job_level', 'current_seniority'),
    job_function: str('job_function', 'current_function'),
    email_address: str('email_address', 'work_email'),
    email_status: str('email_status'),
    org_company_name: str('org_company_name', 'current_company_name', 'co_name'),
    org_domain: str('org_domain', 'current_company_website'),
    employee_count_range: str('employee_count_range', 'org_employee_count_range', 'company_size'),
  };
}

async function search(domain, jobTitles) {
  const res = await fetch(`${config.getleads.baseUrl}${SEARCH_ENDPOINT}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.getleads.apiKey}`,
    },
    body: JSON.stringify({
      filters: {
        domains: [domain],
        job_titles: jobTitles,
        // Without this the index happily returns people with no address at all.
        require_email: true,
      },
      limit: ROWS_PER_ROLE,
    }),
  });

  if (res.status === 429 || res.status === 402) {
    throw new GetLeadsTransientError(
      `GetLeads returned ${res.status} (${res.status === 429 ? 'rate limited' : 'out of credits'}) — lookups are paused until it clears.`
    );
  }
  // Server-side failures — including their own "Search timed out after 50s" 502 on large
  // companies — say nothing about the company, so they are retried on a later cycle too.
  if (res.status >= 500) {
    const body = await res.json().catch(() => ({}));
    throw new GetLeadsTransientError(`GetLeads returned ${res.status} — will retry next cycle: ${body.message || 'server error'}`);
  }

  const body = await res.json().catch(() => ({}));

  if (!res.ok || body.ok === false) {
    throw new Error(`GetLeads error ${res.status} on ${SEARCH_ENDPOINT}: ${body.message || 'unknown error'}`);
  }

  // An account without credits does NOT get an error status: GetLeads answers 200 with
  // zero contacts and the reason in `message`. Read as an ordinary empty result, that
  // would mark every company "no contacts" and cache it permanently.
  const contacts = body.contacts || [];
  if (body.credits_exhausted || (contacts.length === 0 && body.message)) {
    throw new GetLeadsTransientError(
      `GetLeads returned no results with a notice — lookups are paused until it clears: ${body.message || 'credits exhausted'}`
    );
  }

  return contacts.map(normalizeContact);
}

/**
 * Rejects titles that match a search term by coincidence rather than by role. "CRO" in
 * marketing means Conversion Rate Optimisation; assistants carry their executive's title
 * verbatim ("Executive Assistant to Chief Revenue Officer").
 */
function isFalseTitleMatch(jobTitle) {
  const title = jobTitle.toLowerCase();
  const disqualifying = [
    'conversion rate',
    'conversion-rate',
    'marketing manager',
    'chat cro',
    'executive assistant',
    'assistant to',
    'chief of staff',
    'intern',
    'sales support',
    'sales assistant',
    'sales associate',
    'sales representative',
    'sales development representative',
  ];
  return disqualifying.some((term) => title.includes(term));
}

/**
 * Confirms a "CRO" really is the revenue leader: spelled out in full, or a standalone
 * "CRO" at executive level or filed under sales. Every conversion-rate CRO sits below the
 * executive levels and in marketing.
 */
function isGenuineRevenueLeader(contact) {
  const title = (contact.job_title || '').toLowerCase();
  if (title.includes('chief revenue')) return true;
  const level = (contact.job_level || '').toLowerCase();
  const executive = level.includes('c-team') || level.includes('c-suite') || level === 'vp';
  const inSales = (contact.job_function || '').toLowerCase().includes('sales');
  return /\bcro\b/.test(title) && (executive || inSales);
}

/**
 * Seniority within a department, lower is more senior; null means "not in it". Takes the
 * head of the department when there is one, otherwise the next most senior person in it.
 * Within a tier the shorter title wins — "VP Sales" over "VP Sales Enablement, EMEA".
 */
const SENIOR = /\b(svp|evp|vp|vice president)\b|head of/;

function salesRank(contact) {
  const title = (contact.job_title || '').toLowerCase();
  if (title.includes('chief revenue') || title.includes('chief sales')) return 0;
  if (/\bcro\b/.test(title)) return isGenuineRevenueLeader(contact) ? 0 : null;
  if (!/\bsales\b/.test(title)) return null;
  if (SENIOR.test(title)) return 1;
  if (title.includes('director')) return 2;
  if (title.includes('manager')) return 3;
  return 4;
}

function operationsRank(contact) {
  const title = (contact.job_title || '').toLowerCase();
  if (title.includes('chief operating') || /\bcoo\b/.test(title)) return 0;
  if (!/\boperations\b/.test(title)) return null;
  if (SENIOR.test(title)) return 1;
  if (title.includes('director')) return 2;
  if (title.includes('manager')) return 3;
  return 4;
}

function founderRank(contact) {
  const title = (contact.job_title || '').toLowerCase();
  if (title.includes('founder') || title.includes('chief executive') || /\bceo\b/.test(title)) return 0;
  if (title.includes('owner') || (/\bpresident\b/.test(title) && !title.includes('vice president'))) return 1;
  if (title.includes('managing partner') || title.includes('managing director')) return 2;
  return null;
}

function pickTop(contacts, rank) {
  const ranked = contacts
    .filter((c) => Boolean(c.email_address))
    .filter((c) => !isFalseTitleMatch(c.job_title || ''))
    .map((c) => ({ c, r: rank(c) }))
    .filter((x) => x.r !== null)
    .sort((a, b) => a.r - b.r || (a.c.job_title || '').length - (b.c.job_title || '').length);
  return ranked[0] ? ranked[0].c : null;
}

/**
 * "small" is a headcount band topping out at 10 or fewer ("1 to 10"); "11 to 50" and up
 * is "large". Unknown when GetLeads gives no usable band — handled by the large-company
 * rules, the conservative default.
 */
function classifySize(rows) {
  for (const row of rows) {
    const range = row.employee_count_range;
    if (!range) continue;
    const numbers = (range.match(/\d[\d,]*/g) || []).map((n) => Number(n.replace(/,/g, '')));
    if (numbers.length === 0) continue;
    return { size: Math.max(...numbers) <= 10 ? 'small' : 'large', range };
  }
  return { size: 'unknown', range: null };
}

function toContact(person) {
  return {
    id: person.email_address || '',
    firstName: person.first_name || '',
    lastName: person.last_name || '',
    title: person.job_title || '',
    seniority: person.job_level || null,
    email: person.email_address || null,
  };
}

/**
 * Decides who receives the forward.
 *
 *   10 or fewer employees:  To the founder / CEO / owner, Cc the top sales and top
 *                           operations person if found.
 *   More than 10 (or size   To the top sales person, Cc the top operations person.
 *   unknown):               Only one of them found → just that one.
 *                           Neither → nobody: the company is skipped. The founder of a
 *                           company this size is never contacted.
 *
 * A small company with no findable founder falls back to its sales / operations people.
 *
 * Returns { companyName, companySize, sizeRange, companyKnown, recipients: { to, cc } | null }.
 */
async function lookupCompanyContacts(domain) {
  const [salesRows, operationsRows] = await Promise.all([
    search(domain, SALES_TITLES),
    search(domain, OPERATIONS_TITLES),
  ]);
  let rows = [...salesRows, ...operationsRows];
  let { size, range } = classifySize(rows);

  // Founders of companies above 10 are never contacted — including one who also runs a
  // department ("Founder, Head of Operations"). Only a known-small company may reach them.
  const notFounder = (rank) => (c) => (size !== 'small' && founderRank(c) !== null ? null : rank(c));
  const sales = pickTop(salesRows, notFounder(salesRank));
  const operations = pickTop(operationsRows, notFounder(operationsRank));

  // The founder search (which costs credits) runs only when the company is known to be
  // small — or when the department searches found nobody, leaving its size unknown; the
  // founder rows then tell us, and a founder is used only if they show it is small.
  let founder = null;
  if (size === 'small' || (size === 'unknown' && !sales && !operations)) {
    const founderRows = await search(domain, FOUNDER_TITLES);
    rows = rows.concat(founderRows);
    if (size === 'unknown') ({ size, range } = classifySize(rows));
    if (size === 'small') founder = pickTop(founderRows, founderRank);
  }

  const order = size === 'small' && founder ? [founder, sales, operations] : [sales, operations];

  // The same person can top two lists (a founder who also runs sales); write to them once.
  const seen = new Set();
  const people = order.filter((p) => {
    const email = p && p.email_address && p.email_address.toLowerCase();
    if (!email || seen.has(email)) return false;
    seen.add(email);
    return true;
  });

  // The company's display name comes back on the contact rows themselves.
  const named = rows.find((r) => r.org_company_name);

  return {
    companyName: named ? named.org_company_name : null,
    companySize: size,
    sizeRange: range,
    companyKnown: rows.length > 0,
    recipients: people.length > 0 ? { to: toContact(people[0]), cc: people.slice(1).map(toContact) } : null,
  };
}

module.exports = { lookupCompanyContacts, GetLeadsTransientError };

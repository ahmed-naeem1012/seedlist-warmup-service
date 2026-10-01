// Provider-agnostic pieces shared by every campaign send path (SES today,
// Resend as of the send_provider column added in
// migrations/009_ses_campaigns_send_provider.sql). Extracted out of what
// used to be sesEmailSender.js-only code so adding a second transport
// doesn't mean forking the recipient sourcing, rate limiting, or template
// loading logic - those don't change based on which provider does the
// actual sending.

const supabase = require('./supabaseClient');
const { renderTemplate } = require('../utils/templateRenderer');

// Resolves subject/html for a campaign that was started with just a
// templateId (no inline content) - the daily cron resend path, which only
// ever has the persisted ses_campaigns row to work from, not the original
// request. If html was already passed in (the direct-send path from the
// dashboard, which renders the template client-side first), this is a
// no-op passthrough.
const loadTemplateIfNeeded = async ({ orgId, templateId, templateData, subject, html }) => {
  if (!templateId || html) return { subject, html };

  const { data: template, error: templateError } = await supabase
    .from('templates')
    .select('*')
    .eq('id', templateId)
    .eq('workspace_id', orgId)
    .single();

  if (templateError) throw new Error(`Failed to load template: ${templateError.message}`);
  if (!template) throw new Error(`No template ${templateId} found for org ${orgId}.`);

  return {
    subject: template.subject || subject,
    html: renderTemplate(template, templateData || {})
  };
};

const createConcurrencyLimiter = (max) => {
  let running = 0;
  const queue = [];
  return (fn) => {
    const run = () => {
      running++;
      return fn().finally(() => {
        running--;
        if (queue.length > 0) queue.shift()();
      });
    };
    if (running < max) return run();
    return new Promise(resolve => queue.push(resolve)).then(run);
  };
};

// Token-bucket limiter factory - each provider gets its OWN instance (own
// tokens/queue/interval) via its own createRateLimiter(...) call, since SES
// and Resend have entirely different real API rate limits and a shared
// bucket would throttle one provider's headroom for the other's sake.
const createRateLimiter = (maxPerSecond) => {
  let tokens = maxPerSecond;
  const queue = [];

  setInterval(() => {
    tokens = maxPerSecond;
    while (tokens > 0 && queue.length > 0) {
      tokens--;
      queue.shift()();
    }
  }, 1000).unref();

  return () => {
    if (tokens > 0) {
      tokens--;
      return Promise.resolve();
    }
    return new Promise(resolve => queue.push(resolve));
  };
};

// Shared caps - not provider-specific, since they're about not hammering
// the shared auto_responder_mailboxes seedlist pool rather than either
// provider's own API limits.
const SEND_CONCURRENCY = parseInt(process.env.SES_SEND_CONCURRENCY || '5');
const CAMPAIGN_MAX_RECIPIENTS = parseInt(process.env.SES_CAMPAIGN_MAX_RECIPIENTS || '100');

// auto_responder_mailboxes is Google-infrastructure-only (imap_host/smtp_host
// default to imap.gmail.com/smtp.gmail.com) - the only real split within it
// is @gmail.com vs. custom-domain (Google Workspace) addresses, no Microsoft
// representation exists in this pool. Resolves the org's warmup_preferences
// down to which half of that split a campaign should send to.
//
// gsuite ("Gmail") selected, google not -> gmail.com only
// google selected, gsuite not -> custom domain only (excludes gmail.com)
// both selected, neither selected (e.g. only ms365/outlook), or no
// preferences at all -> null (no filter, full pool) - safe default so orgs
// that haven't touched warmup preferences see no behavior change.
const resolveProviderFilter = (selectedProviders, providerDistribution) => {
  const selected = selectedProviders || [];
  const distribution = providerDistribution || {};

  const hasGsuite = selected.includes('gsuite') && (distribution.gsuite || 0) > 0;
  const hasGoogle = selected.includes('google') && (distribution.google || 0) > 0;

  if (hasGsuite && !hasGoogle) return 'gmail_only';
  if (hasGoogle && !hasGsuite) return 'custom_domain_only';
  return null;
};

// Fisher-Yates - same technique the engagement scripts elsewhere in this repo
// (scripts/seedlist engagments/*/engage-*.js) already use for picking which
// mailboxes to act on. Used here so every campaign run reaches a different
// random slice of the seedlist instead of the same leading rows every time.
const shuffle = (arr) => {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

// Share of a campaign's recipients that should be Outlook seeds
// (admin_seedlist_outlook_accounts, maxify-proj/backend's Microsoft seedlist -
// engaged there by scripts/outlook-seedlist-warmup-engagement.js): the
// ms365 + outlook weight over the total weight of the selected providers.
// 0 unless OUTLOOK_SEEDLIST_ENABLED=true, so behaviour is unchanged until then.
const resolveOutlookShare = (selectedProviders, providerDistribution) => {
  if (process.env.OUTLOOK_SEEDLIST_ENABLED !== 'true') return 0;
  const selected = selectedProviders || [];
  const distribution = providerDistribution || {};

  const weightOf = (key) => (selected.includes(key) ? distribution[key] || 0 : 0);
  const total = selected.reduce((sum, key) => sum + (distribution[key] || 0), 0);
  if (total <= 0) return 0;
  return (weightOf('ms365') + weightOf('outlook')) / total;
};

const fetchOutlookSeedEmails = async (limit) => {
  const { data, error } = await supabase
    .from('admin_seedlist_outlook_accounts')
    .select('email')
    .eq('is_active', true)
    .eq('connection_status', 'connected');

  if (error) {
    console.warn(`Could not load Outlook seeds, using Gmail/Google seedlist only: ${error.message}`);
    return [];
  }
  return shuffle((data || []).map(m => m.email)).slice(0, limit);
};

// Supabase/PostgREST caps unpaginated selects at 1000 rows (db-max-rows) -
// page through with .range() to load every matching mailbox, then shuffle
// and take `limit` of them. Loads the full filtered pool every call (rather
// than stopping at `limit`) specifically so the random slice isn't biased
// toward whatever rows Postgres happens to return first.
//
// `preferences` ({ selectedProviders, providerDistribution }) is optional:
// with OUTLOOK_SEEDLIST_ENABLED=true and ms365/outlook weighted, that share
// of `limit` goes to Outlook seeds and the rest to auto_responder_mailboxes.
// If fewer Outlook seeds are connected, the Gmail/Google pool fills the gap.
const MAILBOX_PAGE_SIZE = 1000;
const fetchActiveMailboxEmails = async (providerFilter, limit, preferences = {}) => {
  const outlookShare = resolveOutlookShare(preferences.selectedProviders, preferences.providerDistribution);
  const outlookEmails = outlookShare > 0
    ? await fetchOutlookSeedEmails(Math.max(1, Math.round(limit * outlookShare)))
    : [];
  const googleLimit = limit - outlookEmails.length;
  if (googleLimit <= 0) return outlookEmails;

  const emails = [];
  let offset = 0;

  while (true) {
    let query = supabase
      .from('auto_responder_mailboxes')
      .select('email')
      .eq('is_active', true);

    if (providerFilter === 'gmail_only') {
      query = query.ilike('email', '%@gmail.com');
    } else if (providerFilter === 'custom_domain_only') {
      query = query.not('email', 'ilike', '%@gmail.com');
    }

    const { data, error } = await query.range(offset, offset + MAILBOX_PAGE_SIZE - 1);

    if (error) throw new Error(`Failed to load recipients: ${error.message}`);

    emails.push(...data.map(m => m.email));
    if (data.length < MAILBOX_PAGE_SIZE) break;
    offset += MAILBOX_PAGE_SIZE;
  }

  return shuffle([...outlookEmails, ...shuffle(emails).slice(0, googleLimit)]);
};

module.exports = {
  loadTemplateIfNeeded,
  createConcurrencyLimiter,
  createRateLimiter,
  SEND_CONCURRENCY,
  CAMPAIGN_MAX_RECIPIENTS,
  resolveProviderFilter,
  fetchActiveMailboxEmails
};

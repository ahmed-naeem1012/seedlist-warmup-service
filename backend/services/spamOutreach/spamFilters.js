/**
 * Senders that are never worth outreach.
 *
 * A spam folder is full of mail from Google itself (security alerts, DMARC reports) and
 * from free providers where the domain says nothing about who sent it. Looking these up
 * wastes GetLeads credits and would address a pitch about spam deliverability to the
 * wrong company entirely.
 */
const SKIP_DOMAINS = new Set([
  'google.com',
  'accounts.google.com',
  'mail.google.com',
  'gmail.com',
  'googlemail.com',
  'youtube.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  // Website builders that send form confirmations on their customers' behalf: the domain
  // is the platform's, so a lookup would reach the platform's staff, not the company's.
  'multiscreensite.com',
]);

function isSkippedDomain(domain) {
  if (!domain) return true;
  if (SKIP_DOMAINS.has(domain)) return true;
  // Any Google subdomain, e.g. noreply-dmarc-support@google.com variants.
  return domain.endsWith('.google.com');
}

/**
 * Automated senders that are never a company writing to us — DMARC aggregate reports,
 * bounces. A DMARC report arrives from e.g. dmarcreport@microsoft.com, and treating it
 * as outreach would forward it to Microsoft's sales leadership.
 */
function isSystemSender(email) {
  const local = (email.split('@')[0] || '').toLowerCase();
  return /dmarc|postmaster|mailer-daemon|bounce/.test(local);
}

function domainFromEmail(email) {
  return (email.split('@')[1] || '').toLowerCase();
}

module.exports = { isSkippedDomain, isSystemSender, domainFromEmail };

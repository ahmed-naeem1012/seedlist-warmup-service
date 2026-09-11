// OAuth counterpart to smtpEmailSender.js. Same prepare*Campaign /
// execute*Send pair so campaignRunner.js dispatches to it like any other
// transport.
//
// Sender identity: a warmup mailbox connected via Google or Outlook OAuth
// on the Maxify dashboard - an organization_warmup_emails row with provider
// 'google' or 'outlook'. Its access/refresh tokens live on that row and are
// kept fresh by maxify-proj/backend (its daily warmup sends from these same
// rows via GmailWarmupService.js / OutlookWarmupService.js).
//
// Sending goes straight to the provider's REST API with the row's access
// token - Gmail: users.messages.send with a raw MIME message; Outlook:
// Microsoft Graph /me/sendMail - the same calls the backend's warmup
// services make. Token refresh is NOT reimplemented here: the OAuth client
// secrets stay in the backend, and this module calls its existing
// POST /api/organizations/:orgId/warmup-emails/:id/refresh-token endpoint
// when the token is expired/expiring (or a send comes back 401), which
// refreshes and persists the new token, then retries once.
//
// Recipients, personalization, and pacing match smtpEmailSender.js: the
// same shuffled auto_responder_mailboxes seedlist slice, one message at a
// time with a delay, and a low per-run cap - one real mailbox, not an API
// built for volume.

const axios = require('axios');
const supabase = require('./supabaseClient');
const { renderHandlebars } = require('../utils/templateRenderer');
const { derivePersonalizationVariables } = require('../utils/personalization');
const {
  loadTemplateIfNeeded,
  resolveProviderFilter,
  fetchActiveMailboxEmails
} = require('./campaignSendShared');

const MAXIFY_BACKEND_URL = (process.env.MAXIFY_BACKEND_URL || 'https://api.maxify.co').replace(/\/$/, '');
const OAUTH_CAMPAIGN_MAX_RECIPIENTS = parseInt(process.env.OAUTH_CAMPAIGN_MAX_RECIPIENTS || '30');
const OAUTH_SEND_DELAY_MS = parseInt(process.env.OAUTH_SEND_DELAY_MS || '4000');
// Same 5-minute early-refresh window as the backend's refreshTokenIfNeeded.
const TOKEN_REFRESH_WINDOW_MS = 5 * 60 * 1000;

const OAUTH_PROVIDERS = ['google', 'outlook'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const MAILBOX_COLUMNS = 'id, organization_id, email, name, provider, connection_status, is_active, access_token, refresh_token, expires_at';

const loadMailbox = async ({ orgId, fromEmail }) => {
  const { data: mailbox, error } = await supabase
    .from('organization_warmup_emails')
    .select(MAILBOX_COLUMNS)
    .eq('organization_id', orgId)
    .ilike('email', fromEmail)
    .in('provider', OAUTH_PROVIDERS)
    .maybeSingle();

  if (error) throw new Error(`Failed to look up OAuth mailbox: ${error.message}`);
  if (!mailbox) throw new Error(`No Google/Outlook OAuth mailbox found for org ${orgId} / ${fromEmail}.`);
  return mailbox;
};

// Asks maxify-proj/backend to refresh this row's token (it owns the OAuth
// client secrets and already persists the result to organization_warmup_emails).
const refreshViaBackend = async (mailbox) => {
  const url = `${MAXIFY_BACKEND_URL}/api/organizations/${encodeURIComponent(mailbox.organization_id)}/warmup-emails/${encodeURIComponent(mailbox.id)}/refresh-token`;
  let response;
  try {
    response = await axios.post(url, {}, { timeout: 30000 });
  } catch (err) {
    const message = err.response?.data?.message || err.response?.data?.error || err.message;
    throw new Error(`Token refresh failed for ${mailbox.email}: ${message}`);
  }
  const refreshed = response.data?.email;
  if (!response.data?.success || !refreshed?.access_token) {
    throw new Error(`Token refresh failed for ${mailbox.email}: ${response.data?.message || 'no token returned'}`);
  }
  return { ...mailbox, ...refreshed };
};

const isTokenExpiringSoon = (mailbox) => {
  if (!mailbox.expires_at) return false;
  return new Date(mailbox.expires_at).getTime() <= Date.now() + TOKEN_REFRESH_WINDOW_MS;
};

// Gmail: raw RFC 2822 message, base64url-encoded - same construction as
// the backend's GmailWarmupService.sendFromCustomer, plus an explicit From
// header so the display name is carried.
const sendViaGmail = async ({ mailbox, to, subject, html, text }) => {
  const fromHeader = mailbox.name ? `"${mailbox.name.replace(/"/g, '')}" <${mailbox.email}>` : mailbox.email;
  const body = html || text || '';
  const contentType = html ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8';
  const raw = [
    `From: ${fromHeader}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: ${contentType}`,
    '',
    body
  ].join('\r\n');

  const encoded = Buffer.from(raw)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  await axios.post(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    { raw: encoded },
    {
      headers: { Authorization: `Bearer ${mailbox.access_token}`, 'Content-Type': 'application/json' },
      timeout: 30000
    }
  );
};

// Outlook: Microsoft Graph sendMail - same payload shape and headers as the
// backend's OutlookWarmupService.sendFromCustomer.
const sendViaOutlook = async ({ mailbox, to, subject, html, text }) => {
  const senderName = mailbox.name || mailbox.email.split('@')[0];
  await axios.post(
    'https://graph.microsoft.com/v1.0/me/sendMail',
    {
      message: {
        subject,
        body: html
          ? { contentType: 'HTML', content: html }
          : { contentType: 'Text', content: text || '' },
        toRecipients: [{ emailAddress: { address: to, name: to.split('@')[0] } }],
        from: { emailAddress: { address: mailbox.email, name: senderName } },
        importance: 'normal',
        inferenceClassification: 'focused',
        isDeliveryReceiptRequested: false,
        isReadReceiptRequested: false
      },
      saveToSentItems: 'true'
    },
    {
      headers: {
        Authorization: `Bearer ${mailbox.access_token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'X-ClientType': 'OWA',
        Accept: 'application/json'
      },
      timeout: 30000
    }
  );
};

const sendOne = (args) =>
  args.mailbox.provider === 'google' ? sendViaGmail(args) : sendViaOutlook(args);

const describeAxiosError = (err) =>
  err.response?.data?.error?.message ||
  err.response?.data?.error_description ||
  err.response?.data?.message ||
  (typeof err.response?.data === 'string' ? err.response.data : null) ||
  err.message;

// Validates the request and resolves everything the send needs (template,
// the connected OAuth mailbox). No provider I/O here - same synchronous-path
// contract as the other prepare*Campaign functions. Token freshness is
// handled at the start of executeOauthSend.
const prepareOauthCampaign = async ({ orgId, fromEmail, templateId, templateData, subject, html, text, providerDistribution, selectedProviders } = {}) => {
  if (!orgId) throw new Error('orgId is required.');
  if (!fromEmail) throw new Error('fromEmail is required.');
  if (!templateId && !subject) throw new Error('subject is required when not using templateId.');
  if (!templateId && !html && !text) throw new Error('At least one of templateId, html or text is required.');

  const loaded = await loadTemplateIfNeeded({ orgId, templateId, templateData, subject, html });
  subject = loaded.subject;
  html = loaded.html;

  const mailbox = await loadMailbox({ orgId, fromEmail });

  if (mailbox.connection_status !== 'connected') {
    throw new Error(`${fromEmail} is not connected (status: ${mailbox.connection_status}). Reconnect it on the dashboard first.`);
  }
  if (!mailbox.is_active) throw new Error(`${fromEmail} is paused on the dashboard. Turn it on to send campaigns from it.`);
  if (!mailbox.access_token) throw new Error(`${fromEmail} has no OAuth access token stored. Reconnect it on the dashboard.`);

  const providerFilter = resolveProviderFilter(selectedProviders, providerDistribution);

  return { orgId, fromEmail: mailbox.email, mailboxId: mailbox.id, subject, html, text, providerFilter };
};

// Runs the actual send prepared above. Same result shape as the other
// execute*Send functions so campaignRunner.js's bookkeeping is unchanged.
const executeOauthSend = async ({ orgId, fromEmail, mailboxId, subject, html, text, onRecipientsResolved, providerFilter }) => {
  const startTime = Date.now();

  // Re-read the row now (not the prepare-time copy) so a token the backend
  // refreshed in between is used, then refresh once up front if needed.
  let mailbox = await loadMailbox({ orgId, fromEmail });
  if (mailbox.id !== mailboxId) throw new Error(`OAuth mailbox for ${fromEmail} changed since the campaign was prepared.`);
  if (isTokenExpiringSoon(mailbox) || !mailbox.access_token) {
    mailbox = await refreshViaBackend(mailbox);
  }

  const to = await fetchActiveMailboxEmails(providerFilter, OAUTH_CAMPAIGN_MAX_RECIPIENTS);
  if (onRecipientsResolved) await onRecipientsResolved(to.length);

  let sent = 0;
  let failed = 0;
  const errors = [];
  let refreshedMidRun = false;
  const tag = `${mailbox.provider === 'google' ? 'Gmail' : 'Outlook'}:${orgId}`;

  // Strictly sequential, paced - see header comment.
  for (let i = 0; i < to.length; i++) {
    const email = to[i];
    const vars = derivePersonalizationVariables(email);
    const message = {
      to: email,
      subject: renderHandlebars(subject || '', vars),
      html: html ? renderHandlebars(html, vars) : undefined,
      text: text ? renderHandlebars(text, vars) : undefined
    };

    try {
      try {
        await sendOne({ mailbox, ...message });
      } catch (err) {
        // One mid-run refresh + retry on an auth failure; a second 401
        // means the refresh token itself is dead, which surfaces as a
        // normal per-recipient failure with the provider's message.
        if (err.response?.status === 401 && !refreshedMidRun) {
          refreshedMidRun = true;
          mailbox = await refreshViaBackend(mailbox);
          await sendOne({ mailbox, ...message });
        } else {
          throw err;
        }
      }
      sent++;
      console.log(`  [${tag}] Sent → ${email}`);
    } catch (err) {
      failed++;
      const message = describeAxiosError(err);
      errors.push({ email, error: message });
      console.error(`  [${tag}] Failed → ${email}: ${message}`);
    }

    if (i < to.length - 1) await sleep(OAUTH_SEND_DELAY_MS);
  }

  const duration = parseFloat(((Date.now() - startTime) / 1000).toFixed(1));
  return { sent, failed, total: to.length, errors, duration };
};

module.exports = { prepareOauthCampaign, executeOauthSend };

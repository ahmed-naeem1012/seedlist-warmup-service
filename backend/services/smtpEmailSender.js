// SMTP counterpart to sesEmailSender.js / resendEmailSender.js /
// platformSesEmailSender.js. Same prepare*Campaign / execute*Send pair so
// campaignRunner.js dispatches to it like any other transport.
//
// Sender identity: a warmup mailbox connected via app password on the
// Maxify dashboard - an organization_warmup_emails row with provider
// 'smtp'. Its SMTP host/port/username and encrypted password were stored
// there by maxify-proj/backend's saveSmtpCredentialsHandler, and that same
// backend already sends daily warmup mail through them
// (services/warmup/SmtpWarmupService.js). This module does the same thing
// for a template campaign: the template's subject + body, to the same
// shuffled slice of the auto_responder_mailboxes seedlist the SES and
// Resend transports use, with the same per-recipient personalization.
//
// Pacing is deliberately much gentler than SES/Resend. Those talk to an
// API built for volume; this is one real mailbox on Gmail/Outlook/cPanel
// SMTP, which will throttle or flag a burst. So: one message at a time,
// a fixed delay between messages, and a lower recipient cap - all
// overridable via env (see .env.example).

const nodemailer = require('nodemailer');
const supabase = require('./supabaseClient');
const { decryptWarmupCredential } = require('../utils/warmupCredentialsCrypto');
const { renderHandlebars } = require('../utils/templateRenderer');
const { derivePersonalizationVariables } = require('../utils/personalization');
const {
  loadTemplateIfNeeded,
  resolveProviderFilter,
  fetchActiveMailboxEmails
} = require('./campaignSendShared');

// Per run, per sender. 30 is a safe daily volume for a single warmed
// app-password mailbox; SES/Resend default to 100.
const SMTP_CAMPAIGN_MAX_RECIPIENTS = parseInt(process.env.SMTP_CAMPAIGN_MAX_RECIPIENTS || '30');
// Gap between consecutive messages from the same mailbox.
const SMTP_SEND_DELAY_MS = parseInt(process.env.SMTP_SEND_DELAY_MS || '4000');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Validates the request and resolves everything the send needs (template,
// the connected warmup mailbox and its decrypted SMTP credentials) - same
// synchronous-path contract as prepareSesCampaign: no recipient fetch and
// no network I/O to the mail server here, so the API route's up-front
// validation stays fast. Login is verified once at the start of
// executeSmtpSend instead, so a bad/rotated password fails the run with one
// clear error rather than N identical per-recipient failures.
const prepareSmtpCampaign = async ({ orgId, fromEmail, templateId, templateData, subject, html, text, providerDistribution, selectedProviders } = {}) => {
  if (!orgId) throw new Error('orgId is required.');
  if (!fromEmail) throw new Error('fromEmail is required.');
  if (!templateId && !subject) throw new Error('subject is required when not using templateId.');
  if (!templateId && !html && !text) throw new Error('At least one of templateId, html or text is required.');

  const loaded = await loadTemplateIfNeeded({ orgId, templateId, templateData, subject, html });
  subject = loaded.subject;
  html = loaded.html;

  const { data: mailbox, error: mailboxError } = await supabase
    .from('organization_warmup_emails')
    .select('id, email, name, provider, connection_status, is_active, smtp_host, smtp_port, smtp_username, smtp_password, smtp_secure')
    .eq('organization_id', orgId)
    .ilike('email', fromEmail)
    .eq('provider', 'smtp')
    .maybeSingle();

  if (mailboxError) throw new Error(`Failed to look up SMTP mailbox: ${mailboxError.message}`);
  if (!mailbox) throw new Error(`No app-password (SMTP) mailbox found for org ${orgId} / ${fromEmail}.`);
  if (mailbox.connection_status !== 'connected') {
    throw new Error(`${fromEmail} is not connected (status: ${mailbox.connection_status}). Reconnect it on the dashboard first.`);
  }
  if (!mailbox.is_active) throw new Error(`${fromEmail} is paused on the dashboard. Turn it on to send campaigns from it.`);
  if (!mailbox.smtp_host || !mailbox.smtp_port || !mailbox.smtp_password) {
    throw new Error(`${fromEmail} has no SMTP credentials stored.`);
  }

  let smtpPassword;
  try {
    smtpPassword = decryptWarmupCredential(mailbox.smtp_password);
  } catch (err) {
    throw new Error(`Could not decrypt the stored SMTP password for ${fromEmail}: ${err.message}`);
  }

  // Same transporter shape as maxify-proj/backend's SmtpWarmupService.js,
  // which is known to work against these exact rows.
  const smtpConfig = {
    host: mailbox.smtp_host,
    port: mailbox.smtp_port,
    secure: mailbox.smtp_secure || mailbox.smtp_port === 465,
    auth: {
      user: mailbox.smtp_username || mailbox.email,
      pass: smtpPassword
    },
    tls: { rejectUnauthorized: false }
  };

  const providerFilter = resolveProviderFilter(selectedProviders, providerDistribution);

  return {
    orgId,
    fromEmail: mailbox.email,
    fromName: mailbox.name || null,
    subject,
    html,
    text,
    smtpConfig,
    providerFilter
  };
};

// Runs the actual send prepared above. Same result shape as the other
// execute*Send functions so campaignRunner.js's bookkeeping is unchanged.
const executeSmtpSend = async ({ orgId, fromEmail, fromName, subject, html, text, smtpConfig, onRecipientsResolved, providerFilter }) => {
  const startTime = Date.now();

  const transporter = nodemailer.createTransport(smtpConfig);

  // One login check up front - a wrong password or blocked host fails the
  // whole run with the server's own message instead of N identical errors.
  try {
    await transporter.verify();
  } catch (err) {
    throw new Error(`SMTP login failed for ${fromEmail}: ${err.message}`);
  }

  const to = await fetchActiveMailboxEmails(providerFilter, SMTP_CAMPAIGN_MAX_RECIPIENTS);
  if (onRecipientsResolved) await onRecipientsResolved(to.length);

  let sent = 0;
  let failed = 0;
  const errors = [];
  const senderDomain = fromEmail.split('@')[1] || 'localhost';

  // Strictly sequential, paced - see header comment.
  for (let i = 0; i < to.length; i++) {
    const email = to[i];
    try {
      const vars = derivePersonalizationVariables(email);
      const personalizedSubject = renderHandlebars(subject || '', vars);
      const personalizedHtml = html ? renderHandlebars(html, vars) : undefined;
      const personalizedText = text ? renderHandlebars(text, vars) : undefined;

      await transporter.sendMail({
        from: fromName ? `"${fromName}" <${fromEmail}>` : fromEmail,
        to: email,
        subject: personalizedSubject,
        html: personalizedHtml,
        text: personalizedText,
        messageId: `<${Date.now()}.${Math.random().toString(36).slice(2)}@${senderDomain}>`
      });
      sent++;
      console.log(`  [SMTP:${orgId}] Sent → ${email}`);
    } catch (err) {
      failed++;
      errors.push({ email, error: err.message });
      console.error(`  [SMTP:${orgId}] Failed → ${email}: ${err.message}`);
    }

    if (i < to.length - 1) await sleep(SMTP_SEND_DELAY_MS);
  }

  transporter.close();

  const duration = parseFloat(((Date.now() - startTime) / 1000).toFixed(1));
  return { sent, failed, total: to.length, errors, duration };
};

module.exports = { prepareSmtpCampaign, executeSmtpSend };

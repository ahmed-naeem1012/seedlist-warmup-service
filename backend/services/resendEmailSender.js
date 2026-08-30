// Resend counterpart to sesEmailSender.js. Mirrors its shape deliberately -
// prepareResendCampaign/executeResendSend line up 1:1 with
// prepareSesCampaign/executeSesSend - so campaignRunner.js can dispatch
// between the two providers without either one needing special-case
// handling. Only the two things that actually differ between providers live
// here: (1) how the sender identity is resolved and validated, and (2) how
// one email actually gets sent. Recipient sourcing, personalization, rate
// limiting, and campaign bookkeeping are all shared - see
// campaignSendShared.js.

const supabase = require('./supabaseClient');
const resendApiClient = require('./resendApiClient');
const { renderHandlebars } = require('../utils/templateRenderer');
const { derivePersonalizationVariables } = require('../utils/personalization');
const {
  loadTemplateIfNeeded,
  createConcurrencyLimiter,
  createRateLimiter,
  SEND_CONCURRENCY,
  CAMPAIGN_MAX_RECIPIENTS,
  resolveProviderFilter,
  fetchActiveMailboxEmails
} = require('./campaignSendShared');

// Resend's own documented default account rate limit is ~10 requests/sec -
// this stays comfortably under that. Configurable since it depends on the
// platform account's actual plan, unlike SES where each org supplies its
// own AWS credentials/limits.
const RESEND_SEND_RATE_PER_SECOND = parseInt(process.env.RESEND_SEND_RATE_PER_SECOND || '9');
const acquireSendSlot = createRateLimiter(RESEND_SEND_RATE_PER_SECOND);

// Validates the request and resolves everything the send needs (template,
// verified sending mailbox) up front - same synchronous-path contract as
// prepareSesCampaign (see its own comment for why the recipient fetch is
// deliberately NOT done here). Looks up sending_domain_mailboxes/
// sending_domains directly rather than a dedicated "resend_integrations"
// table - those Custom DNS tables (owned by maxify-proj/backend, same
// Supabase project) are the actual source of truth for which mailboxes are
// real, verified Resend senders; duplicating that into a second table here
// would just be two places that can disagree.
const prepareResendCampaign = async ({ orgId, fromEmail, templateId, templateData, subject, html, text, providerDistribution, selectedProviders } = {}) => {
  if (!orgId) throw new Error('orgId is required.');
  if (!fromEmail) throw new Error('fromEmail is required.');
  if (!templateId && !subject) throw new Error('subject is required when not using templateId.');
  if (!templateId && !html && !text) throw new Error('At least one of templateId, html or text is required.');

  const loaded = await loadTemplateIfNeeded({ orgId, templateId, templateData, subject, html });
  subject = loaded.subject;
  html = loaded.html;

  const { data: mailbox, error: mailboxError } = await supabase
    .from('sending_domain_mailboxes')
    .select('*, sending_domains(domain, resend_status)')
    .eq('organization_id', orgId)
    .eq('email_address', fromEmail)
    .eq('is_active', true)
    .maybeSingle();

  if (mailboxError) throw new Error(`Failed to look up Resend mailbox: ${mailboxError.message}`);
  if (!mailbox) throw new Error(`No active Custom DNS mailbox found for org ${orgId} / ${fromEmail}.`);
  if (!mailbox.sending_domains || mailbox.sending_domains.resend_status !== 'verified') {
    throw new Error(`Domain for ${fromEmail} has not verified with Resend yet (status: ${mailbox.sending_domains?.resend_status || 'unknown'}).`);
  }

  const providerFilter = resolveProviderFilter(selectedProviders, providerDistribution);

  return { orgId, fromEmail, subject, html, text, providerFilter };
};

// Runs the actual send prepared above. Mirrors executeSesSend's shape and
// bookkeeping exactly, swapping the AWS SDK call for a Resend API call -
// callers (campaignRunner.js) treat the two interchangeably.
const executeResendSend = async ({ orgId, fromEmail, subject, html, text, onRecipientsResolved, providerFilter }) => {
  const startTime = Date.now();

  const to = await fetchActiveMailboxEmails(providerFilter, CAMPAIGN_MAX_RECIPIENTS);
  if (onRecipientsResolved) await onRecipientsResolved(to.length);

  let sent = 0;
  let failed = 0;
  const errors = [];

  const limit = createConcurrencyLimiter(SEND_CONCURRENCY);

  await Promise.all(
    to.map(email =>
      limit(async () => {
        try {
          const vars = derivePersonalizationVariables(email);
          const personalizedSubject = renderHandlebars(subject || '', vars);
          const personalizedHtml = html ? renderHandlebars(html, vars) : undefined;
          const personalizedText = text ? renderHandlebars(text, vars) : undefined;

          await acquireSendSlot();
          await resendApiClient.sendEmail({
            from: fromEmail,
            to: email,
            subject: personalizedSubject,
            html: personalizedHtml,
            text: personalizedText
          });
          sent++;
          console.log(`  [Resend:${orgId}] Sent → ${email}`);
        } catch (err) {
          failed++;
          const message = err.response?.data?.message || err.message;
          errors.push({ email, error: message });
          console.error(`  [Resend:${orgId}] Failed → ${email}: ${message}`);
        }
      })
    )
  );

  const duration = parseFloat(((Date.now() - startTime) / 1000).toFixed(1));
  return { sent, failed, total: to.length, errors, duration };
};

module.exports = { prepareResendCampaign, executeResendSend };

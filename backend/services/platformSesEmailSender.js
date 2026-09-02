// Third sender, alongside sesEmailSender.js (customer-supplied AWS keys,
// ses_integrations pool) and resendEmailSender.js (Resend, Custom DNS pool).
// This one sends via the PLATFORM's own shared AWS SES account - the same
// account maxify-proj/backend's sesClient.js used to create the SES identity
// for a Custom DNS domain in the first place (confirmed same
// AWS_ACCESS_KEY_ID/AWS_REGION already sitting in this service's own .env,
// no new credentials needed). Used only for Custom DNS mailboxes whose
// domain has ses_identity_verification_status = 'success' - see
// campaignRunner.js's resolveCustomDnsProvider, which picks this over
// Resend whenever SES is verified.

const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const supabase = require('./supabaseClient');
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

// Shared platform account, not per-org - same rate ceiling class as the
// sesEmailSender.js SES limiter, kept separate since it's a genuinely
// different limiter instance guarding the same underlying AWS account.
const PLATFORM_SES_SEND_RATE_PER_SECOND = parseInt(process.env.PLATFORM_SES_SEND_RATE_PER_SECOND || '11');
const acquireSendSlot = createRateLimiter(PLATFORM_SES_SEND_RATE_PER_SECOND);

const getPlatformSesClient = () => {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const region = process.env.AWS_REGION || 'us-east-1';
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('Platform AWS SES is not configured. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .env.');
  }
  return new SESClient({ region, credentials: { accessKeyId, secretAccessKey } });
};

// Same synchronous-validation contract as prepareSesCampaign/
// prepareResendCampaign - resolves template + confirms the domain's SES
// identity is actually verified, without touching the recipient list.
const preparePlatformSesCampaign = async ({ orgId, fromEmail, templateId, templateData, subject, html, text, providerDistribution, selectedProviders } = {}) => {
  if (!orgId) throw new Error('orgId is required.');
  if (!fromEmail) throw new Error('fromEmail is required.');
  if (!templateId && !subject) throw new Error('subject is required when not using templateId.');
  if (!templateId && !html && !text) throw new Error('At least one of templateId, html or text is required.');

  const loaded = await loadTemplateIfNeeded({ orgId, templateId, templateData, subject, html });
  subject = loaded.subject;
  html = loaded.html;

  const { data: mailbox, error: mailboxError } = await supabase
    .from('sending_domain_mailboxes')
    .select('*, sending_domains(domain, ses_identity_verification_status)')
    .eq('organization_id', orgId)
    .eq('email_address', fromEmail)
    .eq('is_active', true)
    .maybeSingle();

  if (mailboxError) throw new Error(`Failed to look up Custom DNS mailbox: ${mailboxError.message}`);
  if (!mailbox) throw new Error(`No active Custom DNS mailbox found for org ${orgId} / ${fromEmail}.`);
  if (!mailbox.sending_domains || mailbox.sending_domains.ses_identity_verification_status !== 'success') {
    throw new Error(`Domain for ${fromEmail} has not verified with SES yet (status: ${mailbox.sending_domains?.ses_identity_verification_status || 'unknown'}).`);
  }

  const body = {};
  if (html) body.Html = { Data: html, Charset: 'UTF-8' };
  if (text) body.Text = { Data: text, Charset: 'UTF-8' };

  const providerFilter = resolveProviderFilter(selectedProviders, providerDistribution);

  return { orgId, fromEmail, subject, body, client: getPlatformSesClient(), providerFilter };
};

// Identical loop shape to executeSesSend - same personalization, same
// concurrency limiter, own rate limiter, just built fresh per call from the
// platform account instead of a decrypted customer key pair.
const executePlatformSesSend = async ({ orgId, fromEmail, subject, body, client, onRecipientsResolved, providerFilter }) => {
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
          const personalizedBody = {};
          if (body.Html) personalizedBody.Html = { ...body.Html, Data: renderHandlebars(body.Html.Data, vars) };
          if (body.Text) personalizedBody.Text = { ...body.Text, Data: renderHandlebars(body.Text.Data, vars) };

          await acquireSendSlot();
          await client.send(new SendEmailCommand({
            Source: fromEmail,
            Destination: { ToAddresses: [email] },
            Message: {
              Subject: { Data: personalizedSubject, Charset: 'UTF-8' },
              Body: personalizedBody,
            },
          }));
          sent++;
          console.log(`  [PlatformSES:${orgId}] Sent → ${email}`);
        } catch (err) {
          failed++;
          errors.push({ email, error: err.message });
          console.error(`  [PlatformSES:${orgId}] Failed → ${email}: ${err.message}`);
        }
      })
    )
  );

  const duration = parseFloat(((Date.now() - startTime) / 1000).toFixed(1));
  return { sent, failed, total: to.length, errors, duration };
};

module.exports = { preparePlatformSesCampaign, executePlatformSesSend };

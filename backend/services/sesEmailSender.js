const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const supabase = require('./supabaseClient');
const { decrypt } = require('../utils/crypto');
const { renderTemplate } = require('../utils/templateRenderer');

// The same 100 test auto-responder mailboxes that engage-test-ses.js monitors.
// These receive the SES campaign so the engagement cron has emails to open/click.
const TEST_EMAILS = [
  'geografyesfrageer@gmail.com',
  'austineromero246@gmail.com',
  'uthandaesdarmier@gmail.com',
  'elierberryes36@gmail.com',
  'wadanthony09@gmail.com',
  'jeksiclodiidi@gmail.com',
  'danillajulier@gmail.com',
  'manfollarquwkeep@gmail.com',
  'barrettesdchristophered@gmail.com',
  'watkinesejasoneds@gmail.com',
  'jeremebenneth@gmail.com',
  'nathanerreaides@gmail.com',
  'fullsdeeppardhanco@gmail.com',
  'robiniyeresakom@gmail.com',
  'jertyparkar@gmail.com',
  'joerobertdon0@gmail.com',
  'devidsonesjosever@gmail.com',
  'rightersootes@gmail.com',
  'amibhaidesai709@gmail.com',
  'thomaszdaszews@gmail.com',
  'numberfeeding@gmail.com',
  'geokavageonaca@gmail.com',
  'debkalisosk@gmail.com',
  'veokavsdvsokavwcs@gmail.com',
  'tsushimajdjfhf8@gmail.com',
  'checkhshs73@gmail.com',
  'gsowijebxsgaousnc@gmail.com',
  'rhagsgldjdhd7@gmail.com',
  'comingfun151@gmail.com',
  'formriding@gmail.com',
  'gueye040483@gmail.com',
  'p85113035@gmail.com',
  'umeshpujar612@gmail.com',
  'scottstaylor691@gmail.com',
  'sd6253463@gmail.com',
  'dtrfyte@gmail.com',
  'rameshmohacha@gmail.com',
  'jesonsmith6273@gmail.com',
  'taniyamondal7899@gmail.com',
  'rameshbmramesh19670@gmail.com',
  'wadud5189@gmail.com',
  'sidindiaye9734842@gmail.com',
  'jameershaikhshaikh39@gmail.com',
  'p64200291@gmail.com',
  'ziddim76590@gmail.com',
  'sambuharijan38@gmail.com',
  'shivamyadavpatepur233235@gmail.com',
  'seerila346@gmail.com',
  'insadrame82@gmail.com',
  'barrylongbalaoxhswpsnal85291@gmail.com',
  'charleehale30@gmail.com',
  'carolinekolly555@gmail.com',
  'aqibewequfu11@gmail.com',
  'awexoxikew47@gmail.com',
  'hffg46dd@gmail.com',
  'shoheiohtani83@gmail.com',
  'alfinoalbarez564@gmail.com',
  'jon@tryameloa.com',
  'jada@putdelivra.com',
  'jada@nowdelivra.com',
  'jada@buymyuselybase.com',
  'sadie@rundelivra.com',
  'mitch@setameloa.com',
  'jay@tagameloa.com',
  'becca@getmyusely.com',
  'henri@tagameloa.com',
  'mitch@putdelivra.com',
  'jada@heyzmyuser.com',
  'mia@makedelivra.com',
  'sadie@sendmyusely.com',
  'arielle@buydelivra.com',
  'sadie@whymyusers.com',
  'jay@buydelivra.com',
  'max@sendameloa.com',
  'jay@aimameloa.com',
  'henri@letmyusely.com',
  'ivy@bestmyusers.com',
  'jace@itsmyuserly.com',
  'leo@askmyusers.com',
  'jace@trymyusely.com',
  'henri@gomyuserly.com',
  'henri@pickmyuselyh.com',
  'arielle@pickmyuselyflow.com',
  'jon@putmyuselyapp.com',
  'sadie@themyuserly.com',
  'jada@permyuserly.com',
  'mitch@findmyuselyport.com',
  'eli@addmyuselylabs.com',
  'becca@ourmyuserly.com',
  'max@buymyuselylink.com',
  'zach@putmyuselyapp.com',
  'leo@saymyuserly.com',
  'gia@viewmyusers.com',
  'jada@pickmyuserly.com',
  'leo@allmyuserly.com',
  'zoe@joinmyuselyteam.com',
  'max@heymyusers.com',
  'jada@addmyuselyflow.com',
  'eli@addmyuselydev.com',
  'becca@putmyuselysync.com',
];

const CLICK_URL = process.env.SES_CAMPAIGN_CLICK_URL || 'https://www.google.com';
const SEND_CONCURRENCY = parseInt(process.env.SES_SEND_CONCURRENCY || '5');

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

const buildEmailHtml = (subject, clickUrl) => `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f4f4f4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr><td style="background:#4F46E5;padding:32px 40px;">
          <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">${subject}</h1>
        </td></tr>
        <tr><td style="padding:40px;">
          <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">Hi there,</p>
          <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.6;">
            We have some exciting updates to share with you. Click the button below to learn more about what we've been working on.
          </p>
          <table cellpadding="0" cellspacing="0" style="margin:0 auto 32px;">
            <tr><td style="background:#4F46E5;border-radius:6px;text-align:center;">
              <a href="${clickUrl}" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">
                Learn More
              </a>
            </td></tr>
          </table>
          <p style="margin:0 0 8px;color:#374151;font-size:15px;line-height:1.6;">Best regards,<br>The Team</p>
        </td></tr>
        <tr><td style="background:#f9fafb;padding:24px 40px;border-top:1px solid #e5e7eb;">
          <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
            You received this email as part of our mailing list.
            <a href="${clickUrl}" style="color:#9ca3af;">Unsubscribe</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

const buildEmailText = (subject, clickUrl) =>
  `${subject}\n\nHi there,\n\nWe have some exciting updates to share with you.\n\nLearn More: ${clickUrl}\n\nBest regards,\nThe Team`;

const sendSesTestCampaign = async ({ subject, fromEmail, recipients, clickUrl } = {}) => {
  const startTime = Date.now();

  const from = fromEmail || process.env.SES_FROM_EMAIL;
  const to = recipients || TEST_EMAILS;
  const url = clickUrl || CLICK_URL;

  if (!from) throw new Error('No from email. Set SES_FROM_EMAIL in .env or pass fromEmail.');
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    throw new Error('AWS credentials missing. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .env.');
  }

  const client = new SESClient({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });

  const htmlBody = buildEmailHtml(subject, url);
  const textBody = buildEmailText(subject, url);

  let sent = 0;
  let failed = 0;
  const errors = [];

  const limit = createConcurrencyLimiter(SEND_CONCURRENCY);

  await Promise.all(
    to.map(email =>
      limit(async () => {
        try {
          await client.send(new SendEmailCommand({
            Source: from,
            Destination: { ToAddresses: [email] },
            Message: {
              Subject: { Data: subject, Charset: 'UTF-8' },
              Body: {
                Html: { Data: htmlBody, Charset: 'UTF-8' },
                Text: { Data: textBody, Charset: 'UTF-8' },
              },
            },
          }));
          sent++;
          console.log(`  [SES] Sent → ${email}`);
        } catch (err) {
          failed++;
          errors.push({ email, error: err.message });
          console.error(`  [SES] Failed → ${email}: ${err.message}`);
        }
      })
    )
  );

  const duration = parseFloat(((Date.now() - startTime) / 1000).toFixed(1));
  return { sent, failed, total: to.length, errors, duration };
};

// Supabase/PostgREST caps unpaginated selects at 1000 rows (db-max-rows) — page
// through with .range() so campaigns actually reach every active mailbox, not
// just the first 1000.
const MAILBOX_PAGE_SIZE = 1000;
const fetchAllActiveMailboxEmails = async () => {
  const emails = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('auto_responder_mailboxes')
      .select('email')
      .eq('is_active', true)
      .range(offset, offset + MAILBOX_PAGE_SIZE - 1);

    if (error) throw new Error(`Failed to load recipients: ${error.message}`);

    emails.push(...data.map(m => m.email));
    if (data.length < MAILBOX_PAGE_SIZE) break;
    offset += MAILBOX_PAGE_SIZE;
  }

  return emails;
};

// Validates the request and resolves everything the send needs (template,
// integration/credentials) up front. Deliberately does NOT fetch the
// recipient list — fetchAllActiveMailboxEmails() pages through the seedlist
// 1000 rows at a time and, on its own, can take well past a minute once the
// seedlist is large. Only point lookups (template by id, integration by
// org+email) belong in this synchronous path; both the recipient fetch and
// the actual sends run in the background via executeSesSend. See
// migrations/003_ses_campaigns.sql for why.
const prepareSesCampaign = async ({ orgId, fromEmail, templateId, templateData, subject, html, text } = {}) => {
  if (!orgId) throw new Error('orgId is required.');
  if (!fromEmail) throw new Error('fromEmail is required.');
  if (!templateId && !subject) throw new Error('subject is required when not using templateId.');
  if (!templateId && !html && !text) throw new Error('At least one of templateId, html or text is required.');

  if (templateId && !html) {
    const { data: template, error: templateError } = await supabase
      .from('templates')
      .select('*')
      .eq('id', templateId)
      .eq('workspace_id', orgId)
      .single();

    if (templateError) throw new Error(`Failed to load template: ${templateError.message}`);
    if (!template) throw new Error(`No template ${templateId} found for org ${orgId}.`);

    subject = template.subject || subject;
    html = renderTemplate(template, templateData || {});
  }

  const { data: integration, error: integrationError } = await supabase
    .from('ses_integrations')
    .select('*')
    .eq('org_id', orgId)
    .eq('from_email', fromEmail)
    .eq('is_active', true)
    .maybeSingle();

  if (integrationError) throw new Error(`Failed to look up integration: ${integrationError.message}`);
  if (!integration) throw new Error(`No active SES integration found for org ${orgId} / ${fromEmail}.`);

  const client = new SESClient({
    region: integration.aws_region,
    credentials: {
      accessKeyId: decrypt(integration.aws_access_key_id_enc),
      secretAccessKey: decrypt(integration.aws_secret_access_key_enc),
    },
  });

  const body = {};
  if (html) body.Html = { Data: html, Charset: 'UTF-8' };
  if (text) body.Text = { Data: text, Charset: 'UTF-8' };

  return { orgId, fromEmail, subject, body, client };
};

// Runs the actual send prepared above: fetches the full recipient list (the
// part that can itself take well over a minute against a large seedlist —
// see prepareSesCampaign) and then sends, throttled to SEND_CONCURRENCY.
// Callers must run this in the background rather than awaiting it inline in
// an HTTP request. `onRecipientsResolved`, if given, is awaited with the
// recipient count as soon as the list is known, before sending starts, so
// callers can persist it without waiting for the whole send to finish.
const executeSesSend = async ({ orgId, fromEmail, subject, body, client, onRecipientsResolved }) => {
  const startTime = Date.now();

  const to = await fetchAllActiveMailboxEmails();
  if (onRecipientsResolved) await onRecipientsResolved(to.length);

  let sent = 0;
  let failed = 0;
  const errors = [];

  const limit = createConcurrencyLimiter(SEND_CONCURRENCY);

  await Promise.all(
    to.map(email =>
      limit(async () => {
        try {
          await client.send(new SendEmailCommand({
            Source: fromEmail,
            Destination: { ToAddresses: [email] },
            Message: {
              Subject: { Data: subject, Charset: 'UTF-8' },
              Body: body,
            },
          }));
          sent++;
          console.log(`  [SES:${orgId}] Sent → ${email}`);
        } catch (err) {
          failed++;
          errors.push({ email, error: err.message });
          console.error(`  [SES:${orgId}] Failed → ${email}: ${err.message}`);
        }
      })
    )
  );

  const duration = parseFloat(((Date.now() - startTime) / 1000).toFixed(1));
  return { sent, failed, total: to.length, errors, duration };
};

// Runs one send for an existing ses_campaigns definition row — the first
// send (called synchronously-in-background by the API route right after the
// definition row is inserted) and every recurring daily resend (called by
// the cron job in cronJobs.js) both go through this one path. Never inserts
// into ses_campaigns itself — campaignRow.id must already exist — it only
// logs the run to ses_campaign_sends and updates both rows' status on
// completion.
const runCampaignSend = async (campaignRow) => {
  const {
    id: campaignId,
    org_id: orgId,
    from_email: fromEmail,
    template_id: templateId,
    template_name: templateName,
    template_data: templateData,
    subject,
    html,
    text,
  } = campaignRow;

  // prepareSesCampaign and the ses_campaign_sends insert live inside this
  // try too — if either throws before a send even starts, the catch below
  // still needs to flip the parent ses_campaigns row out of 'sending',
  // otherwise it's stuck there forever with no retry (the cron's due-query
  // excludes 'sending' rows from every future tick).
  let sendRow;
  try {
    const prepared = await prepareSesCampaign({ orgId, fromEmail, templateId, templateData, subject, html, text });

    const { data, error: insertError } = await supabase
      .from('ses_campaign_sends')
      .insert({
        campaign_id: campaignId,
        org_id: orgId,
        from_email: fromEmail,
        template_id: templateId || null,
        template_name: templateName || null,
        status: 'sending',
        sent_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (insertError) throw new Error(`Failed to create campaign send log: ${insertError.message}`);
    sendRow = data;

    const result = await executeSesSend({
      ...prepared,
      onRecipientsResolved: (total) =>
        supabase.from('ses_campaigns').update({ total }).eq('id', campaignId),
    });

    await supabase
      .from('ses_campaign_sends')
      .update({
        status: 'completed',
        sent: result.sent,
        failed: result.failed,
        total: result.total,
        duration: result.duration,
        error: null,
      })
      .eq('id', sendRow.id);

    await supabase
      .from('ses_campaigns')
      .update({
        status: 'completed',
        sent: result.sent,
        failed: result.failed,
        total: result.total,
        duration: result.duration,
        error: null,
        completed_at: new Date().toISOString(),
      })
      .eq('id', campaignId);

    return result;
  } catch (err) {
    if (sendRow) {
      await supabase
        .from('ses_campaign_sends')
        .update({ status: 'failed', error: err.message })
        .eq('id', sendRow.id);
    }

    await supabase
      .from('ses_campaigns')
      .update({ status: 'failed', error: err.message, completed_at: new Date().toISOString() })
      .eq('id', campaignId);

    throw err;
  }
};

module.exports = { sendSesTestCampaign, prepareSesCampaign, executeSesSend, runCampaignSend, TEST_EMAILS };

// Owns the provider-dispatch and the shared ses_campaigns/ses_campaign_sends
// bookkeeping that every send transport goes through. Pulled out of
// sesEmailSender.js (where runCampaignSend used to live, SES-only) so this
// orchestration layer doesn't have to live inside any one provider's own
// module - sesEmailSender.js, resendEmailSender.js and
// platformSesEmailSender.js all stay symmetric, each just exposing a
// prepare*Campaign/execute*Send pair.
//
// Two levels here, not one:
//   - POOL (send_provider on ses_campaigns - what the frontend picks):
//       'ses'        - legacy ses_integrations pool (customer's own AWS keys)
//       'custom_dns' - Custom DNS pool (a domain with its own SES + Resend
//                      identities)
//   - TRANSPORT (send_provider on ses_campaign_sends - what actually sent
//     this specific run): 'ses' | 'platform_ses' | 'resend'
// For the 'ses' pool these are the same value. For 'custom_dns', every run
// (including every cron resend) re-resolves which transport to use, per
// the user's priority rule: SES wins whenever the domain's SES identity is
// verified, Resend is only ever used as a fallback when SES isn't. This is
// re-checked fresh each run (not decided once and cached) so a domain that
// gets SES-verified later automatically switches over with no manual
// action - see migrations/010_ses_campaigns_send_provider_custom_dns.sql.
//
// Unrelated to speed_mode_index (008_ses_campaigns_speed_mode.sql), which
// only affects cronJobs.js's resend cadence, never touched here.

const supabase = require('./supabaseClient');
const { prepareSesCampaign, executeSesSend } = require('./sesEmailSender');
const { prepareResendCampaign, executeResendSend } = require('./resendEmailSender');
const { preparePlatformSesCampaign, executePlatformSesSend } = require('./platformSesEmailSender');

const VALID_POOLS = ['ses', 'custom_dns'];

const normalizeProvider = (provider) =>
  VALID_POOLS.includes(provider) ? provider : 'ses';

// SES wins whenever it's verified, full stop - Resend is only ever the
// fallback for when SES isn't ready yet. Re-run on every single send (first
// send and every cron resend alike), never decided once and cached, so
// verification status changing later is picked up automatically.
const resolveCustomDnsTransport = async ({ orgId, fromEmail }) => {
  const { data: mailbox, error } = await supabase
    .from('sending_domain_mailboxes')
    .select('*, sending_domains(ses_identity_verification_status, resend_status)')
    .eq('organization_id', orgId)
    .eq('email_address', fromEmail)
    .eq('is_active', true)
    .maybeSingle();

  if (error) throw new Error(`Failed to look up Custom DNS mailbox: ${error.message}`);
  if (!mailbox || !mailbox.sending_domains) throw new Error(`No active Custom DNS mailbox found for org ${orgId} / ${fromEmail}.`);

  const { ses_identity_verification_status: sesStatus, resend_status: resendStatus } = mailbox.sending_domains;

  if (sesStatus === 'success') return 'platform_ses';
  if (resendStatus === 'verified') return 'resend';
  throw new Error(`Neither SES nor Resend has verified the domain for ${fromEmail} yet (SES: ${sesStatus}, Resend: ${resendStatus}).`);
};

// Single entry point the API route (index.js) uses for its synchronous
// up-front validation call, and that runCampaignSend below reuses for the
// real send. Returns the prepared send data plus `transport`, the concrete
// sender that was actually resolved - always equal to `pool` for the 'ses'
// pool, resolved fresh from live domain status for 'custom_dns'.
const prepareCampaign = async ({ provider, ...args }) => {
  const pool = normalizeProvider(provider);

  if (pool === 'custom_dns') {
    const transport = await resolveCustomDnsTransport({ orgId: args.orgId, fromEmail: args.fromEmail });
    const prepared = transport === 'platform_ses'
      ? await preparePlatformSesCampaign(args)
      : await prepareResendCampaign(args);
    return { ...prepared, transport };
  }

  return { ...(await prepareSesCampaign(args)), transport: 'ses' };
};

const executeCampaignSend = ({ transport, ...args }) => {
  if (transport === 'platform_ses') return executePlatformSesSend(args);
  if (transport === 'resend') return executeResendSend(args);
  return executeSesSend(args);
};

// Runs one send for an existing ses_campaigns definition row — the first
// send (called synchronously-in-background by the API route right after the
// definition row is inserted) and every recurring resend (called by the
// cron job in cronJobs.js, at whatever cadence its speed_mode_index sets)
// both go through this one path. Never inserts into ses_campaigns itself —
// campaignRow.id must already exist — it only logs the run to
// ses_campaign_sends and updates both rows' status on completion.
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
    provider_distribution: providerDistribution,
    selected_providers: selectedProviders,
    send_provider: pool,
  } = campaignRow;

  // prepareCampaign and the ses_campaign_sends insert live inside this try
  // too — if either throws before a send even starts, the catch below still
  // needs to flip the parent ses_campaigns row out of 'sending', otherwise
  // it's stuck there forever with no retry (the cron's due-query excludes
  // 'sending' rows from every future tick).
  let sendRow;
  try {
    const prepared = await prepareCampaign({ provider: pool, orgId, fromEmail, templateId, templateData, subject, html, text, providerDistribution, selectedProviders });
    const { transport } = prepared;

    const { data, error: insertError } = await supabase
      .from('ses_campaign_sends')
      .insert({
        campaign_id: campaignId,
        org_id: orgId,
        from_email: fromEmail,
        template_id: templateId || null,
        template_name: templateName || null,
        // The concrete transport this specific run actually used - not the
        // pool selector - so history shows e.g. "sent via Resend" on a day
        // SES wasn't verified yet, even though the campaign is (and stays)
        // tagged 'custom_dns'.
        send_provider: transport,
        status: 'sending',
        sent_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (insertError) throw new Error(`Failed to create campaign send log: ${insertError.message}`);
    sendRow = data;

    const result = await executeCampaignSend({
      transport,
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

module.exports = { runCampaignSend, prepareCampaign, normalizeProvider };

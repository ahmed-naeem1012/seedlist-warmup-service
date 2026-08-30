// Owns the provider-dispatch and the shared ses_campaigns/ses_campaign_sends
// bookkeeping that both SES and Resend sends go through. Pulled out of
// sesEmailSender.js (where runCampaignSend used to live, SES-only) so this
// orchestration layer doesn't have to live inside either provider's own
// module - sesEmailSender.js and resendEmailSender.js now stay symmetric,
// each just exposing a prepare*Campaign/execute*Send pair.
//
// send_provider (migrations/009_ses_campaigns_send_provider.sql) is what
// decides which pair runs - defaults to 'ses' so every campaign row that
// existed before this file did still behaves exactly as before. Unrelated
// to speed_mode_index (migrations/008_ses_campaigns_speed_mode.sql), which
// only affects cronJobs.js's resend cadence, never touched here.

const supabase = require('./supabaseClient');
const { prepareSesCampaign, executeSesSend } = require('./sesEmailSender');
const { prepareResendCampaign, executeResendSend } = require('./resendEmailSender');

const VALID_PROVIDERS = ['ses', 'resend'];

const normalizeProvider = (provider) =>
  VALID_PROVIDERS.includes(provider) ? provider : 'ses';

// Single entry point the API route (index.js) uses for its synchronous
// up-front validation call, and that runCampaignSend below reuses for the
// real send - one place decides which provider's prepare function runs.
const prepareCampaign = ({ provider, ...args }) =>
  normalizeProvider(provider) === 'resend'
    ? prepareResendCampaign(args)
    : prepareSesCampaign(args);

const executeCampaignSend = ({ provider, ...args }) =>
  normalizeProvider(provider) === 'resend'
    ? executeResendSend(args)
    : executeSesSend(args);

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
    send_provider: sendProvider,
  } = campaignRow;

  const provider = normalizeProvider(sendProvider);

  // prepareCampaign and the ses_campaign_sends insert live inside this try
  // too — if either throws before a send even starts, the catch below still
  // needs to flip the parent ses_campaigns row out of 'sending', otherwise
  // it's stuck there forever with no retry (the cron's due-query excludes
  // 'sending' rows from every future tick).
  let sendRow;
  try {
    const prepared = await prepareCampaign({ provider, orgId, fromEmail, templateId, templateData, subject, html, text, providerDistribution, selectedProviders });

    const { data, error: insertError } = await supabase
      .from('ses_campaign_sends')
      .insert({
        campaign_id: campaignId,
        org_id: orgId,
        from_email: fromEmail,
        template_id: templateId || null,
        template_name: templateName || null,
        send_provider: provider,
        status: 'sending',
        sent_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (insertError) throw new Error(`Failed to create campaign send log: ${insertError.message}`);
    sendRow = data;

    const result = await executeCampaignSend({
      provider,
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

// How many emails a mailbox sends per day, and how much of that is this
// service's to send.
//
// One flat number per mailbox per day, set by the organization's saved
// Warmup Preference. It is the mailbox's TOTAL across everything it is used
// for - warmup conversations and campaigns (both sent by maxify-proj/backend)
// and the template campaigns this service sends - split equally between
// those uses, with the template share then divided between the mailbox's
// templates.
//
// The numbers and the split mirror maxify-proj/backend's
// config/warmupDailyQuota.js. The two services deploy separately, so a
// change to either file has to be made in both.

const supabase = require('./supabaseClient');

// Emails/day for each warmup_preferences.speed_mode_index (Low / Medium / High).
const SPEED_MODE_DAILY_QUOTAS = [25, 50, 75];

// An organization that has never saved a preference.
const DEFAULT_SPEED_MODE_INDEX = 0;

// Index 3 was "Custom Mode", whose typed number was never stored. It is no
// longer offered; rows already saved with it are treated as High.
const LEGACY_CUSTOM_SPEED_MODE_INDEX = 3;

// Organizations on a flat HIGH_VOLUME_DAILY_QUOTA whatever their preference
// (same list as HIGH_VOLUME_ORG_IDS in maxify-proj/backend's
// config/warmupDailyQuota.js).
const HIGH_VOLUME_DAILY_QUOTA = 450;
const HIGH_VOLUME_ORG_IDS = [
  '53b13e04-ab73-4aa6-b981-3e50911ca961'
];

const normalizeSpeedModeIndex = (value) => {
  if (Number.isInteger(value) && value >= 0 && value < SPEED_MODE_DAILY_QUOTAS.length) return value;
  if (value === LEGACY_CUSTOM_SPEED_MODE_INDEX) return SPEED_MODE_DAILY_QUOTAS.length - 1;
  return DEFAULT_SPEED_MODE_INDEX;
};

const resolveDailyQuota = (orgId, speedModeIndex) => {
  if (HIGH_VOLUME_ORG_IDS.includes(orgId)) return HIGH_VOLUME_DAILY_QUOTA;
  return SPEED_MODE_DAILY_QUOTAS[normalizeSpeedModeIndex(speedModeIndex)];
};

// `total` in `parts` whole shares; the remainder goes to the first shares
// (25 in 2 -> [13, 12], in 3 -> [9, 8, 8]).
const splitEvenly = (total, parts) => {
  if (parts <= 0) return [];
  const base = Math.floor(total / parts);
  const remainder = total % parts;
  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0));
};

// A mailbox's daily number split equally between the things it is used for.
// Any remainder goes to warmup first, then templates, then campaigns.
const MAILBOX_USES = ['warmup', 'templates', 'campaigns'];
const splitDailyQuota = (total, uses) => {
  const active = MAILBOX_USES.filter((use) => uses[use]);
  const amounts = splitEvenly(total, active.length);
  const shares = { warmup: 0, templates: 0, campaigns: 0 };
  active.forEach((use, i) => { shares[use] = amounts[i]; });
  return shares;
};

const startOfUtcDay = () => {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  return dayStart;
};

// maxify-proj/backend's tables are in this service's Supabase project in
// production, but not necessarily anywhere else. A table that isn't there
// can't say a mailbox is used for anything, so it reads as "no".
const isMissingTable = (error) => error.code === '42P01' || error.code === 'PGRST205';

// _ and % are wildcards to ilike; an address can contain both.
const escapeLike = (value) => String(value).replace(/[\\%_]/g, (char) => `\\${char}`);

const getOrgDailyQuota = async (orgId) => {
  // Custom DNS / SES override rows also have warmup_email_id NULL - the
  // org-wide row is the one with no mailbox id of any kind.
  const { data, error } = await supabase
    .from('warmup_preferences')
    .select('speed_mode_index')
    .eq('organization_id', orgId)
    .is('warmup_email_id', null)
    .is('sending_domain_mailbox_id', null)
    .is('ses_integration_id', null)
    .maybeSingle();

  if (error && !isMissingTable(error)) {
    throw new Error(`Failed to load warmup preferences: ${error.message}`);
  }

  return resolveDailyQuota(orgId, data ? data.speed_mode_index : DEFAULT_SPEED_MODE_INDEX);
};

const mailboxExists = async (table, orgId, fromEmail, narrow) => {
  const query = supabase
    .from(table)
    .select('id')
    .eq('organization_id', orgId)
    .ilike('email', escapeLike(fromEmail));

  const { data, error } = await narrow(query).limit(1);

  if (error) {
    if (isMissingTable(error)) return false;
    throw new Error(`Failed to check ${table} for ${fromEmail}: ${error.message}`);
  }
  return data.length > 0;
};

// What else this sender address is used for, besides the template being sent.
const getMailboxUses = async (orgId, fromEmail) => {
  const [dashboardWarmup, apiWarmup, campaigns] = await Promise.all([
    mailboxExists('organization_warmup_emails', orgId, fromEmail, (q) => q.eq('is_active', true).eq('connection_status', 'connected')),
    mailboxExists('api_warmup_emails', orgId, fromEmail, (q) => q.eq('is_active', true)),
    mailboxExists('sendkit_mailboxes', orgId, fromEmail, (q) => q.eq('sending_enabled', true))
  ]);

  return { warmup: dashboardWarmup || apiWarmup, templates: true, campaigns };
};

// How many recipients this run of one template campaign may send to: its
// part of the mailbox's template share, less whatever has already gone out
// today (UTC). The second check is what keeps a mailbox at its number when a
// template is edited and re-saved, or another template is added, on a day
// its share has already been used.
const getTemplateRecipientLimit = async (campaignRow) => {
  const { id: campaignId, org_id: orgId, from_email: fromEmail } = campaignRow;

  const [dailyQuota, uses] = await Promise.all([
    getOrgDailyQuota(orgId),
    getMailboxUses(orgId, fromEmail)
  ]);
  const templateShare = splitDailyQuota(dailyQuota, uses).templates;

  const { data: activeCampaigns, error: campaignsError } = await supabase
    .from('ses_campaigns')
    .select('id')
    .eq('org_id', orgId)
    .eq('from_email', fromEmail)
    .eq('is_active', true)
    .order('created_at')
    .order('id');

  if (campaignsError) throw new Error(`Failed to load campaigns for ${fromEmail}: ${campaignsError.message}`);

  // A paused campaign still sends once when its template is saved - it
  // takes a part like the others for that run.
  const campaignIds = activeCampaigns.map((campaign) => campaign.id);
  if (!campaignIds.includes(campaignId)) campaignIds.push(campaignId);
  const campaignShare = splitEvenly(templateShare, campaignIds.length)[campaignIds.indexOf(campaignId)];

  const { data: sendsToday, error: sendsError } = await supabase
    .from('ses_campaign_sends')
    .select('campaign_id, total')
    .eq('org_id', orgId)
    .eq('from_email', fromEmail)
    .gte('sent_at', startOfUtcDay().toISOString());

  if (sendsError) throw new Error(`Failed to load today's sends for ${fromEmail}: ${sendsError.message}`);

  let mailboxSentToday = 0;
  let campaignSentToday = 0;
  for (const send of sendsToday) {
    mailboxSentToday += send.total || 0;
    if (send.campaign_id === campaignId) campaignSentToday += send.total || 0;
  }

  return Math.max(0, Math.min(campaignShare - campaignSentToday, templateShare - mailboxSentToday));
};

module.exports = {
  resolveDailyQuota,
  splitEvenly,
  splitDailyQuota,
  startOfUtcDay,
  getOrgDailyQuota,
  getMailboxUses,
  getTemplateRecipientLimit
};

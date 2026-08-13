const cron = require('node-cron');
const rollbar = require('../middlewares/trackers/rollbar');

const supabase = require('./supabaseClient');
const { runCampaignSend } = require('./sesEmailSender');

const { engageTestBrevo } = require('../scripts/seedlist engagments/test engagments/engage-test-brevo');
const { engageSeedlistBrevo } = require('../scripts/seedlist engagments/seedlist engagments/engage-seedlist-brevo');
const { engageSeedlistEmails: engageSeedlistBrevoV2 } = require('../scripts/seedlist engagments/seedlist engagments/engage-seedlist-brevo-v2');

const { engageTestHubspot } = require('../scripts/seedlist engagments/test engagments/engage-test-hubspot');
const { engageSeedlistHubspot } = require('../scripts/seedlist engagments/seedlist engagments/engage-seedlist-hubspot');

const { engageTestMailchimp } = require('../scripts/seedlist engagments/test engagments/engage-test-mailchimp');
const { engageSeedlistMailchimp } = require('../scripts/seedlist engagments/seedlist engagments/engage-seedlist-mailchimp');

const { engageTestActiveCampaign } = require('../scripts/seedlist engagments/test engagments/engage-test-activecampaign');
const { engageSeedlistActiveCampaign } = require('../scripts/seedlist engagments/seedlist engagments/engage-seedlist-activecampaign');

const { engageTestMailerLite } = require('../scripts/seedlist engagments/test engagments/engage-test-mailerlite');
const { engageSeedlistMailerLite } = require('../scripts/seedlist engagments/seedlist engagments/engage-seedlist-mailerlite');

const { engageTestDrip } = require('../scripts/seedlist engagments/test engagments/engage-test-drip');
const { engageSeedlistDrip } = require('../scripts/seedlist engagments/seedlist engagments/engage-seedlist-drip');
const { engageTestSes } = require('../scripts/seedlist engagments/test engagments/engage-test-ses');
const { engageSeedlistSes } = require('../scripts/seedlist engagments/seedlist engagments/engage-seedlist-ses');

const STUCK_JOB_TIMEOUT_MS = 10 * 60 * 1000;

// Re-entrancy lock + try/catch/finally, shared across all warmer jobs.
// envFlag is optional: pass it only when this exact job also runs in the
// main backend (maxify-proj) and the two services need to coordinate which
// one owns it, to avoid double-processing the same mailboxes/emails. Jobs
// that are unique to this service don't need one — they just run.
//
// IMPORTANT: a stuck job is never force-released here. Force-releasing used to
// let the next cron tick start a brand-new overlapping run on top of a job
// that was still executing in the background (nothing actually cancels the
// old run's IMAP sockets / Puppeteer pages) — on a long seedlist run that
// overlap could compound tick after tick until the server ran out of memory.
// Instead we just skip ticks and log loudly so a stuck job is visible instead
// of silently spawning duplicates.
function registerWarmerJob({ label, schedule, envFlag, run }) {
  let isRunning = false;
  let startTime = null;
  let alertedStuck = false;

  cron.schedule(schedule, async () => {
    if (envFlag && process.env[envFlag] !== 'true') return;

    if (isRunning) {
      const runningForMs = startTime ? Date.now() - startTime : 0;
      if (runningForMs > STUCK_JOB_TIMEOUT_MS && !alertedStuck) {
        alertedStuck = true;
        const msg = `[${label}] still running after ${Math.round(runningForMs / 60000)}m — skipping ticks instead of starting an overlapping run`;
        console.error(msg);
        rollbar.error(new Error(msg));
      }
      return;
    }

    isRunning = true;
    startTime = Date.now();
    alertedStuck = false;
    try {
      const result = await run();
      console.log(`[${label}]`, result);
    } catch (err) {
      console.error(`[${label}] error:`, err.message);
      rollbar.error(err);
    } finally {
      isRunning = false;
      startTime = null;
    }
  });
}

registerWarmerJob({ label: 'Brevo Test', schedule: '*/1 * * * *', envFlag: 'BREVO_TEST_WARMER', run: engageTestBrevo });
registerWarmerJob({ label: 'Brevo Seedlist', schedule: '*/1 * * * *', envFlag: 'BREVO_SEEDLIST_WARMER', run: engageSeedlistBrevo });
registerWarmerJob({ label: 'Brevo Seedlist V2', schedule: '*/1 * * * *', envFlag: 'BREVO_V2_SEEDLIST_WARMER', run: engageSeedlistBrevoV2 });

registerWarmerJob({ label: 'HubSpot Test', schedule: '*/1 * * * *', envFlag: 'HUBSPOT_TEST_WARMER', run: engageTestHubspot });
registerWarmerJob({ label: 'HubSpot Seedlist', schedule: '*/1 * * * *', envFlag: 'HUBSPOT_SEEDLIST_WARMER', run: engageSeedlistHubspot });

registerWarmerJob({ label: 'Mailchimp Test', schedule: '2-59/3 * * * *', envFlag: 'MAILCHIMP_TEST_WARMER', run: engageTestMailchimp });
registerWarmerJob({ label: 'Mailchimp Seedlist', schedule: '*/1 * * * *', envFlag: 'MAILCHIMP_SEEDLIST_WARMER', run: engageSeedlistMailchimp });

registerWarmerJob({ label: 'ActiveCampaign Test', schedule: '*/3 * * * *', envFlag: 'ACTIVECAMPAIGN_TEST_WARMER', run: engageTestActiveCampaign });
registerWarmerJob({ label: 'ActiveCampaign Seedlist', schedule: '*/1 * * * *', envFlag: 'ACTIVECAMPAIGN_SEEDLIST_WARMER', run: engageSeedlistActiveCampaign });

registerWarmerJob({ label: 'MailerLite Test', schedule: '1-59/3 * * * *', envFlag: 'MAILERLITE_TEST_WARMER', run: engageTestMailerLite });
registerWarmerJob({ label: 'MailerLite Seedlist', schedule: '*/1 * * * *', envFlag: 'MAILERLITE_SEEDLIST_WARMER', run: engageSeedlistMailerLite });

registerWarmerJob({ label: 'Drip Test', schedule: '*/3 * * * *', envFlag: 'DRIP_TEST_WARMER', run: engageTestDrip });
registerWarmerJob({ label: 'Drip Seedlist', schedule: '*/1 * * * *', envFlag: 'DRIP_SEEDLIST_WARMER', run: engageSeedlistDrip });
registerWarmerJob({ label: 'SES Test', schedule: '*/1 * * * *', envFlag: 'SES_TEST_WARMER', run: engageTestSes });
registerWarmerJob({ label: 'SES Seedlist', schedule: '*/1 * * * *', envFlag: 'SES_SEEDLIST_WARMER', run: engageSeedlistSes });

const BASE_CAMPAIGN_RESEND_INTERVAL_MS = 24 * 60 * 60 * 1000;

// 0=slow, 1=medium, 2=fast, 3=ultra — same multiplier scale as
// WarmupScheduler.js's calculateDelayMinutes() (inboxifi-backend-), applied
// here to the campaign resend interval instead of a per-recipient send
// delay, since a single SES campaign run always blasts its whole active
// pool at once rather than pacing individual sends. Extended with an
// explicit "ultra" entry that scheduler's own array leaves undefined.
const SPEED_INTERVAL_MULTIPLIERS = [1.5, 1.0, 0.6, 0.4]; // slow, medium, fast, ultra

function resendIntervalMsFor(campaign) {
  const multiplier = SPEED_INTERVAL_MULTIPLIERS[campaign.speed_mode_index] ?? 1.0;
  return BASE_CAMPAIGN_RESEND_INTERVAL_MS * multiplier;
}

// Every active ses_campaigns row recurs forever, at a cadence set by its own
// speed_mode_index, until paused (is_active = false) — there's no
// per-campaign opt-in. Polls hourly rather than firing once at a fixed
// daily time so a missed tick or a process restart doesn't push a
// campaign's resend by a full cycle; the last_run_at age check against each
// row's own interval is what actually enforces the cadence.
async function resendDueSesCampaigns() {
  // Postgres can't express "cutoff varies per row's own speed_mode_index"
  // in one .or() filter, so this pulls every candidate using the widest
  // (slowest) possible interval, then narrows to the exact per-row due set
  // in JS below.
  const widestIntervalMs = BASE_CAMPAIGN_RESEND_INTERVAL_MS * Math.max(...SPEED_INTERVAL_MULTIPLIERS);
  const widestCutoff = new Date(Date.now() - widestIntervalMs).toISOString();

  const { data: candidates, error } = await supabase
    .from('ses_campaigns')
    .select('*')
    .eq('is_active', true)
    .neq('status', 'sending')
    .or(`last_run_at.is.null,last_run_at.lte.${widestCutoff}`);

  if (error) throw new Error(`Failed to load due SES campaigns: ${error.message}`);
  if (!candidates || candidates.length === 0) return { checked: 0, started: 0 };

  const now = Date.now();
  const dueCampaigns = candidates.filter((campaign) =>
    !campaign.last_run_at || now - new Date(campaign.last_run_at).getTime() >= resendIntervalMsFor(campaign)
  );

  let started = 0;

  for (const campaign of dueCampaigns) {
    // Guarded claim: stops an overlapping tick (or a slow-running previous
    // send still in flight) from double-firing the same campaign. Only
    // proceed if this update actually flipped a row — if another tick
    // claimed it first, status is already 'sending' and 0 rows come back.
    const { data: claimed, error: claimError } = await supabase
      .from('ses_campaigns')
      .update({ status: 'sending', last_run_at: new Date().toISOString() })
      .eq('id', campaign.id)
      .neq('status', 'sending')
      .select('id');

    if (claimError) {
      console.error(`[SES Recurring] Failed to claim campaign ${campaign.id}:`, claimError.message);
      continue;
    }
    if (!claimed || claimed.length === 0) continue;

    started++;
    runCampaignSend(campaign).catch((err) => {
      console.error(`[SES Recurring] Campaign ${campaign.id} send failed:`, err.message);
    });
  }

  return { checked: dueCampaigns.length, started };
}

// No envFlag: this job is unique to this service (doesn't exist in
// maxify-proj), so there's no other instance it could double-process
// against — it should just always run.
registerWarmerJob({ label: 'SES Recurring Campaigns', schedule: '0 * * * *', run: resendDueSesCampaigns });

const { getPlatformSesCredentials, getDomainVerificationStatus } = require('./sesDomainIdentity');

// Dashboard's "Domains & DKIM" tab shows every ses_domains row as
// 'pending' until this flips it — AWS itself only checks DNS for the CNAME
// records on its own schedule, we just have to ask it. Only ever reads
// status = 'pending' rows so verified/failed domains stop costing API
// calls once they're resolved.
async function pollPendingSesDomainVerifications() {
  const { data: pendingDomains, error } = await supabase
    .from('ses_domains')
    .select('id, org_id, domain, aws_region')
    .eq('status', 'pending');

  if (error) throw new Error(`Failed to load pending SES domains: ${error.message}`);
  if (!pendingDomains || pendingDomains.length === 0) return { checked: 0, verified: 0, failed: 0 };

  let verified = 0;
  let failed = 0;

  for (const row of pendingDomains) {
    try {
      // Same platform account for every domain across every org — the
      // region must still be the one this identity was actually created
      // in, though (see getDomainVerificationStatus).
      const { accessKeyId, secretAccessKey } = getPlatformSesCredentials();
      const status = await getDomainVerificationStatus({
        region: row.aws_region,
        accessKeyId,
        secretAccessKey,
        domain: row.domain,
      });

      if (status === 'pending') continue;

      const { error: updateError } = await supabase
        .from('ses_domains')
        .update({ status })
        .eq('id', row.id);

      if (updateError) {
        console.error(`[SES Domain Verification] Failed to update ${row.domain}:`, updateError.message);
        continue;
      }

      if (status === 'verified') verified++;
      if (status === 'failed') failed++;
    } catch (err) {
      console.error(`[SES Domain Verification] Failed to check ${row.domain} (org ${row.org_id}):`, err.message);
    }
  }

  return { checked: pendingDomains.length, verified, failed };
}

registerWarmerJob({ label: 'SES Domain Verification', schedule: '*/5 * * * *', envFlag: 'SES_DOMAIN_VERIFICATION_WARMER', run: pollPendingSesDomainVerifications });

console.log('Seedlist warmer cron jobs registered.');

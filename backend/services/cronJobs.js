const cron = require('node-cron');
const rollbar = require('../middlewares/trackers/rollbar');

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

// Env-flag gate + re-entrancy lock + try/catch/finally, shared across all 10
// warmer jobs.
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
    if (process.env[envFlag] !== 'true') return;

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

console.log('Seedlist warmer cron jobs registered.');

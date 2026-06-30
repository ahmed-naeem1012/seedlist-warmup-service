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

const { engageTestSes } = require('../scripts/seedlist engagments/test engagments/engage-test-ses');
const { engageSeedlistSes } = require('../scripts/seedlist engagments/seedlist engagments/engage-seedlist-ses');

const STUCK_JOB_TIMEOUT_MS = 10 * 60 * 1000;

// Env-flag gate + re-entrancy lock (with stuck-job force release) + try/catch/finally,
// shared across all 10 warmer jobs.
function registerWarmerJob({ label, schedule, envFlag, run }) {
  let isRunning = false;
  let startTime = null;

  cron.schedule(schedule, async () => {
    if (process.env[envFlag] !== 'true') return;

    if (isRunning && startTime && (Date.now() - startTime) > STUCK_JOB_TIMEOUT_MS) {
      isRunning = false;
    }
    if (isRunning) return;

    isRunning = true;
    startTime = Date.now();
    try {
      const result = await run();
      console.log(`[${label}]`, result);
    } catch (err) {
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

registerWarmerJob({ label: 'SES Test', schedule: '*/1 * * * *', envFlag: 'SES_TEST_WARMER', run: engageTestSes });
registerWarmerJob({ label: 'SES Seedlist', schedule: '*/1 * * * *', envFlag: 'SES_SEEDLIST_WARMER', run: engageSeedlistSes });

console.log('Seedlist warmer cron jobs registered.');

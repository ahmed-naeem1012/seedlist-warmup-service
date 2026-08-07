// Prevent stray Puppeteer ProtocolErrors from crashing the process mid-run
process.on('unhandledRejection', (reason) => {
  console.error('  [unhandledRejection suppressed]', reason?.message || reason);
});

const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const crypto = require('crypto');
const puppeteer = require('puppeteer');
const http = require('http');
const https = require('https');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const TARGET_SENDERS = [
  'admin@email.clearskinstudy.com',
  'admin@email.disquantified.org',
  'admin@email.lookwhatmomfound.com',
  'admin@email.theboringmagazine.com',
  'admin@email.whatutalkingboutwillis.com',
  'advertise@email.cancelhow.com',
  'allaboard@email.jerseyexpress.net',
  'ask@email.avstarnews.com',
  'bianca@email.conversationswithbianca.com',
  'boss@email.seattlesportsonline.com',
  'boss@email.techgroup21.com',
  'boss@email.thinksano.com',
  'boss@email.travelgimmicks.com',
  'coach@email.thesportshouse.net',
  'connect@email.futuretechgirls.com',
  'contact@email.aliensync.com',
  'contact@email.allaxess.com',
  'contact@email.alternativeway.net',
  'contact@email.americanlivewire.com',
  'contact@email.anwire.org',
  'contact@email.beaconsoft.net',
  'contact@email.beyondverbal.com',
  'contact@email.bigboxratio.com',
  'contact@email.bitclassic.org',
  'contact@email.bitnation-blog.com',
  'contact@email.blueflamepublishing.net',
  'contact@email.bookvibe.com',
  'contact@email.checkerpointorg.com',
  'contact@email.creativegaming.net',
  'contact@email.daysaver.net',
  'contact@email.decoratoradvice.com',
  'contact@email.designmode24.com',
  'contact@email.digitalnewsalerts.com',
  'contact@email.digitalrgs.org',
  'contact@email.emergewomanmagazine.com',
  'contact@email.eurogamersonline.com',
  'contact@email.famousparenting.com',
  'contact@email.fintechasia.net',
  'contact@email.formotorbikes.com',
  'contact@email.freelogopng.com',
  'contact@email.gfxmaker.com',
  'contact@email.goodnever.com',
  'contact@email.healthsciencesforum.com',
  'contact@email.home-hearted.com',
  'contact@email.infomercial-reviews.org',
  'contact@email.letwomenspeak.com',
  'contact@email.livingpristine.com',
  'contact@email.mobilehomeexteriors.com',
  'contact@email.moneyaisle.com',
  'contact@email.myfavouriteplaces.org',
  'contact@email.mygreenbucks.net',
  'contact@email.myinteriorpalace.com',
  'contact@email.networkfinds.com',
  'contact@email.oneworldplate.com',
  'contact@email.premiumjoy.com',
  'contact@email.ramechanic.com',
  'contact@email.rapidhomedirect.com',
  'contact@email.springhillmedgroup.com',
  'contact@email.techidemics.com',
  'contact@email.techoelite.com',
  'contact@email.thelaptopadviser.com',
  'contact@email.thesoundstour.com',
  'contact@email.thinkofgames.com',
  'contact@email.thunderonthegulf.com',
  'contact@email.tomoson.com',
  'contact@email.travellingapples.com',
  'contact@email.voicesofconservation.org',
  'contact@email.wealthybyte.com',
  'contactus@email.plugboxlinux.org',
  'editor@email.thegamearchives.com',
  'enquiries@email.activepropertycare.com',
  'enquiries@email.fameblogs.net',
  'enquiries@email.feedbuzzard.com',
  'enquiries@email.varsitygaming.net',
  'feature@email.g15tools.com',
  'feed@email.pro-reed.com',
  'headchef@email.justalittlebite.com',
  'hello@email.amairaskincare.com.au',
  'hello@email.costofwar.com',
  'hello@email.traveltweaks.com',
  'hello@triptips.steller.co',
  'help@email.mywirelesscoupons.com',
  'help@email.revolvertech.com',
  'hi@email.igxcosmetics.com',
  'hi@email.igxocosmetics.com',
  'hitmeup@email.onthisveryspot.com',
  'ihave@email.nothing2hide.net',
  'info@email.21strongfoundation.org',
  'info@email.abithelp.com',
  'info@email.accordshort.com',
  'info@email.arcyart.com',
  'info@email.articoolo.com',
  'info@email.bageltechnews.com',
  'info@email.betterthisworld.com',
  'info@email.bettingbase.net',
  'info@email.ccafs.net',
  'info@email.cookiesforlove.com',
  'info@email.craigscottcapital.com',
  'info@email.debsllc.org',
  'info@email.deephacks.org',
  'info@email.drhomey.com',
  'info@email.embedtree.com',
  'info@email.entretech.org',
  'info@email.etherions.com',
  'info@email.etruesports.com',
  'info@email.fintechasia.net',
  'info@email.fitness-talk.net',
  'info@email.freeworlder.org',
  'info@email.harmonicode.com',
  'info@email.hearthstats.net',
  'info@email.housereal.net',
  'info@email.hyperlogic.org',
  'info@email.internet-story.com',
  'info@email.kdarchitects.net',
  'info@email.lapwinglabs.com',
  'info@email.lyncconf.com',
  'info@email.mailtopython.org',
  'info@email.mat-thebasics.com',
  'info@email.moneysideoflife.com',
  'info@email.mydecine.com',
  'info@email.mygardenandpatio.com',
  'info@email.netcurtains.org',
  'info@email.notinthekitchenanymore.com',
  'info@email.oneframework.net',
  'info@email.oneworldcolumn.org',
  'info@email.outsidedomain.com',
  'info@email.playmyworld.com',
  'info@email.pondershort.com',
  'info@email.rarefiedtech.com',
  'info@email.severedbytes.net',
  'info@email.socialbizmagazine.com',
  'info@email.startingblockonline.com',
  'info@email.terabytelabs.net',
  'info@email.thehometrotters.com',
  'info@email.thestripesblog.com',
  'info@email.timeshealthmag.com',
  'info@email.tintorera.la',
  'info@email.vital-mag.net',
  'info@email.wavetechglobal.com',
  'inquire@email.simcookie.com',
  'loaded@email.lock-7.com',
  'manager@email.fightingforfutures.org',
  'manager@email.high-tech-inspections.com',
  'manager@email.homerocketrealty.com',
  'manager@email.latesthealthtricks.com',
  'manager@email.masterrealtysolutions.com',
  'manager@email.northshoretimingonline.com',
  'manager@email.socceragency.net',
  'manager@email.thehealthyprimate.org',
  'manager@email.tomtechblog.com',
  'manager@email.treeleftbigshop.com',
  'manager@email.turbogeek.org',
  'manager@email.wizzydigital.org',
  'movein@email.middleclasshomes.net',
  'office@email.tadiran-spectralink.com',
  'questions@email.thehake.com',
  'ready@email.playbattlesquare.com',
  'share@email.lovelolablog.com',
  'showmelove@email.theportablegamer.com',
  'studio@email.eurotechtalk.com',
  'support@email.innewstoday.net',
  'support@email.iwilldominate.net',
  'support@email.myinternetaccess.net',
  'support@email.naturaplug.com',
  'support@email.silicon-insider.com',
  'support@email.songoftruth.org',
  'support@email.sourcednextdoor.com',
  'support@email.usefulideas.net',
  'support@email.webtosociety.com',
  'team@email.riproar.com',
  'theboss@email.zerodevice.net',
  'tryme@email.that-bites.org',
  'visitors@email.gamificationsummit.com',
];

const MAX_EMAIL_AGE_HOURS = 240;
const CLICK_ENABLED_UNTIL_INDEX = 730;

const ENGAGEMENT_CONFIG = {
  open_rate: 0.95,
  click_rate: 0.10,
  read_time_min: 5000,
  read_time_max: 10000,
  click_delay_min: 2000,
  click_delay_max: 4000
};

const shouldCheckReadEmails = () => true;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
  , { realtime: { transport: ws } }
);

// Supabase/PostgREST caps unpaginated selects at 1000 rows (db-max-rows) — page
// through with .range() so every active mailbox gets engaged, not just the first 1000.
const MAILBOX_PAGE_SIZE = 1000;
const fetchAllActiveMailboxes = async () => {
  const rows = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('auto_responder_mailboxes')
      .select('*')
      .eq('is_active', true)
      .order('email', { ascending: true })
      .range(offset, offset + MAILBOX_PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to fetch mailboxes: ${error.message}`);
    rows.push(...data);
    if (data.length < MAILBOX_PAGE_SIZE) break;
    offset += MAILBOX_PAGE_SIZE;
  }
  return rows;
};

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

const WORKER_CONCURRENCY = parseInt(process.env.SEEDLIST_WORKER_CONCURRENCY || '8');
const MAX_PUPPETEER_PAGES = parseInt(process.env.PUPPETEER_PAGE_POOL_SIZE || '5');
const MAILBOX_TIMEOUT_MS = parseInt(process.env.SEEDLIST_MAILBOX_TIMEOUT_MS || '120000');

let globalBrowser = null;
const campaignCache = new Map();

const getBrowser = async () => {
  if (!globalBrowser) {
    globalBrowser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-accelerated-2d-canvas', '--disable-gpu']
    });
  }
  return globalBrowser;
};

class PageSemaphore {
  constructor(max) { this.max = max; this.current = 0; this.waiting = []; }
  acquire() {
    if (this.current < this.max) { this.current++; return Promise.resolve(); }
    return new Promise(resolve => this.waiting.push(resolve));
  }
  release() {
    if (this.waiting.length > 0) { this.waiting.shift()(); } else { this.current--; }
  }
}
const pageSemaphore = new PageSemaphore(MAX_PUPPETEER_PAGES);

const createConcurrencyLimiter = (maxConcurrent) => {
  let running = 0;
  const queue = [];
  return async (fn) => {
    if (running >= maxConcurrent) await new Promise(resolve => queue.push(resolve));
    running++;
    try { return await fn(); } finally { running--; if (queue.length > 0) queue.shift()(); }
  };
};

const IMAP_CONFIG = {
  connTimeout: 60000, authTimeout: 60000, socketTimeout: 120000,
  keepalive: { interval: 10000, idleInterval: 300000, forceNoop: true }
};

const decrypt = (encrypted) => {
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY.slice(0, 32).padEnd(32, '0')), Buffer.alloc(16, 0));
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
};

const getEmailAgeHours = (emailDate) => (new Date() - new Date(emailDate)) / (1000 * 60 * 60);

const createImapConnection = async (mailbox, retries = 3) => {
  const appPassword = decrypt(mailbox.app_password).replace(/\s/g, '');
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const imap = new Imap({
        user: mailbox.email, password: appPassword, host: mailbox.imap_host, port: mailbox.imap_port,
        tls: true, tlsOptions: { rejectUnauthorized: false, minVersion: 'TLSv1.2' },
        connTimeout: IMAP_CONFIG.connTimeout, authTimeout: IMAP_CONFIG.authTimeout,
        socketTimeout: IMAP_CONFIG.socketTimeout, keepalive: IMAP_CONFIG.keepalive, debug: false
      });
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { imap.end(); reject(new Error('IMAP connection timeout')); }, IMAP_CONFIG.connTimeout + 5000);
        imap.once('ready', () => { clearTimeout(timeout); resolve(); });
        imap.once('error', (err) => { clearTimeout(timeout); imap.end(); reject(err); });
        imap.connect();
      });
      return imap;
    } catch (error) {
      if (attempt < retries) await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      else throw error;
    }
  }
};

const extractAllUrls = (emailText, emailHtml) => {
  const urls = [];
  const textMatches = (emailText || '').match(/https?:\/\/[^\s]+/g);
  if (textMatches) urls.push(...textMatches);
  let match;
  const hrefRegex = /href=["']([^"']+)["']/g;
  while ((match = hrefRegex.exec(emailHtml || '')) !== null) { if (match[1].startsWith('http')) urls.push(match[1]); }
  const imgRegex = /src=["']([^"']+)["']/g;
  while ((match = imgRegex.exec(emailHtml || '')) !== null) { if (match[1].startsWith('http')) urls.push(match[1]); }
  return [...new Set(urls)];
};

const loadUrl = async (url, type = 'unknown', retries = 2) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    await pageSemaphore.acquire();
    let page = null;
    let released = false;
    const releaseSemaphore = () => { if (!released) { released = true; pageSemaphore.release(); } };
    try {
      const browser = await getBrowser();
      page = await browser.newPage();
      await page.setDefaultTimeout(10000);
      await page.setDefaultNavigationTimeout(10000);
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      await Promise.race([
        page.goto(url, { waitUntil: 'networkidle2', timeout: 10000 }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Page load timeout')), 12000))
      ]);
      await new Promise(resolve => setTimeout(resolve, 1000));
      await page.close();
      releaseSemaphore();
      return true;
    } catch (error) {
      if (page) {
        try { await Promise.race([page.close(), new Promise((_, reject) => setTimeout(() => reject(new Error('Close timeout')), 2000))]); }
        catch (e) { try { page.close(); } catch (e2) { } }
      }
      releaseSemaphore();
      if (attempt === retries) console.log(`          ⚠️  ${type} load failed: ${error.message} (gave up after ${retries} attempts)`);
      if (attempt < retries) await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  return false;
};

// SES tracking pixels (awstrack.me) don't reliably fire via Puppeteer's
// networkidle2 wait — a plain HTTP GET registers the open just as well
// and is much cheaper, so it's used as a fallback when no real page-load is needed.
const fireTrackingUrl = async (url, retries = 2) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await new Promise((resolve, reject) => {
        const lib = url.startsWith('https://') ? https : http;
        const req = lib.get(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Connection': 'close'
          },
          timeout: 8000
        }, (res) => { res.resume(); resolve(true); });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
      });
      return true;
    } catch (err) {
      if (attempt < retries) await new Promise(r => setTimeout(r, 500));
      else console.log(`          ⚠️  fallback-open failed: ${err.message} (gave up after ${retries} attempts)`);
    }
  }
  return false;
};

const simulateReadTime = async () => {
  const delay = Math.random() * (ENGAGEMENT_CONFIG.read_time_max - ENGAGEMENT_CONFIG.read_time_min) + ENGAGEMENT_CONFIG.read_time_min;
  await new Promise(resolve => setTimeout(resolve, delay));
};

// ─── Campaign-level idempotency helpers ───────────────────────────────────────

const buildCampaignKey = (senderEmail, subject, date) => {
  const raw = `${senderEmail}||${subject}||${date}`;
  return require('crypto').createHash('sha256').update(raw).digest('hex');
};

const fisherYates = (array) => {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

const getOrCreateCampaign = async (campaignKey, senderEmail, subject, date, allMailboxes) => {
  if (campaignCache.has(campaignKey)) return campaignCache.get(campaignKey);

  const { data: existing } = await supabase
    .from('warmup_campaigns').select('*').eq('campaign_key', campaignKey).maybeSingle();
  if (existing) { campaignCache.set(campaignKey, existing); return existing; }

  const total = allMailboxes.length;
  const openRate = [0.48, 0.55, 0.60][Math.floor(Math.random() * 3)];
  const clickRate = [0.10, 0.20, 0.30, 0.35][Math.floor(Math.random() * 4)];
  const targetOpens = Math.round(total * openRate);
  const targetClicks = Math.round(targetOpens * clickRate);

  const { data: campaign, error: insertError } = await supabase
    .from('warmup_campaigns')
    .insert({
      campaign_key: campaignKey, provider: 'ses', sender_email: senderEmail,
      subject, campaign_date: date, total_mailboxes: total,
      target_open_rate: openRate, target_click_rate: clickRate,
      target_opens: targetOpens, target_clicks: targetClicks
    })
    .select().single();

  if (insertError) {
    const { data: raceWinner, error: fetchError } = await supabase
      .from('warmup_campaigns').select('*').eq('campaign_key', campaignKey).single();
    if (fetchError || !raceWinner) throw fetchError || new Error('Campaign race fetch failed');
    campaignCache.set(campaignKey, raceWinner);
    return raceWinner;
  }

  const shuffled = fisherYates(allMailboxes);
  const decisions = shuffled.map((mb, i) => ({
    campaign_id: campaign.id,
    mailbox_email: mb.email,
    decision: i < targetClicks ? 'click' : i < targetOpens ? 'open' : 'skip',
  }));
  await supabase.from('warmup_decisions').insert(decisions);

  campaignCache.set(campaignKey, campaign);
  return campaign;
};

const getDecision = async (campaignId, mailboxEmail) => {
  const { data, error } = await supabase
    .from('warmup_decisions').select('*')
    .eq('campaign_id', campaignId).eq('mailbox_email', mailboxEmail).single();
  if (error) throw error;
  return data;
};

const markOpenDone = async (id) => {
  const { error } = await supabase.from('warmup_decisions').update({ open_done: true }).eq('id', id);
  if (error) throw error;
};
const markClickDone = async (id) => {
  const { error } = await supabase.from('warmup_decisions').update({ click_done: true }).eq('id', id);
  if (error) throw error;
};

const markCleanupDone = async (id) => {
  const { error } = await supabase.from('warmup_decisions').update({ cleanup_done: true }).eq('id', id);
  if (error) throw error;
};
const markDecisionProcessed = async (id) => {
  const { error } = await supabase.from('warmup_decisions')
    .update({ processed: true, processed_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
};

const incrementCampaignOpens = (id) => supabase.rpc('inc_campaign_opens', { p_id: id });
const incrementCampaignClicks = (id) => supabase.rpc('inc_campaign_clicks', { p_id: id });

// ──────────────────────────────────────────────────────────────────────────────

const markEmailAsRead = async (mailbox, uid) => {
  if (!uid) return;
  return new Promise((resolve, reject) => {
    const appPassword = decrypt(mailbox.app_password).replace(/\s/g, '');
    const imap = new Imap({ user: mailbox.email, password: appPassword, host: mailbox.imap_host, port: mailbox.imap_port, tls: true, tlsOptions: { rejectUnauthorized: false }, connTimeout: IMAP_CONFIG.connTimeout, authTimeout: IMAP_CONFIG.authTimeout });
    imap.once('ready', () => { imap.openBox('INBOX', false, (err) => { if (err) { imap.end(); return reject(err); } imap.addFlags(uid, ['\\Seen'], (err) => { imap.end(); if (err) return reject(err); resolve(); }); }); });
    imap.once('error', (err) => reject(err));
    imap.connect();
  });
};

const moveToMaxifyLabel = async (mailbox, uid) => {
  if (!uid) return;
  return new Promise((resolve) => {
    const appPassword = decrypt(mailbox.app_password).replace(/\s/g, '');
    const imap = new Imap({ user: mailbox.email, password: appPassword, host: mailbox.imap_host, port: mailbox.imap_port, tls: true, tlsOptions: { rejectUnauthorized: false }, connTimeout: IMAP_CONFIG.connTimeout, authTimeout: IMAP_CONFIG.authTimeout });
    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err) => {
        if (err) { imap.end(); return resolve(); }
        // Archive: move out of inbox without deleting.
        // Try Gmail All Mail first, fall back to Archive folder.
        const folders = ['[Gmail]/All Mail', 'Archive'];
        const tryMove = (index) => {
          if (index >= folders.length) { imap.end(); return resolve(); }
          imap.move(uid, folders[index], (moveErr) => {
            if (moveErr) return tryMove(index + 1);
            imap.end();
            resolve();
          });
        };
        tryMove(0);
      });
    });
    imap.once('error', () => resolve());
    imap.connect();
  });
};

const buildSearchCriteria = (checkReadEmails, sinceDate) => {
  if (checkReadEmails) return [['SINCE', sinceDate]];
  return ['UNSEEN', ['SINCE', sinceDate]];
};

// Mutable — refreshed each run by refreshTargetSenders() to also include
// active tenant senders from ses_integrations, on top of the static list above.
let allTargetSenders = [...TARGET_SENDERS];
let TARGET_SENDER_SET = new Set(allTargetSenders.map((s) => s.toLowerCase()));

const isFromTargetSender = (email) => {
  const addr = (email.from?.value?.[0]?.address || '').toLowerCase();
  const text = (email.from?.text || '').toLowerCase();
  return TARGET_SENDER_SET.has(addr) || allTargetSenders.some((s) => text.includes(s.toLowerCase()));
};

const refreshTargetSenders = async () => {
  const { data, error } = await supabase
    .from('ses_integrations')
    .select('from_email')
    .eq('is_active', true);

  if (error) {
    console.error('  [TARGET_SENDERS] Failed to load tenant senders, using static list only:', error.message);
    return;
  }

  const tenantSenders = (data || []).map((row) => row.from_email);
  allTargetSenders = [...new Set([...TARGET_SENDERS, ...tenantSenders])];
  TARGET_SENDER_SET = new Set(allTargetSenders.map((s) => s.toLowerCase()));
};

const checkSpamAndMove = async (mailbox, checkReadEmails = false) => {
  try {
    const imap = await createImapConnection(mailbox);
    await new Promise((resolve) => {
      const spamFolders = ['[Gmail]/Spam', 'Spam', 'Junk', 'SPAM'];
      const tryFolder = (index) => {
        if (index >= spamFolders.length) { imap.end(); return resolve(0); }
        imap.openBox(spamFolders[index], false, (err) => {
          if (err) return tryFolder(index + 1);
          const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
          imap.search(buildSearchCriteria(checkReadEmails, sevenDaysAgo), (err, results) => {
            if (err || !results || results.length === 0) { imap.end(); return resolve(0); }
            let completed = 0, succeeded = 0;
            results.forEach((seqno) => { imap.move(seqno, 'INBOX', (moveErr) => { completed++; if (!moveErr) succeeded++; if (completed === results.length) { setTimeout(() => { imap.end(); resolve(succeeded); }, 2000); } }); });
          });
        });
      };
      tryFolder(0);
    });
  } catch (error) { return 0; }
};

const checkPromotionsAndMove = async (mailbox, checkReadEmails = false) => {
  try {
    const imap = await createImapConnection(mailbox);
    await new Promise((resolve) => {
      const promotionsFolders = ['[Gmail]/Promotions', 'Promotions', '[Gmail]/All Mail'];
      const tryFolder = (index) => {
        if (index >= promotionsFolders.length) { imap.end(); return resolve(0); }
        imap.openBox(promotionsFolders[index], false, (err) => {
          if (err) return tryFolder(index + 1);
          const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
          imap.search(buildSearchCriteria(checkReadEmails, sevenDaysAgo), (err, results) => {
            if (err || !results || results.length === 0) { imap.end(); return resolve(0); }
            let completed = 0, succeeded = 0;
            results.forEach((seqno) => { imap.move(seqno, 'INBOX', (moveErr) => { completed++; if (!moveErr) succeeded++; if (completed === results.length) { setTimeout(() => { imap.end(); resolve(succeeded); }, 2000); } }); });
          });
        });
      };
      tryFolder(0);
    });
  } catch (error) { return 0; }
};

const processMailbox = async (mailbox, mailboxIndex = 999, allMailboxes = []) => {
  const ENABLE_CLICKS = mailboxIndex <= CLICK_ENABLED_UNTIL_INDEX;
  const checkReadEmails = shouldCheckReadEmails(mailbox.email);

  const movedFromSpam = await checkSpamAndMove(mailbox, checkReadEmails);
  const movedFromPromotions = await checkPromotionsAndMove(mailbox, checkReadEmails);
  if (movedFromSpam + movedFromPromotions > 0) { await new Promise(resolve => setTimeout(resolve, 5000)); }

  try {
    const imap = await createImapConnection(mailbox);
    const emails = await new Promise((resolve, reject) => {
      imap.openBox('INBOX', false, (err) => {
        if (err) { imap.end(); return reject(err); }
        const tenDaysAgo = new Date(); tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
        imap.search(buildSearchCriteria(checkReadEmails, tenDaysAgo), (err, results) => {
          if (err) { imap.end(); return reject(err); }
          if (!results || results.length === 0) { imap.end(); return resolve([]); }
          const fetch = imap.fetch(results.reverse(), { bodies: '', struct: true, markSeen: false, envelope: true });
          const emailPromises = [];
          fetch.on('message', (msg, seqno) => {
            const emailPromise = new Promise((resolveEmail) => {
              let buffer = '', uid = null, bodyEnded = false, attrsReceived = false;
              msg.once('attributes', (attrs) => { uid = attrs.uid; attrsReceived = true; if (bodyEnded) resolveWithParsedEmail(); });
              const resolveWithParsedEmail = async () => {
                try {
                  const parsed = await simpleParser(buffer);
                  if (!uid) uid = seqno;
                  resolveEmail({ seqno, uid, from: parsed.from, subject: parsed.subject || 'No subject', text: parsed.text || '', html: parsed.html || '', messageId: parsed.messageId || null, date: parsed.date });
                } catch (e) { resolveEmail(null); }
              };
              msg.on('body', (stream) => { stream.on('data', (chunk) => { buffer += chunk.toString('utf8'); }); stream.once('end', () => { bodyEnded = true; if (attrsReceived) resolveWithParsedEmail(); }); });
              msg.once('end', () => { if (!attrsReceived && bodyEnded) setTimeout(resolveWithParsedEmail, 100); });
            });
            emailPromises.push(emailPromise);
          });
          fetch.once('error', (err) => { imap.end(); reject(err); });
          fetch.once('end', async () => { const parsed = await Promise.all(emailPromises); imap.end(); resolve(parsed.filter(e => e !== null)); });
        });
      });
    });

    if (emails.length === 0) return { mailbox: mailbox.email, found: 0, opened: 0, clicked: 0 };

    const targetEmails = emails.filter(isFromTargetSender);
    const nonTargetCount = emails.length - targetEmails.length;
    if (nonTargetCount > 0) console.log(`   📭 ${nonTargetCount} non-target email(s) skipped`);
    if (targetEmails.length > 0) {
      console.log(`   📬 ${targetEmails.length} target-sender email(s) found:`);
      for (const e of targetEmails) {
        const addr = e.from?.value?.[0]?.address || e.from?.text || 'unknown';
        console.log(`      → ${addr} | ${e.subject}`);
      }
    }

    let openedCount = 0, clickedCount = 0;

    for (const email of targetEmails) {
      try {
        const senderEmail = email.from?.value?.[0]?.address || email.from?.text;

        if (getEmailAgeHours(email.date) > MAX_EMAIL_AGE_HOURS) {
          await markEmailAsRead(mailbox, email.uid);
          try { await moveToMaxifyLabel(mailbox, email.uid); } catch (e) { }
          continue;
        }

        const emailDate = email.date
          ? new Date(email.date).toISOString().slice(0, 10)
          : new Date().toISOString().slice(0, 10);
        const campaignKey = buildCampaignKey(senderEmail, email.subject || '', emailDate);

        // Campaign-memory is best-effort: if warmup_campaigns/warmup_decisions
        // is unavailable (missing table/columns/RPCs), fall back to a local
        // random-roll decision instead of skipping the email entirely.
        let campaign = null, decisionRow = null;
        try {
          campaign = await getOrCreateCampaign(campaignKey, senderEmail,
            email.subject || '', emailDate, allMailboxes);
          decisionRow = await getDecision(campaign.id, mailbox.email);
        } catch (dbErr) {
          console.log(`          ⚠️  Campaign-memory unavailable (${dbErr.message}) — using local random-roll engagement`);
        }

        if (decisionRow?.processed) {
          console.log(`          ✅ Already fully processed — archiving`);
          await markEmailAsRead(mailbox, email.uid);
          try { await moveToMaxifyLabel(mailbox, email.uid); } catch (e) { }
          continue;
        }

        const willOpen = decisionRow ? decisionRow.decision !== 'skip' : Math.random() < ENGAGEMENT_CONFIG.open_rate;
        const willClick = decisionRow ? decisionRow.decision === 'click' : Math.random() < ENGAGEMENT_CONFIG.click_rate;

        if (!willOpen) {
          console.log(`          ❌ Not engaged (skip)`);
          await markEmailAsRead(mailbox, email.uid);
          try {
            await moveToMaxifyLabel(mailbox, email.uid);
            console.log(`          📁 Archived (not engaged)`);
          } catch (labelError) {
            console.log(`          ⚠️  Archive failed: ${labelError.message}`);
          }
          if (decisionRow) {
            await markCleanupDone(decisionRow.id).catch(e =>
              console.log(`          ⚠️  markCleanupDone failed: ${e.message}`));
            await markDecisionProcessed(decisionRow.id).catch(e =>
              console.log(`          ⚠️  markDecisionProcessed failed: ${e.message}`));
          }
          continue;
        }

        const allUrls = extractAllUrls(email.text, email.html);

        // ── SES-ONLY tracking pixel detection ────────────────────────
        const trackingPixels = allUrls.filter((url) => {
          const lowerUrl = url.toLowerCase();
          const isSesTracker = lowerUrl.includes('awstrack.me') && lowerUrl.includes('/trk/open');
          const isNotClickTracker = !(lowerUrl.includes('awstrack.me') && lowerUrl.includes('/trk/click'));
          return isSesTracker && isNotClickTracker;
        });

        const needsOpenLoad = decisionRow ? !decisionRow.open_done : true;
        if (needsOpenLoad) {
          if (decisionRow) {
            await markOpenDone(decisionRow.id).catch(e =>
              console.log(`          ⚠️  markOpenDone failed (continuing anyway): ${e.message}`));
          }
          let openFired = false;
          let openUrl = null;
          if (trackingPixels.length > 0) {
            for (const pixel of trackingPixels) {
              const fired = await loadUrl(pixel, 'pixel');
              if (fired) { openFired = true; openUrl = pixel; }
              await new Promise(resolve => setTimeout(resolve, 800));
            }
            await new Promise(resolve => setTimeout(resolve, 3000));
          } else {
            const fallback = allUrls.find(url => url.startsWith('http') && !url.toLowerCase().includes('unsubscribe'));
            if (fallback) {
              openFired = await fireTrackingUrl(fallback);
              if (openFired) openUrl = fallback;
              await new Promise(resolve => setTimeout(resolve, 3000));
            }
          }
          if (openFired) {
            const openDomain = (() => { try { return new URL(openUrl).hostname; } catch { return openUrl; } })();
            console.log(`          ✓ OPENED — ${email.subject} [pixel: ${openDomain}]`);
            if (campaign) {
              await incrementCampaignOpens(campaign.id).catch(e =>
                console.log(`          ⚠️  inc actual_opens failed: ${e.message}`));
            }
          } else {
            console.log(`          ✗ OPEN FAILED — ${email.subject}`);
          }
        }

        openedCount++;
        await simulateReadTime();

        const needsClickLoad = ENABLE_CLICKS && willClick && (decisionRow ? !decisionRow.click_done : true);
        if (needsClickLoad) {
          if (decisionRow) {
            await markClickDone(decisionRow.id).catch(e =>
              console.log(`          ⚠️  markClickDone failed (continuing anyway): ${e.message}`));
          }
          const clickableLinks = allUrls.filter((url) =>
            url.startsWith('http') &&
            !url.toLowerCase().includes('unsubscribe') &&
            !trackingPixels.includes(url));
          const sesClickLinks = clickableLinks.filter((url) => {
            const lowerUrl = url.toLowerCase();
            return lowerUrl.includes('awstrack.me') && lowerUrl.includes('/trk/click');
          });
          const linksToClickFrom = sesClickLinks.length > 0 ? sesClickLinks : clickableLinks;
          if (linksToClickFrom.length > 0) {
            const randomLink = linksToClickFrom[Math.floor(Math.random() * linksToClickFrom.length)];
            await new Promise(resolve => setTimeout(resolve, Math.random() * (ENGAGEMENT_CONFIG.click_delay_max - ENGAGEMENT_CONFIG.click_delay_min) + ENGAGEMENT_CONFIG.click_delay_min));
            const clicked = await loadUrl(randomLink, 'click');
            if (clicked) {
              clickedCount++;
              if (campaign) {
                await incrementCampaignClicks(campaign.id).catch(e =>
                  console.log(`          ⚠️  inc actual_clicks failed: ${e.message}`));
              }
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
          }
        }

        await new Promise(resolve => setTimeout(resolve, 2000));
        await markEmailAsRead(mailbox, email.uid);
        try { await moveToMaxifyLabel(mailbox, email.uid); } catch (e) { }

        if (decisionRow) {
          await markCleanupDone(decisionRow.id).catch(e =>
            console.log(`          ⚠️  markCleanupDone failed: ${e.message}`));
          await markDecisionProcessed(decisionRow.id).catch(e =>
            console.log(`          ⚠️  markDecisionProcessed failed: ${e.message}`));
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (emailError) {
        console.error(`          Error:`, emailError.message);
      }
    }

    return { mailbox: mailbox.email, found: targetEmails.length, opened: openedCount, clicked: clickedCount };
  } catch (error) {
    return { mailbox: mailbox.email, found: 0, opened: 0, clicked: 0, error: error.message };
  }
};

const engageSeedlistSes = async () => {
  const startTime = Date.now();
  console.log('\n========================================');
  console.log('   [SES] SEEDLIST ENGAGEMENT');
  console.log('========================================\n');

  try {
    await getBrowser();
    await refreshTargetSenders();
    const mailboxes = await fetchAllActiveMailboxes();
    if (mailboxes.length === 0) return { mailboxCount: 0, mailboxesWithEmails: 0, found: 0, opened: 0, clicked: 0, duration: 0 };

    const limit = createConcurrencyLimiter(WORKER_CONCURRENCY);
    let logIndex = 0;

    const results = await Promise.all(
      mailboxes.map((mailbox) => {
        logIndex++;
        const currentIndex = logIndex;
        return limit(async () => {
          console.log(`\n[${currentIndex}/${mailboxes.length}] ${mailbox.email}`);
          try {
            const result = await Promise.race([
              processMailbox(mailbox, currentIndex, mailboxes),
              new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout (${MAILBOX_TIMEOUT_MS / 1000}s)`)), MAILBOX_TIMEOUT_MS))
            ]);
            if (result.found > 0) {
              console.log(`    Done - Found: ${result.found} | Opened: ${result.opened} | Clicked: ${result.clicked}`);
            } else {
              console.log(`    No emails from target senders`);
            }
            return result;
          } catch (error) {
            console.log(`    ERROR: ${error.message}`);
            return { mailbox: mailbox.email, found: 0, opened: 0, clicked: 0, error: error.message };
          }
        });
      })
    );

    const totalFound = results.reduce((s, r) => s + r.found, 0);
    const totalOpened = results.reduce((s, r) => s + r.opened, 0);
    const totalClicked = results.reduce((s, r) => s + r.clicked, 0);
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n[SES SEEDLIST] Found: ${totalFound} | Opened: ${totalOpened} | Clicked: ${totalClicked} | ${duration}s\n`);
    if (globalBrowser) { try { await globalBrowser.close(); globalBrowser = null; } catch (e) { } }
    return { mailboxCount: mailboxes.length, mailboxesWithEmails: results.filter(r => r.found > 0).length, found: totalFound, opened: totalOpened, clicked: totalClicked, duration: parseFloat(duration) };
  } catch (error) {
    if (globalBrowser) { try { await globalBrowser.close(); globalBrowser = null; } catch (e) { } }
    console.error('\n CRITICAL ERROR:', error);
    throw error;
  }
};

module.exports = { engageSeedlistSes };

if (require.main === module) {
  engageSeedlistSes().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
}

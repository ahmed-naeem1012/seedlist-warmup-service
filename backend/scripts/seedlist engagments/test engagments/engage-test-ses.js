const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const crypto = require('crypto');
const puppeteer = require('puppeteer');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

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
  'henri@pickmyuselyhq.com',
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
  'becca@putmyuselysync.com'
];

// TODO: Set your SES sender address(es) before enabling SES_TEST_WARMER
const TARGET_SENDERS = [
  'abdullahamir1010@gmail.com'
];

const MAX_EMAIL_AGE_HOURS = 1;
const CLICK_ENABLED_UNTIL_INDEX = 82;

const ENGAGEMENT_CONFIG = {
  open_rate: 0.75,
  click_rate: 0.10,
  read_time_min: 5000,
  read_time_max: 10000,
  click_delay_min: 2000,
  click_delay_max: 4000
};

const shouldCheckReadEmails = (email) => email.toLowerCase().includes('use');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
, { realtime: { transport: ws } }
);

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

const WORKER_CONCURRENCY = parseInt(process.env.SEEDLIST_WORKER_CONCURRENCY || '25');
const MAX_PUPPETEER_PAGES = parseInt(process.env.PUPPETEER_PAGE_POOL_SIZE || '15');
const MAILBOX_TIMEOUT_MS = 90000;

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

  const total        = allMailboxes.length;
  const openRate     = [0.48, 0.55, 0.60][Math.floor(Math.random() * 3)];
  const clickRate    = [0.10, 0.20, 0.30, 0.35][Math.floor(Math.random() * 4)];
  const targetOpens  = Math.round(total * openRate);
  const targetClicks = Math.round(targetOpens * clickRate);

  const { data: campaign, error: insertError } = await supabase
    .from('warmup_campaigns')
    .insert({ campaign_key: campaignKey, provider: 'ses', sender_email: senderEmail,
              subject, campaign_date: date, total_mailboxes: total,
              target_open_rate: openRate, target_click_rate: clickRate,
              target_opens: targetOpens, target_clicks: targetClicks })
    .select().single();

  if (insertError) {
    const { data: raceWinner, error: fetchError } = await supabase
      .from('warmup_campaigns').select('*').eq('campaign_key', campaignKey).single();
    if (fetchError || !raceWinner) throw fetchError || new Error('Campaign race fetch failed');
    campaignCache.set(campaignKey, raceWinner);
    return raceWinner;
  }

  const shuffled  = fisherYates(allMailboxes);
  const decisions = shuffled.map((mb, i) => ({
    campaign_id:   campaign.id,
    mailbox_email: mb.email,
    decision:      i < targetClicks ? 'click' : i < targetOpens ? 'open' : 'skip',
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

const incrementCampaignOpens  = (id) => supabase.rpc('inc_campaign_opens',  { p_id: id });
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
  return new Promise((resolve, reject) => {
    const appPassword = decrypt(mailbox.app_password).replace(/\s/g, '');
    const imap = new Imap({ user: mailbox.email, password: appPassword, host: mailbox.imap_host, port: mailbox.imap_port, tls: true, tlsOptions: { rejectUnauthorized: false }, connTimeout: IMAP_CONFIG.connTimeout, authTimeout: IMAP_CONFIG.authTimeout });
    imap.once('ready', () => { imap.openBox('INBOX', false, (err) => { if (err) { imap.end(); return reject(err); } imap.addFlags(uid, ['\\Deleted'], (flagErr) => { if (flagErr) { imap.end(); return reject(flagErr); } imap.expunge((expErr) => { imap.end(); if (expErr) return reject(expErr); resolve(); }); }); }); });
    imap.once('error', (err) => reject(err));
    imap.connect();
  });
};

const buildSearchCriteria = (checkReadEmails, sinceDate) => {
  let senderCriteria;
  if (TARGET_SENDERS.length === 1) { senderCriteria = ['FROM', TARGET_SENDERS[0]]; }
  else if (TARGET_SENDERS.length === 2) { senderCriteria = ['OR', ['FROM', TARGET_SENDERS[0]], ['FROM', TARGET_SENDERS[1]]]; }
  else { let orChain = ['FROM', TARGET_SENDERS[TARGET_SENDERS.length - 1]]; for (let i = TARGET_SENDERS.length - 2; i >= 0; i--) { orChain = ['OR', ['FROM', TARGET_SENDERS[i]], orChain]; } senderCriteria = orChain; }
  if (checkReadEmails) return [senderCriteria, ['SINCE', sinceDate]];
  return ['UNSEEN', senderCriteria, ['SINCE', sinceDate]];
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
  if (checkReadEmails) console.log(`   📖 "USE" MAILBOX DETECTED`);
  console.log(`   Clicks ${ENABLE_CLICKS ? 'ENABLED' : 'DISABLED'} (${mailboxIndex}/${CLICK_ENABLED_UNTIL_INDEX})`);

  console.log(`    Checking SPAM folder...`);
  const movedFromSpam = await checkSpamAndMove(mailbox, checkReadEmails);
  console.log(`    Checking PROMOTIONS folder...`);
  const movedFromPromotions = await checkPromotionsAndMove(mailbox, checkReadEmails);
  if (movedFromSpam + movedFromPromotions > 0) { await new Promise(resolve => setTimeout(resolve, 5000)); }

  try {
    const imap = await createImapConnection(mailbox);
    const emails = await new Promise((resolve, reject) => {
      imap.openBox('INBOX', false, (err) => {
        if (err) { imap.end(); return reject(err); }
        const twoDaysAgo = new Date(); twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
        imap.search(buildSearchCriteria(checkReadEmails, twoDaysAgo), (err, results) => {
          if (err) { imap.end(); return reject(err); }
          if (!results || results.length === 0) { imap.end(); return resolve([]); }
          const fetch = imap.fetch(results.reverse(), { bodies: '', struct: true, markSeen: false, envelope: true });
          const emailPromises = [];
          fetch.on('message', (msg, seqno) => {
            const emailPromise = new Promise((resolveEmail) => {
              let buffer = '', uid = null, bodyEnded = false, attrsReceived = false;
              msg.once('attributes', (attrs) => { uid = attrs.uid; attrsReceived = true; if (bodyEnded) resolveWithParsedEmail(); });
              const resolveWithParsedEmail = async () => {
                try { const parsed = await simpleParser(buffer); if (!uid) uid = seqno; resolveEmail({ seqno, uid, from: parsed.from, subject: parsed.subject || 'No subject', text: parsed.text || '', html: parsed.html || '', date: parsed.date }); }
                catch (e) { resolveEmail(null); }
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
    let openedCount = 0, clickedCount = 0;

    for (const email of emails) {
      try {
        const senderEmail = email.from?.value?.[0]?.address || email.from?.text;
        console.log(`       Campaign: ${senderEmail} | Subject: ${email.subject}`);

        const emailAgeHours = getEmailAgeHours(email.date);
        if (emailAgeHours > MAX_EMAIL_AGE_HOURS) {
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
          campaign    = await getOrCreateCampaign(campaignKey, senderEmail,
                          email.subject || '', emailDate, allMailboxes);
          decisionRow = await getDecision(campaign.id, mailbox.email);
        } catch (dbErr) {
          console.log(`          ⚠️  Campaign-memory unavailable (${dbErr.message}) — using local random-roll engagement`);
        }

        if (decisionRow?.processed) {
          console.log(`          ✅ Already fully processed — archiving`);
          await markEmailAsRead(mailbox, email.uid);
          try { await moveToMaxifyLabel(mailbox, email.uid); } catch (e) {}
          continue;
        }

        const willOpen  = decisionRow ? decisionRow.decision !== 'skip' : Math.random() < ENGAGEMENT_CONFIG.open_rate;
        const willClick = decisionRow ? decisionRow.decision === 'click' : Math.random() < ENGAGEMENT_CONFIG.click_rate;

        if (!willOpen) {
          console.log(`          ❌ Not engaged (skip)`);
          await markEmailAsRead(mailbox, email.uid);
          try {
            await moveToMaxifyLabel(mailbox, email.uid);
            console.log(`          📁 Moved to "Maxify's Label" (not engaged)`);
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
        // SES open tracking: awstrack.me/.../trk/open/...
        // SES click tracking: awstrack.me/.../trk/click/...
        const trackingPixels = allUrls.filter(url => {
          const lowerUrl = url.toLowerCase();
          const isSesTracker = lowerUrl.includes('awstrack.me') && lowerUrl.includes('/trk/open');
          return isSesTracker;
        });

        const needsOpenLoad = decisionRow ? !decisionRow.open_done : true;
        if (needsOpenLoad) {
          if (decisionRow) {
            await markOpenDone(decisionRow.id).catch(e =>
              console.log(`          ⚠️  markOpenDone failed (continuing anyway): ${e.message}`));
          }
          if (trackingPixels.length > 0) {
            console.log(`          📊 Found ${trackingPixels.length} SES tracking pixel(s)`);
            for (const pixel of trackingPixels) { await loadUrl(pixel, 'pixel'); await new Promise(resolve => setTimeout(resolve, 800)); }
            await new Promise(resolve => setTimeout(resolve, 3000));
          } else {
            const fallbackLinks = allUrls.filter(url => url.startsWith('http') && !url.toLowerCase().includes('unsubscribe'));
            if (fallbackLinks.length > 0) { await loadUrl(fallbackLinks[0], 'fallback-open'); await new Promise(resolve => setTimeout(resolve, 3000)); }
          }
          if (campaign) {
            await incrementCampaignOpens(campaign.id).catch(e =>
              console.log(`          ⚠️  inc actual_opens failed: ${e.message}`));
          }
        }

        openedCount++;
        console.log(`          ✓ EMAIL OPENED`);
        await simulateReadTime();

        const needsClickLoad = ENABLE_CLICKS && willClick && (decisionRow ? !decisionRow.click_done : true);
        if (needsClickLoad) {
          if (decisionRow) {
            await markClickDone(decisionRow.id).catch(e =>
              console.log(`          ⚠️  markClickDone failed (continuing anyway): ${e.message}`));
          }
          const clickableLinks = allUrls.filter(url => url.startsWith('http') && !url.toLowerCase().includes('unsubscribe') && !trackingPixels.includes(url));

          // Prioritize SES click tracking links
          const sesClickLinks = clickableLinks.filter(url => {
            const lowerUrl = url.toLowerCase();
            return lowerUrl.includes('awstrack.me') && lowerUrl.includes('/trk/click');
          });
          const linksToClickFrom = sesClickLinks.length > 0 ? sesClickLinks : clickableLinks;
          if (sesClickLinks.length > 0) console.log(`          🎯 Found ${sesClickLinks.length} SES click link(s)`);

          if (linksToClickFrom.length > 0) {
            const randomLink = linksToClickFrom[Math.floor(Math.random() * linksToClickFrom.length)];
            const clickDelay = Math.random() * (ENGAGEMENT_CONFIG.click_delay_max - ENGAGEMENT_CONFIG.click_delay_min) + ENGAGEMENT_CONFIG.click_delay_min;
            await new Promise(resolve => setTimeout(resolve, clickDelay));
            const clicked = await loadUrl(randomLink, 'click');
            if (clicked) {
              clickedCount++;
              if (campaign) {
                await incrementCampaignClicks(campaign.id).catch(e =>
                  console.log(`          ⚠️  inc actual_clicks failed: ${e.message}`));
              }
              console.log(`          ✓ CLICKED`);
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

    return { mailbox: mailbox.email, found: emails.length, opened: openedCount, clicked: clickedCount };
  } catch (error) {
    return { mailbox: mailbox.email, found: 0, opened: 0, clicked: 0, error: error.message };
  }
};

const engageTestSes = async () => {
  const startTime = Date.now();
  console.log('\n========================================');
  console.log('   [SES] TEST ENGAGEMENT');
  console.log('========================================\n');

  try {
    await getBrowser();
    const { data: mailboxData, error: fetchError } = await supabase.from('auto_responder_mailboxes').select('*').in('email', TEST_EMAILS);
    if (fetchError) throw new Error(`Failed to fetch mailboxes: ${fetchError.message}`);

    const mailboxes = TEST_EMAILS.map(email => mailboxData.find(m => m.email === email)).filter(m => m !== undefined);
    if (mailboxes.length === 0) return { mailboxCount: 0, mailboxesWithEmails: 0, found: 0, opened: 0, clicked: 0, duration: 0 };

    const limit = createConcurrencyLimiter(WORKER_CONCURRENCY);
    let logIndex = 0;

    const processPromise = Promise.all(
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
            console.log(result.found > 0 ? `    Done - Found: ${result.found} | Opened: ${result.opened} | Clicked: ${result.clicked}` : `    No emails`);
            return result;
          } catch (error) {
            console.log(`    ERROR: ${error.message}`);
            return { mailbox: mailbox.email, found: 0, opened: 0, clicked: 0, error: error.message };
          }
        });
      })
    );

    const globalTimeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('GLOBAL TIMEOUT: Script exceeded 2.5 minutes')), 150000)
    );

    let results;
    try {
      results = await Promise.race([processPromise, globalTimeout]);
    } catch (timeoutError) {
      console.error(`\n⏱️  ${timeoutError.message} - Forcing completion`);
      results = [];
    }

    const totalFound = results.reduce((s, r) => s + r.found, 0);
    const totalOpened = results.reduce((s, r) => s + r.opened, 0);
    const totalClicked = results.reduce((s, r) => s + r.clicked, 0);
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`\n[SES] Found: ${totalFound} | Opened: ${totalOpened} | Clicked: ${totalClicked} | ${duration}s\n`);
    if (globalBrowser) { try { await globalBrowser.close(); globalBrowser = null; } catch (e) { } }
    return { mailboxCount: mailboxes.length, mailboxesWithEmails: results.filter(r => r.found > 0).length, found: totalFound, opened: totalOpened, clicked: totalClicked, duration: parseFloat(duration) };
  } catch (error) {
    if (globalBrowser) { try { await globalBrowser.close(); globalBrowser = null; } catch (e) { } }
    console.error('\n CRITICAL ERROR:', error);
    throw error;
  }
};

module.exports = { engageTestSes };

if (require.main === module) {
  engageTestSes().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
}

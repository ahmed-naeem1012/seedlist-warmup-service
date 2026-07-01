require('dotenv').config();

require('./services/cronJobs');

const http = require('http');
const fs   = require('fs');
const path = require('path');

const { sendSesTestCampaign, TEST_EMAILS } = require('./services/sesEmailSender');

const port = process.env.PORT || 3000;

const parseBody = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(raw)); } catch { resolve({}); }
    });
  });

const json = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
};

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  // ── existing health check (unchanged) ────────────────────────────────────
  if (url === '/health' || url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'seedlist-warmup-service' }));
    return;
  }

  // ── dashboard UI ──────────────────────────────────────────────────────────
  if (req.method === 'GET' && url === '/dashboard') {
    try {
      const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch {
      json(res, 500, { error: 'Dashboard file not found.' });
    }
    return;
  }

  // ── GET /api/ses/test-emails ──────────────────────────────────────────────
  if (req.method === 'GET' && url === '/api/ses/test-emails') {
    return json(res, 200, { emails: TEST_EMAILS, count: TEST_EMAILS.length });
  }

  // ── POST /api/ses/send-test-campaign ──────────────────────────────────────
  if (req.method === 'POST' && url === '/api/ses/send-test-campaign') {
    try {
      const body      = await parseBody(req);
      const subject   = (body.subject || '').trim() || `SES Test Campaign — ${new Date().toISOString()}`;
      const fromEmail = body.fromEmail || process.env.SES_FROM_EMAIL;

      if (!fromEmail) {
        return json(res, 400, {
          success: false,
          error: 'SES_FROM_EMAIL is not configured. Add it to .env or pass fromEmail in the request body.',
        });
      }
      if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
        return json(res, 400, {
          success: false,
          error: 'AWS credentials are not configured. Add AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY to .env.',
        });
      }

      console.log(`\n[SES SENDER] Campaign: "${subject}"`);
      console.log(`[SES SENDER] From: ${fromEmail} → ${TEST_EMAILS.length} recipients\n`);

      const result = await sendSesTestCampaign({ subject, fromEmail });

      console.log(`\n[SES SENDER] Done — Sent: ${result.sent} | Failed: ${result.failed} | ${result.duration}s\n`);

      return json(res, 200, { success: true, ...result });
    } catch (err) {
      console.error('[SES SENDER] Error:', err.message);
      return json(res, 500, { success: false, error: err.message });
    }
  }

  // ── 404 ───────────────────────────────────────────────────────────────────
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(port, () => {
  console.log(`Seedlist warmup service running on port ${port}.`);
  console.log(`Dashboard: http://localhost:${port}/dashboard`);
});

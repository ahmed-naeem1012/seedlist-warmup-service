require('dotenv').config();

require('./services/cronJobs');

const http = require('http');
const fs   = require('fs');
const path = require('path');

const { sendSesTestCampaign, sendSesCampaignForOrg, TEST_EMAILS } = require('./services/sesEmailSender');
const supabase = require('./services/supabaseClient');
const { encrypt } = require('./utils/crypto');

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

const getQuery = (req) => new URL(req.url, 'http://internal').searchParams;

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

  // ── POST /api/integrations/ses ────────────────────────────────────────────
  if (req.method === 'POST' && url === '/api/integrations/ses') {
    try {
      const body = await parseBody(req);
      const { orgId, fromEmail, awsAccessKeyId, awsSecretAccessKey } = body;
      const awsRegion = body.awsRegion || 'us-east-1';

      if (!orgId || !fromEmail || !awsAccessKeyId || !awsSecretAccessKey) {
        return json(res, 400, {
          success: false,
          error: 'orgId, fromEmail, awsAccessKeyId and awsSecretAccessKey are all required.',
        });
      }

      const { data, error } = await supabase
        .from('ses_integrations')
        .upsert({
          org_id: orgId,
          from_email: fromEmail,
          aws_region: awsRegion,
          aws_access_key_id_enc: encrypt(awsAccessKeyId),
          aws_secret_access_key_enc: encrypt(awsSecretAccessKey),
          is_active: true,
        }, { onConflict: 'org_id,from_email' })
        .select('id, org_id, from_email, aws_region, is_active, created_at, updated_at')
        .single();

      if (error) return json(res, 500, { success: false, error: error.message });
      return json(res, 200, { success: true, integration: data });
    } catch (err) {
      return json(res, 500, { success: false, error: err.message });
    }
  }

  // ── GET /api/integrations/ses?orgId=... ───────────────────────────────────
  if (req.method === 'GET' && url === '/api/integrations/ses') {
    const orgId = getQuery(req).get('orgId');
    if (!orgId) return json(res, 400, { success: false, error: 'orgId query param is required.' });

    const { data, error } = await supabase
      .from('ses_integrations')
      .select('id, from_email, aws_region, is_active, last_error, created_at, updated_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: true });

    if (error) return json(res, 500, { success: false, error: error.message });
    return json(res, 200, { success: true, integrations: data });
  }

  // ── DELETE /api/integrations/ses/:id ───────────────────────────────────────
  if (req.method === 'DELETE' && url.startsWith('/api/integrations/ses/')) {
    const id = url.slice('/api/integrations/ses/'.length);
    if (!id) return json(res, 400, { success: false, error: 'Integration id is required.' });

    const { error } = await supabase
      .from('ses_integrations')
      .update({ is_active: false })
      .eq('id', id);

    if (error) return json(res, 500, { success: false, error: error.message });
    return json(res, 200, { success: true });
  }

  // ── POST /api/ses/send-campaign ───────────────────────────────────────────
  if (req.method === 'POST' && url === '/api/ses/send-campaign') {
    try {
      const body = await parseBody(req);
      const { orgId, fromEmail, templateId, templateData, subject, html, text } = body;

      console.log(`\n[SES CAMPAIGN] org=${orgId} from=${fromEmail} templateId=${templateId || '-'} subject="${subject || ''}"`);

      const result = await sendSesCampaignForOrg({ orgId, fromEmail, templateId, templateData, subject, html, text });

      console.log(`[SES CAMPAIGN] Done — Sent: ${result.sent} | Failed: ${result.failed} | ${result.duration}s\n`);

      return json(res, 200, { success: true, ...result });
    } catch (err) {
      console.error('[SES CAMPAIGN] Error:', err.message);
      return json(res, 400, { success: false, error: err.message });
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

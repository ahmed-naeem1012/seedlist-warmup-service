require('dotenv').config();

require('./services/cronJobs');

const http = require('http');
const fs   = require('fs');
const path = require('path');

const { sendSesTestCampaign, prepareSesCampaign, executeSesSend, runCampaignSend, TEST_EMAILS } = require('./services/sesEmailSender');
const supabase = require('./services/supabaseClient');
const { encrypt } = require('./utils/crypto');
const { resolveOrgSesCredentials, createDomainIdentity } = require('./services/sesDomainIdentity');

const port = process.env.PORT || 3000;

const DOMAIN_REGEX = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

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

  // ── POST /api/integrations/ses/bulk ───────────────────────────────────────
  if (req.method === 'POST' && url === '/api/integrations/ses/bulk') {
    try {
      const body = await parseBody(req);
      const { orgId, awsRegion, awsAccessKeyId, awsSecretAccessKey, fromEmails } = body;

      if (!orgId || !awsRegion || !awsAccessKeyId || !awsSecretAccessKey || !Array.isArray(fromEmails) || fromEmails.length === 0) {
        return json(res, 400, {
          success: false,
          error: 'orgId, awsRegion, awsAccessKeyId, awsSecretAccessKey and a non-empty fromEmails array are all required.',
        });
      }

      if (!fromEmails.every(e => typeof e === 'string' && e.trim())) {
        return json(res, 400, { success: false, error: 'fromEmails must be an array of non-empty strings.' });
      }

      const uniqueFromEmails = [...new Set(fromEmails.map(e => e.trim()))];

      const MAX_BULK_EMAILS = 100;
      if (uniqueFromEmails.length > MAX_BULK_EMAILS) {
        return json(res, 400, {
          success: false,
          error: `fromEmails exceeds the maximum of ${MAX_BULK_EMAILS} entries.`,
        });
      }

      const rows = uniqueFromEmails.map(fromEmail => ({
        org_id: orgId,
        from_email: fromEmail,
        aws_region: awsRegion,
        aws_access_key_id_enc: encrypt(awsAccessKeyId),
        aws_secret_access_key_enc: encrypt(awsSecretAccessKey),
        is_active: true,
      }));

      const { data, error } = await supabase
        .from('ses_integrations')
        .upsert(rows, { onConflict: 'org_id,from_email' })
        .select('id, org_id, from_email, aws_region, is_active, created_at, updated_at');

      if (error) return json(res, 500, { success: false, error: error.message });
      return json(res, 200, { success: true, integrations: data });
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

  // ── POST /api/domains ──────────────────────────────────────────────────────
  // Adds a sending domain for DKIM verification. Calls real AWS SESv2
  // CreateEmailIdentity (services/sesDomainIdentity.js) using the org's
  // stored ses_integrations credentials — the 3 CNAME records saved here
  // are the actual tokens AWS returns, not locally generated placeholders.
  if (req.method === 'POST' && url === '/api/domains') {
    try {
      const body = await parseBody(req);
      const { orgId } = body;
      const domain = (body.domain || '').trim().toLowerCase();

      if (!orgId || !domain) {
        return json(res, 400, { success: false, error: 'orgId and domain are required.' });
      }
      if (!DOMAIN_REGEX.test(domain)) {
        return json(res, 400, { success: false, error: 'Enter a valid domain, e.g. yourdomain.com.' });
      }

      const { data: existing, error: lookupError } = await supabase
        .from('ses_domains')
        .select('id')
        .eq('org_id', orgId)
        .eq('domain', domain)
        .maybeSingle();

      if (lookupError) return json(res, 500, { success: false, error: lookupError.message });
      if (existing) {
        return json(res, 409, { success: false, error: 'This domain has already been added.' });
      }

      let credentials;
      try {
        credentials = await resolveOrgSesCredentials(orgId);
      } catch (err) {
        return json(res, 400, { success: false, error: err.message });
      }

      let tokens;
      try {
        tokens = await createDomainIdentity({ ...credentials, domain });
      } catch (err) {
        return json(res, 502, { success: false, error: `AWS SES rejected this domain: ${err.message}` });
      }

      const cnameRecords = tokens.map((token) => ({
        name: `${token}._domainkey.${domain}`,
        value: `${token}.dkim.amazonses.com`,
      }));

      const { data, error } = await supabase
        .from('ses_domains')
        .insert({ org_id: orgId, domain, cname_records: cnameRecords, aws_region: credentials.region })
        .select('id, domain, cname_records, status, created_at, updated_at')
        .single();

      if (error) return json(res, 500, { success: false, error: error.message });
      return json(res, 200, { success: true, domain: data });
    } catch (err) {
      return json(res, 500, { success: false, error: err.message });
    }
  }

  // ── GET /api/domains?orgId=... ─────────────────────────────────────────────
  if (req.method === 'GET' && url === '/api/domains') {
    const orgId = getQuery(req).get('orgId');
    if (!orgId) return json(res, 400, { success: false, error: 'orgId query param is required.' });

    const { data, error } = await supabase
      .from('ses_domains')
      .select('id, domain, cname_records, status, created_at, updated_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false });

    if (error) return json(res, 500, { success: false, error: error.message });
    return json(res, 200, { success: true, domains: data });
  }

  // ── DELETE /api/domains/:id?orgId=... ──────────────────────────────────────
  if (req.method === 'DELETE' && url.startsWith('/api/domains/')) {
    const id = url.slice('/api/domains/'.length);
    const orgId = getQuery(req).get('orgId');
    if (!id) return json(res, 400, { success: false, error: 'Domain id is required.' });
    if (!orgId) return json(res, 400, { success: false, error: 'orgId query param is required.' });

    const { error } = await supabase
      .from('ses_domains')
      .delete()
      .eq('id', id)
      .eq('org_id', orgId);

    if (error) return json(res, 500, { success: false, error: error.message });
    return json(res, 200, { success: true });
  }

  // ── POST /api/domains/:id/senders ──────────────────────────────────────────
  // Adds a "From" sender at a verified domain, reusing the org's existing
  // active ses_integrations credentials (copied as-is, ciphertext to
  // ciphertext — never decrypted here) so the user never re-enters AWS keys
  // just to add another sender address. Lands in ses_integrations, the same
  // table the campaigns tab's "Send from" dropdown already reads from.
  if (req.method === 'POST' && url.startsWith('/api/domains/') && url.endsWith('/senders')) {
    try {
      const id = url.slice('/api/domains/'.length, url.length - '/senders'.length);
      const body = await parseBody(req);
      const { orgId } = body;
      const fromEmail = (body.fromEmail || '').trim();

      if (!id || !orgId || !fromEmail) {
        return json(res, 400, { success: false, error: 'orgId, domain id and fromEmail are required.' });
      }

      const { data: domainRow, error: domainError } = await supabase
        .from('ses_domains')
        .select('domain, status')
        .eq('id', id)
        .eq('org_id', orgId)
        .maybeSingle();

      if (domainError) return json(res, 500, { success: false, error: domainError.message });
      if (!domainRow) return json(res, 404, { success: false, error: 'Domain not found.' });
      if (domainRow.status !== 'verified') {
        return json(res, 400, { success: false, error: 'This domain must be verified before adding senders.' });
      }

      const emailDomain = fromEmail.split('@')[1]?.toLowerCase();
      if (emailDomain !== domainRow.domain) {
        return json(res, 400, { success: false, error: `Sender email must be at ${domainRow.domain}.` });
      }

      const { data: sourceIntegration, error: sourceError } = await supabase
        .from('ses_integrations')
        .select('aws_region, aws_access_key_id_enc, aws_secret_access_key_enc')
        .eq('org_id', orgId)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (sourceError) return json(res, 500, { success: false, error: sourceError.message });
      if (!sourceIntegration) {
        return json(res, 400, { success: false, error: 'No active AWS SES integration found for this organization. Add your AWS SES credentials first.' });
      }

      const { data, error } = await supabase
        .from('ses_integrations')
        .upsert({
          org_id: orgId,
          from_email: fromEmail,
          aws_region: sourceIntegration.aws_region,
          aws_access_key_id_enc: sourceIntegration.aws_access_key_id_enc,
          aws_secret_access_key_enc: sourceIntegration.aws_secret_access_key_enc,
          is_active: true,
        }, { onConflict: 'org_id,from_email' })
        .select('id, from_email, aws_region, is_active, created_at, updated_at')
        .single();

      if (error) return json(res, 500, { success: false, error: error.message });
      return json(res, 200, { success: true, integration: data });
    } catch (err) {
      return json(res, 500, { success: false, error: err.message });
    }
  }

  // ── POST /api/ses/send-campaign ───────────────────────────────────────────
  // Queues the send and returns as soon as the job is recorded — the actual
  // sending (one SES call per active seedlist mailbox) runs in the
  // background and can take minutes, which used to make callers (dashboard
  // → nginx) time out waiting on this response. See
  // migrations/003_ses_campaigns.sql. Poll GET /api/ses/campaigns?orgId=
  // for progress.
  //
  // This creates or reuses the campaign *definition* row — it must never
  // insert a second row for a template+sender that's already recurring.
  // Every day after the first send, the recurring cron job in
  // services/cronJobs.js resends against this same row via
  // runCampaignSend(), it never inserts a new ses_campaigns row. See
  // migrations/005_ses_campaigns_recurring.sql.
  if (req.method === 'POST' && url === '/api/ses/send-campaign') {
    try {
      const body = await parseBody(req);
      const { orgId, fromEmail, templateId, templateName, templateData, subject, html, text } = body;

      console.log(`\n[SES CAMPAIGN] org=${orgId} from=${fromEmail} templateId=${templateId || '-'} subject="${subject || ''}"`);

      const prepared = await prepareSesCampaign({ orgId, fromEmail, templateId, templateData, subject, html, text });

      let campaign;

      // Saving a template auto-triggers this route once per connected
      // sender. Without this lookup, every edit+resave would insert a brand
      // new recurring campaign alongside the old one instead of updating
      // it — both would then go on sending daily forever, compounding with
      // every edit. Reuse the existing definition row for this
      // org+sender+template instead of always inserting.
      if (templateId) {
        const { data: existing, error: lookupError } = await supabase
          .from('ses_campaigns')
          .select('*')
          .eq('org_id', orgId)
          .eq('from_email', fromEmail)
          .eq('template_id', templateId)
          .limit(1)
          .maybeSingle();

        if (lookupError) return json(res, 500, { success: false, error: lookupError.message });

        if (existing) {
          // Deliberately not touching is_active here: if the user paused
          // this campaign, editing the template later shouldn't silently
          // resume it behind their back. Pausing stays paused until they
          // explicitly resume it. The edit still sends right now regardless
          // — is_active only gates the cron's daily pickup, not this
          // direct call.
          const { data: updated, error: updateError } = await supabase
            .from('ses_campaigns')
            .update({
              template_data: templateData || null,
              subject: prepared.subject,
              html: html || null,
              text: text || null,
              last_run_at: new Date().toISOString(),
            })
            .eq('id', existing.id)
            .select('*')
            .single();

          if (updateError) return json(res, 500, { success: false, error: updateError.message });
          campaign = updated;
        }
      }

      if (!campaign) {
        const { data: inserted, error: insertError } = await supabase
          .from('ses_campaigns')
          .insert({
            org_id: orgId,
            from_email: fromEmail,
            template_id: templateId || null,
            template_name: templateName || null,
            template_data: templateData || null,
            subject: prepared.subject,
            html: html || null,
            text: text || null,
            status: 'sending',
            is_active: true,
            last_run_at: new Date().toISOString(),
          })
          .select('*')
          .single();

        if (insertError) return json(res, 500, { success: false, error: insertError.message });
        campaign = inserted;
      }

      runCampaignSend(campaign)
        .then((result) => {
          console.log(`[SES CAMPAIGN] Done — Sent: ${result.sent} | Failed: ${result.failed} | ${result.duration}s\n`);
        })
        .catch((err) => {
          console.error('[SES CAMPAIGN] Background send failed:', err.message);
        });

      return json(res, 202, { success: true, id: campaign.id, status: 'sending' });
    } catch (err) {
      console.error('[SES CAMPAIGN] Error:', err.message);
      return json(res, 400, { success: false, error: err.message });
    }
  }

  // ── GET /api/ses/campaigns?orgId=... ──────────────────────────────────────
  if (req.method === 'GET' && url === '/api/ses/campaigns') {
    const orgId = getQuery(req).get('orgId');
    if (!orgId) return json(res, 400, { success: false, error: 'orgId query param is required.' });

    const { data, error } = await supabase
      .from('ses_campaigns')
      .select('id, from_email, template_id, template_name, status, total, sent, failed, duration, error, is_active, last_run_at, created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) return json(res, 500, { success: false, error: error.message });

    const campaigns = data.map((c) => ({
      id: c.id,
      fromEmail: c.from_email,
      templateId: c.template_id,
      templateName: c.template_name,
      sentAt: c.created_at,
      status: c.status,
      total: c.total,
      sent: c.sent,
      failed: c.failed,
      duration: c.duration,
      error: c.error,
      isActive: c.is_active,
      lastRunAt: c.last_run_at,
    }));

    return json(res, 200, { success: true, campaigns });
  }

  // ── DELETE /api/ses/campaigns/:id ─────────────────────────────────────────
  // Soft-stop: pauses the recurring daily resend without deleting history.
  // Same pattern as DELETE /api/integrations/ses/:id.
  if (req.method === 'DELETE' && url.startsWith('/api/ses/campaigns/')) {
    const id = url.slice('/api/ses/campaigns/'.length);
    if (!id) return json(res, 400, { success: false, error: 'Campaign id is required.' });

    const { error } = await supabase
      .from('ses_campaigns')
      .update({ is_active: false })
      .eq('id', id);

    if (error) return json(res, 500, { success: false, error: error.message });
    return json(res, 200, { success: true });
  }

  // ── POST /api/ses/campaigns/:id/resume ────────────────────────────────────
  // Un-pauses a campaign. Only flips is_active back on — last_run_at is left
  // untouched so the normal due-check on the next cron tick decides whether
  // it's immediately due or still has to wait out the rest of the 24h window.
  if (req.method === 'POST' && url.startsWith('/api/ses/campaigns/') && url.endsWith('/resume')) {
    const id = url.slice('/api/ses/campaigns/'.length, url.length - '/resume'.length);
    if (!id) return json(res, 400, { success: false, error: 'Campaign id is required.' });

    const { error } = await supabase
      .from('ses_campaigns')
      .update({ is_active: true })
      .eq('id', id);

    if (error) return json(res, 500, { success: false, error: error.message });
    return json(res, 200, { success: true });
  }

  // ── 404 ───────────────────────────────────────────────────────────────────
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(port, () => {
  console.log(`Seedlist warmup service running on port ${port}.`);
  console.log(`Dashboard: http://localhost:${port}/dashboard`);
});

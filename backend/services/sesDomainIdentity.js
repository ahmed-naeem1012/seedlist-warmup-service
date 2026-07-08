const { SESv2Client, CreateEmailIdentityCommand, GetEmailIdentityCommand } = require('@aws-sdk/client-sesv2');
const supabase = require('./supabaseClient');
const { decrypt } = require('../utils/crypto');

// Picks which of the org's AWS credentials to create/verify domain
// identities against. Orgs typically have one AWS account behind their SES
// integrations, so "most recently added active integration" is the simple,
// correct default — the Domains & DKIM tab has no per-domain credential
// picker (yet; would need one if an org ever runs multiple AWS accounts).
async function resolveOrgSesCredentials(orgId) {
  const { data: integration, error } = await supabase
    .from('ses_integrations')
    .select('aws_region, aws_access_key_id_enc, aws_secret_access_key_enc')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Failed to look up SES credentials: ${error.message}`);
  if (!integration) {
    throw new Error('No active AWS SES integration found for this organization. Add your AWS SES credentials first.');
  }

  return {
    region: integration.aws_region,
    accessKeyId: decrypt(integration.aws_access_key_id_enc),
    secretAccessKey: decrypt(integration.aws_secret_access_key_enc),
  };
}

// Creates the SES email identity for `domain` in AWS and returns its real
// DKIM tokens — the same 3 tokens shown in the SES console, used to build
// the CNAME records the user copies into their DNS provider.
async function createDomainIdentity({ region, accessKeyId, secretAccessKey, domain }) {
  const client = new SESv2Client({ region, credentials: { accessKeyId, secretAccessKey } });

  try {
    const response = await client.send(new CreateEmailIdentityCommand({
      EmailIdentity: domain,
      DkimSigningAttributes: { NextSigningKeyLength: 'RSA_2048_BIT' },
    }));

    const tokens = response.DkimAttributes && response.DkimAttributes.Tokens;
    if (!tokens || tokens.length === 0) {
      throw new Error('AWS SES did not return DKIM tokens for this domain.');
    }
    return tokens;
  } catch (err) {
    // Domain is already a registered identity in this AWS account (added
    // directly in the SES console, or a prior attempt that created it in
    // AWS but failed before we stored it) — fetch its existing tokens
    // instead of failing the add.
    if (err.name === 'AlreadyExistsException') {
      const existing = await client.send(new GetEmailIdentityCommand({ EmailIdentity: domain }));
      const tokens = existing.DkimAttributes && existing.DkimAttributes.Tokens;
      if (!tokens || tokens.length === 0) {
        throw new Error('This domain already exists in AWS SES but has no DKIM tokens to show.');
      }
      return tokens;
    }
    throw err;
  }
}

// Checks AWS for the current DKIM verification state of a previously
// created domain identity. `region` must be the domain's own stored
// aws_region (migrations/006_ses_domains.sql) — not necessarily the org's
// most-recently-added integration's region — since SES identities are
// per-region and querying the wrong one returns NotFoundException even
// though the identity exists. accessKeyId/secretAccessKey are account-wide
// though, so any of the org's active integrations can supply those.
//
// Returns 'verified' once AWS confirms the CNAME records, 'failed' if AWS
// gave up on them, or 'pending' if there's nothing new yet (keep polling).
async function getDomainVerificationStatus({ region, accessKeyId, secretAccessKey, domain }) {
  const client = new SESv2Client({ region, credentials: { accessKeyId, secretAccessKey } });
  const response = await client.send(new GetEmailIdentityCommand({ EmailIdentity: domain }));

  const dkimStatus = response.DkimAttributes && response.DkimAttributes.Status;
  if (dkimStatus === 'SUCCESS') return 'verified';
  if (dkimStatus === 'FAILED') return 'failed';
  // PENDING, NOT_STARTED, TEMPORARY_FAILURE — none of these are final, keep polling.
  return 'pending';
}

module.exports = { resolveOrgSesCredentials, createDomainIdentity, getDomainVerificationStatus };

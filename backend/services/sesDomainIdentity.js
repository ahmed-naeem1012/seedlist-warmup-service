const { SESv2Client, CreateEmailIdentityCommand, GetEmailIdentityCommand } = require('@aws-sdk/client-sesv2');

// Domain verification is NOT per-org — customers never provide their own AWS
// keys for this. A customer's domain gets whitelisted against Maxify's own
// AWS SES account: we create the identity here, hand them the DKIM CNAME
// records, they add those to their own DNS, and once AWS confirms them,
// *our* account is authorized to send as their domain. Sending later goes
// out through this same platform account on their behalf.
//
// This intentionally has zero relationship to the "SES Credentials" tab
// (ses_integrations) — that's a separate, optional bring-your-own-AWS path
// for customers who want to connect their own account for warmup. Domains &
// DKIM must work with no row in that table at all.
function getPlatformSesCredentials() {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const region = process.env.AWS_REGION;

  if (!accessKeyId || !secretAccessKey || !region) {
    throw new Error(
      "Maxify's AWS SES is not configured on this server. Set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and AWS_REGION in .env."
    );
  }

  return { accessKeyId, secretAccessKey, region };
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
// created domain identity. `region` should be the domain's own stored
// aws_region (migrations/006_ses_domains.sql) — SES identities are
// per-region, and since it's always this same platform account, that's
// just process.env.AWS_REGION at the time the domain was created (kept
// per-row in case the platform's region config ever changes later).
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

module.exports = { getPlatformSesCredentials, createDomainIdentity, getDomainVerificationStatus };

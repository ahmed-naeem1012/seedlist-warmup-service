const { SESClient, GetSendQuotaCommand } = require('@aws-sdk/client-ses');

// GetSendQuota is the standard "are these SES creds real" probe — it needs
// only ses:GetSendQuota (present in virtually every SES policy, including
// read-only ones), touches no data, and never sends an email, unlike
// actually attempting a send just to test auth.
const validateAwsSesCredentials = async ({ accessKeyId, secretAccessKey, region }) => {
  const client = new SESClient({ region, credentials: { accessKeyId, secretAccessKey } });

  try {
    await client.send(new GetSendQuotaCommand({}));
  } catch (err) {
    if (err.name === 'InvalidClientTokenId' || err.name === 'UnrecognizedClientException') {
      throw new Error('AWS rejected this access key ID — it doesn\'t exist or was deactivated.');
    }
    if (err.name === 'SignatureDoesNotMatch') {
      throw new Error('AWS rejected this secret access key — it doesn\'t match the access key ID.');
    }
    if (err.name === 'AccessDenied' || err.name === 'AccessDeniedException') {
      throw new Error('These AWS credentials are valid but lack SES permissions (ses:GetSendQuota) in this region.');
    }
    throw new Error(`AWS rejected these credentials: ${err.message}`);
  }
};

module.exports = { validateAwsSesCredentials };

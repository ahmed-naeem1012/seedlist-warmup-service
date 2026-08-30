const axios = require('axios');

const RESEND_BASE_URL = 'https://api.resend.com';

// Same platform-credentials model as maxify-proj/backend's resendClient.js -
// one shared account for every org's verified Custom DNS domain, never a
// customer-supplied key. Deliberately the same env var name as that repo so
// copying the value across is a straight paste, not a rename.
const getPlatformApiKey = () => {
  const apiKey = process.env.RESEND_API_KEY_FULL_PER;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY_FULL_PER is not configured in .env.');
  }
  return apiKey;
};

const authHeaders = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${getPlatformApiKey()}`
});

const sendEmail = async ({ from, to, subject, html, text }) => {
  const response = await axios.post(
    `${RESEND_BASE_URL}/emails`,
    { from, to: [to], subject, html, text },
    { headers: authHeaders() }
  );
  return { messageId: response.data.id };
};

module.exports = { sendEmail };

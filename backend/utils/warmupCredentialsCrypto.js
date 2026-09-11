// Decrypts organization_warmup_emails.smtp_password / imap_password.
//
// Those columns are written by maxify-proj/backend's utils/encryption.js,
// which uses a DIFFERENT scheme from this service's own utils/crypto.js
// (that one is only for auto_responder_mailboxes.app_password):
//
//   utils/crypto.js (seedlist)      encryption.js (maxify-proj/backend)
//   key = first 32 chars of KEY     key = hex-decoded KEY (must be 32 bytes)
//   IV  = 16 zero bytes             IV  = random, stored as "ivhex:cipherhex"
//
// So ciphertext from one cannot be read by the other. This module is a
// faithful port of the backend's decryptPassword so the SMTP campaign
// transport can use the same stored app passwords the backend's own
// SmtpWarmupService.js sends with. It reads WARMUP_ENCRYPTION_KEY if set,
// otherwise ENCRYPTION_KEY - in production both projects share one value.

const crypto = require('crypto');

const ALGORITHM = 'aes-256-cbc';

const getKey = () => {
  const raw = process.env.WARMUP_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('WARMUP_ENCRYPTION_KEY (or ENCRYPTION_KEY) is not set - cannot decrypt warmup mailbox credentials.');
  }
  const key = Buffer.from(raw, 'hex');
  if (key.length === 32) return key;
  // Backend fallback for a non-32-byte key: SHA-256 of the raw string.
  return crypto.createHash('sha256').update(raw).digest();
};

const decryptWarmupCredential = (encrypted) => {
  if (!encrypted || typeof encrypted !== 'string') {
    throw new Error('Encrypted credential is empty.');
  }
  const parts = encrypted.split(':');
  if (parts.length !== 2) {
    throw new Error('Encrypted credential is not in the expected iv:ciphertext format.');
  }
  const iv = Buffer.from(parts[0], 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  let decrypted = decipher.update(parts[1], 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
};

module.exports = { decryptWarmupCredential };

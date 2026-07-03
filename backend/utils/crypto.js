const crypto = require('crypto');

// Same AES-256-CBC scheme already used across the engage-*.js scripts to
// decrypt auto_responder_mailboxes.app_password — same ENCRYPTION_KEY,
// same null-IV convention. Kept identical so ciphertext is interchangeable
// with what those scripts already produce/consume.
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const KEY_BUFFER = () => Buffer.from(ENCRYPTION_KEY.slice(0, 32).padEnd(32, '0'));
const IV = Buffer.alloc(16, 0);

const encrypt = (text) => {
  const cipher = crypto.createCipheriv('aes-256-cbc', KEY_BUFFER(), IV);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
};

const decrypt = (encrypted) => {
  const decipher = crypto.createDecipheriv('aes-256-cbc', KEY_BUFFER(), IV);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
};

module.exports = { encrypt, decrypt };

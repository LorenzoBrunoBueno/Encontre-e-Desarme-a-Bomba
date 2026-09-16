const { scryptSync, randomBytes, timingSafeEqual } = require('crypto');

const KEY_LENGTH = 64;

function hashPin(pin) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(pin, salt, KEY_LENGTH).toString('hex');
  return { salt, hash };
}

function verifyPin(pin, salt, expectedHash) {
  const candidate = scryptSync(pin, salt, KEY_LENGTH);
  const expected = Buffer.from(expectedHash, 'hex');
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

module.exports = { hashPin, verifyPin };

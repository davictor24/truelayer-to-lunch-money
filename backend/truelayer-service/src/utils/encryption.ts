import crypto from 'crypto';
import config from '../config';

const algorithm = 'aes-256-cbc';
const { secret, salt } = config.truelayer.tokenEncryption;
if (!secret) {
  throw new Error('TRUELAYER_TOKEN_ENCRYPTION_SECRET environment variable not specified');
}
if (!salt) {
  throw new Error('TRUELAYER_TOKEN_ENCRYPTION_SALT environment variable not specified');
}
const key = crypto.scryptSync(secret, salt, 32);

export async function encrypt(plainText: string): Promise<string> {
  const iv: Buffer = crypto.randomBytes(16);
  const cipher: crypto.Cipher = crypto.createCipheriv(algorithm, key, iv);
  const encrypted: string = cipher.update(plainText, 'utf8', 'hex');
  return [
    encrypted + cipher.final('hex'),
    Buffer.from(iv).toString('hex'),
  ].join('|');
}

export async function decrypt(cipherText: string): Promise<string> {
  const [encrypted, iv] = cipherText.split('|');
  if (!iv) throw new Error('IV not found');
  const decipher: crypto.Decipher = crypto.createDecipheriv(
    algorithm,
    key,
    Buffer.from(iv, 'hex'),
  );
  return decipher.update(encrypted, 'hex', 'utf8') + decipher.final('utf8');
}

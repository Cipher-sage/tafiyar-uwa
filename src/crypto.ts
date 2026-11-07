import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const COST = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
function derive(secret: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(secret, salt, 32, COST, (error, key) => error ? reject(error) : resolve(key));
  });
}

export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(secret, salt);
  return `scrypt$32768$8$3$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifySecret(secret: string, hash: string): Promise<boolean> {
  const fields = hash.split('$');
  if (fields.length !== 6 || fields.slice(0, 4).join('$') !== 'scrypt$32768$8$3' ||
    !/^[a-f0-9]{32}$/.test(fields[4] ?? '') || !/^[a-f0-9]{64}$/.test(fields[5] ?? '')) return false;
  const expected = Buffer.from(fields[5]!, 'hex');
  const actual = await derive(secret, Buffer.from(fields[4]!, 'hex'));
  return timingSafeEqual(expected, actual);
}

export interface SessionClaims { type: 'staff' | 'mother'; id: number; version: number; expires: number; nonce: string }

export function signSession(claims: SessionClaims, secret: string): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifySession(token: string, secret: string, now = Date.now()): SessionClaims | null {
  if (token.length > 1500) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, signature] = parts as [string, string];
  const expected = createHmac('sha256', secret).update(payload).digest();
  const supplied = Buffer.from(signature, 'base64url');
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as SessionClaims;
    if (!['staff', 'mother'].includes(claims.type) || !Number.isSafeInteger(claims.id) || claims.id < 1 ||
      !Number.isSafeInteger(claims.version) || claims.version < 0 || !Number.isSafeInteger(claims.expires) ||
      claims.expires <= Math.floor(now / 1000) || typeof claims.nonce !== 'string' || claims.nonce.length < 16) return null;
    return claims;
  } catch { return null; }
}

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import type { OfflineAuditGrant } from './provider.js';

type SessionReceipt = OfflineAuditGrant & { sessionKey: string };

// This receipt can report openings of one already-audited record. It cannot read a record.
export function offlineReceipts(secret: string) {
  const key = createHmac('sha256', secret).update('tafiyar-uwa/offline-audit/v1').digest();
  function issue(grant: SessionReceipt): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(grant), 'utf8'), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString('base64url');
  }
  function read(token: unknown): SessionReceipt | null {
    if (typeof token !== 'string' || token.length > 8000 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
    try {
      const envelope = Buffer.from(token, 'base64url');
      if (envelope.length <= 28 || envelope.toString('base64url') !== token) return null;
      const decipher = createDecipheriv('aes-256-gcm', key, envelope.subarray(0, 12));
      decipher.setAuthTag(envelope.subarray(12, 28));
      const clear = Buffer.concat([decipher.update(envelope.subarray(28)), decipher.final()]);
      return JSON.parse(clear.toString('utf8')) as SessionReceipt;
    } catch { return null; }
  }
  return { issue, read };
}

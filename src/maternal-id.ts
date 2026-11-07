import { randomInt } from 'node:crypto';

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateMaternalId(): string {
  let id = 'MC-';
  for (let position = 0; position < 6; position++) id += alphabet[randomInt(alphabet.length)];
  return id;
}

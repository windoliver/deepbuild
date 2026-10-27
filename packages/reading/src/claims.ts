import { createHash } from 'node:crypto';

/**
 * The id an install gives a claim: a slug of its first words for reading, and a hash of its whole text, so the same
 * finding again is the same claim and two different findings never share an id, whichever run wrote each.
 */
export function claimId(text: string): string {
  const whole = text.normalize('NFC').replace(/\s+/g, ' ').trim();
  const slug = whole.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40).replace(/^-+|-+$/g, '') || 'claim';
  return `${slug}-${createHash('sha256').update(whole).digest('hex').slice(0, 8)}`;
}

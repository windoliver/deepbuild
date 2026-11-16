// #2365: no scrub match may be divided between evidence parts, including multi-line held text.
import { writeFileSync } from 'node:fs';
import { afterAll, expect, test } from 'vitest';
import { archivedOf, claudeTranscript, dataOf, openArchiveOn, openWorld, redacted, removeTemps } from '../../../tests/acceptance/20/helpers.ts';

afterAll(removeTemps);

const armor = (edge: string) => `-----${edge} PRIVATE KEY-----`;
// These are deliberately non-JSON transcript lines: the archive's facts can name another agent's plain text.
for (const [name, secret, held] of [
  ['held', 'upper-half-of-the-value\nlower-half-of-the-value\n', ['upper-half-of-the-value\nlower-half-of-the-value']],
  ['private key', `${armor('BEGIN')}\n${'synthetic-not-a-real-key'.repeat(8)}\n${armor('END')}\n`, []],
  ['field value', '"password": {\n "fixture": "not-a-real-password",\n "second": "also-private"\n}\n', []],
] as const) {
  test(`${name} spanning a part boundary equals the whole-file scrub byte for byte`, async () => {
    const w = await openWorld();
    try {
      const t = claudeTranscript(w.env, []);
      const first = secret.indexOf('\n') + 1;
      const pad = `${'safe line\n'.repeat(Math.floor((256 * 1024 - first - 10) / 10))}`;
      const source = pad + secret + 'last public line\n';
      writeFileSync(t.path, source);
      const archive = await openArchiveOn(w, { held: [...held] });
      await archive.pass();
      const event = (await archivedOf(w.record, t.id)).at(-1)!;
      const actual = Buffer.from(await w.store.read(String(dataOf(event).evidence))).toString();
      expect(actual, `${name} is scrubbed whole even though its lines reach two storage parts`).toBe(redacted(source, held));
      for (const sha of event.evidence) expect(Buffer.from(await w.store.read(sha)).toString()).not.toContain('lower-half-of-the-value');
    } finally { await w.close(); }
  }, 120_000);
}

// #2365: wherever a transcript's writes and passes stop, its parts join to the transcript scrubbed whole.
import fc from 'fast-check';
import { appendFileSync, readFileSync } from 'node:fs';
import { afterAll, expect, test } from 'vitest';
import { archivedOf, claudeTranscript, dataOf, openArchiveOn, openWorld, redacted, removeTemps, type World } from '../../../tests/acceptance/20/helpers.ts';

afterAll(removeTemps);

const armor = (edge: string) => `-----${edge} PRIVATE KEY-----`;
const HELD = 'held-upper-half\nheld-lower-half';
const line = (uuid: string, content: string) => `${JSON.stringify({ type: 'user', message: { role: 'user', content }, uuid })}\n`;
// Whole lines each. Several hold a scrub match that spans lines, so a write or a pass can stop inside one.
const PIECES = [
  'plain words 🛒 一 résumé\n',
  '\n',
  line('k1', `deploy with ghp_${'aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cF0iL3oR6'} now`),
  line('f1', 'the "password": "one-line-field-value" is set'),
  `${armor('BEGIN')}\n${'multi-line-key-body-'.repeat(6)}\n${armor('END')}\n`,
  `${HELD}\n`,
  '"password": {\n "first": "structured-first-value",\n "nested": {\n  "second": "structured-second-value"\n }\n}\n',
  'userPassword:: e1NTSEF9bGRpZi1maXJzdC1saW5l\n bGRpZi1mb2xkZWQtc2Vjb25k\n bGRpZi1mb2xkZWQtdGhpcmQ=\n',
  'safe filler line\n'.repeat(9000),
];

/** The newest copy equals the scrub, whole, of the bytes its event says it read. */
async function copyIsPrefixScrubbed(w: World, id: string, path: string, when: string): Promise<void> {
  const newest = (await archivedOf(w.record, id)).at(-1);
  if (!newest) return;
  const read = readFileSync(path).subarray(0, Number((dataOf(newest).source as { size: number }).size));
  expect(Buffer.from(await w.store.read(String(dataOf(newest).evidence))).toString(), when).toBe(redacted(read.toString('utf8'), [HELD]));
}

test('a folded value whose later lines arrive after a pass is copied as the whole scrub masks it', async () => {
  const w = await openWorld();
  try {
    const t = claudeTranscript(w.env, []);
    const [first, ...folded] = PIECES[7]!.split(/(?<=\n)/);
    appendFileSync(t.path, `public line\n${first}`);
    const archive = await openArchiveOn(w);
    await archive.pass();
    await copyIsPrefixScrubbed(w, t.id, t.path, 'after the value\'s first line');
    appendFileSync(t.path, `${folded.join('')}last public line\n`);
    await archive.pass();
    const whole = readFileSync(t.path, 'utf8');
    const newest = (await archivedOf(w.record, t.id)).at(-1)!;
    expect(Buffer.from(await w.store.read(String(dataOf(newest).evidence))).toString()).toBe(redacted(whole));
    expect(redacted(whole), 'the whole scrub masks the folded lines').not.toContain('bGRpZi1mb2xkZWQtc2Vjb25k');
  } finally { await w.close(); }
}, 120_000);

test('a held value on two lines that is all of an unterminated transcript is copied once it stops changing', async () => {
  const w = await openWorld();
  try {
    const t = claudeTranscript(w.env, []);
    appendFileSync(t.path, HELD);
    const archive = await openArchiveOn(w, { held: [HELD] });
    await archive.pass();
    await archive.pass();
    const newest = (await archivedOf(w.record, t.id)).at(-1)!;
    expect(Buffer.from(await w.store.read(String(dataOf(newest).evidence))).toString()).toBe(redacted(HELD, [HELD]));
  } finally { await w.close(); }
}, 60_000);

test('seeded property: any pieces, written and archived in any steps, are copied as their whole scrub', async () => {
  await fc.assert(fc.asyncProperty(
    fc.array(fc.constantFrom(...PIECES), { minLength: 1, maxLength: 10 }),
    fc.array(fc.record({ at: fc.double({ min: 0, max: 1, noNaN: true }), again: fc.boolean() }), { maxLength: 5 }),
    async (pieces, stops) => {
      const whole = Buffer.from(pieces.join(''));
      const w = await openWorld();
      try {
        const t = claudeTranscript(w.env, []);
        const archive = await openArchiveOn(w, { held: [HELD] });
        let written = 0;
        for (const { at, again } of [...stops.map((s) => ({ ...s, at: Math.floor(s.at * whole.length) })).sort((a, b) => a.at - b.at), { at: whole.length, again: true }]) {
          appendFileSync(t.path, whole.subarray(written, at));
          written = Math.max(written, at);
          for (let pass = 0; pass < (again ? 2 : 1); pass++) {
            await archive.pass();
            await copyIsPrefixScrubbed(w, t.id, t.path, `after ${written} of ${whole.length} bytes, pass ${pass + 1}`);
          }
        }
        const newest = (await archivedOf(w.record, t.id)).at(-1)!;
        expect(Buffer.from(await w.store.read(String(dataOf(newest).evidence))).toString(), 'the finished transcript').toBe(redacted(whole.toString('utf8'), [HELD]));
      } finally { await w.close(); }
    },
  ), { numRuns: 40, seed: 2365, endOnFailure: true });
}, 1_200_000);

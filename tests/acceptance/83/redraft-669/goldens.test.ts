// Blind redraft of #83 AC11 for #669 (README, The dispute). AC11 #83.15ee3b42: golden lines for says done, sent back,
// PASS, BLOCKED and checks running fit the set width; a fixture with a long cause keeps "not verified" and the outcome,
// and shortens the cause first.
//
// The #1460 redraft (`../redraft-1460/goldens.test.ts`), each step and expected value kept, but for the count of tests
// run that #669 puts on the line: `<n> tests`, the tests the claim's checks ran as their reports counted them (each run
// `test.verdict` plants reports one), as its own part after the cause and before the next step's owner, left out when
// no run has finished. Each golden (goldens/<name>.json) is the #1460 redraft's with that change; `{session8}` and
// `{claim}` stand for the session's and the claim's IDs, known only once the test made them.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { AC11, begin, claim, cleanup, edits, firedShown, hubWithSetup, lineOf, makeHome, newSession, plant, stop, WIDTH, type Planted } from '../helpers.ts';

afterAll(cleanup, 60_000);

const GOLDENS = fileURLToPath(new URL('./goldens/', import.meta.url));
interface Golden { name: string; state: string; plant: Omit<Planted, 'session' | 'claim'>; line: string | null; keeps?: string[]; shortened?: string }
const goldens: Golden[] = readdirSync(GOLDENS).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(join(GOLDENS, f), 'utf8')) as Golden);
const widthOf = (line: string) => [...line].length;
/** A golden's line for a session and a claim: the receipt's address filled in. */
const filled = (line: string, session: string, claimId: string): string => line.replace('{session8}', session.slice(0, 8)).replace('{claim}', claimId);
/** A session ID and a claim ID of the lengths the record gives: a UUID and a ULID. */
const SAMPLE = { session: '2a21552c-9f26-4a86-ad58-31f88b51fde8', claim: '01K74G0A1B2C3D4E5F6G7H8J9K' };
const RECEIPT = `session/${SAMPLE.session.slice(0, 8)}/${SAMPLE.claim}`;

describe(`${AC11} Golden lines fit the set width (${WIDTH} columns); the long-cause fixture keeps "not verified" and the outcome and shortens the cause first`, () => {
  it(`${AC11} the goldens cover says done, sent back, PASS, BLOCKED and checks running, and one with a long cause`, () => {
    expect(goldens.map((g) => g.name).sort()).toEqual(['BLOCKED', 'PASS', 'checks running', 'long cause', 'says done', 'sent back']);
    for (const g of goldens.filter((g) => g.line !== null)) expect(widthOf(filled(g.line!, SAMPLE.session, SAMPLE.claim)), `the golden "${g.name}" is itself within ${WIDTH} columns`).toBeLessThanOrEqual(WIDTH);
  });

  for (const g of goldens) {
    it(`${AC11} ${g.name}: ${g.state}${g.line ? ` → ${JSON.stringify(g.line)}` : ''}`, async () => {
      const h = makeHome();
      const hub = await hubWithSetup(h);
      const s = newSession(h);
      const claude = await begin(h, s);
      await edits(claude, s);
      const c = await claim(claude, s);
      await plant(hub, { session: s.id, claim: c.claim, ...g.plant });
      const fired = await stop(claude, s);
      const line = lineOf(fired);
      expect(line, `the stop carries the line: ${firedShown(fired)}`).toBeDefined();
      expect(widthOf(line!), `the line fits ${WIDTH} columns: ${JSON.stringify(line)}`).toBeLessThanOrEqual(WIDTH);
      if (g.line !== null) {
        expect(line, `the line for "${g.name}" is its golden`).toBe(filled(g.line, s.id, c.id));
      } else {
        for (const keep of g.keeps ?? []) expect(line, `the line keeps ${JSON.stringify(keep)}: ${JSON.stringify(line)}`).toContain(keep);
        expect(line, 'it says "not verified" first').toMatch(/^not verified\b/);
        expect(line, `the cause is shortened, not kept whole: ${JSON.stringify(line)}`).not.toContain(g.shortened!);
        // With `2 tests` on the line, every kept part leaves the cause 7 columns before its `…`: its first word, `receipt`,
        // read where the cause sits, after the outcome, so the bare word `receipt` can't stand in for it.
        expect(line, 'the cause is shortened from its start, so its first words stay').toContain(`sent back 2/3: ${g.shortened!.slice(0, 7)}`);
        expect(line, 'a shortened cause is marked as cut').toMatch(/…|\.\.\./);
        expect(line, 'the receipt part, where it is kept, is the claim\'s address, never the bare word').not.toMatch(/ · receipt$/);
      }
      await claude.end();
    }, 180_000);
  }

  it(`${AC11} (wrong program) a line that drops "not verified" to fit the width, or keeps the whole cause past ${WIDTH} columns, fails`, () => {
    const g = goldens.find((x) => x.name === 'long cause')!;
    const dropped = `sent back 2/3: ${g.shortened!.slice(0, 40)}… · total.ts:42 · 2 tests · next: agent · ${RECEIPT}`;
    expect(dropped).not.toMatch(/^not verified\b/);
    const whole = `not verified: R2 · sent back 2/3: ${g.shortened} · total.ts:42 · 2 tests · next: agent · ${RECEIPT}`;
    expect(widthOf(whole)).toBeGreaterThan(WIDTH);
  });
});

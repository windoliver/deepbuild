// AC11 #83.15ee3b42: golden lines for says done, sent back, PASS, BLOCKED and checks running fit the set width; a
// fixture with a long cause keeps "not verified" and the outcome, and shortens the cause first.
//
// Each golden (goldens/<name>.json) is a record state planted through `test.verdict` on a real session's claim and the
// line that state must give, read from the next Stop's reply as the chat shows it (README: Defined here, the line and
// its goldens). The long-cause fixture holds no line: it names what the line must keep and the cause it must shorten.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AC11, begin, claim, cleanup, edits, firedShown, GOLDENS, hubWithSetup, lineOf, makeHome, newSession, plant, stop, WIDTH, type Planted } from './helpers.ts';

afterAll(cleanup, 60_000);

interface Golden { name: string; state: string; plant: Omit<Planted, 'session' | 'claim'>; line: string | null; keeps?: string[]; shortened?: string }
const goldens: Golden[] = readdirSync(GOLDENS).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(join(GOLDENS, f), 'utf8')) as Golden);
const widthOf = (line: string) => [...line].length;

describe(`${AC11} Golden lines fit the set width (${WIDTH} columns); the long-cause fixture keeps "not verified" and the outcome and shortens the cause first`, () => {
  it(`${AC11} the goldens cover says done, sent back, PASS, BLOCKED and checks running, and one with a long cause`, () => {
    expect(goldens.map((g) => g.name).sort()).toEqual(['BLOCKED', 'PASS', 'checks running', 'long cause', 'says done', 'sent back']);
    for (const g of goldens.filter((g) => g.line !== null)) expect(widthOf(g.line!), `the golden "${g.name}" is itself within ${WIDTH} columns`).toBeLessThanOrEqual(WIDTH);
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
        expect(line, `the line for "${g.name}" is its golden`).toBe(g.line);
      } else {
        for (const keep of g.keeps ?? []) expect(line, `the line keeps ${JSON.stringify(keep)}: ${JSON.stringify(line)}`).toContain(keep);
        expect(line, 'it says "not verified" first').toMatch(/^not verified\b/);
        expect(line, `the cause is shortened, not kept whole: ${JSON.stringify(line)}`).not.toContain(g.shortened!);
        expect(line, 'the cause is shortened from its start, so its first words stay').toContain(g.shortened!.slice(0, 12));
        expect(line, 'a shortened cause is marked as cut').toMatch(/…|\.\.\./);
      }
      await claude.end();
    }, 180_000);
  }

  it(`${AC11} (wrong program) a line that drops "not verified" to fit the width, or keeps the whole cause past ${WIDTH} columns, fails`, () => {
    const g = goldens.find((x) => x.name === 'long cause')!;
    const dropped = `sent back 2/3: ${g.shortened!.slice(0, 40)}… · total.ts:42 · next: agent · receipt`;
    expect(dropped).not.toMatch(/^not verified\b/);
    const whole = `not verified: R2 · sent back 2/3: ${g.shortened} · total.ts:42 · next: agent · receipt`;
    expect(widthOf(whole)).toBeGreaterThan(WIDTH);
  });
});

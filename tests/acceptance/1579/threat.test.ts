// #1579 AC5: the threats table has this row, and a planted verifier that skips the time fails its kit. The row is
// "Signatures used again" in the design's Threats, and what stops each one; its kit is scenarios.ts's
// `signatureKit`, every case of the row against one real hub. The planted verifier is the hub run with
// DEEP_HUB_PLANT=signature-skips-time (README, Surfaces): the one verifier with its time check left out.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REPO } from '../16/helpers.ts';
import { AC, cleanup } from './helpers.ts';
import { signatureKit, type KitCase } from './scenarios.ts';

afterEach(cleanup, 60_000);

const PLANT = 'signature-skips-time';

/** The rows of the table under the heading "Threats, and what stops each one", as [threat, what stops it]. */
function threatRows(): string[][] {
  const doc = readFileSync(join(REPO, 'docs/technical-design.md'), 'utf8').split('\n');
  const at = doc.findIndex((l) => /^#+ .*Threats, and what stops each one/.test(l));
  if (at < 0) throw Error('the design has no heading "Threats, and what stops each one"');
  const rows: string[][] = [];
  for (const line of doc.slice(at + 1)) {
    if (/^#+ /.test(line)) break;
    if (!line.startsWith('|') || /^\|\s*-/.test(line)) continue;
    rows.push(line.split('|').slice(1, -1).map((c) => c.trim()));
  }
  return rows;
}

describe(`${AC[5]} The threats table has this row, and a planted verifier that skips the time fails its kit`, () => {
  it(`${AC[5]} the threats table has the row "Signatures used again", naming the method, the hub, the time, the once-only ID, 10 minutes, one verifier, restarts, the planted verifier and #1579`, () => {
    const row = threatRows().find((r) => r[0] === 'Signatures used again');
    expect(row, `the threats table's rows: ${threatRows().map((r) => r[0]).join(' · ')}`).toBeDefined();
    const text = row![1]!;
    for (const words of ['the method', 'the hub', 'the time', 'once-only ID', 'hash of the params', '10 minutes', 'One verifier', 'the app, phones and channels', 'across restarts', 'a planted verifier that skips the time fails its kit', '#1579']) {
      expect(text, `the row says "${words}"`).toContain(words);
    }
  });

  it(`${AC[5]} the planted verifier that skips the time fails the kit at its 11-minute-old case, naming the ask that counted, and passes every other case`, async () => {
    const report = await signatureKit(PLANT);
    expect(report.at, 'the planted verifier counts the 11-minute-old signature, and the kit fails it there').toMatch(/signed 11 minutes ago was taken/);
    const others = Object.entries(report).filter(([name]) => (name as KitCase) !== 'at');
    expect(Object.fromEntries(others), 'the plant is a verifier that skips the time and nothing else').toEqual(Object.fromEntries(others.map(([name]) => [name, null])));
  }, 300_000);

  it(`${AC[5]} the kit passes on the hub as shipped: it is no wall`, async () => {
    const report = await signatureKit();
    expect(report).toEqual({ at: null, 'within the window': null, hub: null, 'fresh after the refusals': null, method: null, once: null });
  }, 300_000);
});

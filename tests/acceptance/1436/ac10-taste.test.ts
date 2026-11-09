// Criterion 10 (README: The taste call): "Shown to you: the gallery in light and dark, taken by the check run, is attached
// to the PR. Whether each looks right is one taste call, recorded; without it the run stays INCONCLUSIVE."
// The check run draws the gallery panel with the replica in light and in dark (the same surface as criterion 1), writes
// the two PNGs, byte for byte as the replica wrote them, to docs/evidence/1436/gallery-light.png and gallery-dark.png
// for the PR, and prints each SHA-256. Then it reads tests/acceptance/1436/TASTE.json: none, or a call recorded on other
// pictures, is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly these two passes. Nothing here judges a
// picture: the pixels are copied, never measured.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC, APPEARANCES, REPO, gallery, useBuild } from './helpers.ts';

const bin = useBuild('replica');
const SHOTS = join(REPO, 'docs', 'evidence', '1436');
const TASTE = join(REPO, 'tests', 'acceptance', '1436', 'TASTE.json');

describe(`#1436 AC10 ${AC[10]} the gallery in light and dark, and one taste call on it`, () => {
  it('AC10 the check run takes the gallery in light and dark, and the recorded taste call on those two pictures says they look right', () => {
    const drawn = APPEARANCES.map((a) => ({ a, bytes: gallery(bin(), a).bytes }));
    mkdirSync(SHOTS, { recursive: true });
    const shots: Record<string, string> = {};
    for (const { a, bytes } of drawn) {
      const name = `gallery-${a}.png`;
      writeFileSync(join(SHOTS, name), bytes);
      shots[name] = createHash('sha256').update(bytes).digest('hex');
      console.log(`AC10 ${AC[10]}: the gallery in ${a} for the taste call: ${join(SHOTS, name)}  ${shots[name]}`);
    }
    if (!existsSync(TASTE)) expect.fail(`INCONCLUSIVE: no taste call is recorded on these pictures (${JSON.stringify(shots)}); record it in ${TASTE} (README: The taste call)`);
    const call = JSON.parse(readFileSync(TASTE, 'utf8')) as { issue?: number; criterion?: string; verdict?: string; who?: string; when?: string; screenshots?: Record<string, string> };
    const same = JSON.stringify(Object.entries(call.screenshots ?? {}).sort()) === JSON.stringify(Object.entries(shots).sort());
    if (call.issue !== 1436 || call.criterion !== AC[10] || typeof call.who !== 'string' || call.who === '' || typeof call.when !== 'string' || !same) {
      expect.fail(`INCONCLUSIVE: the taste call in ${TASTE} isn't one on these two pictures (${JSON.stringify(shots)}): ${JSON.stringify(call).slice(0, 600)}`);
    }
    console.log(`AC10 ${AC[10]}: the taste call by ${call.who}: ${call.verdict}`);
    expect(call.verdict, 'the recorded taste call').toBe('looks_right');
  }, 3_600_000);
});

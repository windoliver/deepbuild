// #1173.478ff552 (blind redraft, C3-REDRAFT.md): "A half-resolution puff has no 2 × 2 block of identical pixels inside
// its soft edge; a planted block copy fails, naming the emitter".
//
// The scene (puffs-redraft-helpers.ts): two still puffs, 48 px across, in mid grey on a near-black ground under an
// orthographic camera, one `particles@1` emitter each with `draw: puff`: `puff-half` at `resolution: half` (the
// criterion's) and `puff-full` at `resolution: full` beside it. One `deep-gpu run` draws frame 60 of four variants
// through #378's `view3d` with `targets: ["final"]`: both emitters (the frame measured), each emitter alone, and
// neither. Each emitter's footprint is where its own frame differs from the bare one; its soft edge is the falloff
// ring between a quarter and four fifths of the footprint's radius from its centroid (helpers: INNER, OUTER). In the
// measured frame, no 2 × 2 block at any offset with all four pixels in that ring may have four equal pixels.
// Wrong programs: the base, and `--planted puff_block_copy` (a half-resolution puff shaded once per 2 × 2 px block
// on the even grid and that value written to all four pixels: the base's particles.wgsl), which must fail naming
// `puff-half` and never `puff-full`. Drawing runs only on Metal: off macOS each test is INCONCLUSIVE.

import { describe, expect, it } from 'vitest';
import {
  EMITTERS, FRAME, FULL, HALF, finalOf, puffProblems, puffsDoc, requireMetal, run, useBuild, useOut, view3dCall, writeJson,
  type Image, type Planted,
} from './puffs-redraft-helpers.ts';

const ID = '#1173.478ff552';
const build = useBuild();
const out = useOut();

/** Frame 60 of the four variants in one run, and the criterion's measure on it. */
function measured(planted?: Planted): string[] {
  const ids = Object.keys(EMITTERS);
  const variants: [string, string[]][] = [['both', ids], ...ids.map((id): [string, string[]] => [id, [id]]), ['bare', []]];
  const calls = variants.map(([name, with_]) => view3dCall(writeJson(out(), name, puffsDoc(with_))));
  const replies = run(build.bin(), out(), calls, planted);
  const frames = new Map<string, Image>(variants.map(([name], i) => [name, finalOf(replies[i]!, out(), FRAME, `the ${name} frame`)]));
  const both = frames.get('both')!; const bare = frames.get('bare')!;
  expect([both.width, both.height], 'the frame is 320 × 240').toEqual([320, 240]);
  const { problems, report } = puffProblems(both, Object.fromEntries(ids.map((id) => [id, frames.get(id)!])), bare);
  console.log(`${ID}${planted ? ` (--planted ${planted})` : ''}:\n  ${report.join('\n  ')}${problems.length ? `\n  failures:\n    ${problems.join('\n    ')}` : ''}`);
  return problems;
}

describe(`${ID} a half-resolution puff has no 2 × 2 block of identical pixels inside its soft edge (redraft)`, () => {
  it(`${ID} the half-resolution puff ${HALF} (and the full-resolution ${FULL} beside it) has no 2 × 2 block of four identical pixels in its falloff ring`, () => {
    requireMetal();
    const problems = measured();
    expect(problems, `no identical 2 × 2 block inside either puff's soft edge:\n  ${problems.join('\n  ')}`).toEqual([]);
  }, 3_600_000);

  it(`${ID} a planted block copy (--planted puff_block_copy) fails, naming the emitter ${HALF} and not ${FULL}`, () => {
    requireMetal();
    const problems = measured('puff_block_copy');
    expect(problems.length, '--planted puff_block_copy fails the check').toBeGreaterThan(0);
    expect(problems.some((p) => p.startsWith(`emitter ${HALF}: `) && /2 × 2 blocks inside its puff's soft edge are four identical pixels/.test(p)),
      `a failure names the emitter ${HALF} and its identical blocks:\n  ${problems.join('\n  ')}`).toBe(true);
    expect(problems.filter((p) => p.includes(FULL)), `no failure names the full-resolution emitter ${FULL}, which the block copy leaves alone`).toEqual([]);
  }, 3_600_000);
});

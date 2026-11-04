// #1173.478ff552: A half-resolution puff has no 2 × 2 block of identical pixels inside its soft edge; a planted block
// copy fails, naming the emitter.
//
// The puffs are `puffDoc` (helpers.ts): one `particles@1` emitter, `puffs`, drawing large near-white puffs at half
// resolution (`draw: puff`, `resolution: half`) on a night ground under a still camera. One process draws its frame 45
// (t 1.5 s) by #378's `view3d` with the emitter and without it. The puffs' soft edge is where they add between 20% and
// 80% of the most they add anywhere (helpers.ts, `blocksOf`); no 2 × 2 window there, at any offset, is four identical
// pixels. Wrong programs: the base (a puff shaded once per 2 × 2 block and written to all four pixels,
// crates/deep-effects-render/src/particles.wgsl); `--planted puff_block_copy` (issue-named: that block copy), which
// must fail naming the emitter.
import { describe, expect, it } from 'vitest';
import {
  EMITTER, PUFF_FRAME, PUFF_LOOK, PUFF_VIEW, blockProblems, finalOf, frameAt, puffDoc, requireMetal, run, useBuild, useOut, view3dCall, viewOf, writeJson,
  type Planted,
} from './helpers.ts';

const ID = '#1173.478ff552';

const bin = useBuild();
const out = useOut();

function puffProblems(planted?: Planted): string[] {
  const call = (doc: string) => view3dCall({ doc, look: PUFF_LOOK, size: PUFF_VIEW, from: PUFF_FRAME, frames: 1, fps: 30, capture: [PUFF_FRAME], targets: ['final'] });
  const [w, b] = run(bin(), out(), [call(writeJson(out(), 'puffs', puffDoc(true))), call(writeJson(out(), 'bare', puffDoc(false)))], planted);
  const read = (reply: typeof w, what: string) => finalOf(out(), frameAt(viewOf(reply!, what).frames, PUFF_FRAME, what), `${what}, frame ${PUFF_FRAME}`);
  const { problems, blocks } = blockProblems(EMITTER, read(w, 'with the puffs'), read(b, 'without them'));
  console.log(`${ID}${planted ? ` (--planted ${planted})` : ''}: soft edge ${blocks.band} px, ${blocks.windows} 2 × 2 windows inside it, ${blocks.identical} of them four identical pixels`);
  return problems;
}

describe(`${ID} a half-resolution puff has no 2 × 2 block of identical pixels inside its soft edge`, () => {
  it(`${ID} the half-resolution puffs: no 2 × 2 block of identical pixels inside their soft edge`, () => {
    requireMetal();
    expect(puffProblems(), 'no 2 × 2 block of identical pixels inside the soft edge').toEqual([]);
  }, 3_600_000);

  it(`${ID} a planted block copy fails, naming the emitter`, () => {
    requireMetal();
    const problems = puffProblems('puff_block_copy');
    expect(problems.join('\n'), '--planted puff_block_copy fails, naming the emitter').toMatch(new RegExp(`^${EMITTER}: \\d+ of the \\d+ 2 × 2 blocks inside the half-resolution puffs' soft edge are four identical pixels`, 'm'));
  }, 3_600_000);
});

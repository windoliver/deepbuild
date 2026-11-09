// #166.5cdde7aa: "With foam at threshold 0.6 and a wake behind a boat keyed across the lake, a frame reached by seeking
// to 20 s equals the one played to 20 s by pixel hash; a planted foam that keeps simulation state from frame to frame
// draws different foam after the seek and fails, naming the material"
//
// The fixture (helpers.ts `harbour` with its boat, 320 × 180): the lake's material `lake-water` carries STEEP_WAVES (so
// foam at 0.6 shows), `foam: {threshold: 0.6}` and `wake: {item: "boat", span: 8}`; the boat `boat` crosses the lake on
// a channel from x = −12 m at 0 s to 12 m at 24 s. The film is played from frame 0 to frame 600 (20 s at 30 fps), and
// frame 600 is opened cold by a seek (`from`): one pixel hash. Not vacuous: at 20 s the same lake with foam off (threshold
// 1) and the same lake with no wake each draw another frame.
// The planted foam (`deep-gpu run --planted water_foam_keeps_state`): the water's foam, its wake's foam among it, carried
// from frame to frame as simulation state, everything else as shipped. The suite's check compares the seek with the
// play and names the material whose foam differs; under the plant it must fail at 20 s naming `lake-water`, while the
// same lake with foam off and no wake still seeks equal to play under the plant, so what differs is the foam.
import { describe, expect, it } from 'vitest';
import { AC, type Planted, STEEP_WAVES, type Water, failsNaming, harbour, hashAt, look3d, none, requireGpu, runGpu, useGpu, useOut, view3d, writeJson } from './helpers.ts';

const bin = useGpu();
const out = useOut();
const SIZE: [number, number] = [320, 180];
const LOOK = look3d('foam-166');
const AT = 600;
const FOAMY: Water = { waves: STEEP_WAVES, foam: { threshold: 0.6 }, wake: { item: 'boat', span: 8 } };

/** Seek against play at 20 s for each lake; a difference is a failure naming the water's material. */
function seekProblems(lakes: [string, Water][], planted?: Planted): { failures: string[]; played: Map<string, string> } {
  const dir = out();
  const calls = lakes.flatMap(([name, w]) => {
    const doc = writeJson(dir, name, harbour(`lake-${name}`, SIZE, w, { boat: true }));
    return [view3d({ doc, look: LOOK, size: SIZE, frames: AT + 1, fps: 30 }), view3d({ doc, look: LOOK, size: SIZE, from: AT, frames: 1, fps: 30 })];
  });
  const replies = runGpu(bin(), dir, calls, planted);
  const failures: string[] = []; const played = new Map<string, string>();
  lakes.forEach(([name], k) => {
    const p = hashAt(replies[2 * k]!, AT, `${name}: played`); const s = hashAt(replies[2 * k + 1]!, AT, `${name}: seeked`);
    played.set(name, p);
    if (p !== s) failures.push(`material lake-water (${name}): the frame seeked to 20 s (${s.slice(0, 12)}) differs from the one played to 20 s (${p.slice(0, 12)})`);
  });
  return { failures, played };
}

describe(`${AC[7]} foam and a boat's wake are closed forms of t`, () => {
  it(`${AC[7]} with foam at 0.6 and a wake behind the keyed boat, the frame seeked to 20 s equals the one played to 20 s, and the foam and the wake show`, () => {
    requireGpu();
    const { failures, played } = seekProblems([
      ['foamy', FOAMY], ['no-foam', { ...FOAMY, foam: { threshold: 1 } }], ['no-wake', { ...FOAMY, wake: 'none' }],
    ]);
    none(failures, 'seek equals play at 20 s');
    expect(played.get('no-foam'), 'the foam shows: with threshold 1 the frame at 20 s differs').not.toBe(played.get('foamy'));
    expect(played.get('no-wake'), 'the wake shows: without it the frame at 20 s differs').not.toBe(played.get('foamy'));
  });

  it(`${AC[7]} a planted foam that keeps simulation state (--planted water_foam_keeps_state) draws different foam after the seek and fails, naming the material`, () => {
    requireGpu();
    const plain = seekProblems([['calm', { waves: STEEP_WAVES, foam: { threshold: 1 }, wake: 'none' }]], 'water_foam_keeps_state');
    none(plain.failures, 'under the plant, the lake with no foam and no wake still seeks equal to play');
    failsNaming(seekProblems([['foamy', FOAMY]], 'water_foam_keeps_state').failures, ['material lake-water', '20 s'], 'water_foam_keeps_state');
  });
});

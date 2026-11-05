// AC1 #425.85981004: Level of detail and the light cut are pure functions of the view: a camera that crosses a band
// threshold or the light cut from either side, and a seek to the same time, give the same bands, light weights and
// pixel hash on one machine, with no session hysteresis and no fade in wall-clock time.
//
// The band sweep (README: The fixtures): the camera dollies from z = 6 m to 30 m and back in 0.25 m steps, so the
// clay ball's projected size falls through its 48 px band and its margin and rises again, and b-near and c-far trade
// the light cut's 32nd place at z = 18 m. Frame n and frame 192 − n show the same view, one reached from each side; a
// fresh process seeks every out-leg frame where the report changes and the two after it. All must report the same
// `lod` rows and `light_cut` and draw the same pixels. Planted: a band with session hysteresis, a light cut with
// session hysteresis, a band change faded over wall-clock time.
import { describe, expect, it } from 'vitest';
import {
  AC, BAND_SIZE, BAND_SWEEP, LOOK, bandDoc, failsNaming, none, playAndSeek, requireMetal, rowOf, sameViewProblems, useBuilds, useDir, writeJson,
  type Frame3, type GpuPlanted, type Played,
} from './helpers.ts';

const ID = AC[1];
const bin = useBuilds(['default']);
const dir = useDir();

function played(planted?: GpuPlanted): Played {
  requireMetal();
  const out = dir();
  const doc = writeJson(out, 'bands', bandDoc());
  return playAndSeek(bin('default'), out, { doc, look: LOOK, size: BAND_SIZE, lod: true, light_cut: true }, BAND_SWEEP, planted ? { planted } : {});
}

/** The sweep crosses both: the ball is full at the start, inside its margin somewhere, its lower band at the turn;
 * c-far is left out at the start and b-near at the turn. */
function crossings(play: Frame3[]): string[] {
  const out: string[] = [];
  const bands = (n: number): string[] | null => rowOf(play[n]!, 'ball', out)?.bands ?? null;
  const cut = (n: number): string[] | null => {
    const c = play[n]!.cut;
    if (!c) { out.push(`frame ${n} carries no light_cut report`); return null; }
    return c.left_out;
  };
  const [first, turn] = [bands(0), bands(BAND_SWEEP.leg)];
  if (JSON.stringify(first) !== JSON.stringify(['full'])) out.push(`frame 0 (z = 6 m): the ball draws ${JSON.stringify(first)}, not its full band alone`);
  if (JSON.stringify(turn) !== JSON.stringify(['box'])) out.push(`frame ${BAND_SWEEP.leg} (z = 30 m): the ball draws ${JSON.stringify(turn)}, not its box band alone`);
  const margin = play.slice(0, BAND_SWEEP.leg + 1).filter((f) => f.lod?.find((r) => r.item === 'ball')?.bands.length === 2);
  if (margin.length === 0) out.push('no out-leg frame draws the ball inside its band margin (two bands)');
  const [from, to] = [cut(0), cut(BAND_SWEEP.leg)];
  if (JSON.stringify(from) !== JSON.stringify(['c-far'])) out.push(`frame 0: the light cut leaves out ${JSON.stringify(from)}, not c-far`);
  if (JSON.stringify(to) !== JSON.stringify(['b-near'])) out.push(`frame ${BAND_SWEEP.leg}: the light cut leaves out ${JSON.stringify(to)}, not b-near`);
  return out;
}

describe(`${ID} level of detail and the light cut are pure functions of the view`, () => {
  it(`${ID} crossing a band threshold and the light cut from either side, and seeking to the same time, give the same bands, light weights and pixel hash`, () => {
    const p = played();
    none(crossings(p.play), 'the sweep crosses the ball\'s band threshold and the light cut');
    expect(p.seeks.length, 'the sweep seeks the frames where its report changes').toBeGreaterThan(2);
    none(sameViewProblems(p, BAND_SWEEP), 'one view gives one report and one picture, however it was reached');
  }, 1_800_000);

  it(`${ID} a band or a light cut with session hysteresis, and a band change faded over wall-clock time, each fail, naming the frame`, () => {
    for (const planted of ['band_hysteresis', 'light_cut_hysteresis', 'band_fade_by_wall_clock'] as const) {
      const p = played(planted);
      failsNaming(sameViewProblems(p, BAND_SWEEP), ['frame '], `--planted ${planted}`);
    }
  }, 1_800_000);
});

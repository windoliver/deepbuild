// #2010.bf531cb7: changing the document's frame_rate from 60/1 to 50/1 on a ball-and-goal lab changes the bake key, and
// playback at 50 fps reads outputs sampled at 50 fps that equal a fresh bake's by hash; a planted key that leaves out
// frame_rate reuses the 60 fps outputs and fails, naming the field.
//
// The lab (helpers: ballAndGoal) is written here from #2009's shapes; its one output is the ball's position. Bakes go to
// a store (README: `store`); a bake whose key the store already holds reuses it, and `play` reads the store and never
// simulates. "Sampled at 50 fps" is checked against the ball's own baked states: frame k sits at t = k ÷ 50 s, between
// steps ⌊120·t⌋ and the next (Physics output). Twin: `--planted key_omits_frame_rate`.
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, TIMEOUT, answered, ask, bake, ballAndGoal, caught, keyOf, lerpPos, none, outputsOf, play, prebuild, scratch, show, statesOf,
  type JsonObject, type JsonValue, type Outputs, type Planted, type State,
} from './helpers.ts';

prebuild();

const ID = CRITERIA[5];
const RATE = 120;
const SPAN = 3;
const N = RATE * SPAN;
/** Within f32 rounding of the lerp at 10 m; a frame one step off, or at 60 fps, is centimetres away. */
const TOL = 1e-4;

/** The outputs are the ball's position sampled at p/1 fps over the span, from the bake's own states. */
function sampledFailures(o: Outputs, p: number, states: State[], what: string): string[] {
  const f: string[] = [];
  if (o.frameRate !== `${p}/1`) f.push(`frame_rate: ${what} holds outputs sampled at ${show(o.frameRate)}, the document's frame_rate is ${p}/1`);
  if (o.frames !== o.series.length) f.push(`${what}: outputs.frames is ${o.frames}, its series holds ${o.series.length}`);
  if (o.series.length !== SPAN * p && o.series.length !== SPAN * p + 1) f.push(`frame_rate: ${what} holds ${o.series.length} frames; ${p} fps over ${SPAN} s gives ${SPAN * p} or ${SPAN * p + 1}`);
  let off = 0; let first = '';
  o.series.slice(0, SPAN * p + 1).forEach((got, k) => {
    const ticks = k * RATE; // t·RATE = k·RATE ÷ p, exact in integers
    const s = Math.floor(ticks / p); const alpha = (ticks % p) / p;
    if (s >= states.length || (alpha > 0 && s + 1 >= states.length)) return;
    const want = lerpPos(states, s, alpha);
    if (got.some((x, i) => Math.abs(x - want[i]!) > TOL)) { off++; first ||= `frame ${k} (t = ${k}/${p} s) reads [${got.map((x) => x.toFixed(5))}], the ball's state there is [${want.map((x) => x.toFixed(5))}]`; }
  });
  if (off) f.push(`frame_rate: ${off} of ${what}'s frames aren't the ball's position at k ÷ ${p} s; ${first}`);
  return f;
}

interface Run { key60: string; key50: string; reused: JsonValue | undefined; played: JsonObject; fresh: JsonObject; freshStates: State[]; baked60: JsonObject; states60: State[] }
/** Bakes the lab at 60/1, then at 50/1, into one store; plays it at 50/1 from that store; bakes it fresh at 50/1 in another. */
function runLab(planted?: Planted): Run {
  const w = ballAndGoal();
  const store = scratch(`ac5-${planted ?? 'real'}`);
  const fresh = scratch(`ac5-fresh-${planted ?? 'real'}`);
  const opts = planted ? { planted } : {};
  const [b60] = ask([bake(w, N, { frame_rate: '60/1', store, read: ['ball'] })], opts);
  const [b50] = ask([bake(w, N, { frame_rate: '50/1', store, read: ['ball'] })], opts);
  const [played] = ask([play(w, N, '50/1', store)], opts);
  const [f50] = ask([bake(w, N, { frame_rate: '50/1', store: fresh, read: ['ball'] })], opts);
  return {
    key60: keyOf(b60!, 'the 60/1 bake'), key50: keyOf(b50!, 'the 50/1 bake'), reused: answered(b50, 'the 50/1 bake')['reused'],
    played: answered(played, 'playback at 50/1'), fresh: answered(f50, 'the fresh 50/1 bake'),
    freshStates: statesOf(f50!, 'ball', N + 1, 'the fresh 50/1 bake'), baked60: b60!, states60: statesOf(b60!, 'ball', N + 1, 'the 60/1 bake'),
  };
}
/** The criterion on one program's answers: a new key at 50/1, no reuse, and playback reading 50 fps outputs equal to a fresh bake's. */
function labFailures(r: Run): string[] {
  const f: string[] = [];
  if (r.key50 === r.key60) f.push(`frame_rate: the bake key doesn't change when frame_rate goes from 60/1 to 50/1 (${r.key60})`);
  if (r.reused !== false) f.push(`frame_rate: the 50/1 bake answers reused ${show(r.reused)}: it took the 60/1 bake's record`);
  const played = outputsOf(r.played, 'ball', 'playback at 50/1');
  const fresh = outputsOf(r.fresh, 'ball', 'the fresh 50/1 bake');
  if (r.played['key'] !== r.key50) f.push(`playback reads key ${show(r.played['key'])}, not the 50/1 bake's ${r.key50}`);
  f.push(...sampledFailures(played, 50, r.freshStates, 'playback at 50/1'));
  if (played.hash !== fresh.hash) f.push(`playback's outputs hash ${played.hash}, a fresh 50/1 bake's ${fresh.hash}`);
  if (JSON.stringify(played.series) !== JSON.stringify(fresh.series)) f.push('playback\'s outputs aren\'t the fresh 50/1 bake\'s');
  return f;
}

describe(`${ID} the document's frame rate is in the bake key, and playback reads outputs sampled at it`, () => {
  it(`${ID} on the ball-and-goal lab, frame_rate 60/1 → 50/1 changes the bake key, and playback at 50 fps reads outputs sampled at 50 fps equal to a fresh bake's by hash; the twin key_omits_frame_rate reuses the 60 fps outputs and fails naming frame_rate`, () => {
    const real = runLab();
    none(sampledFailures(outputsOf(real.baked60, 'ball', 'the 60/1 bake'), 60, real.states60, 'the 60/1 bake'), 'the 60/1 bake\'s outputs are sampled at 60 fps');
    none(sampledFailures(outputsOf(real.fresh, 'ball', 'the fresh 50/1 bake'), 50, real.freshStates, 'the fresh 50/1 bake'), 'a fresh 50/1 bake\'s outputs are sampled at 50 fps');
    none(labFailures(real), 'frame_rate 60/1 → 50/1: a new key, and playback at 50 fps reads a fresh bake\'s outputs');
    const [empty] = ask([play(ballAndGoal(), N, '50/1', scratch('ac5-empty'))]);
    expect(empty!['ok'], `playback never simulates: an empty store has nothing to play: ${show(empty)}`).toBe(false);
    expect('outputs' in empty!, 'and answers no outputs').toBe(false);

    const twin = labFailures(runLab('key_omits_frame_rate'));
    caught(twin, 'key_omits_frame_rate');
    expect(twin.filter((m) => m.startsWith('frame_rate')), `the twin's failure names frame_rate: ${twin.join('; ')}`).not.toEqual([]);
  }, TIMEOUT);
});

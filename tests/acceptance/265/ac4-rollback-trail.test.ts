// AC4 #265.69afee79: "After a rollback that replaces 4 steps of a two-seat match, a `mark.line` trail behind the moved
// item equals a straight run's by pixel hash; a planted trail that keeps the predicted points fails, naming the step"
//
// The steering piece (below): a two-seat match (net@1: 60 Hz, delay 2, window 8) whose logic item `pilot` reads player
// entries on the slider `steer` and moves the box `runner` 0.1 m along +x each step and 0.1 m × the last steer value
// along z, through two drivers reading its arrays `pilot.x` and `pilot.z`; the line `streak` trails the runner over the
// last 0.5 s in 16 segments. Player 2 steers to 1 at step 120 (made at step 118, `delay` 2 steps on). Through #551's
// `match` in `deep-show run`:
// - Held: the test relay's `deliver` holds player 2's message for step 120 from copy 1 until copy 1 has run step 123,
//   so copy 1 predicts steps 120 to 123 with the runner going straight, then rolls back to 120 and runs 120 to 123
//   again: 4 steps replaced (`rolled_back` holds {from: 123, to: 120}).
// - Straight: the same match with every message on time; copy 1 never rolls back.
// - #549's `render_back` draws copy 1's frame at match steps 120, 121 and 122 (before the late message) and 126, 130,
//   136 and 144 (after it), each `renders[].sha256` the piece's layer at the step that copy shows, from that copy's own
//   state (README: The surface under test).
// Judge: every frame after the rollback has the straight run's pixel hash at the same step; a failure names the replaced
// step 120. Guards: the frames before the late message differ from the straight run's (the copy draws its prediction,
// so there was something to draw again), and the same piece without the trail draws step 136 otherwise (the trail is in
// what's compared). The planted `trail_keeps_predicted_points` (README: Planted programs, the scenario's `planted`) fails
// the judge, naming step 120.
// Wrong programs: the base (a trail behind a logic-moved item is refused at check); a trail that keeps the points it read
// from predicted steps; one drawn from the confirmed steps only, or from the record's track with no prediction.

import { describe, expect, it } from 'vitest';
import { Script, presented, putEvidence, rendersOf, runShow, type Render } from '../549/helpers.ts';
import { FULL, TIMEOUT as SHOW_TIMEOUT, copiesOf, depthOf, rollbacksOf, useBuilds, useChildren, useTemp, world } from '../551/helpers.ts';
import { I, WRITES_AT, ac, code, failsNaming, none, program, requireGpu, show, type JsonObject, type Program } from './helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();

const LATE = 120;
const RAN = 123;
const STEPS = 180;
const BEFORE = [120, 121, 122];
const AFTER = [126, 130, 136, 144];
const HEADING = 8192;

/**
 * `pilot`: its read region holds the slider `steer`'s entries of the step (a u32 count, 4 zero bytes, then each entry as
 * a u32 player, 4 zero bytes and its f64 value: Logic `logic@1`); the last entry's value becomes its heading, kept in
 * memory. `init` puts the runner at x = −12, z = 0; each step adds 0.1 to `x` and 0.1 × the heading to `z`, kept in its
 * write region (`x`, then `z`, f64 each) and read back each step.
 */
function pilotProgram(): Program {
  // Locals of `step`: 0 the step (i64), 1 the heading (f64), 2 the entries' count (i32).
  const step = code(
    I.i32(HEADING), I.f64load, I.set(1),
    I.i32(0), I.load, I.set(2),
    I.get(2), I.if, I.get(2), I.i32(4), I.shl, I.f64load, I.set(1), I.end,
    I.i32(HEADING), I.get(1), I.f64store,
    I.i32(WRITES_AT), I.i32(WRITES_AT), I.f64load, I.f64(0.1), I.fadd, I.f64store,
    I.i32(WRITES_AT + 8), I.i32(WRITES_AT + 8), I.f64load, I.get(1), I.f64(0.1), I.fmul, I.fadd, I.f64store,
  );
  return program('pilot', { init: code(I.i32(WRITES_AT), I.f64(-12), I.f64store), step, stepLocals: [0x02, 0x01, 0x7c, 0x01, 0x7f] });
}

const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture made by the #265 acceptance tests.' };
const DOCS = { trail: '01JB265D000000000000000001', bare: '01JB265D000000000000000002' } as const;
/** The steering piece in the agent's form (#391's envelope, as #551's suite writes its pieces), with or without its trail. */
function pieceDoc(p: Program, trail: boolean): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: [0, 12, 7], target: [0, 0, 1], fov: 60 } },
    floor: { kind: 'mark.box@1', params: { size: [30, 0.1, 16] }, at: { pos: [0, -0.05, 0] } },
    runner: { kind: 'mark.box@1', params: { size: [0.5, 0.5, 0.5] }, at: { pos: [-12, 0.25, 0] } },
    pilot: { kind: 'logic@1', params: { program: p.sha, step_rate: 60, reads: ['steer'], writes: { x: { type: 'f64', count: 1 }, z: { type: 'f64', count: 1 } }, checkpoint: { every: 60 } } },
    ...(trail ? { streak: { kind: 'mark.line@1', params: { trail: { of: 'runner', span: 0.5, segments: 16, width: 6 }, paint: { fill: { role: 'ink' } } } } } : {}),
    match: { kind: 'net@1', params: { relay: 'https://relay.test/265', players: 2, step_rate: 60, delay: 2, window: 8, hash_every: 60 } },
  };
  const withIds: JsonObject = {};
  let k = 0;
  for (const [id, item] of Object.entries(items)) withIds[id] = { id, name: id, order: `a${String(k++).padStart(4, '0')}`, ...item };
  return {
    format: 1, id: trail ? DOCS.trail : DOCS.bare, profile: 'scene', title: 'A steering match', description: 'A steering piece the #265 acceptance tests play.', size: [320, 180], camera: 'cam', seed: 265,
    transport: { span: '10s', frame_rate: [60, 1] },
    requires: { modules: { scene3d: '^1', input: '^1', logic: '^1', net: '^1' } },
    controls: { steer: { kind: 'slider', class: 'document', label: 'Steer', role: 'slider', range: [-1, 1], default: 0, increment: 0.5 } },
    assets: { pilot_program: { sha256: p.sha, license: LICENSE } },
    drivers: {
      'runner-x': { target: 'items/runner/at/pos/0', expr: 'v', vars: { v: 'pilot.x' } },
      'runner-z': { target: 'items/runner/at/pos/2', expr: 'v', vars: { v: 'pilot.z' } },
    },
    items: withIds,
  };
}

const PLAYS = { '2': [{ step: LATE - 2, control: 'steer', value: 1 }] };
const renderBack = [...BEFORE, ...AFTER].map((j) => ({ player: 1, t: (j + 0.5) / 60 }));
/** One `match` of `doc`: held (player 2's message for step 120 reaches copy 1 once it has run step 123) or straight. */
const matchOf = (doc: string, held: boolean): JsonObject => ({
  call: 'match', doc, steps: STEPS, plays: PLAYS,
  relay: { seed: 265, ...(held ? { deliver: [{ player: 2, step: LATE, to: 1, at: RAN }] } : {}) }, render_back: renderBack,
});

interface Played { held: { renders: Render[]; reply: JsonObject }; straight: { renders: Render[]; reply: JsonObject }; bare: Render[] | null }
/** One `deep-show run`: the piece shown (and without its trail when `bare`), then its matches. */
async function played(what: string, o: { bare: boolean; planted?: string }): Promise<Played> {
  const evidence = temp();
  const p = pilotProgram();
  putEvidence(evidence, p.bytes);
  const s = new Script();
  const shown = [s.present(DOCS.trail, pieceDoc(p, true)), ...(o.bare ? [s.present(DOCS.bare, pieceDoc(p, false))] : [])];
  const held = s.add(matchOf(DOCS.trail, true));
  const straight = s.add(matchOf(DOCS.trail, false));
  const bare = o.bare ? s.add(matchOf(DOCS.bare, false)) : -1;
  const sc = { ...world(evidence, o.bare ? [DOCS.trail, DOCS.bare] : [DOCS.trail], s.calls), ...(o.planted ? { planted: o.planted } : {}) };
  const r = await runShow(builds.show(), sc, what);
  shown.forEach((i) => presented(r[i], `${what}: the steering piece`));
  const of = (i: number, name: string): { renders: Render[]; reply: JsonObject } => {
    copiesOf(r[i], 2, `${what}: ${name}`);
    return { renders: rendersOf(r[i], `${what}: ${name}`), reply: r[i]! };
  };
  return { held: of(held, 'the held match'), straight: of(straight, 'the straight match'), bare: bare >= 0 ? of(bare, 'the match without the trail').renders : null };
}

const at = (rs: Render[], step: number): Render | undefined => rs.find((r) => r.player === 1 && r.step === step);
/** The judge: every frame of copy 1 after the rollback against the straight run's at its step; failures name the step. */
function judge(p: Played): string[] {
  const out: string[] = [];
  for (const j of AFTER) {
    const h = at(p.held.renders, j); const s = at(p.straight.renders, j);
    if (!h || !s || h.sha256 !== s.sha256) out.push(`copy 1's frame at match step ${j}, after the rollback that replaced steps ${LATE} to ${RAN}, draws ${h?.sha256.slice(0, 12) ?? 'nothing'} and the straight run ${s?.sha256.slice(0, 12) ?? 'nothing'}: the trail through the replaced step ${LATE} isn't drawn again`);
  }
  return out;
}

describe(`${ac(4)} a trail behind a logic-moved item in a match draws again after a rollback`, () => {
  it(`${ac(4)} after a rollback that replaces steps 120 to 123, the runner's trail equals the straight run's by pixel hash`, async () => {
    requireGpu();
    const p = await played('AC4', { bare: true });
    const fails: string[] = [];
    const held = copiesOf(p.held.reply, 2, 'AC4 the held match');
    const straight = copiesOf(p.straight.reply, 2, 'AC4 the straight match');
    const back = rollbacksOf(held[0]!, 'AC4 the held match');
    if (!back.some((r) => r.to === LATE && depthOf(r) === RAN - LATE + 1)) fails.push(`copy 1 didn't roll back from step ${RAN} to step ${LATE}, replacing ${RAN - LATE + 1} steps: it rolled back ${show(back)}`);
    if (rollbacksOf(straight[0]!, 'AC4 the straight match').length !== 0) fails.push(`copy 1 of the straight run rolled back: ${show(straight[0]!.raw['rolled_back'] ?? null)}`);
    for (const j of BEFORE) {
      const h = at(p.held.renders, j); const s = at(p.straight.renders, j);
      if (!h || !s) fails.push(`no frame of copy 1 at match step ${j} in both runs (held ${show(p.held.renders.map((r) => r.step))}, straight ${show(p.straight.renders.map((r) => r.step))})`);
      else if (h.sha256 === s.sha256) fails.push(`copy 1's frame at match step ${j}, before player 2's late message, equals the straight run's: it doesn't draw its prediction`);
    }
    const bare = at(p.bare!, 136); const s136 = at(p.straight.renders, 136);
    if (!bare || !s136 || bare.sha256 === s136.sha256) fails.push('the piece without its trail draws match step 136 as the piece with it does: the trail isn\'t in what\'s compared');
    none([...fails, ...judge(p)], 'copy 1\'s frames after the rollback against the straight run\'s');
  }, SHOW_TIMEOUT);

  it(`${ac(4)} (planted) a trail that keeps the predicted points fails, naming the step`, async () => {
    requireGpu();
    const p = await played('AC4 planted trail_keeps_predicted_points', { bare: false, planted: 'trail_keeps_predicted_points' });
    failsNaming(judge(p), [`replaced step ${LATE}`], 'the planted trail_keeps_predicted_points');
    expect(rollbacksOf(copiesOf(p.held.reply, 2, 'AC4 planted')[0]!, 'AC4 planted').some((r) => r.to === LATE), 'under the plant, copy 1 still rolls back to step 120').toBe(true);
  }, SHOW_TIMEOUT);
});

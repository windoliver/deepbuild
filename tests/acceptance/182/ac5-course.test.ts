// Criterion 5: a course with the 30° ramp, the 0.3 m step and a jump over a 1 m gap, driven for 1,200 steps by a
// logic item's move and jump inputs, gives the same full-state hash at every checkpoint and the same step hashes when
// seeked from each checkpoint, mid-jump included, as a straight run, and its golden recorded on macOS matches on Linux;
// a planted checkpoint that leaves out the character's vertical speed fails, naming the first step and that field; and
// the physics module passes the conformance kit's carried-state and late-entry parts (#138) on that course.
//
// The course is helpers' `courseWorld`: the world's `walk` and `hop` take `on: {logic: "driver"}`, and the track holds
// the entries `driver` fires (a walk at step 0, jumps at 96 and 960), as a bake keeps derived entries. Seeks are #522's
// `seek`; the full-state hashes at checkpoints are physics.determinism's (`determinism`), which restores every
// checkpoint of the straight run and compares step, canonical and deep hashes. The seek judge also compares the body's
// states field by field, so a failure names the first step and field that differ. The Linux machine is this checkout
// built for linux/amd64 in Docker; the kit is deep-show's (#138's `kit` call) on its fixture
// `parity/physics/character-course.<profile>`.
import { describe, expect, test } from 'vitest';
import {
  AC, COURSE_STEPS, HERO, LINUX_TIMEOUT, LINUX_TRIPLE, SESSION, TIMEOUT, arr, bake, blocked, caught, characterStates,
  courseTrack, courseWorld, hashesOf, heroInputs, isObject, none, num, obj, onLinux, physics, prebuild, runShow, scenario,
  show, statesOf, str, useTemp, type Character, type JsonObject, type JsonValue, type Runner, type State,
} from './helpers.ts';

prebuild(['shipped', 'show']);
const temp = useTemp();
const WORLD = (): JsonObject => courseWorld(heroInputs({ logic: 'driver' }));
const KIT_FIXTURE = 'parity/physics/character-course.';

interface Baked { reply: JsonObject; states: State[]; hashes: string[]; checkpoints: number[] }
function baked(r: Runner, store: string): Baked {
  const reply = physics([bake(WORLD(), COURSE_STEPS, { track: courseTrack(), store, checkpoints: true, read: [HERO] })], r)[0]!;
  const states = statesOf(reply, HERO, 'the course\'s bake');
  const checkpoints = arr(reply['checkpoints'], 'the course\'s checkpoints').map((c, i) => num(obj(c, `checkpoints[${i}]`)['step'], `checkpoints[${i}].step`));
  return { reply, states, hashes: hashesOf(reply, 'the course\'s bake'), checkpoints };
}
const seekCall = (store: string, to: number): JsonObject =>
  ({ call: 'seek', world: WORLD(), track: courseTrack(), steps: COURSE_STEPS, store, to, play: COURSE_STEPS - to, read: [HERO] });

/** The fields the judge compares, in order: the frame's position, then the character's own state. */
function fields(s: State, c: Character): [string, JsonValue][] {
  return [
    ['pos', s.pos], ['vertical', c.vertical], ['grounded', c.grounded], ['sliding', c.sliding], ['wants', c.wants], ['crouched', c.crouched],
  ];
}
/**
 * The seek judge: a seek from each checkpoint c of the bake's ring restores c and steps to the end; every state and
 * step hash from c on equals the straight run's. A failure names the seek, the first step that differs and its field.
 */
function seekFailures(b: Baked, seeks: JsonObject[]): string[] {
  const out: string[] = [];
  const straight = characterStates(b.states, 'the straight run');
  b.checkpoints.forEach((c, i) => {
    const reply = seeks[i]!;
    if (reply['from'] !== c) { out.push(`seek to checkpoint ${c} restored ${show(reply['from'])}, not ${c}`); return; }
    const states = statesOf(reply, HERO, `the seek from ${c}`);
    const chars = characterStates(states, `the seek from ${c}`);
    const hashes = hashesOf(reply, `the seek from ${c}`);
    for (let j = 0; j < states.length; j++) {
      const k = c + j;
      const want = fields(b.states[k]!, straight[k]!);
      const got = fields(states[j]!, chars[j]!);
      const f = want.findIndex(([, v], n) => JSON.stringify(v) !== JSON.stringify(got[n]![1]));
      if (f >= 0) { out.push(`seek from checkpoint ${c}: first differs at step ${k}, field ${want[f]![0]} (straight run ${show(want[f]![1])}, seek ${show(got[f]![1])})`); return; }
      if (hashes[j] !== b.hashes[k]) { out.push(`seek from checkpoint ${c}: first differs at step ${k}, field step_hash`); return; }
    }
    if (states.length !== COURSE_STEPS - c + 1) out.push(`seek from checkpoint ${c} answers ${states.length} states, not ${COURSE_STEPS - c + 1}`);
  });
  return out;
}
/** The checkpoints taken mid-jump: the body airborne with a vertical speed. */
const midJump = (b: Baked): number[] => {
  const chars = characterStates(b.states, 'the straight run');
  return b.checkpoints.filter((c) => !chars[c]!.grounded && chars[c]!.vertical !== 0);
};

describe(`${AC[5]} the course seeks as it plays, its golden matches on Linux, and the kit passes on it`, () => {
  test(`${AC[5]} seeking from each checkpoint, mid-jump included, gives the straight run's step hashes and states, and physics.determinism finds every checkpoint's full-state hash equal`, () => {
    const store = temp();
    const b = baked({}, store);
    expect(b.checkpoints.length, `the bake's ring keeps checkpoints: ${show(b.checkpoints)}`).toBeGreaterThan(1);
    expect(midJump(b), `a checkpoint falls mid-jump (checkpoints ${b.checkpoints.join(', ')})`).not.toEqual([]);
    const replies = physics([...b.checkpoints.map((c) => seekCall(store, c)), { call: 'determinism', world: WORLD(), track: courseTrack(), steps: COURSE_STEPS, at_times: [COURSE_STEPS / 120] }]);
    none(seekFailures(b, replies.slice(0, -1)), 'seeks from each checkpoint against the straight run');
    const det = replies.at(-1)!;
    expect(det['ok'], `physics.determinism ran: ${show(det)}`).toBe(true);
    expect(det['verdict'], `physics.determinism over the course: ${show(det['failures'] ?? null)}`).toBe('PASS');
    expect(arr(det['failures'], 'failures'), 'no failure').toEqual([]);
  }, TIMEOUT);

  test(`${AC[5]} a planted checkpoint that leaves out the character's vertical speed (--planted checkpoint_drops_vertical) fails, naming the first step and that field`, () => {
    const store = temp();
    const b = baked({ planted: 'checkpoint_drops_vertical' }, store);
    const mid = midJump(b);
    expect(mid, 'a checkpoint falls mid-jump').not.toEqual([]);
    const seeks = physics(b.checkpoints.map((c) => seekCall(store, c)), { planted: 'checkpoint_drops_vertical' });
    const failures = seekFailures(b, seeks);
    caught(failures, 'the checkpoint without the character\'s vertical speed');
    expect(failures[0], `the first failure names the first mid-jump checkpoint, step ${mid[0]}, and the field vertical: ${failures.join('; ')}`).toContain(`first differs at step ${mid[0]}, field vertical`);
  }, TIMEOUT);

  test(`${AC[5]} the course's golden recorded on macOS matches on Linux x86_64`, () => {
    if (process.platform !== 'darwin') blocked(`the golden is recorded on macOS; this is ${process.platform}`);
    const track = courseTrack();
    const [rec] = physics([{ call: 'golden', world: WORLD(), track, steps: COURSE_STEPS, store: temp(), verify_on: [LINUX_TRIPLE] }]);
    expect(rec!['ok'], `the golden is recorded: ${show(rec)}`).toBe(true);
    const golden = obj(rec!['golden'], 'golden');
    expect(str(golden['record_on'], 'record_on'), 'recorded on macOS').toMatch(/apple-darwin$/);
    const verify: JsonObject = { call: 'golden_verify', golden, world: WORLD(), track, steps: COURSE_STEPS };
    const [here] = physics([verify]);
    expect(here!['verdict'], `this machine replays its own golden: ${show(here)}`).toBe('PASS');
    const [linux] = onLinux([verify]);
    expect(linux!['target'], `the replay ran on Linux x86_64: ${show(linux)}`).toBe(LINUX_TRIPLE);
    expect(linux!['verdict'], `the golden matches on Linux: ${show(linux!['report'] ?? linux!['failure'] ?? linux!)}`).toBe('PASS');
  }, LINUX_TIMEOUT);

  test(`${AC[5]} the physics module passes the conformance kit's carried-state and late-entry parts on the course`, () => {
    const [reply] = runShow(scenario(temp(), [], [{ call: 'kit', modules: ['physics'], parts: ['carried_state', 'late_entry'] }]), `deep-show kit (${SESSION})`);
    const physicsModule = arr(reply!['modules'], `the kit's modules: ${show(reply)}`).map((m, i) => obj(m, `modules[${i}]`)).find((m) => m['module'] === 'physics');
    expect(physicsModule, `the kit's report holds the physics module: ${show(reply)}`).toBeDefined();
    const parts = arr(physicsModule!['parts'], 'physics: parts').map((p, i) => obj(p, `physics: parts[${i}]`));
    for (const part of ['carried_state', 'late_entry']) {
      const p = parts.find((x) => x['part'] === part);
      expect(p, `the physics module ran the ${part} part; it ran ${parts.map((x) => show(x['part'])).join(', ')}`).toBeDefined();
      const cases = arr(p!['cases'], `${part}: cases`).filter(isObject).filter((c) => typeof c['fixture'] === 'string' && c['fixture'].startsWith(KIT_FIXTURE));
      expect(cases.length, `${part} runs the course's fixture ${KIT_FIXTURE}*; its cases: ${show(arr(p!['cases'], 'cases').map((c) => (isObject(c) ? c['fixture'] ?? c['case'] ?? null : null)))}`).toBeGreaterThan(0);
      none(cases.filter((c) => c['verdict'] !== 'PASS').map((c) => `${part}: ${show(c['case'] ?? null)} reads ${show(c['verdict'] ?? null)}: ${show(c['failure'] ?? null)}`), `the ${part} part's cases on the course`);
      expect(p!['verdict'], `the ${part} part passes: ${show(p!['failures'] ?? null)}`).toBe('PASS');
    }
  }, TIMEOUT);
});

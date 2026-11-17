// Criterion 6: on the course, a logic item that counts landings from the body's grounded output counts each landing
// at the first logic step after the physics step where grounded turned true; a readout bound to its velocity shows
// 2.00 m/s within 1% while it walks on flat ground; and its contacts with the step and the ramp appear as contact_begin
// occurrences naming it, in the bake's sorted order.
//
// The readout and the contacts are read from `deep-physics`'s bake of the course (helpers' `courseWorld`): the output
// `speed` (`read: velocity`, `to` a readout) sampled at the document's 60 frames a second, and the occurrence list. The
// counter runs in deep-show beside the course in a scene: a logic item at 60 Hz reading `course.hero.grounded` (the
// world's reading by `<world ID>.<body ID>.<read>`, as the core's column view names one) and writing `landings`. Logic
// steps first at a shared time and reads physics only from earlier steps, so logic step j reads grounded after physics
// step 2j − 1, and a landing at physics step k is counted at logic step ⌊k/2⌋ + 1. In the scene the course's walk and
// jumps come from presses of two controls on the core's input track, deriving the same entries at the same steps
// (README: Readings): a logic item firing a world's inputs is #1834's, not this issue's.
import { describe, expect, test } from 'vitest';
import {
  AC, COURSE, COURSE_JUMPS, COURSE_STEPS, COURSE_WALK, DOC, HERO, SESSION, TIMEOUT, arr, bake, between, characterStates,
  courseTrack, courseWorld, heroInputs, isObject, none, num, obj, physics, prebuild, presented, putEvidence, rowsOf,
  runShow, scenario, show, showCall, statesOf, str, unsorted, useTemp, vec3, type JsonObject,
} from './helpers.ts';

prebuild(['shipped', 'show']);
const temp = useTemp();

describe(`${AC[6]} logic and items read the body's outputs and contacts`, () => {
  test(`${AC[6]} a readout bound to the body's velocity shows 2.00 m/s within 1% on flat ground, and its contacts with the step and the ramp are contact_begin rows naming it in the sorted list`, () => {
    const [reply] = physics([bake(courseWorld(heroInputs({ logic: 'driver' })), COURSE_STEPS, { track: courseTrack(), read: [HERO] })]);
    const states = statesOf(reply!, HERO, 'the course');
    const chars = characterStates(states, 'the course');
    const series = arr(obj(obj(reply!['outputs'], 'outputs')['series'], 'outputs.series')['speed'], 'outputs.series.speed (the readout\'s velocity)');
    // Frame f at 60 fps is state 2f. On flat ground: grounded at states 2f − 4 … 2f + 2 at one height, over a flat level.
    const flat = (x: number): boolean => (x > 0.05 && x < 1.55) || (x > 3.7 && x < 4.6) || (x > 8.9 && x < 10.5) || (x > 11.6 && x < 29);
    const out: string[] = [];
    let frames = 0;
    for (let f = 2; 2 * f + 2 <= COURSE_STEPS && f < series.length; f++) {
      const window = states.slice(2 * f - 4, 2 * f + 3);
      if (!window.every((s, i) => chars[2 * f - 4 + i]!.grounded && flat(s.pos[0]) && Math.abs(s.pos[1] - window[0]!.pos[1]) <= 1e-4)) continue;
      frames++;
      const v = vec3(series[f], `outputs.series.speed[${f}]`);
      const speed = Math.hypot(...v);
      if (Math.abs(speed - 2) > 0.02) out.push(`frame ${f} (x ${states[2 * f]!.pos[0].toFixed(3)} on flat ground): the readout shows ${speed.toFixed(4)} m/s, not 2.00 within 1%`);
    }
    expect(frames, 'frames on flat ground were found to read').toBeGreaterThan(20);
    const rows = rowsOf(reply!, 'the course');
    for (const body of ['ramp', 'step']) if (between(rows, 'contact_begin', HERO, body).length === 0) out.push(`no contact_begin row names ${HERO} and ${body}`);
    out.push(...unsorted(rows));
    none(out, 'the readout and the occurrence list');
  }, TIMEOUT);

  test(`${AC[6]} a logic item counting landings from the body's grounded output counts each at the first logic step after the physics step where grounded turned true`, () => {
    const evidence = temp();
    // The physics run, its grounded after each step; the landings are its rises after the start, two at least (two jumps).
    const derived = [{ step: 0, kind: 'move', target: HERO, data: { velocity: COURSE_WALK } }, ...COURSE_JUMPS.map((s) => ({ step: s, kind: 'jump', target: HERO, data: { height: 1 } }))];
    const [reply] = physics([bake(controlCourse(), COURSE_STEPS, { track: derived, read: [HERO] })]);
    const grounded = characterStates(statesOf(reply!, HERO, 'the course'), 'the course').map((c) => c.grounded);
    // What logic step j reads: grounded after physics step 2j − 1 (j ≥ 1); the counter counts from step 2 on.
    const read = (j: number): boolean => grounded[2 * j - 1]!;
    const expected: number[] = [];
    for (let j = 2; j < LOGIC_STEPS; j++) if (read(j) && !read(j - 1)) expected.push(j);
    const landings: number[] = [];
    for (let k = 2; k <= 2 * LOGIC_STEPS - 1; k++) if (grounded[k] && !grounded[k - 1]) landings.push(k);
    expect(landings.length, `the body lands after each of its ${COURSE_JUMPS.length} jumps (grounded turns true at steps ${landings.join(', ')})`).toBeGreaterThanOrEqual(COURSE_JUMPS.length);
    expect(expected, `each landing at physics step k is read at logic step ⌊k/2⌋ + 1 (landings ${landings.join(', ')})`).toEqual(landings.map((k) => Math.floor(k / 2) + 1));
    // The counter's read slot, from its region map; then the counter itself.
    const probeDoc = DOC(1);
    const [shown, query] = runShow(scenario(evidence, [probeDoc], [
      showCall(probeDoc, courseScene(evidence, counter({ offset: 0, type: 'i32' }))),
      { call: 'deep_query', session: SESSION, doc: probeDoc, what: 'logic', items: ['counter'], steps: [0], at: 0 },
    ]), 'the counter\'s region map');
    presented(shown, 'the course scene');
    const map = obj(obj(obj(query!['logic'], `deep_query's logic read: ${show(query)}`)['counter'], 'logic.counter')['region_map'], 'logic.counter.region_map');
    const slot = arr(map['entries'], 'region_map.entries').filter(isObject).find((e) => e['region'] === 'reads' && e['name'] === `${COURSE}.${HERO}.grounded`);
    expect(slot, `the counter's read region holds ${COURSE}.${HERO}.grounded: ${show(map)}`).toBeDefined();
    const type = str(slot!['type'], 'its type');
    expect(['bool', 'i32', 'f64'], `${COURSE}.${HERO}.grounded is read as a bool, an i32 or an f64`).toContain(type);
    const doc = DOC(2);
    const track = [press('go', 0, 0), ...COURSE_JUMPS.map((s, i) => press('hop', s, i + 1))];
    const [shown2, ran] = runShow(scenario(evidence, [doc], [
      showCall(doc, courseScene(evidence, counter({ offset: num(slot!['offset'], 'its offset'), type: type as 'bool' | 'i32' | 'f64' }))),
      { call: 'logic', doc, steps: LOGIC_STEPS, track },
    ]), 'the counter beside the course');
    presented(shown2, 'the course scene with the counter');
    expect(ran!['code'], `the logic call runs: ${show(ran)}`).toBeUndefined();
    const steps = arr(ran!['steps'], 'the logic steps').map((s, i) => obj(s, `steps[${i}]`));
    expect(steps.length, 'the counter ran 600 logic steps (10 s at 60 Hz)').toBe(LOGIC_STEPS);
    const counts = steps.map((s, j) => num(arr(obj(s['arrays'], `step ${j}: arrays`)['counter.landings'], `step ${j}: counter.landings`)[0], `step ${j}: landings`));
    const counted = counts.map((n, j) => (j > 0 && n > counts[j - 1]! ? j : -1)).filter((j) => j >= 0);
    expect(counted, `the counter counts each landing at the first logic step after the physics step where grounded turned true (physics landings ${landings.join(', ')})`).toEqual(expected);
  }, TIMEOUT);
});

const LOGIC_STEPS = COURSE_STEPS / 2;
/** One physics step in flicks (705,600,000 a second, 120 steps a second). */
const STEP_FLICKS = 705_600_000 / 120;
const press = (control: string, step: number, seq: number): JsonObject => ({ t: step * STEP_FLICKS, seq, control, value: 1, writer: 'you', player: 1 });

/** The course with its walk and jumps derived from presses of `go` and `hop`, each entry's data constant. */
function controlCourse(): JsonObject {
  return courseWorld({
    ...heroInputs(),
    walk: { kind: 'move', targets: [HERO], on: { control: 'go', each: 'entry' }, data: { velocity: COURSE_WALK } },
    hop: { kind: 'jump', targets: [HERO], on: { control: 'hop', each: 'entry' }, data: { height: 1 } },
  });
}
const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture made by the #182 acceptance tests.' };
/** The course as a 10 s scene: its two controls, the world, a camera and the counter. */
function courseScene(evidence: string, program: Uint8Array): JsonObject {
  const sha = putEvidence(evidence, program);
  const item = (id: string, order: string, rest: JsonObject): JsonObject => ({ id, name: id, order, ...rest });
  return {
    format: 1, profile: 'scene', title: 'Character course', description: 'The character course with a landing counter: a #182 acceptance fixture.',
    size: [640, 360], camera: 'cam', seed: 182, transport: { span: '10s', frame_rate: [60, 1] },
    requires: { modules: { scene3d: '^1', logic: '^1', physics: '^1' } },
    controls: { go: { kind: 'press', class: 'document', label: 'Go', role: 'button' }, hop: { kind: 'press', class: 'document', label: 'Hop', role: 'button' } },
    worlds: { [COURSE]: controlCourse() },
    items: {
      cam: item('cam', 'a000', { kind: 'camera@1', params: { projection: 'perspective', position: [10, 6, 18], target: [10, 1, 0], fov: 40 } }),
      counter: item('counter', 'a001', { kind: 'logic@1', params: { program: sha, step_rate: 60, reads: [`${COURSE}.${HERO}.grounded`], writes: { landings: { type: 'i32' } } } }),
    },
    assets: { counter_program: { sha256: sha, license: LICENSE } },
  };
}

// The counter, as an agent would write it, assembled here as WebAssembly bytes. Its memory is one page (its maximum its
// minimum); the read region at 0, the write region (`landings`, an i32) at 4,096; its last read at 8,192 and its count
// at 8,196. Step k reads grounded at the slot's offset; from step 2 on, a read true after one false adds a landing.
const leb = (n: number): number[] => { const out: number[] = []; let v = n >>> 0; do { let b = v & 0x7f; v >>>= 7; if (v) b |= 0x80; out.push(b); } while (v); return out; };
const sleb = (n: number): number[] => {
  const out: number[] = [];
  let v = BigInt(n);
  for (;;) {
    const b = Number(v & 0x7fn);
    v >>= 7n;
    const done = (v === 0n && (b & 0x40) === 0) || (v === -1n && (b & 0x40) !== 0);
    out.push(done ? b : b | 0x80);
    if (done) return out;
  }
};
const name = (s: string): number[] => [...leb(s.length), ...Buffer.from(s, 'utf8')];
const vec = (xs: number[][]): number[] => [...leb(xs.length), ...xs.flat()];
const section = (id: number, body: number[]): number[] => [id, ...leb(body.length), ...body];
const fn = (locals: number[][], code: number[]): number[] => { const b = [...vec(locals), ...code, 0x0b]; return [...leb(b.length), ...b]; };
const WRITES_AT = 4096;
const PREV = 8192;
const COUNT = 8196;
function counter(slot: { offset: number; type: 'bool' | 'i32' | 'f64' }): Uint8Array {
  const load = slot.type === 'f64'
    ? [0x41, ...sleb(slot.offset), 0x2b, 0x03, 0x00, 0x44, 0, 0, 0, 0, 0, 0, 0, 0, 0x62]
    : [0x41, ...sleb(slot.offset), 0x28, 0x02, 0x00, 0x41, 0x00, 0x47];
  const step = fn([[1, 0x7f]], [
    ...load, 0x21, 1, // $g = grounded != 0
    0x20, 0, 0x42, 2, 0x5a, 0x20, 1, 0x71, 0x41, ...sleb(PREV), 0x28, 0x02, 0x00, 0x45, 0x71, // k >= 2 && $g && !prev
    0x04, 0x40, 0x41, ...sleb(COUNT), 0x41, ...sleb(COUNT), 0x28, 0x02, 0x00, 0x41, 1, 0x6a, 0x36, 0x02, 0x00, 0x0b, // count += 1
    0x41, ...sleb(PREV), 0x20, 1, 0x36, 0x02, 0x00, // prev = $g
    0x41, ...sleb(WRITES_AT), 0x41, ...sleb(COUNT), 0x28, 0x02, 0x00, 0x36, 0x02, 0x00, // landings = count
  ]);
  return Uint8Array.from([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, vec([[0x60, 1, 0x7e, 0]])),
    ...section(3, vec([[0], [0]])),
    ...section(5, vec([[0x01, 1, 1]])),
    ...section(6, vec([[0x7f, 0x00, 0x41, ...sleb(0), 0x0b], [0x7f, 0x00, 0x41, ...sleb(WRITES_AT), 0x0b]])),
    ...section(7, vec([[...name('memory'), 2, 0], [...name('init'), 0, 0], [...name('step'), 0, 1], [...name('reads_at'), 3, 0], [...name('writes_at'), 3, 1]])),
    ...section(10, vec([fn([], []), step])),
  ]);
}

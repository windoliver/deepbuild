// AC8 #504.a17a1463: A take-apart shot that keeps every part has every part's bounds inside the safe frame at all 30
// samples a second.
//
// Through `deep-motion eval` with `project` naming every part: a 30 fps film of a figure of three assemblies (base, body,
// lid), two parts each, taken apart by a follow channel whose stagger names the assemblies, under one 4 s hold shot
// whose `frame.keep` names all six parts. Each sample's `projected.<part>.box` is held to the safe frame (24 u in from
// each edge of 1920 × 1080). The plant is `framer_ignores_apart`: framing that bounds the kept parts at rest, as if no
// assembly were taken apart. The fixture's arithmetic is in the README.
import { describe, expect, it } from 'vitest';
import {
  AC8, F30, TIMEOUT, add, camera3d, evalOk, evalPlanted, failsNaming, LAYER, none, part, poseOf, projOf, projectPoint, safeFrame, samples30,
  unionOf, useMotion, type Accepted, type JsonObject, type V3,
} from './helpers.ts';

const motion = useMotion();

/** The assemblies: each one's `at`, its `apart` vector (m) and its `order`, in the stagger's order. */
const ASSEMBLIES: Record<string, { at: V3; apart: V3; order: number }> = {
  base: { at: [0, -0.5, 0], apart: [0, -2, 0], order: 0 },
  body: { at: [0, 0, 0], apart: [1.2, 0, 0], order: 1 },
  lid: { at: [0, 0.5, 0], apart: [0, 2, 0], order: 2 },
};
/** The parts: each one's assembly, its position in the assembly's space and its box size (m). */
const PARTS: Record<string, { assembly: string; pos: V3; size: number | V3 }> = {
  plate: { assembly: 'base', pos: [0, 0, 0], size: [1.2, 0.2, 0.6] },
  peg: { assembly: 'base', pos: [0.4, 0.2, 0], size: 0.2 },
  drum: { assembly: 'body', pos: [0, 0, 0], size: [0.8, 0.4, 0.6] },
  gear: { assembly: 'body', pos: [0.55, 0, 0], size: 0.3 },
  cap: { assembly: 'lid', pos: [0, 0, 0], size: [1.0, 0.2, 0.6] },
  knob: { assembly: 'lid', pos: [0, 0.2, 0], size: 0.2 },
};
const PART_IDS = Object.keys(PARTS);
const SHOT = 'apart_shot';

const DOC: JsonObject = {
  format: 1, id: 'take-apart', profile: 'film', title: '#504 AC8 take-apart', description: 'A figure of three assemblies taken apart under one shot that keeps every part.',
  size: [1920, 1080], camera: 'cam', layers: { [LAYER]: { writer: 'agent-a', title: 'Main', order: 'a0' } },
  transport: { span: '4s', frame_rate: '30/1' },
  items: Object.fromEntries([
    camera3d('cam', { azimuth: 0, elevation: 0, distance: 10 }),
    ...PART_IDS.map((id) => part(id, PARTS[id]!.assembly, PARTS[id]!.pos, PARTS[id]!.size)),
  ].map((item) => [String(item['id']), item])),
  assemblies: Object.fromEntries(Object.entries(ASSEMBLIES).map(([id, a]) => [id, { at: { pos: a.at }, apart: a.apart, order: a.order }])),
  data: { apart: 0 },
  channels: {
    take_apart: {
      target: 'data/apart', type: 'f32', mode: 'follow',
      follow: {
        source: { keys: { k0: { t: '0s', value: 0 }, k1: { t: '0.5s', value: 1 } } },
        model: { spring: { freq_hz: 2, damping_ratio: 1 } },
        stagger: { targets: Object.keys(ASSEMBLIES), lag: '0.5s', order: 'index' },
      },
    },
  },
  shots: { [SHOT]: { start: '0s', end: '4s', camera: 'cam', move: 'hold', frame: { keep: PART_IDS, fill: 0.6 } } },
};
/** The shot's 30-a-second samples: 0, 1/30, …, 119/30 s. */
const TIMES = samples30(0, 4);
const LAST = TIMES.length - 1;
const SIZE: [number, number] = [1920, 1080];
const SAFE = safeFrame(DOC);

/** The criterion's check: every part's projected bounds inside the safe frame at every sample; a failure names the
 * part and the sample. */
function safeFailures(a: Accepted, what: string): string[] {
  return a.frames.flatMap((f, k) => PART_IDS.flatMap((id) => {
    const b = projOf(f, id, what).box;
    return b[0] >= SAFE[0] && b[1] >= SAFE[1] && b[2] <= SAFE[2] && b[3] <= SAFE[3] ? [] : [`${id} leaves the safe frame at sample ${k} (t = ${k}/30 s): its box ${JSON.stringify(b)} against ${JSON.stringify(SAFE)}`];
  }));
}

/** That the shot shows a take-apart at all: from the first sample (every share 0) to the last (every assembly settled
 * apart), each part's projected centre moves by its assembly's `apart` as the frame's camera projects it, within 1%
 * and 0.5 px. Without it, parts that never move would pass the safe-frame check. */
function apartFailures(a: Accepted, what: string): string[] {
  const first = a.frames[0]!; const last = a.frames[LAST]!;
  const pose = poseOf(last, 'cam', what);
  expect(Math.abs(pose.roll), `${what}: the hold shot has no roll, as the reference projection takes it`).toBeLessThan(1e-9);
  return PART_IDS.flatMap((id) => {
    const p = PARTS[id]!; const asm = ASSEMBLIES[p.assembly]!;
    const rest = add(asm.at, p.pos);
    const [x0, y0] = projectPoint(pose, rest, SIZE); const [x1, y1] = projectPoint(pose, add(rest, asm.apart), SIZE);
    const want = [x1 - x0, y1 - y0] as const;
    const c0 = projOf(first, id, what).center; const c1 = projOf(last, id, what).center;
    const got = [c1[0] - c0[0], c1[1] - c0[1]] as const;
    const off = Math.hypot(got[0] - want[0], got[1] - want[1]);
    return off <= 0.01 * Math.hypot(want[0], want[1]) + 0.5 ? [] : [`${id} moves ${JSON.stringify(got)} px from sample 0 to sample ${LAST}, not its assembly ${p.assembly}'s apart ${JSON.stringify(asm.apart)} m, ${JSON.stringify(want)} px`];
  });
}

describe(`${AC8} a take-apart shot keeps every part's bounds in the safe frame`, () => {
  it(`${AC8} a hold shot keeping all six parts of a staggered take-apart has each part's projected bounds inside the safe frame at each of its 120 samples at 30 a second, the parts ending apart`, () => {
    const a = evalOk(motion.bin(), { doc: DOC, times: TIMES, project: PART_IDS }, 'the take-apart');
    expect(a.frames[1]!.t, 'sample 1 is t = 1/30 s').toBe(F30);
    none([...apartFailures(a, 'the take-apart'), ...safeFailures(a, 'the take-apart')], 'the take-apart shot');
  }, TIMEOUT);

  it(`${AC8} a planted framer that frames the parts at rest, ignoring the take-apart, loses the plate and the knob from the safe frame by the last sample`, () => {
    const a = evalPlanted(motion.bin(), { doc: DOC, times: TIMES, project: PART_IDS, planted: 'framer_ignores_apart' }, 'the planted framer');
    // The plant's union is the parts' rest bounds (x −0.6…0.7, y −0.6…0.8 m), not the take-apart's (x to 1.9, y −2.6…2.8).
    const [lo, hi] = unionOf(a, SHOT, 'the planted framer');
    const past = Math.max(-0.6 - lo[0], -0.6 - lo[1], hi[0] - 0.7, hi[1] - 0.8);
    expect(past, `the plant's union ${JSON.stringify([lo, hi])} sees the parts only at rest, within 0.02 m`).toBeLessThanOrEqual(0.02);
    failsNaming(safeFailures(a, 'the planted framer'), [`plate leaves the safe frame at sample ${LAST} `, `knob leaves the safe frame at sample ${LAST} `], 'the safe-frame check on the plant');
  }, TIMEOUT);
});

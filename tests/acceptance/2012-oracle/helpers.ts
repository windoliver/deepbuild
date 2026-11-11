// The #2012 Oracle lane's tools: the #2012 suite's (../2012/helpers.ts: deep-physics on this Mac, in the lane's
// linux/amd64 container and through the wasm32 leg), reused as they stand so both lanes ask the same programs the same
// way, and two of Rapier's test scenes written as our world documents under upstream's defaults as #2010's Oracle lane
// writes them (../2010-oracle/helpers.ts: 60 Hz, 4 solver iterations as substeps, gravity (0, −9.81, 0), average
// combine, a collider's friction 0.5 and density 1, a checkpoint ring wide enough never to double its spacing).
import { upstreamScene, withJointsAndSensor } from '../2010-oracle/helpers.ts';
import {
  arr, box, isObject, obj, show, sphere, type JsonObject, type JsonValue,
} from '../2012/helpers.ts';

export * from '../2012/helpers.ts';

const stat = (shape: string, pos: number[], extra: JsonObject = {}): JsonObject => ({ kind: 'static', shapes: [{ shape, contact_material: 'plain', ...extra }], pose: { pos } });
const dyn = (shape: string, pos: number[], extra: JsonObject = {}): JsonObject => ({ kind: 'dynamic', shapes: [{ shape, contact_material: 'plain' }], pose: { pos }, ...extra });

/** Upstream's jittered pile: a 20 × 0.5 × 20 ground with its top at y 0, n × 3 × n unit boxes on a 1.05 m pitch from −`from`. */
function jitteredPile(n: number, from: number): { shapes: JsonObject; bodies: JsonObject } {
  const bodies: JsonObject = { ground: stat('ground', [0, -0.5, 0]) };
  for (let i = 0; i < n; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < n; k++) {
    const jitter = (i * 0.013 + k * 0.017) % 0.05;
    bodies[`box_${String(i).padStart(2, '0')}_${j}_${String(k).padStart(2, '0')}`] = dyn('cube', [i * 1.05 - from + jitter, j * 1.05 + 0.55, k * 1.05 - from - jitter]);
  }
  return { shapes: { ground: box([20, 0.5, 20]), cube: box([0.5, 0.5, 0.5]) }, bodies };
}

/**
 * snapshot_portability's `scene()`: a 6 × 3 × 6 pile, a chain of four r 0.25 balls on ball joints from a fixed point
 * at (0, 7, 0) that never sleep, a 3 × 0.5 × 3 sensor at y 4 they swing through, and a never-sleeping r 0.15 CCD ball
 * thrown from (−8, 2, 0.5) at (90, −20, 1) m/s across the pile. Its multibody chain is left out: our document has no
 * multibody joint. A deep checkpoint every 60 steps: the one at step 60 is the whole world's bytes upstream compares.
 */
export function portabilityScene(): JsonObject {
  const scene = withJointsAndSensor(jitteredPile(6, 3));
  return upstreamScene({
    shapes: { ...scene.shapes, bullet: sphere(0.15) },
    bodies: { ...scene.bodies, bullet: dyn('bullet', [-8, 2, 0.5], { ccd: true, sleep: false, velocity: { linear: [90, -20, 1] } }) },
    joints: scene.joints,
  }, 60);
}

/**
 * simd_backend_determinism's `run()`: a 12 × 3 × 12 pile (many same-color contacts, so the solver's four-wide chunks
 * engage) and a chain of four r 0.25 balls on ball joints from a fixed point at (0, 8, 0), at Rapier's defaults (they
 * may sleep). A deep checkpoint every 60 steps.
 */
export function simdScene(): JsonObject {
  const pile = jitteredPile(12, 6);
  const bodies: JsonObject = { ...pile.bodies };
  const joints: JsonObject = {};
  for (let i = 0; i < 4; i++) {
    bodies[`link_${i}`] = dyn('link', [0.6 * (i + 1), 8, 0]);
    joints[`joint_${i}`] = {
      kind: 'ball', collide_connected: true,
      a: i === 0 ? 'world' : `link_${i - 1}`, frame_a: { anchor: i === 0 ? [0.3, 8, 0] : [0.3, 0, 0] },
      b: `link_${i}`, frame_b: { anchor: [-0.3, 0, 0] },
    };
  }
  return upstreamScene({ shapes: { ...pile.shapes, link: sphere(0.25) }, bodies, joints }, 60);
}

/** A bake's checkpoints by step: the deep hash and the whole-world state's bytes. */
export function checkpointsOf(reply: JsonObject, what: string): Map<number, { deepHash: JsonValue | undefined; bytes: Buffer }> {
  const out = new Map<number, { deepHash: JsonValue | undefined; bytes: Buffer }>();
  arr(reply['checkpoints'], `${what}: checkpoints`).forEach((c, i) => {
    const cp = obj(c, `${what}: checkpoints[${i}]`);
    out.set(cp['step'] as number, { deepHash: cp['deep_hash'], bytes: Buffer.from(String(cp['state']), 'base64') });
  });
  return out;
}

/**
 * Upstream's portability assertion, on our output: another target's bake of the scene gives the golden's step hash at
 * every step, and at each checkpoint the whole world's bytes this Mac's bake took, so the same size (a different size is
 * an encoding change, as a usize sentinel on 32-bit wasm32 was) and the same bytes (an equal size with other bytes is a
 * value change), and the deep hash the golden recorded.
 */
export function portableFailures(reply: JsonObject, golden: JsonObject, mac: Map<number, { deepHash: JsonValue | undefined; bytes: Buffer }>, what: string): string[] {
  if (reply['ok'] !== true) return [`${what}: the bake doesn't answer: ${show(reply)}`];
  const f: string[] = [];
  const want = golden['step_hashes'] as JsonValue[];
  const got = reply['step_hashes'];
  if (!Array.isArray(got) || got.length !== want.length) f.push(`${what}: ${Array.isArray(got) ? got.length : show(got)} step hashes, the golden ${want.length}`);
  else {
    const k = got.findIndex((h, i) => h !== want[i]);
    if (k >= 0) f.push(`${what}: step ${k} hashes ${show(got[k])}, the golden recorded on the Mac ${show(want[k])}`);
  }
  const recorded = new Map((golden['checkpoint_hashes'] as JsonValue[]).filter(isObject).map((c) => [c['step'], c['deep_hash']]));
  const theirs = checkpointsOf(reply, what);
  if (JSON.stringify([...theirs.keys()]) !== JSON.stringify([...mac.keys()])) f.push(`${what}: checkpoints at ${JSON.stringify([...theirs.keys()])}, this Mac's at ${JSON.stringify([...mac.keys()])}`);
  for (const [step, mine] of mac) {
    const other = theirs.get(step);
    if (!other) continue;
    if (other.bytes.length !== mine.bytes.length) f.push(`${what}: the whole world at step ${step} is ${other.bytes.length} bytes, ${mine.bytes.length} on the Mac: an encoding differs`);
    else if (!other.bytes.equals(mine.bytes)) {
      let i = 0;
      while (other.bytes[i] === mine.bytes[i]) i++;
      f.push(`${what}: the whole world at step ${step} is ${mine.bytes.length} bytes on both, first differing at byte ${i}: a value differs`);
    }
    if (other.deepHash !== recorded.get(step)) f.push(`${what}: the checkpoint at step ${step} has deep hash ${show(other.deepHash)}, the golden ${show(recorded.get(step))}`);
  }
  return f;
}

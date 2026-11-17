// AC11 #458.0b2667d3: "25 instances of one prototype, moving under an orbiting camera, and the same 25 as separate
// items give equal ID, normal, depth and velocity targets, bit for bit, at 10 sampled times; a planted instanced path
// that leaves out the instances in the velocity pass alone keeps the final frame's hash and fails this pair, naming
// the target and the first pixel"
//
// The fleet (generate.ts `fleetDoc`): 25 boxes on a 5 × 5 grid sliding 3 m along x over 2 s under a camera that orbits
// a quarter turn, as one `instance@1` of 25 elements of one hidden prototype, and as 25 `mark.box@1` items. One
// `deep-gpu run` draws both by `view3d` at 32 frames a second and captures frames 4, 10, …, 58 with the targets
// `final`, `ids`, `normal`, `depth` and `velocity` (README: `view3d`'s `velocity` target).
//
// asserts:
//   - at each of the 10 times, the instances' ID, normal, depth and velocity targets equal the items', byte for byte;
//     the targets aren't empty: the ID target shows at least 20 of the 25 boxes, and the velocity target is nonzero
//     on a box (they move);
//   - under `--planted instanced_skips_velocity` the instances' final frame hashes as the honest run's at every time,
//     their ID, normal and depth targets still equal the items', and the pair fails, naming the target `velocity` and
//     the first pixel that differs, a pixel the ID target gives to a box.
// At the base `view3d` refuses the target: `bad_input`, "targets are final, linear, ids, …".
import { describe, expect, it } from 'vitest';
import { decodePng } from '../../385/helpers.ts';
import { FLEET, FLEET_LOOK, fleetDoc } from './generate.ts';
import { AC, TIMEOUT, arr, failsNaming, firstDifferentPixel, needsMetal, none, obj, outFile, runGpu, show, str, useBins, useTemp, writeJson, type JsonObject } from './helpers.ts';

const bin = useBins(['deep-gpu']);
const temp = useTemp();
const PLANTED = 'instanced_skips_velocity';
const [W, H] = FLEET.size;
type Target = (typeof FLEET.targets)[number];
/** Each raw target's bytes a pixel: the ID target's pick ID (u32, from its PNG), the normal (three f32), the view-axis
 * depth (one f32), the velocity (two f32: device px over the shutter, x and y). */
const BYTES: Record<Target, number> = { ids: 4, normal: 12, depth: 4, velocity: 8 };

interface Sample { frame: number; pixelHash: string; targets: Record<Target, Buffer> }
interface Drawn { instances: Sample[]; items: Sample[] }

function draw(planted?: string): Drawn {
  const out = temp();
  const call = (as: 'instances' | 'items'): JsonObject => ({
    call: 'view3d', doc: writeJson(out, as, fleetDoc(as)), look: FLEET_LOOK, size: [...FLEET.size], fps: FLEET.fps, frames: FLEET.sampled.at(-1)! + 1,
    capture: [...FLEET.sampled], targets: ['final', ...FLEET.targets],
  });
  const replies = runGpu(bin('deep-gpu'), out, [call('instances'), call('items')], 'the fleet as instances and as items', planted);
  const samples = (reply: JsonObject, as: string): Sample[] => {
    expect(reply['code'], `the fleet as ${as}: view3d draws it with the targets final, ${FLEET.targets.join(', ')}; it answered ${show(reply, 600)}`).toBeUndefined();
    const frames = arr(reply['frames'], `the fleet as ${as}: frames`).map((f, i) => obj(f, `the fleet as ${as}: frames[${i}]`));
    return FLEET.sampled.map((n) => {
      const f = frames.find((x) => x['frame'] === n);
      expect(f, `the fleet as ${as}: frame ${n} is in the reply`).toBeDefined();
      const what = `the fleet as ${as}, frame ${n}`;
      const raw = (t: Target): Buffer => {
        const bytes = t === 'ids' ? Buffer.from(decodePng(outFile(out, f![t], 'png', `${what}: ${t}`)).rgba) : outFile(out, f![t], 'f32', `${what}: ${t}`);
        expect(bytes.length, `${what}: the ${t} target holds ${BYTES[t]} bytes for each of ${W} × ${H} pixels`).toBe(W * H * BYTES[t]);
        return bytes;
      };
      return { frame: n, pixelHash: str(f!['pixel_hash'], `${what}: pixel_hash`), targets: { ids: raw('ids'), normal: raw('normal'), depth: raw('depth'), velocity: raw('velocity') } };
    });
  };
  return { instances: samples(replies[0]!, 'instances'), items: samples(replies[1]!, 'items') };
}
/** This suite's check of the pair: every target equal bit for bit at every sampled time, or a failure naming the
 * target, the time and the first pixel that differs. */
function pairFailures(d: Drawn, targets: readonly Target[] = FLEET.targets): string[] {
  const out: string[] = [];
  for (const [i, a] of d.instances.entries()) for (const t of targets) {
    const p = firstDifferentPixel(a.targets[t], d.items[i]!.targets[t], FLEET.size, `${t} at frame ${a.frame}`);
    if (p) out.push(`instances against items: target ${t} differs at frame ${a.frame} (t = ${a.frame / FLEET.fps} s); the first pixel that differs is (${p.x}, ${p.y})`);
  }
  return out;
}
const idAt = (ids: Buffer, x: number, y: number): number => ids.readUInt32LE(4 * (y * W + x));

describe(`${AC[11]} 25 instances and the same 25 as separate items, target by target`, () => {
  it(`${AC[11]} equal ID, normal, depth and velocity targets, bit for bit, at 10 sampled times; a planted instanced path that leaves the instances out of the velocity pass keeps the final frame's hash and fails, naming the target and the first pixel`, () => {
    needsMetal('view3d');
    expect(FLEET.sampled.length, 'the issue\'s 10 sampled times').toBe(10);
    expect(FLEET.count, 'the issue\'s 25').toBe(25);

    // The honest program: the four targets equal at every time, and each holds what it should.
    const honest = draw();
    none(pairFailures(honest), 'the instances\' ID, normal, depth and velocity targets against the items\'');
    for (const s of honest.items) {
      const seen = new Set<number>();
      let moving = 0;
      for (let p = 0; p < W * H; p++) {
        const id = s.targets.ids.readUInt32LE(4 * p);
        if (id === 0) continue;
        seen.add(id);
        if (s.targets.velocity.readFloatLE(8 * p) !== 0 || s.targets.velocity.readFloatLE(8 * p + 4) !== 0) moving++;
      }
      expect(seen.size, `frame ${s.frame}: the ID target shows at least 20 of the 25 boxes`).toBeGreaterThanOrEqual(20);
      expect(seen.size, `frame ${s.frame}: the ID target shows no more than the 25 boxes`).toBeLessThanOrEqual(FLEET.count);
      expect(moving, `frame ${s.frame}: the velocity target reads motion on the boxes' pixels`).toBeGreaterThan(0);
    }

    // The planted instanced path: the final frame keeps its hash, and the velocity target alone gives it away.
    const planted = draw(PLANTED);
    expect(planted.instances.map((s) => s.pixelHash), `--planted ${PLANTED} keeps the final frame's hash at every sampled time`).toEqual(honest.instances.map((s) => s.pixelHash));
    none(pairFailures(planted, ['ids', 'normal', 'depth']), `--planted ${PLANTED} leaves the ID, normal and depth targets equal: it is the velocity pass alone`);
    const failures = pairFailures(planted);
    const named = failsNaming(failures, /target velocity differs at frame \d+ .*first pixel that differs is \(\d+, \d+\)/, `--planted ${PLANTED}`);
    const [, frame, x, y] = /at frame (\d+) .*first pixel that differs is \((\d+), (\d+)\)/.exec(named)!.map(Number);
    expect(frame, 'the pair fails at the first sampled time').toBe(FLEET.sampled[0]);
    const ids = planted.items[0]!.targets.ids;
    expect(idAt(ids, x!, y!), `the first pixel that differs, (${x}, ${y}), is a box's pixel in the ID target: the instances are what the velocity pass left out`).toBeGreaterThan(0);
  }, TIMEOUT);
});

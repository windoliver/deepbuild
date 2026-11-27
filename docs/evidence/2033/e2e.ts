// #2033 hand e2e: the real deep-gpu draws AC4's 16 m wall scene (tests/acceptance/2033) under a shadowed spot or point
// light, shadow on and off; the CPU rays pick the plane pixels whose ray to the light runs 0.25 m or more inside the
// wall, and a pixel the shadowed frame lights more than 4 codes above the unshadowed one counts as reached. It writes
// the shadowed frame with those pixels in magenta as <out>/<kind>-leaks.ppm.
// Usage: DEEP_GPU_BIN=<deep-gpu> E2E_OUT=<dir> node --experimental-transform-types docs/evidence/2033/e2e.ts spot|point
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { localFixture, fixtureDoc, view3dCall, runGpu, frame0, readFinal, classify, pixelsOf } from '../../../tests/acceptance/2033/helpers.ts';

const out = process.env.E2E_OUT!;
const bin = process.env.DEEP_GPU_BIN!;
const kind = (process.argv[2] ?? 'spot') as 'spot' | 'point';
mkdirSync(out, { recursive: true });
const f = localFixture(kind, 16, 'wall');
const calls = (['shadow', 'off'] as const).map((v) => { const d = fixtureDoc(out, `${kind}-16-${v}`, f.parts, f.cam, f.light, v); return view3dCall(d.doc, d.assets); });
const replies = runGpu(bin, out, calls);
const a = readFinal(out, frame0(replies[0]!, 's'), 's');
const b = readFinal(out, frame0(replies[1]!, 'o'), 'o');
const behind = pixelsOf(classify(f.parts, f.cam, f.light).behind, 1);
const mask = new Uint8Array(640 * 480 * 3);
for (let j = 0; j < 640 * 480; j++) for (let c = 0; c < 3; c++) mask[3 * j + c] = a[4 * j + c]!;
let leaks = 0;
for (const j of behind) {
  let dmax = 0; for (let c = 0; c < 3; c++) dmax = Math.max(dmax, a[4 * j + c]! - b[4 * j + c]!);
  if (dmax > 4) { leaks++; mask[3 * j] = 255; mask[3 * j + 1] = 0; mask[3 * j + 2] = 255; }
}
console.log('behind', behind.length, 'leaks', leaks);
writeFileSync(join(out, `${kind}-leaks.ppm`), Buffer.concat([Buffer.from('P6 640 480 255\n'), Buffer.from(mask)]));

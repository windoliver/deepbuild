// AC4 #486.5d0001c4: core.bump@1 gives relief from any height graph: on a 1 m plate whose uv0 spans it, a height of
// 0.2 × uv0.v (in m) at strength 1 shades with a normal tilted toward −v by atan 0.2 = 11.31°, within 0.5° at 100
// sampled interior pixels, both on the plate and on a twin whose uv0.u runs the other way (tangent handedness −1); a
// planted bump that ignores the handedness tilts the twin's normal toward +v, 22.6° from the analytic one, and fails,
// naming the part; and a call to core.bump@1 inside a repeat that has a stop_if is refused, naming the call.
//
// The plates (helpers: `reliefDoc`): `plate`, a 1 m `mark.box@1` mirrored in y so its uv0 runs u along +x and v up
// (tangent handedness +1), and `twin`, the box turned half a turn about its normal so u runs along −x and v up
// (handedness −1); both white, roughness 1, specular level 0 (a Lambertian lobe alone), under the operator `relief`:
// height = 0.2 × uv0.v m, `use@1` of core.bump@1 at strength 1, its `normal` the material's normal. Both lie in z = 0
// facing a camera 2.6 m away at 640 × 320, under a black sky.
// 1. On Metal, drawn three times, each under one unshadowed sun of π lx (straight on; 40° toward +x; 40° toward +y), so a
//    pixel's linear value is n · l. At 100 pixels of each part (a 10 × 10 grid over the central 60% of its extent in the
//    frame, each 3 px inside it in all three frames), the normal the three values give (`reference.ts`:
//    `lambertNormal`) is within 0.5° of the analytic normal, normalize(0, −0.2, 1): v runs along +y on both, so −v is
//    −y. `--planted bump_ignores_handedness` (the bump's tangent-space normal built with the bitangent cross(n, t) whatever
//    the handedness) fails, naming `twin`; the twin's median normal then lies within 1° of 2 × 11.31° = 22.62° from the
//    analytic one, tilted toward +v (+y).
// 2. On the noop lane, `live` admits the relief document and refuses one whose material calls core.bump@1, as step
//    `relief_call`, inside a repeat of 4 trips whose body has a stop_if, with an error operator_kind_rule naming
//    `relief_call` (its step, or a path ending in it).
// Wrong programs: the base (no uv0 step, no core.bump@1, no normal output: the plates draw flat); a bump by another
// gradient, a missed strength, the handedness ignored; a call inside a divergent loop left to naga.
import { describe, expect, it } from 'vitest';
import { angleDeg, lambertNormal, towardSun, type V3 } from './reference.ts';
import {
  AC, ANALYTIC, RELIEF_SUNS, SLOPE, draw, failsNaming, insideAt, isObject, issueNames, liveCall, liveReply, loopedReliefDoc, none, payload,
  reliefDoc, requireMetal, runGpu, sessionRow, shown, useDir, useGpu, writeJson, type Drawn, type Planted,
} from './helpers.ts';

const ID = AC[4];
const bin = useGpu();
const dir = useDir();
const TOWARD = RELIEF_SUNS.map(towardSun) as [V3, V3, V3];
const PARTS = ['plate', 'twin'] as const;

/** 100 pixels of `part`: a 10 × 10 grid over the central 60% of its extent in the frame, 3 px inside it in every frame. */
function samples(frames: Drawn[], part: string): [number, number][] {
  const ids = frames[0]!.ids;
  let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
  for (let y = 0; y < ids.height; y++) for (let x = 0; x < ids.width; x++) if (ids.at(x, y) === part) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const out: [number, number][] = [];
  if (!Number.isFinite(x0)) return out;
  for (let j = 0; j < 10; j++) for (let i = 0; i < 10; i++) {
    const x = Math.round(x0 + (x1 - x0) * (0.2 + (0.6 * (i + 0.5)) / 10)); const y = Math.round(y0 + (y1 - y0) * (0.2 + (0.6 * (j + 0.5)) / 10));
    if (frames.every((f) => insideAt(f.ids, [part], x, y, 3))) out.push([x, y]);
  }
  return out;
}
/** Each part's normals at its 100 pixels, against the analytic one: failures naming the part and the pixel. */
function normals(planted?: Planted): { failures: string[]; angles: Record<string, number[]>; up: Record<string, number> } {
  const frames = draw(bin(), dir(), [0, 1, 2].map((k) => ({ name: `relief, sun ${k}`, doc: reliefDoc(k) })), planted);
  const failures: string[] = []; const angles: Record<string, number[]> = {}; const up: Record<string, number> = {};
  for (const part of PARTS) {
    const px = samples(frames, part);
    if (px.length < 100) failures.push(`${part}: only ${px.length} of its 100 sampled pixels lie inside it in all three frames`);
    angles[part] = []; up[part] = 0;
    for (const [x, y] of px) {
      const read = frames.map((f) => { const c = f.linear.at(x, y); return (c[0] + c[1] + c[2]) / 3; }) as V3;
      const n = lambertNormal(TOWARD, read);
      const a = angleDeg(n, ANALYTIC);
      angles[part]!.push(a);
      if (n[1] > 0) up[part]!++;
      if (!(a <= 0.5)) failures.push(`${part}: pixel (${x}, ${y}) shades with a normal [${n.map((c) => c.toFixed(4)).join(', ')}], ${a.toFixed(2)}° from the analytic one`);
    }
  }
  return { failures, angles, up };
}
const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)]! : NaN; };

describe(`${ID} core.bump@1 gives relief from a height graph`, () => {
  it(`${ID} a height of 0.2 × uv0.v at strength 1 shades with a normal tilted 11.31° toward −v within 0.5° at 100 pixels, on the plate and on its twin of the other handedness; a planted bump that ignores the handedness tilts the twin toward +v and fails, naming the part`, () => {
    requireMetal();
    const shipped = normals();
    console.log(`${ID}: median angle from the analytic normal (atan ${SLOPE} = ${((Math.atan(SLOPE) * 180) / Math.PI).toFixed(2)}° from the plate's): plate ${median(shipped.angles['plate']!).toFixed(3)}°, twin ${median(shipped.angles['twin']!).toFixed(3)}°`);
    none(shipped.failures, 'the relief on the plate and the twin');
    const planted = normals('bump_ignores_handedness');
    failsNaming(planted.failures, ['twin'], '--planted bump_ignores_handedness');
    const twin = median(planted.angles['twin']!); const twice = (2 * Math.atan(SLOPE) * 180) / Math.PI;
    console.log(`${ID}: --planted bump_ignores_handedness: the twin's median normal ${twin.toFixed(2)}° from the analytic one, ${planted.up['twin']} of ${planted.angles['twin']!.length} tilted toward +v`);
    expect(Math.abs(twin - twice), `the planted twin's normal lies 2 × 11.31° = ${twice.toFixed(2)}° from the analytic one, within 1°: ${twin.toFixed(2)}°`).toBeLessThanOrEqual(1);
    expect(planted.up['twin'], 'the planted twin\'s normals tilt toward +v at every sampled pixel').toBe(planted.angles['twin']!.length);
  }, 3_600_000);

  it(`${ID} a call to core.bump@1 inside a repeat that has a stop_if is refused, naming the call, while the same call outside a loop checks, on the noop lane`, () => {
    const out = dir();
    const sessions = [
      { session: 'relief', doc: writeJson(out, 'relief-live', payload(reliefDoc(0))), size: [640, 320] as [number, number] },
      { session: 'relief_loop', doc: writeJson(out, 'relief-loop-live', payload(loopedReliefDoc())), size: [320, 320] as [number, number] },
    ];
    const live = liveReply(runGpu(bin(), out, [liveCall(2, sessions, [])], { lane: 'noop' })[0]!, 'the relief documents on the noop lane');
    const relief = sessionRow(live, 'relief');
    expect(relief['state'], `the relief document checks: ${shown(relief)}`).toBe('live');
    const loop = sessionRow(live, 'relief_loop');
    expect(loop['state'], `the looped call's document is refused at check: ${shown(loop)}`).toBe('refused');
    const issues = Array.isArray(loop['issues']) ? loop['issues'].filter(isObject) : [];
    const named = issues.some((i) => i['code'] === 'operator_kind_rule' && (issueNames(i, 'relief_call')));
    expect(named, `an operator_kind_rule error names the call relief_call: ${shown(loop['issues'])}`).toBe(true);
  }, 3_600_000);
});

// AC6 #486.0887c8cd: A material whose operator writes lobe outputs compiles its set at check, and turning that material
// on in a later frame creates 0 pipelines, counted on the noop lane. A white furnace with every lobe at full strength
// from outputs of value 1 stays at or under 1 within 1%, as field-driven lobes do.
//
// 1. The material `lacquer` (helpers: `LACQUER`) has every lobe on at half strength (coat, sheen, anisotropy,
//    translucency, transmission, subsurface, iridescence, diffuse roughness, a specular color off white); its operator
//    `lacquer_op` writes each of the issue's lobe outputs as a constant: coat, coat_roughness, coat_normal, sheen,
//    sheen_color, sheen_roughness, specular_level, specular_color, anisotropy, translucency, transmission, subsurface,
//    iridescence_thickness and diffuse_roughness. Its plate is hidden at first and turned on at frame 3 by a toggle bound
//    to its `visible` (helpers: `toggledDoc`). On the noop lane, `live` plays it for 6 frames at 30 fps: the session is
//    admitted, frame 3 draws, and no frame from the first on lists a created pipeline (#432's `created`: pipelines the
//    warm-up compiled at check are never listed), so the set was compiled at check and the turn creates none.
// 2. On Metal, #422's white furnace (radiance 1 from every direction, no light) at 640 × 320 under an orthographic view:
//    eight white balls (roughness 0.5), `ball_<lobe>`, each with one lobe at half strength in its material and its
//    operator writing that lobe's output at full strength, value 1 (anisotropy's [1, 0]): coat, sheen, translucency,
//    transmission, subsurface, specular_level, anisotropy, diffuse_roughness. The fixture holds only if the background
//    reads 1 within 1%. On every ball's pixels 2 px inside it, no channel reads above 1.01 (pbrt-v4's pass rule as #422
//    ported it) and its mean luminance is at least 0.5; and on 99.9% of them each channel is within 0.01 of the same ball
//    with that lobe's field at full strength and no operator. The fields sit at half strength, so a ball that reads the
//    output in one term and the field in another (its compensation, the base it dims) goes over 1 or off that ball. The
//    outputs must be in effect: the same document is first admitted by `live` on the noop lane, since view3d draws a
//    part whose operator the check refuses with its own fields, which a white furnace can't tell from the outputs.
// Wrong programs: the base (lobe outputs unknown: the session refused, the furnace's operators refused); a warm-up that
// misses an operator's lobe feature set; lobe outputs that add to the field or skip the energy compensation.
import { describe, expect, it } from 'vitest';
import {
  AC, FURNACE_LOBES, FURNACE_SIZE, LACQUER, LACQUER_OP, TURN_ON, draw, firstDrawn, furnaceBackground, furnaceDoc, inputAt, liveCall, liveReply, lum, none, payload,
  requireMetal, runGpu, samePartPixels, sessionRow, shown, toggledDoc, useDir, useGpu, writeJson, type Drawn,
} from './helpers.ts';

const ID = AC[6];
const bin = useGpu();
const dir = useDir();

describe(`${ID} lobe outputs compile at check and stay within the furnace`, () => {
  it(`${ID} a material whose operator writes lobe outputs compiles its set at check: turning it on at frame 3 creates no pipeline, nor does any frame from the first, on the noop lane`, () => {
    const out = dir();
    const doc = writeJson(out, 'lacquer-live', payload(toggledDoc('lacquer-live', 'lacquer', LACQUER, 'lacquer_op', LACQUER_OP(), 'lacquer_plate')));
    const live = liveReply(runGpu(bin(), out, [liveCall(6, [{ session: 'lacquer', doc, size: [320, 320] }], [inputAt(TURN_ON, 'lacquer', 'show', true)])], { lane: 'noop' })[0]!, 'the lacquer plate on the noop lane');
    const row = sessionRow(live, 'lacquer');
    expect(row['state'], `the lacquer's operator checks: ${shown(row)}`).toBe('live');
    const first = firstDrawn(live, 'lacquer');
    expect(first, 'the session draws').not.toBeNull();
    expect(live.views.some((v) => v.session === 'lacquer' && v.frame === TURN_ON && v.drawn), `frame ${TURN_ON}, where the lacquer turns on, draws`).toBe(true);
    const created = live.views.filter((v) => v.session === 'lacquer' && v.frame >= first!).flatMap((v) => v.created.map((c) => `frame ${v.frame} created a pipeline for ${c.items.join(', ')}, feature set ${c.feature_set}, into ${c.target}`));
    none(created, 'pipelines created from the first frame on');
  }, 3_600_000);

  it(`${ID} in a white furnace, every lobe at full strength from outputs of value 1 stays at or under 1 within 1%, drawn as the same lobes at full strength by their fields`, () => {
    requireMetal();
    // The outputs must be in effect: view3d draws a part whose operator the check refuses with its material's own
    // fields, which a white furnace can't tell from the outputs (README: Readings).
    const out = dir();
    const admitted = liveReply(runGpu(bin(), out, [liveCall(2, [{ session: 'furnace', doc: writeJson(out, 'furnace-live', payload(furnaceDoc(true))), size: FURNACE_SIZE }], [])], { lane: 'noop' })[0]!, 'the furnace on the noop lane');
    const row = sessionRow(admitted, 'furnace');
    expect(row['state'], `the furnace's eight operators check: ${shown(row)}`).toBe('live');
    const [outputs, fields] = draw(bin(), out, [{ name: 'furnace, lobes from outputs', doc: furnaceDoc(true) }, { name: 'furnace, lobes from fields', doc: furnaceDoc(false) }]) as [Drawn, Drawn];
    const failures = [...furnaceBackground(outputs), ...furnaceBackground(fields)];
    for (const l of FURNACE_LOBES) {
      const part = `ball_${l.lobe}`;
      const px = samePartPixels(outputs, fields, [part], 2);
      if (px.length < 2000) { failures.push(`${part}: only ${px.length} pixels judged (2,000 needed)`); continue; }
      let worst = 0; let at = ''; let sum = 0; let off = 0; let offWorst = 0;
      for (const p of px) {
        const c = outputs.linear.at(p.x, p.y); const f = fields.linear.at(p.x, p.y);
        const v = Math.max(c[0], c[1], c[2]);
        if (v > worst) { worst = v; at = `(${p.x}, ${p.y})`; }
        sum += lum(c);
        const d = Math.max(Math.abs(c[0] - f[0]), Math.abs(c[1] - f[1]), Math.abs(c[2] - f[2]));
        if (d > 0.01) { off++; offWorst = Math.max(offWorst, d); }
      }
      console.log(`${ID}: ${part}: brightest ${worst.toFixed(4)}, mean luminance ${(sum / px.length).toFixed(4)}, ${off} of ${px.length} pixels more than 0.01 from the field-driven ball`);
      if (worst > 1.01) failures.push(`${part}: reflects more than it receives in the white furnace, ${worst.toFixed(4)} at ${at}`);
      if (sum / px.length < 0.5) failures.push(`${part}: the furnace barely lights it: mean luminance ${(sum / px.length).toFixed(4)}`);
      if (off > 0.001 * px.length) failures.push(`${part}: ${off} of ${px.length} pixels differ from the ball with ${l.lobe} at full strength by its field by more than 0.01 (worst ${offWorst.toFixed(4)})`);
    }
    none(failures, 'the white furnace with every lobe at full strength from outputs');
  }, 3_600_000);
});

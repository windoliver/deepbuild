// AC13 #493.d82a99aa: With a shot framed by keep at 8 m from its target, lens_zoom with by 2.625 (24 mm to 87 mm on a
// 36 mm sensor) over 2.9 s with in_out_cubic keeps the camera's position bit for bit at every frame, draws the kept item
// at √3.625 = 1.904 times its first frame's projected height at 1.45 s within 1e-6 relative, and scales a post 3.6 m
// from the camera and a ridge 120 m away by the kept item's ratio within 1e-9 at every frame; a planted zoom that eases
// the field of view in degrees reads 1.663 at 1.45 s and fails, and a planted zoom that dollies to 2.207 m scales the
// ridge by 1.051 and fails, each naming the shot.
//
// Through `deep-motion eval` with `project`. The camera's field of view is 87 mm's on a 36 mm sensor, 2·atan(18 ÷ 87),
// across the wider side; the kept item's framing sets the distance D (8 m in the issue; the ratios hold for any D). A
// first run finds the framed position and aim, and the post and the ridge are placed on the aim 3.6 m and 120 m from
// it. Heights are the projected boxes' heights in px. The plants are `lens_zoom_eases_fov_degrees` and
// `lens_zoom_dollies`.
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, add, aim, box3d, camera3d, deg, evalOk, evalPlanted, failsNaming, film, fl, framedOf, frames60, heightOf, none, poseOf, projOf, rel,
  scale, shot, unit, useMotion, type Accepted, type JsonObject,
} from './helpers.ts';

const motion = useMotion();
const FOV = deg(2 * Math.atan(18 / 87));
const WIDE = deg(2 * Math.atan(18 / 24));
const TIMES = [...frames60(0, 2.9)];
const MID = TIMES.indexOf(fl(1.45));
const cam = camera3d({ orbit: { azimuth: 20, elevation: 10, distance: 8 }, fov: FOV });
const subject = box3d('subject', [0, 0, 0], 0.8);
const zoomShot = { zoom: shot(0, 2.9, { move: 'lens_zoom', by: 2.625, ease: 'in_out_cubic', frame: { keep: ['subject'] } }) };

/** The film with the post and the ridge on the framed aim, 3.6 m and 120 m from the framed position. */
function scene(): JsonObject {
  const first = evalOk(motion.bin(), { doc: film('lens-probe', [cam, subject], { shots: zoomShot }), times: [0] }, 'the framing probe');
  const f = framedOf(first, 'zoom', 'the framing probe'); const dir = unit(aim(f));
  return film('lens-zoom', [cam, subject, box3d('post', add(f.position, scale(dir, 3.6)), 0.3, 'ink'), box3d('ridge', add(f.position, scale(dir, 120)), 10, 'muted')], { shots: zoomShot });
}
const run = (doc: JsonObject, planted?: string): Accepted => (planted
  ? evalPlanted(motion.bin(), { doc, times: TIMES, project: ['subject', 'post', 'ridge'], planted }, `the plant ${planted}`)
  : evalOk(motion.bin(), { doc, times: TIMES, project: ['subject', 'post', 'ridge'] }, 'the lens zoom'));

/** The criterion's check on a run: position, the kept item's ratio at 1.45 s, and the post's and ridge's ratios; failures name the shot. */
function zoomFailures(a: Accepted): string[] {
  const f = framedOf(a, 'zoom', 'the lens zoom'); const failures: string[] = [];
  const h = (id: string, i: number): number => heightOf(projOf(a.frames[i]!, id, 'the lens zoom'));
  a.frames.forEach((fr, i) => {
    const p = poseOf(fr, 'cam', 'the lens zoom');
    if (p.position.some((v, k) => v !== f.position[k])) failures.push(`shot zoom: at ${fr.t} flicks the camera is at ${JSON.stringify(p.position)}, not the framed ${JSON.stringify(f.position)} bit for bit`);
    const kept = h('subject', i) / h('subject', 0);
    for (const id of ['post', 'ridge']) { const r = h(id, i) / h(id, 0); if (!(rel(r, kept) <= 1e-9)) failures.push(`shot zoom: at ${fr.t} flicks the ${id} scales by ${r}, the kept item by ${kept}`); }
  });
  const mid = h('subject', MID) / h('subject', 0);
  if (!(rel(mid, Math.sqrt(3.625)) <= 1e-6)) failures.push(`shot zoom: at 1.45 s the kept item is ${mid} times its first height, not √3.625 = ${Math.sqrt(3.625)}`);
  return failures;
}

describe(`${AC[13]} a lens zoom narrows the field of view in log tan space from a fixed position`, () => {
  it(`${AC[13]} lens_zoom by 2.625 over 2.9 s keeps the position bit for bit, draws the kept item √3.625 times taller at 1.45 s, and scales a post and a ridge by the kept item's ratio`, () => {
    expect(TIMES[MID], '1.45 s is a 60 fps frame').toBe(fl(1.45));
    none(zoomFailures(run(scene())), 'the lens zoom');
  }, TIMEOUT);

  it(`${AC[13]} a planted zoom that eases the field of view in degrees reads about 1.663 at 1.45 s and fails, naming the shot`, () => {
    const a = run(scene(), 'lens_zoom_eases_fov_degrees');
    const want = Math.tan((WIDE * Math.PI) / 360) / Math.tan((((WIDE + FOV) / 2) * Math.PI) / 360);
    const mid = heightOf(projOf(a.frames[MID]!, 'subject', 'plant')) / heightOf(projOf(a.frames[0]!, 'subject', 'plant'));
    expect(Math.abs(mid - want), `the plant reads ${mid} at 1.45 s, about ${want.toFixed(4)}`).toBeLessThanOrEqual(1e-3);
    failsNaming(zoomFailures(a), ['shot zoom'], 'the lens zoom check on the degrees plant');
  }, TIMEOUT);

  it(`${AC[13]} a planted zoom that dollies scales the ridge by less than the kept item and fails, naming the shot`, () => {
    const a = run(scene(), 'lens_zoom_dollies');
    const last = a.frames.length - 1;
    const ridge = heightOf(projOf(a.frames[last]!, 'ridge', 'plant')) / heightOf(projOf(a.frames[0]!, 'ridge', 'plant'));
    const kept = heightOf(projOf(a.frames[last]!, 'subject', 'plant')) / heightOf(projOf(a.frames[0]!, 'subject', 'plant'));
    expect(ridge, `the dolly scales the ridge (${ridge}) less than the kept item (${kept})`).toBeLessThan(kept * 0.9);
    failsNaming(zoomFailures(a), ['shot zoom'], 'the lens zoom check on the dolly plant');
  }, TIMEOUT);
});

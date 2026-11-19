// AC1 #2450.308e31fa: "An `axes3d@1` whose x title names a `vector@1` item draws that vector at the x axis's end, facing
// the camera within 1° at 36 azimuths of a 360° orbit and never mirrored"
//
// #226's axes (domains [−4, 4], lengths [8, 8, 8] m, `up: z`, at the world origin, `ticks.size` 0.05 m) with
// `titles: {x: "xt", y: "y"}`: `xt` is a `vector@1` item over the suite's SVG (README: Fixtures: "x′" as three filled
// polygons in a 200 × 100 box), `y` a text title. The first test draws them with `view3d` under an orthographic orbit
// camera at 20° elevation whose azimuth is keyed from 0° at 0 s to 360° at 1 s, 36 frames at 36 fps, so frame k sees
// azimuth 10k°. Each frame's `axes` row lists the titles it draws with their boxes in the world (README: Assumed
// surfaces 1), corners in reading order. At every azimuth: the axes draw exactly the x title from the item `xt` and
// the text title "y"; the x title's box is a rectangle 0.25 m high (the title's size, 5 × `ticks.size`) and 0.5 m
// wide (the SVG's 2:1 box); its reading normal n = (BR − BL) × (TL − BL) is within 1° of b, the unit vector from the
// camera's target toward its eye (it faces the camera), with n̂ · b > 0 (it isn't mirrored); its bottom edge runs
// along the camera's right within 1° (it reads level, as a text label facing the camera does); and its centre lies
// on the x axis's line beyond the axis's end (4, 0, 0), as far beyond it as the text title "y" lies beyond the y
// axis's end (0, 0, −4): a vector title takes a text title's place. Then the picture: the same orbit seen close (the
// camera's target the x axis's end, 2.4 m across 960 px), the final target captured at azimuths 30°, 150°, 210° and
// 330°. Inside the box the frame reports, at six points of the SVG, the picture is ink where the SVG fills and
// ground where it doesn't, so what is drawn is the named item's own graphic, the right way round.
// The second test holds the Scope line the criterion rests on, "through the data module's marks fill (scene3d names
// no vector kind)": the full build presents the document, the build without the vector module (#443's
// `test-leave-out-vector`) seals with scene3d and data, and scene3d@1's interface digest is the same in both.
// Wrong programs: the base (a title naming an item is refused `bad_axis`); a title that reports a box and draws
// nothing, or draws the item's `alt` as text, or another graphic; the vector fixed in the axes' plane (off by up to
// 90°), turned about +Y only (off by the 20° elevation), drawn from behind on half the orbit (mirrored), mirrored
// inside a box that faces the camera, or upside down; a box at the vector's own 200 × 100, or squashed square; a
// title at the axes' origin or at the axis's low end; a scene3d that takes an edge to the vector module.
import { describe, expect, it } from 'vitest';
import {
  AC, AXES, ENDS, GLYPH, ORBIT, PLAIN, SPIN, TICK, TIMEOUT, VECTOR, add, agentDoc, angle, cameraAxes, centre, clearance, colourAt, cross, decodePng, digestOf, docId,
  dot, fmt, framesOf, inked, length, notPresented, orbitCamera, pixelOf, putBytes, readNamed, requireMetal, runGpu, runShow, scale, sceneItems, sealed,
  sessionDoc, show, sub, titleSize, titleSvg, titlesOf, unit, useBins, useOut, writeJson, type Size, type Title, type V3,
} from './helpers.ts';

const ID = AC[1];
const NAME = `AC1 ${ID}`;
const bin = useBins(['deep-gpu', 'deep-show', 'deep-show-no-vector']);
const out = useOut();
const TITLES = { x: VECTOR, y: 'y' };
/** Metres: the #226 suite's tolerance for a place read from a frame. */
const TOLERANCE = 1e-6;
const WIDE: Size = [640, 360];
/** The close view: the camera's target the x axis's end, 2.4 m across 960 px, so the title's 0.5 × 0.25 m box is 200 × 100 px. */
const CLOSE = { target: ENDS.x.end, viewWidth: 2.4, size: [960, 540] as Size, frames: [3, 15, 21, 33] };
/** Points of the SVG, in its own units: two in its ink, four on its ground, three of them where the prime would land
 * if the graphic were mirrored left to right, turned half round or upside down. */
const SAMPLES: { name: string; at: [number, number]; ink: boolean }[] = [
  { name: "the x's crossing", at: [50, 50], ink: true },
  { name: 'the prime', at: [150, 20], ink: true },
  { name: "the x's top notch (the prime, mirrored)", at: [50, 20], ink: false },
  { name: "the x's bottom notch (the prime, turned half round)", at: [50, 80], ink: false },
  { name: 'below the prime (the prime, upside down)', at: [150, 80], ink: false },
  { name: 'between the x and the prime', at: [105, 60], ink: false },
];
/** Of 255 a channel: ground samples agree within the first; an ink sample is at least the second from the ground. */
const [GROUND_SPREAD, INK_CONTRAST] = [24, 60];

/** How far `p` lies beyond an axis's end along the axis, and how far off the axis's line, in metres. */
function beyond(p: V3, axis: 'x' | 'y'): { along: number; off: number } {
  const d = sub(p, ENDS[axis].end);
  const along = dot(d, ENDS[axis].along);
  return { along, off: length(sub(d, scale(ENDS[axis].along, along))) };
}
const named = (t: Title): string => `${t.axis}: ${t.vector !== null ? `the item ${t.vector}` : `the text ${JSON.stringify(t.text)}`}`;

describe(`${NAME} a title naming a vector@1 item draws that vector at the axis's end, facing the camera`, () => {
  it(`${NAME} at each of 36 azimuths of a 360° orbit the x title is the vector item's box at the x axis's end, at the title's size, facing the camera within 1° and never mirrored, and the picture in it is that item's graphic`, () => {
    requireMetal();
    // The fixture: each sample is well inside the SVG's ink or its ground, and the prime's three reflections are ground.
    expect(SAMPLES.map((s) => inked(s.at)), 'the SVG fills each ink sample and none of the ground samples').toEqual(SAMPLES.map((s) => s.ink));
    expect(SAMPLES.filter((s) => clearance(s.at) < 6).map((s) => s.name), 'every sample is at least 6 units from an edge of the SVG\'s parts').toEqual([]);
    const dir = out();
    const src = putBytes(dir, titleSvg());
    const wide = writeJson(dir, 'wide', sessionDoc('orbit-2450', WIDE, sceneItems(src, orbitCamera('orthographic', 30), TITLES), SPIN));
    const close = writeJson(dir, 'close', sessionDoc('close-2450', CLOSE.size, sceneItems(src, orbitCamera('orthographic', 30, CLOSE.target, CLOSE.viewWidth), TITLES), SPIN));
    const orbit = { call: 'view3d', look: PLAIN, fps: ORBIT.fps, frames: ORBIT.frames, axes: true, store: dir };
    const [whole, near] = runGpu(bin('deep-gpu'), dir, [
      { ...orbit, doc: wide, size: [...WIDE] },
      { ...orbit, doc: close, size: [...CLOSE.size], capture: [...CLOSE.frames], targets: ['final'] },
    ]);

    const [height, width] = [titleSize(TICK), (titleSize(TICK) * GLYPH.box[0]) / GLYPH.box[1]];
    const drawn: string[] = []; const facing: string[] = []; const mirrored: string[] = []; const level: string[] = [];
    const size: string[] = []; const place: string[] = []; const textTitle: string[] = [];
    framesOf(whole!, ORBIT.frames, 'the orbit').forEach((f, k) => {
      const azimuth = 10 * k;
      const at = `azimuth ${azimuth}°`;
      const { right, toward } = cameraAxes(azimuth, ORBIT.elevation);
      const titles = titlesOf(f, AXES, `frame ${k} (${at})`);
      const [x, y] = [titles.find((t) => t.axis === 'x'), titles.find((t) => t.axis === 'y')];
      if (titles.length !== 2 || x?.vector !== VECTOR || y?.text !== 'y') {
        drawn.push(`${at}: the axes draw the titles [${titles.map(named).join('; ')}], not the x title from the item ${VECTOR} and the text title "y"`);
        return;
      }
      const [bl, br, tr, tl] = x.quad;
      const [across, upward] = [sub(br, bl), sub(tl, bl)];
      const normal = cross(across, upward);
      if (length(normal) === 0) { size.push(`${at}: the vector title's box is empty`); return; }
      const c = dot(unit(normal), toward);
      const off = (Math.acos(Math.min(1, Math.abs(c))) * 180) / Math.PI;
      if (off > 1) facing.push(`${at}: the vector title is ${off.toFixed(3)}° off facing the camera`);
      if (c < 0) mirrored.push(`${at}: the vector title reads mirrored: its front faces away from the camera (n̂ · b = ${c.toFixed(4)})`);
      const turned = angle(across, right);
      if (turned > 1) level.push(`${at}: the vector title's bottom edge runs ${turned.toFixed(3)}° off the camera's right`);
      if (length(sub(tr, add(br, upward))) > TOLERANCE || Math.abs(dot(unit(across), unit(upward))) > 1e-6) size.push(`${at}: the vector title's box ${x.quad.map((p) => fmt(p)).join(' ')} is not a rectangle`);
      if (Math.abs(length(upward) - height) > TOLERANCE) size.push(`${at}: the vector title's box is ${length(upward).toFixed(6)} m high, not the title's ${height} m`);
      if (Math.abs(length(across) - width) > TOLERANCE) size.push(`${at}: the vector title's box is ${length(across).toFixed(6)} m wide, not ${width} m (its ${GLYPH.box.join(' × ')} box at the title's size)`);
      const [vector, text] = [beyond(centre(x.quad), 'x'), beyond(centre(y.quad), 'y')];
      if (text.off > TOLERANCE || text.along <= 0) textTitle.push(`${at}: the text title "y" is centred ${fmt(centre(y.quad))}, not on the y axis's line beyond its end ${fmt(ENDS.y.end, 0)}`);
      if (vector.off > TOLERANCE) place.push(`${at}: the vector title is centred ${fmt(centre(x.quad))}, ${vector.off.toFixed(6)} m off the x axis's line`);
      if (vector.along <= 0) place.push(`${at}: the vector title is centred ${fmt(centre(x.quad))}, not beyond the x axis's end ${fmt(ENDS.x.end, 0)}`);
      if (Math.abs(vector.along - text.along) > TOLERANCE) place.push(`${at}: the vector title is centred ${vector.along.toFixed(6)} m beyond the x axis's end, where the text title "y" is centred ${text.along.toFixed(6)} m beyond the y axis's`);
    });
    expect(drawn, 'at every azimuth the axes draw the x title from the vector item and the y title as text').toEqual([]);
    expect(textTitle, 'the fixture\'s text title sits on its axis\'s line beyond its end').toEqual([]);
    expect(facing, 'the vector title faces the camera within 1° at each of the 36 azimuths').toEqual([]);
    expect(mirrored, 'the vector title is never mirrored').toEqual([]);
    expect(level, 'the vector title reads level, as a label facing the camera does').toEqual([]);
    expect(size, 'the vector title\'s box is the item\'s box at the title\'s size').toEqual([]);
    expect(place, 'the vector title is at the x axis\'s end, where the axes put a title').toEqual([]);

    // The picture: inside the box each close frame reports, the item's own graphic, the right way round.
    const frames = framesOf(near!, ORBIT.frames, 'the close orbit');
    const picture: string[] = [];
    for (const k of CLOSE.frames) {
      const azimuth = 10 * k;
      const at = `azimuth ${azimuth}°`;
      const x = titlesOf(frames[k]!, AXES, `the close frame ${k} (${at})`).find((t) => t.axis === 'x');
      expect(x?.vector, `${at}: the close frame draws the x title from the item ${VECTOR}`).toBe(VECTOR);
      const [bl, br, , tl] = x!.quad;
      const image = decodePng(readNamed(dir, frames[k]!['final'], 'png', `${at}: the final target`));
      expect([image.width, image.height], `${at}: the final target is the view's size`).toEqual(CLOSE.size);
      const seen = SAMPLES.map((s) => {
        const [u, v] = [s.at[0] / GLYPH.box[0], s.at[1] / GLYPH.box[1]];
        const world = add(add(tl, scale(sub(br, bl), u)), scale(sub(bl, tl), v));
        const pixel = pixelOf(world, { target: CLOSE.target, viewWidth: CLOSE.viewWidth, azimuth, elevation: ORBIT.elevation }, CLOSE.size);
        return { ...s, pixel, colour: colourAt(image, pixel) };
      });
      const outside = seen.filter((s) => s.colour === null);
      expect(outside.map((s) => `${s.name} at pixel ${fmt(s.pixel, 1)}`), `${at}: every sample of the reported box is inside the close frame`).toEqual([]);
      const grounds = seen.filter((s) => !s.ink).map((s) => s.colour!);
      const ground = [0, 1, 2].map((c) => grounds.map((g) => g[c]!).sort((a, b) => a - b)[Math.floor(grounds.length / 2)]!);
      for (const s of seen) {
        const far = Math.max(...[0, 1, 2].map((c) => Math.abs(s.colour![c]! - ground[c]!)));
        const where = `${at}: ${s.name}, the SVG's ${fmt(s.at, 0)} at pixel ${fmt(s.pixel, 1)}, is drawn ${fmt(s.colour!, 0)} on a ground of ${fmt(ground, 0)}`;
        if (s.ink && far < INK_CONTRAST) picture.push(`${where}: the SVG fills it, and the picture shows ground`);
        if (!s.ink && far > GROUND_SPREAD) picture.push(`${where}: the SVG leaves it empty, and the picture shows ink`);
      }
    }
    expect(picture, 'inside the title\'s box the picture is the named item\'s own graphic, unmirrored and upright').toEqual([]);
  }, TIMEOUT);

  it(`${NAME} the full build presents the axes whose x title names the vector item, and scene3d's interface digest is the same with the vector module in the build and without it`, () => {
    const dir = out();
    const doc = agentDoc(sessionDoc('titled-2450', WIDE, sceneItems(putBytes(dir, titleSvg()), orbitCamera('orthographic', 30), TITLES)));
    const d = docId(1);
    const [shown, fullSchedule] = runShow(bin('deep-show'), dir, [d], [show(d, doc), { call: 'schedule' }]);
    expect(notPresented(shown!, 'the axes whose x title names the vector item, on the full build'), 'the full build presents the axes with a vector title').toEqual([]);
    const without = sealed(bin('deep-show-no-vector'), 'the build without vector');
    expect(['scene3d', 'data'].filter((m) => !without.includes(m)), 'the build without vector seals with scene3d and data').toEqual([]);
    expect(without, 'the build without vector holds no vector module').not.toContain('vector');
    expect(sealed(bin('deep-show'), 'the full build'), 'the full build holds the vector module').toContain('vector');
    const [bareSchedule] = runShow(bin('deep-show-no-vector'), dir, [], [{ call: 'schedule' }]);
    expect(digestOf(bareSchedule!, 'scene3d@1', 'the build without vector'), 'scene3d@1\'s interface digest without the vector module equals the full build\'s')
      .toBe(digestOf(fullSchedule!, 'scene3d@1', 'the full build'));
  }, TIMEOUT);
});

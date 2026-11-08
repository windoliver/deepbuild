// AC5 #493.d8794d67: A cross-fade between a shot whose look tone-maps with agx and one whose look has no tone map
// equals, at every frame of the window, the blend of the two sides each rendered alone through its own look, within one
// code value.
// AC6 #493.7831f8ec: In a cross-fade between two shots that both bind one verdict's chip, the chip draws once in its
// exact status color at every frame of the window, unblended, from the outgoing side until the reveal and from the
// incoming side after it.
// AC8 #493.55016885: A 1 s wipe with angle 0, no feather and linear progress shows the incoming side exactly where
// x < 960 on a 1920 px wide frame at 0.5 s, and with angle 90 exactly where y < 540 on a 1080 px high frame.
//
// Through `deep-show run` (`full`): 2D films presented whole, then #387's `eval` with `pixels` at each time, the
// snapshots read back as PNG from the evidence store. Each shot names its look (README: Looks): `toned` (the clean
// look with AgX at its defaults) and `plain` (the clean look, no tone map), stored by hash. "Each side rendered alone"
// is the same film with only that shot, over the whole span: its shots hold, so a side's camera doesn't depend on when
// its shot starts. The window of a 1 s transition centred on the cut at 2 s is [1.5 s, 2.5 s); with linear progress
// p = (t − 1.5 s) ÷ 1 s. The reveal of a cross-fade, where the incoming side covers half the picture, is 2 s.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, F60, TIMEOUT, camera2d, channel, evalCall, film, fl, fromHex, looks, none, num, pictureOf, pixel, present, presented, rect,
  runShow, sameRgb, scenario, shot, show, snapshotOf, storeLooks, useEvidence, useShow, type Image, type JsonObject, type Rgb, type Snapshot,
} from './helpers.ts';

const shows = useShow(['full']);
const evidence = useEvidence();
const WINDOW = Array.from({ length: 60 }, (_, k) => fl(1.5) + k * F60);
const VERDICT = 'verdict:01JB4930000000000000000493';

/** A 2D film over `size` with the stored looks, `plain` its own. */
function lookFilm(id: string, size: [number, number], items: JsonObject[], shots: JsonObject, extra: JsonObject = {}): JsonObject {
  const { toned, plain } = looks();
  return film(id, [camera2d(size), ...items], { look: { asset: 'plain@1', theme: 'light' }, assets: storeLooks(evidence(), { toned, plain }), shots, ...extra }, { span: '4s' }, size);
}
/** Present each document at its own doc ID, then `eval` each at each time with pixels; the replies per document, per time. */
function draw(docs: JsonObject[], times: readonly number[], record?: JsonObject): JsonObject[][] {
  const ids = [DOC.a, DOC.b, DOC.c, DOC.d].slice(0, docs.length);
  const calls = [...docs.map((d, i) => present(ids[i]!, d)), ...times.flatMap((t) => ids.map((id) => evalCall(id, t, { pixels: true })))];
  const replies = runShow(shows.bin('full'), scenario(evidence(), calls, record));
  docs.forEach((_, i) => presented(replies[i]!, `document ${i}`));
  return docs.map((_, i) => times.map((_, k) => replies[docs.length + k * docs.length + i]!));
}
const picture = (reply: JsonObject, what: string): Image => pictureOf(evidence(), snapshotOf(reply, what), what);

describe(`${AC[5]} a cross-fade between two looks blends the sides, each finished through its own look`, () => {
  it(`${AC[5]} at every frame of the window the cross-fade from an agx shot to an untoned one equals the blend of each side rendered alone through its own look, within one code value`, () => {
    const size: [number, number] = [320, 180];
    const items = [
      rect('back', [-200, -200, 720, 580], 'ground'),
      rect('s1', [20, 20, 80, 60], 'accent'), rect('s2', [120, 20, 80, 60], 'ink'), rect('s3', [220, 20, 80, 60], 'muted'),
      rect('mover', [0, 0, 40, 30], 'accent', { at: { pos: [20, 120, 0] } }),
    ];
    const pose = { target: [160, 90, 0], view_width: 320 };
    const moving = { channels: { slide: channel('items/mover/at/pos/0', [[0, 20], [4, 260]]) } };
    const mixed = lookFilm('xfade', size, items, { a: shot(0, 2, { ...pose, look: 'toned' }), b: shot(2, 4, { ...pose, look: 'plain' }) },
      { ...moving, transitions: { xf: { from: 'a', to: 'b', kind: 'cross_fade', span: '1s', progress: 'linear' } } });
    const outgoing = lookFilm('xfade-a', size, items, { a: shot(0, 4, { ...pose, look: 'toned' }) }, moving);
    const incoming = lookFilm('xfade-b', size, items, { b: shot(0, 4, { ...pose, look: 'plain' }) }, moving);
    const [m, a, b] = draw([mixed, outgoing, incoming], WINDOW) as [JsonObject[], JsonObject[], JsonObject[]];
    const failures: string[] = [];
    const a0 = picture(a[0]!, 'the toned side'); const b0 = picture(b[0]!, 'the plain side');
    const ta = pixel(a0, 60, 50); const tb = pixel(b0, 60, 50);
    expect(Math.max(...ta.map((v, i) => Math.abs(v - tb[i]!))), `the agx side and the untoned side draw the accent swatch apart (${ta} vs ${tb}): the shots' looks apply`).toBeGreaterThan(8);
    WINDOW.forEach((t, k) => {
      const p = k / 60;
      const [fm, fa, fb] = [picture(m[k]!, `the cross-fade at ${t}`), picture(a[k]!, `the toned side at ${t}`), picture(b[k]!, `the plain side at ${t}`)];
      let worst = 0; let where = '';
      for (let y = 0; y < fm.height; y++) for (let x = 0; x < fm.width; x++) {
        const [g, u, v] = [pixel(fm, x, y), pixel(fa, x, y), pixel(fb, x, y)];
        for (let c = 0; c < 3; c++) { const d = Math.abs(g[c]! - ((1 - p) * u[c]! + p * v[c]!)); if (d > worst) { worst = d; where = `(${x}, ${y}) channel ${c}: ${g[c]} vs ${(1 - p) * u[c]! + p * v[c]!}`; } }
      }
      if (worst > 1) failures.push(`frame ${k} of the window (t = ${t} flicks, p = ${p}): off the blend by ${worst.toFixed(2)} code values at ${where}`);
    });
    none(failures, 'the cross-fade against the blend of its sides');
  }, TIMEOUT);
});

describe(`${AC[6]} a status chip in a cross-fade draws once, exact, from the side that holds the reveal`, () => {
  it(`${AC[6]} at every frame of the window the chip draws once in its exact status color, unblended, from the outgoing side before the reveal and the incoming side from it`, () => {
    const size: [number, number] = [640, 360];
    const items = [rect('back', [-400, -200, 1440, 760], 'ground'), rect('chip', [0, 0, 40, 40], 'accent', { at: { pos: [60, 60, 0] } }), rect('band', [300, 200, 200, 100], 'muted')];
    const binding = { status_bindings: { 'chip-state': { target: 'items/chip/params/paint/fill', source: VERDICT } } };
    const out = { target: [320, 180, 0], view_width: 640, look: 'plain' }; const inc = { target: [200, 180, 0], view_width: 640, look: 'plain' };
    const mixed = lookFilm('chip', size, items, { a: shot(0, 2, out), b: shot(2, 4, inc) }, { ...binding, transitions: { xf: { from: 'a', to: 'b', kind: 'cross_fade', span: '1s', progress: 'linear' } } });
    const outgoing = lookFilm('chip-a', size, items, { a: shot(0, 4, out) }, binding);
    const incoming = lookFilm('chip-b', size, items, { b: shot(0, 4, inc) }, binding);
    const [m, a, b] = draw([mixed, outgoing, incoming], WINDOW, { [VERDICT]: { session: null, state: 'fail' } }) as [JsonObject[], JsonObject[], JsonObject[]];
    const chipOf = (s: Snapshot, what: string): { box: number[]; color: Rgb }[] => s.marks.filter((mk) => mk['item'] === 'chip').map((mk) => {
      const bounds = Array.isArray(mk['bounds']) ? mk['bounds'].map((v, i) => num(v, `${what}: bounds[${i}]`)) : [];
      const c = mk['color'];
      return { box: bounds, color: typeof c === 'string' ? fromHex(c) : Array.isArray(c) ? (c.slice(0, 3).map(Number) as Rgb) : [-1, -1, -1] };
    });
    const sideA = chipOf(snapshotOf(a[0]!, 'the outgoing side alone'), 'outgoing'); const sideB = chipOf(snapshotOf(b[0]!, 'the incoming side alone'), 'incoming');
    expect(sideA.length, `the outgoing side alone draws the chip's status mark once: ${show(a[0]!['snapshots'])}`).toBe(1);
    expect(sideB.length, 'the incoming side alone draws the chip\'s status mark once').toBe(1);
    expect(Math.abs(sideB[0]!.box[0]! - sideA[0]!.box[0]!), `the two shots hold the chip apart (outgoing ${JSON.stringify(sideA[0]!.box)}, incoming ${JSON.stringify(sideB[0]!.box)}): each shot's pose applies`).toBeGreaterThan(60);
    const fail = fromHex('#bf232b');
    const ground = pixel(picture(a[0]!, 'the outgoing side alone'), 600, 20);
    /** Each pixel 2 px inside a mark's bounds, which the snapshot writes as [x, y, w, h] in px (#382's marks). */
    const inside = (box: number[], f: (x: number, y: number) => void): void => {
      for (let y = Math.ceil(box[1]! + 2); y < Math.floor(box[1]! + box[3]! - 2); y++) for (let x = Math.ceil(box[0]! + 2); x < Math.floor(box[0]! + box[2]! - 2); x++) f(x, y);
    };
    const failures: string[] = [];
    WINDOW.forEach((t, k) => {
      const s = snapshotOf(m[k]!, `the cross-fade at ${t}`);
      const marks = chipOf(s, `the cross-fade at ${t}`);
      if (marks.length !== 1) { failures.push(`at ${t} flicks the chip's status mark draws ${marks.length} times, not once`); return; }
      const [want, other, side] = t < fl(2) ? [sideA[0]!, sideB[0]!, 'outgoing'] : [sideB[0]!, sideA[0]!, 'incoming'];
      if (marks[0]!.box.length !== 4 || marks[0]!.box.some((v, i) => Math.abs(v - want.box[i]!) > 0.5)) failures.push(`at ${t} flicks the chip draws at ${JSON.stringify(marks[0]!.box)}, not the ${side} side's ${JSON.stringify(want.box)}`);
      if (!sameRgb(marks[0]!.color, fail)) failures.push(`at ${t} flicks the chip's mark color is ${marks[0]!.color}, not fail's exact ${fail}`);
      const img = pictureOf(evidence(), s, `the cross-fade at ${t}`);
      let exact = 0; let all = 0;
      inside(want.box, (x, y) => { all++; if (sameRgb(pixel(img, x, y), fail)) exact++; });
      if (!(all > 0 && exact / all >= 0.6)) failures.push(`at ${t} flicks only ${exact} of ${all} pixels inside the chip are its exact status color`);
      let ghost = 0;
      inside(other.box, (x, y) => { if (!sameRgb(pixel(img, x, y), ground)) ghost++; });
      if (ghost > 0) failures.push(`at ${t} flicks ${ghost} pixels where the other side holds the chip aren't the ground: the chip is blended in from the side not drawn`);
    });
    none(failures, 'the chip in the cross-fade');
  }, TIMEOUT);
});

describe(`${AC[8]} a wipe's edge sits exactly where its progress puts it`, () => {
  it(`${AC[8]} halfway through a 1 s linear wipe with no feather, angle 0 shows the incoming side exactly where x < 960 and angle 90 exactly where y < 540`, () => {
    const size: [number, number] = [1920, 1080];
    const items = [rect('left-world', [0, 0, 1920, 1080], 'accent'), rect('right-world', [4000, 0, 1920, 1080], 'ink')];
    const out = { target: [960, 540, 0], view_width: 1920, look: 'plain' }; const inc = { target: [4960, 540, 0], view_width: 1920, look: 'plain' };
    const wipe = (angle: number): JsonObject => lookFilm(`wipe-${angle}`, size, items, { a: shot(0, 2, out), b: shot(2, 4, inc) },
      { transitions: { w: { from: 'a', to: 'b', kind: 'wipe', wipe: { angle, feather: 0 }, span: '1s', progress: 'linear' } } });
    const [w0, oa, ob, w90] = draw([wipe(0), lookFilm('wipe-a', size, items, { a: shot(0, 4, out) }), lookFilm('wipe-b', size, items, { b: shot(0, 4, inc) }), wipe(90)], [fl(2)]) as JsonObject[][];
    const A = pixel(picture(oa![0]!, 'the outgoing side'), 5, 5); const B = pixel(picture(ob![0]!, 'the incoming side'), 5, 5);
    expect(sameRgb(A, B), `the two sides differ (${A} vs ${B})`).toBe(false);
    const failures: string[] = [];
    for (const [reply, angle, incoming] of [[w0![0]!, 0, (x: number) => x < 960], [w90![0]!, 90, (_x: number, y: number) => y < 540]] as [JsonObject, number, (x: number, y: number) => boolean][]) {
      const img = picture(reply, `the wipe at angle ${angle}`);
      expect([img.width, img.height], 'the frame is 1920 × 1080').toEqual([1920, 1080]);
      let wrong = 0; let first = '';
      for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
        const want = incoming(x, y) ? B : A;
        if (!sameRgb(pixel(img, x, y), want)) { wrong++; if (!first) first = `(${x}, ${y}) is ${pixel(img, x, y)}, not ${want}`; }
      }
      if (wrong) failures.push(`angle ${angle}: ${wrong} pixels aren't exactly their side, first ${first}`);
    }
    none(failures, 'the wipe at 0.5 s');
  }, TIMEOUT);
});

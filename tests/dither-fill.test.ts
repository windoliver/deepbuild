// What #1646's dither fill asks that no acceptance criterion reaches (Paint: dither fill): it draws under any look, not
// only a drawing basis; an 8 × 8 matrix; up to four stops, each pair of neighbours dithered over its share of the
// gradient, and a fifth refused; the matrix read in world space by default and in frame space with `anchor: frame`;
// `by: tone` reading the look's light; and nothing a channel can move. Each runs the real `deep-gpu`.
import { describe, expect, it } from 'vitest';
import {
  BAYER4, type Image, type JsonObject, doc2d, film2d, frameAt, hex, item, lines, look2d, none, obj, pixel, readFinal, requireGpu, runGpu, shown,
  useBins, useOut,
} from './acceptance/1646/helpers.ts';

const bins = useBins(['deep-gpu', 'deep-canvas-render']);
const out = useOut();
const COLORS = { lo: '#1f3a5f', mid: '#7a2d4a', hi: '#f2c14e', top: '#e3e4e6', over: '#5f7f3b' };
const LOOK = look2d('dither-gaps-1646', COLORS);

/** BAYER8[y mod 8][x mod 8], the recursive 8 × 8 table built from the 4 × 4 one. */
const bayer8 = (x: number, y: number): number => 4 * BAYER4[y % 4]![x % 4]! + [[0, 2], [3, 1]][Math.floor((y % 8) / 4)]![Math.floor((x % 8) / 4)]!;
const entry = (n: 4 | 8, x: number, y: number): number => (n === 4 ? BAYER4[((y % 4) + 4) % 4]![((x % 4) + 4) % 4]! : bayer8(((x % 8) + 8) % 8, ((y % 8) + 8) % 8));

interface Case {
  /** The plate's box on the frame, x y w h. */
  box: [number, number, number, number];
  stops: string[];
  matrix: 4 | 8;
  /** The value at frame column x, 0..1. */
  value: (x: number) => number;
  /** Where the matrix is read for the frame pixel (x, y). */
  at: (x: number, y: number) => [number, number];
}

/** The stop a pixel takes: the next one where its matrix entry is below its step within its pair of stops. */
function want(c: Case, x: number, y: number): string {
  const seg = c.stops.length - 1;
  const along = Math.min(Math.max(c.value(x), 0), 1) * seg;
  const j = Math.min(Math.floor(along), seg - 1);
  const step = Math.floor((along - j) * c.matrix * c.matrix);
  const [mx, my] = c.at(x, y);
  return COLORS[(entry(c.matrix, mx, my) < step ? c.stops[j + 1] : c.stops[j]) as keyof typeof COLORS];
}

function wrongPixels(img: Image, c: Case, what: string): string[] {
  const [bx, by, bw, bh] = c.box;
  const wrong: string[] = [];
  for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) {
    const got = hex(pixel(img, x, y));
    const w = want(c, x, y);
    if (got !== w) wrong.push(`(${x}, ${y}) draws ${got}, not ${w}`);
  }
  return wrong.length ? [`${what}: ${wrong.length} of ${bw * bh} pixels differ, first ${wrong.slice(0, 4).join('; ')}`] : [];
}

const fill = (stops: string[], extra: JsonObject = {}): JsonObject => ({ dither: { stops, matrix: 4, by: 'gradient', anchor: 'world', ...extra } });
const plate = (box: number[], f: JsonObject): JsonObject => item('plate', 'rect@1', 'a1', { box, paint: { fill: f } });
const camera = (target: [number, number], width: number): JsonObject =>
  item('cam', 'camera@1', 'a0', { projection: 'orthographic', target: [...target, 0], view_width: width });

function frame0(doc: JsonObject, look: JsonObject, what: string): Image {
  requireGpu();
  const [reply] = runGpu(bins.bin('deep-gpu'), out(), [film2d(doc, look, { fps: 24, frames: 1, capture: [0] })]);
  return readFinal(out(), frameAt(reply!, 0, what), what);
}

/** The gradient's value at the pixel centre of column x: 0 at the box's west edge, 1 at its east. */
const across = (bx: number, bw: number) => (x: number): number => (x - bx + 0.5) / bw;
const same = (x: number, y: number): [number, number] => [x, y];
const noBasis = (look: JsonObject): JsonObject => Object.fromEntries(Object.entries(look).filter(([k]) => k !== 'basis'));

describe('#1646 a dither fill beyond the acceptance criteria', () => {
  it('draws the same pixels under a physical look and a look naming no basis as under a drawing one', () => {
    const c: Case = { box: [64, 32, 64, 32], stops: ['lo', 'hi'], matrix: 4, value: across(64, 64), at: same };
    const doc = doc2d('dither-basis-1646', [192, 96], [plate([64, 32, 64, 32], fill(['lo', 'hi']))]);
    const problems = [
      ...wrongPixels(frame0(doc, LOOK, 'drawing'), c, 'under a drawing look'),
      ...wrongPixels(frame0(doc, look2d('dither-physical-1646', COLORS, { basis: 'physical' }), 'physical'), c, 'under a physical look'),
      ...wrongPixels(frame0(doc, noBasis(look2d('dither-nobasis-1646', COLORS)), 'no basis'), c, 'under a look naming no basis'),
    ];
    none(problems, 'the dither under every basis');
  }, 1_800_000);

  it('an 8 × 8 matrix thresholds the gradient in 64 steps', () => {
    const c: Case = { box: [64, 16, 512, 32], stops: ['lo', 'hi'], matrix: 8, value: across(64, 512), at: same };
    const doc = doc2d('dither-eight-1646', [640, 64], [plate([64, 16, 512, 32], fill(['lo', 'hi'], { matrix: 8 }))]);
    none(wrongPixels(frame0(doc, LOOK, 'matrix 8'), c, 'matrix 8'), 'the 8 × 8 dither');
  }, 1_800_000);

  it('three and four stops dither each neighbouring pair over its share of the gradient', () => {
    const three: Case = { box: [32, 16, 128, 32], stops: ['lo', 'mid', 'hi'], matrix: 4, value: across(32, 128), at: same };
    const four: Case = { box: [32, 64, 192, 32], stops: ['lo', 'mid', 'hi', 'top'], matrix: 4, value: across(32, 192), at: same };
    const doc = doc2d('dither-stops-1646', [256, 112], [
      item('three', 'rect@1', 'a1', { box: three.box, paint: { fill: fill(three.stops) } }),
      item('four', 'rect@1', 'a2', { box: four.box, paint: { fill: fill(four.stops) } }),
    ]);
    const img = frame0(doc, LOOK, 'stops');
    none([...wrongPixels(img, three, 'three stops'), ...wrongPixels(img, four, 'four stops')], 'the dither between several stops');
  }, 1_800_000);

  it('a fifth stop is refused, naming the stops', () => {
    requireGpu();
    const doc = doc2d('dither-five-1646', [192, 96], [plate([64, 32, 64, 32], fill(['lo', 'mid', 'hi', 'top', 'over']))]);
    const [reply] = runGpu(bins.bin('deep-gpu'), out(), [film2d(doc, LOOK, { fps: 24, frames: 1, capture: [0] })]);
    expect(reply!['code'], `five stops are refused: ${shown(reply)}`).toBe('out_of_range');
    expect(String(reply!['reason']), `the refusal names the stops: ${shown(reply)}`).toBe('items/plate/params/paint/fill/dither/stops');
  }, 1_800_000);

  it('reads the matrix in world space through a camera, and in frame space with anchor: frame', () => {
    // The camera looks 3 u east of the frame's centre at zoom 1, so the plate lands 3 px west of its box and the world
    // point under frame pixel x is x + 3: 3 is no multiple of 4, so the two anchors draw different pixels.
    const box: [number, number, number, number] = [61, 32, 64, 32];
    const world: Case = { box, stops: ['lo', 'hi'], matrix: 4, value: across(61, 64), at: (x, y) => [x + 3, y] };
    const frame: Case = { ...world, at: same };
    const doc = (id: string, anchor: string): JsonObject => ({
      ...doc2d(id, [192, 96], [camera([99, 48], 192), plate([64, 32, 64, 32], fill(['lo', 'hi'], { anchor }))]),
      camera: 'cam',
    });
    none([
      ...wrongPixels(frame0(doc('dither-world-1646', 'world'), LOOK, 'world'), world, 'anchor world'),
      ...wrongPixels(frame0(doc('dither-frame-1646', 'frame'), LOOK, 'frame'), frame, 'anchor frame'),
    ], 'the dither anchors');
  }, 1_800_000);

  it('by tone takes its value from the look\'s light: lit from the east it is the gradient, from the west its mirror', () => {
    const box: [number, number, number, number] = [64, 32, 64, 32];
    const doc = doc2d('dither-tone-1646', [192, 96], [plate(box, fill(['lo', 'hi'], { by: 'tone' }))]);
    const lit = (dir: number): JsonObject => look2d(`dither-tone-${dir}-1646`, COLORS, { light: { dir } });
    const east: Case = { box, stops: ['lo', 'hi'], matrix: 4, value: across(64, 64), at: same };
    const west: Case = { ...east, value: (x) => 1 - across(64, 64)(x) };
    none([
      ...wrongPixels(frame0(doc, lit(0), 'light from the east'), east, 'lit from the east'),
      ...wrongPixels(frame0(doc, lit(180), 'light from the west'), west, 'lit from the west'),
    ], 'the dither by tone');
  }, 1_800_000);

  it('a channel moving a dither field is refused at check, naming the channel', () => {
    const doc: JsonObject = {
      ...doc2d('dither-channel-1646', [192, 96], [plate([64, 32, 64, 32], fill(['lo', 'hi']))]),
      channels: {
        swap: {
          target: 'items/plate/params/paint/fill/dither/matrix', type: 'f32',
          keys: { k0: { t: '0s', value: 4, interp: 'hold' }, k1: { t: '1s', value: 8, interp: 'hold' } },
        },
      },
    };
    const [answer] = lines(bins.bin('deep-canvas-render'), ['check'], [{ doc, look: LOOK }]);
    const errors = (Array.isArray(answer!['issues']) ? answer!['issues'] : []).map((v) => obj(v, 'an issue')).filter((i) => i['severity'] === 'error');
    const hit = errors.find((e) => e['code'] === 'out_of_range' && e['path'] === 'channels/swap/target');
    expect(hit, `check refuses the channel's target as out of range: ${shown(answer)}`).toBeDefined();
    expect(shown(hit!['ids']), `the refusal names the channel: ${shown(hit)}`).toContain('"swap"');
    const still = { ...doc, channels: {} };
    const [clean] = lines(bins.bin('deep-canvas-render'), ['check'], [{ doc: still, look: LOOK }]);
    expect(clean!['ok'], `the same fill with no channel checks: ${shown(clean)}`).toBe(true);
  }, 1_800_000);
});

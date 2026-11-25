// AC2 #2844.11438f50: "Every frame that `tests/acceptance/2031/` and `tests/acceptance/2032/` draw is byte-identical to the
// merge base, and both suites pass unchanged"
//
// A blind redraft that adds scenes to what `../2844/ac2-frames.test.ts` judges. That file stays as written and keeps
// the suites' own frames and "both suites pass unchanged". The criterion stands for the issue's "without changing a
// pixel", and nearly every frame the two suites draw is still. So this file holds the same comparison with the merge
// base on eight lit groups of its own whose lights and occluders move, each drawn at many times (README: The scenes):
//   - walk-grid, walk-seeded: a point light walks among, beside and through a dozen or more lobed outlines of a few
//     dozen corners each while three lights stay;
//   - drift: twelve outlines move, one over a light and two through each other, while four lights stay;
//   - short-range: two walking lights and a standing one whose ranges end part-way across a wall, boxes and lobed
//     outlines;
//   - beside: lights 1/4 u from a wall's face, 1 u from a lobed outline's corner and 1/8 u off a box's corner;
//   - yard: boxes, a wall, an L and one path of two closed sub-paths beside lobed outlines, on whole units, with lights
//     that pass in line with their sides;
//   - dusk: a sun that turns from 0° to 90° beside three point lights, one walking through the hole of an outline;
//   - cap: 16 lights (a sun and 15 point lights, three walking) and 4,096 occluder segments, four outlines moving.
// Three scenes keep every coordinate and every drawn time on 1/8 u and 1/8 s, which f32 holds exactly; four take seeded
// coordinates and times with every digit f64 gives them; the cap takes both.
// A frame is a film frame's `pixel_hash` (`film2d` with `hash`: every frame of the scene's span from frame 0 in one
// process, so each is drawn after the one before) or a window's PNG by the SHA-256 of its bytes (`window2d` with `t`,
// read from the file). The merge base is `git merge-base HEAD origin/main` (else `main`), exported and built by #2031's
// `useMergeBase`; the checkout's `deep-gpu` is built by #467's `useBin`. Each side draws each scene in one `deep-gpu
// run` process, and every frame the checkout draws must be the merge base's. A difference names the scene, the time
// and both frames, and a differing window says how many pixels differ and where the first is.
//   - The comparison is shown failing first. One window of each scene is drawn by the checkout under each planted
//     shadow the base holds (`deep-gpu run --planted shadow_edge_aliased`, `shadow_bounding_boxes`,
//     `shadow_inside_outline`) and must be a picture other than the merge base's frame of that scene and time.
//   - The scenes move. Of a scene's film frames by the merge base, and of its windows, more than one is a frame of its
//     own and at least half are, so a scene whose channels drive nothing can't pass.
// Off macOS's Metal device, where `deep-gpu` answers `unsupported_platform`, where the merge base can't be exported or
// built, or where it draws no picture of a frame, the test fails `INCONCLUSIVE:`, never passing.
// Wrong programs: a light pass that moves one shadowed pixel for a light at one place among hundreds (the three plants;
// the twin `occluders-on-a-grid`), bins or zones that drop a segment for a light beside or inside an outline, a light's
// bins kept from the frame before, a range cut that drops a segment reaching past it, a sun's bins wrong at one angle,
// a shadow test rewritten so that one sample at one edge falls the other way.
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodePng, fl, hasFile, runGpu, seeded, sha256, type Planted as Planted467 } from '../467/helpers.ts';
import {
  blob, boxPoly, distinctCorners, doc, group, inconclusive, item, keyed, light, LOOK, none, outline, rect, requireMetal, segments, sun,
  useBin, useDir, useMergeBase, WHITE, type JsonObject, type Poly, type Pt,
} from '../2032/helpers.ts';

const AC2 = 'AC2 #2844.11438f50';
const head = useBin('deep-gpu');
const base = useMergeBase();
const dir = useDir();
/** The wrong programs the base holds for a shadow's pixels; each changes every scene here (README: Wrong programs). */
const PLANTS = ['shadow_edge_aliased', 'shadow_bounding_boxes', 'shadow_inside_outline'] as const;

// ---------------------------------------------------------------------------------------------------
// The scenes (README: The scenes)

/** `[seconds, x, y]` keys, linear between them: where a light or an outline is over the scene's span. */
type Track = [number, number, number][];
/** A point light, standing at `at` or walking its track; or a sun, its angle fixed or keyed as `[seconds, degrees]`. */
type Lamp = { at: Pt | Track; energy: number; range: number; role?: string } | { sun: number | [number, number][]; energy: number };
/** An occluding closed path of one sub-path or two: where its corners say, or round its own origin and moved by its position. */
interface Rock { polys: Poly[]; at?: Track; fill?: string }
interface Scene {
  id: string; size: [number, number]; span: number; ambient: number; lamps: Lamp[]; rocks: Rock[];
  /** Its film plays every frame of the span at `fps`; its windows are at `windows`, in seconds, and `windows[under]` is also drawn under each planted program. */
  fps: number; windows: number[]; under: number;
}

const ROLES = [WHITE, 'accent', 'focus'] as const;
/** Standing outlines of one sub-path each, filled in the three roles in turn. */
const standing = (polys: Poly[]): Rock[] => polys.map((p, k) => ({ polys: [p], fill: ROLES[k % 3]! }));
/** `v` moved either way by a seeded share of `by`: a coordinate that keeps every digit f64 gives it. */
const nudged = (rand: () => number) => (v: number, by = 12): number => v + by * (rand() - 0.5);
/** `n` seeded times within `span` seconds, in order. */
const times = (rand: () => number, n: number, span: number): number[] => Array.from({ length: n }, () => rand() * span).sort((a, b) => a - b);
/**
 * A lobed outline whose corners keep every digit: `n` corners round (cx, cy), corner k a seeded 55 to 100% of `r` from
 * the centre at a seeded place in its own n-th of the turn, so the corners turn one way and the outline never crosses itself.
 */
function lobed(cx: number, cy: number, n: number, r: number, rand: () => number): Poly {
  return Array.from({ length: n }, (_, k): Pt => {
    const a = (2 * Math.PI * (k + 0.8 * rand())) / n; const q = r * (0.55 + 0.45 * rand());
    return [cx + q * Math.cos(a), cy + q * Math.sin(a)];
  });
}

/** 15 lobed outlines of 24 to 40 corners on a 5 × 3 grid; the walker keeps to the lanes between them and cuts through two. */
const walkGrid: Scene = {
  id: 'moving-walk-grid', size: [480, 320], span: 6, ambient: 0.15, fps: 8,
  lamps: [
    { at: [[0, 16, 108], [1, 96, 108], [2, 192, 212], [3, 288, 212], [4, 288, 108], [5, 384, 108], [6, 464, 212]], energy: 0.55, range: 200 },
    { at: [192, 108], energy: 0.3, range: 180, role: 'accent' }, { at: [384, 212], energy: 0.3, range: 220, role: 'focus' }, { at: [96, 264], energy: 0.25, range: 140 },
  ],
  rocks: standing(Array.from({ length: 15 }, (_, k) => blob(48 + 96 * (k % 5), 56 + 104 * Math.floor(k / 5), 24 + 4 * (((k % 5) + 2 * Math.floor(k / 5)) % 5), 30, 284400 + k))),
  windows: Array.from({ length: 12 }, (_, k) => k / 2), under: 5,
};

/** The same walk with nothing on a grid: 12 seeded outlines of 20 to 36 corners, a seeded track, seeded times, 7 fps. */
const walkSeeded = ((): Scene => {
  const rand = seeded(284402); const j = nudged(rand);
  const rocks = standing(Array.from({ length: 12 }, (_, k) => lobed(j(60 + 120 * (k % 4), 20), j(56 + 104 * Math.floor(k / 4), 20), 20 + Math.floor(17 * rand()), j(28, 8), rand)));
  const walk = ([[22, 108], [128, 104], [238, 112], [242, 214], [352, 208], [362, 106], [462, 160]] as Pt[]).map(([x, y], t): Track[number] => [t, j(x), j(y)]);
  return {
    id: 'moving-walk-seeded', size: [480, 320], span: 6, ambient: 0.15, fps: 7, rocks,
    lamps: [
      { at: walk, energy: 0.55, range: 200 }, { at: [j(128), j(214)], energy: 0.3, range: 190, role: 'accent' },
      { at: [j(352), j(106)], energy: 0.3, range: 210, role: 'focus' }, { at: [j(240), j(300)], energy: 0.25, range: 150 },
    ],
    windows: times(rand, 8, 6), under: 3,
  };
})();

/**
 * Occluders move while lights stay: six lobed outlines, four boxes and two walls, each round its own origin and moved
 * by its position from its cell of a 4 × 3 grid. The first crosses to another cell over the first light, which stands
 * where its origin is at 2 s; the sixth and the seventh change places through each other; the rest drift 36 u a
 * seeded way. Four lights stand on the cells' corners.
 */
const drift = ((): Scene => {
  const rand = seeded(284403); const j = nudged(rand);
  const cell = (k: number): Pt => [50 + 100 * (k % 4), 45 + 85 * Math.floor(k / 4)];
  const shapes: Poly[] = [
    ...Array.from({ length: 6 }, (_, k) => lobed(0, 0, 26 + k, j(21, 6), rand)),
    boxPoly(-16, -14, 32, 28), boxPoly(-19, -12, 38, 24), boxPoly(-12, -18, 24, 36), boxPoly(-15, -15, 30, 30), boxPoly(-4, -40, 8, 80), boxPoly(-45, -4, 90, 8),
  ];
  const to = new Map<number, Pt>([[0, cell(5)], [5, cell(6)], [6, cell(5)]]);
  const tracks = shapes.map((_, k): Track => {
    const [x, y] = cell(k); const turn = 2 * Math.PI * rand(); const [u, v] = to.get(k) ?? [x + 36 * Math.cos(turn), y + 36 * Math.sin(turn)];
    return [[0, j(x), j(y)], [4, j(u), j(v)]];
  });
  const over = tracks[0]!;
  return {
    id: 'moving-drift', size: [400, 260], span: 4, ambient: 0.15, fps: 8,
    lamps: [
      { at: [(over[0]![1] + over[1]![1]) / 2, (over[0]![2] + over[1]![2]) / 2], energy: 0.45, range: 200 },
      { at: [j(300), j(87)], energy: 0.35, range: 200, role: 'accent' }, { at: [j(200), j(172)], energy: 0.35, range: 220, role: 'focus' }, { at: [j(100), j(172)], energy: 0.3, range: 120 },
    ],
    rocks: shapes.map((p, k) => ({ polys: [p], at: tracks[k]!, fill: ROLES[k % 3]! })),
    windows: times(rand, 6, 4), under: 2,
  };
})();

/**
 * Ranges that end part-way across outlines: two walking lights of range 52 and 64 and a standing one of range 48 among
 * a long wall, two boxes and three wide lobed outlines; the first walker crosses the wall twice. A fourth light reaches
 * the whole document.
 */
const shortRange = ((): Scene => {
  const rand = seeded(284404); const j = nudged(rand);
  return {
    id: 'moving-short-range', size: [360, 240], span: 3, ambient: 0.15, fps: 8,
    lamps: [
      { at: [[0, j(30), j(100)], [1, j(150), j(96)], [2, j(210), j(140)], [3, j(330), j(104)]], energy: 0.7, range: 52 },
      { at: [[0, j(30), j(222)], [1, j(130), j(226)], [2, j(232), j(232)], [3, j(344), j(224)]], energy: 0.6, range: 64 },
      { at: [j(126), j(172)], energy: 0.6, range: 48, role: 'accent' }, { at: [j(300), j(30)], energy: 0.3, range: 300, role: 'focus' },
    ],
    rocks: standing([
      boxPoly(j(40), j(119), 280, 9), lobed(j(90), j(60), 30, 44, rand), lobed(j(250), j(64), 34, 44, rand), lobed(j(180), j(190), 28, 44, rand),
      boxPoly(j(60), j(160), 56, 44), boxPoly(j(270), j(170), 56, 44),
    ]),
    windows: times(rand, 5, 3), under: 2,
  };
})();

/**
 * Lights close beside outlines, on 1/8 u: one slides down a wall's face 1/4 u from it, in line with the wall's top edge
 * at 1 s and its bottom edge at 3.5 s; one passes a lobed outline 1 u right of its rightmost corner, level with it at
 * 2 s; one stands 1/8 u off a box's corner on both axes.
 */
const beside = ((): Scene => {
  const rock = blob(220, 100, 32, 36, 284405);
  const tip = rock.reduce((a, b) => (b[0] > a[0] ? b : a));
  return {
    id: 'moving-beside', size: [320, 200], span: 4, ambient: 0.15, fps: 8,
    lamps: [
      { at: [[0, 99.75, 28], [4, 99.75, 156]], energy: 0.5, range: 140 },
      { at: [[0, tip[0] + 1, tip[1] - 48], [4, tip[0] + 1, tip[1] + 48]], energy: 0.5, range: 120, role: 'accent' },
      { at: [39.875, 149.875], energy: 0.4, range: 100, role: 'focus' },
    ],
    rocks: standing([boxPoly(100, 60, 12, 80), rock, boxPoly(40, 150, 40, 30)]),
    windows: [1, 1.5, 2, 2.75, 3.5], under: 2,
  };
})();

/**
 * Straight sides and right angles on whole units: three boxes, a wall, an L, a path of two closed sub-paths (two posts
 * with a gap a moving box passes through) and two lobed outlines. One light walks down x = 128 and is in line with the
 * boxes' and the L's horizontal sides at 1, 1.5, 2.5 and 3 s; one walks up the line of the wall's right face, then
 * close past a lobed outline; one stands in the L's notch, on the diagonal through its inner corner.
 */
const yard: Scene = {
  id: 'moving-yard', size: [384, 256], span: 4, ambient: 0.15, fps: 8,
  lamps: [
    { at: [[0, 128, 0], [4, 128, 256]], energy: 0.5, range: 180 }, { at: [[0, 248, 232], [2, 248, 200], [4, 368, 200]], energy: 0.45, range: 160, role: 'accent' },
    { at: [192, 192], energy: 0.4, range: 120, role: 'focus' }, { at: [360, 24], energy: 0.3, range: 260 },
  ],
  rocks: [
    ...standing([
      boxPoly(64, 64, 32, 32), boxPoly(160, 64, 32, 32), boxPoly(64, 160, 32, 32), boxPoly(240, 48, 8, 128),
      [[160, 160], [224, 160], [224, 176], [176, 176], [176, 224], [160, 224]], blob(340, 216, 28, 26, 284406), blob(28, 120, 24, 20, 284416),
    ]),
    { polys: [boxPoly(296, 32, 16, 56), boxPoly(296, 136, 16, 56)], fill: 'accent' },
    { polys: [boxPoly(-12, -12, 24, 24)], at: [[0, 272, 112], [4, 336, 112]], fill: 'focus' },
  ],
  windows: [0.5, 1, 1.5, 2.5, 3, 3.625], under: 3,
};

/**
 * A sun beside point lights: the sun turns from 0° to 90° over the span (45° at 2 s) while one point light walks, through
 * the hole of an outline of two sub-paths at 2 s, and two stand. Lobed outlines, a box, a wall turned 30° and one
 * lobed outline that moves.
 */
const dusk = ((): Scene => {
  const rand = seeded(284407); const j = nudged(rand);
  const turned = (cx: number, cy: number, w: number, h: number, deg: number): Poly => {
    const [c, s] = [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
    return boxPoly(-w / 2, -h / 2, w, h).map(([x, y]): Pt => [cx + x * c - y * s, cy + x * s + y * c]);
  };
  const isle: Pt = [j(250), j(140)];
  const windows = [0, 2, ...times(rand, 4, 4)].sort((a, b) => a - b);
  return {
    id: 'moving-dusk', size: [480, 300], span: 4, ambient: 0.15, fps: 6, windows, under: windows.indexOf(2),
    lamps: [
      { sun: [[0, 0], [4, 90]], energy: 0.3 }, { at: [[0, j(40), j(250)], [2, ...isle], [4, j(440), j(60)]], energy: 0.4, range: 190, role: 'accent' },
      { at: [j(120), j(60)], energy: 0.3, range: 170, role: 'focus' }, { at: [j(400), j(240)], energy: 0.3, range: 170 },
    ],
    rocks: [
      ...standing([
        lobed(j(70), j(150), 24, 26, rand), lobed(j(190), j(70), 30, 28, rand), lobed(j(300), j(210), 34, 30, rand), lobed(j(420), j(120), 22, 24, rand),
        boxPoly(j(150), j(200), 44, 30), turned(j(330), j(70), 70, 10, 30),
      ]),
      { polys: [lobed(...isle, 28, 38, rand), lobed(...isle, 12, 14, rand).reverse()] },
      { polys: [lobed(0, 0, 26, 20, rand)], at: [[0, j(60), j(60)], [4, j(200), j(260)]], fill: 'accent' },
    ],
  };
})();

/**
 * The cap: 16 lights, a sun at 30° and 15 point lights on the corners of a 10 × 6 grid of cells, three of them walking
 * a cell's side; and 4,096 occluder segments, 60 lobed outlines of 64 corners at the cells' centres (four of them
 * moving), four of 60 corners and four boxes on corners that hold no light.
 */
const cap = ((): Scene => {
  const rand = seeded(284408); const j = nudged(rand);
  const walks = new Map<number, Pt>([[0, [192, 90]], [7, [480, 180]], [14, [768, 450]]]);
  const moving = new Set([11, 25, 38, 52]);
  return {
    id: 'moving-cap', size: [960, 540], span: 2, ambient: 0.2, fps: 2,
    lamps: [{ sun: 30, energy: 0.2 }, ...Array.from({ length: 15 }, (_, k): Lamp => {
      const at: Pt = [96 + 192 * (k % 5), 90 + 180 * Math.floor(k / 5)]; const to = walks.get(k);
      return { at: to ? [[0, ...at], [2, ...to]] : at, energy: 0.45, range: 160 + 30 * (k % 3), role: ROLES[k % 3]! };
    })],
    rocks: [
      ...Array.from({ length: 60 }, (_, k): Rock => {
        const [x, y] = [48 + 96 * (k % 10), 45 + 90 * Math.floor(k / 10)]; const fill = ROLES[k % 3]!;
        return moving.has(k) ? { polys: [blob(0, 0, 64, 30, 284800 + k)], at: [[0, x, y], [2, j(x, 40), j(y, 32)]], fill } : { polys: [blob(x, y, 64, 30, 284800 + k)], fill };
      }),
      ...standing([2, 4, 6, 8].flatMap((a, k) => [blob(96 * a, 270, 60, 12, 284900 + k), boxPoly(96 * a - 8, (k % 2 ? 360 : 180) - 8, 16, 16)])),
    ],
    windows: [0.25, 1, 1.75], under: 1,
  };
})();

const isTrack = (at: Pt | Track): at is Track => Array.isArray(at[0]);
const closed = (poly: Poly): string => `${poly.map(([x, y], i) => `${i ? 'L' : 'M'} ${x} ${y}`).join(' ')} Z`;
/**
 * The scene as a document, built as #2032's suite builds its own: the lit group `lamps`, a white floor over the whole
 * document, and each outline a closed `path@1` child with `occlude: true`. A walking light's `at` is keyed by two f32
 * channels (`items/lamps/params/light/lights/<k>/at/<0|1>`), a turning sun's `angle` by one, and a moving outline's
 * position by two (`items/<path>/at/pos/<0|1>`), linear between whole seconds.
 */
function build(s: Scene): JsonObject {
  const channels: JsonObject = {};
  const drive = (name: string, target: string, track: Track): void => {
    channels[`${name}-x`] = keyed(`${target}/0`, track.map(([t, x]): [number, number] => [t, x]));
    channels[`${name}-y`] = keyed(`${target}/1`, track.map(([t, , y]): [number, number] => [t, y]));
  };
  const lights = s.lamps.map((l, k) => {
    const target = `items/lamps/params/light/lights/${k}`;
    if ('sun' in l) {
      if (typeof l.sun !== 'number') channels[`sun-${k}`] = keyed(`${target}/angle`, l.sun);
      return sun({ angle: typeof l.sun === 'number' ? l.sun : l.sun[0]![1], energy: l.energy });
    }
    if (isTrack(l.at)) drive(`lamp-${k}`, `${target}/at`, l.at);
    return light({ at: isTrack(l.at) ? [l.at[0]![1], l.at[0]![2]] : l.at, energy: l.energy, range: l.range }, l.role ?? WHITE);
  });
  const rocks = s.rocks.map((r, k) => {
    const [id, order, fill] = [`rock-${String(k).padStart(2, '0')}`, `b${String(k).padStart(2, '0')}`, r.fill ?? WHITE];
    if (r.at) drive(id, `items/${id}/at/pos`, r.at);
    const extra: JsonObject = r.at ? { at: { pos: [r.at[0]![1], r.at[0]![2], 0] } } : {};
    return r.polys.length === 1 ? outline(id, order, r.polys[0]!, 'lamps', { occlude: true, fill }, extra)
      : item(id, 'path@1', order, { d: r.polys.map(closed).join(' '), paint: { fill: { role: fill } }, occlude: true }, { parent: 'lamps', ...extra });
  });
  return doc(s.id, s.size, [group('lamps', 'a0', { ambient: s.ambient, lights }), rect('floor', 'a1', [0, 0, ...s.size], 'lamps'), ...rocks], { transport: { span: `${s.span}s` }, channels });
}
const STAGE = [walkGrid, walkSeeded, drift, shortRange, beside, yard, dusk, cap].map((s) => ({ ...s, doc: build(s) }));
type Staged = (typeof STAGE)[number];

/** What a channel's target names in its document. */
const targeted = (d: JsonObject, target: string): unknown => target.split('/').reduce<unknown>((v, k) => (v !== null && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined), d);
/** Each scene's lights, occluding outlines, their segments and its channels, as the README lists them. */
const COUNTS = STAGE.map((s) => [s.id, s.lamps.length, s.rocks.length, segments(s.rocks.flatMap((r) => r.polys)), Object.keys(s.doc['channels'] as JsonObject).length]);

// ---------------------------------------------------------------------------------------------------
// Frames

/** A frame by its name: `pixel_hash <hash>` for a film's frame, `png <SHA-256 of its bytes>` for a window, `code <code> <path>` for a refusal. */
type Frames = Map<string, string>;
/** One call and the frames it answers with, by name: a window's one, or a film's by frame index. */
interface Ask { names: string[]; call: JsonObject }
const seconds = (s: number): string => `${Number(s.toFixed(4))} s`;
const windowed = (s: Staged, at: number): Ask => ({ names: [`${s.id}: window at t ${fl(at)} (${seconds(at)})`], call: { call: 'window2d', doc: s.doc, look: LOOK, t: fl(at) } });
const filmed = (s: Staged): Ask => ({
  names: Array.from({ length: s.span * s.fps }, (_, n) => `${s.id}: film frame ${n} at ${s.fps} fps (${seconds(n / s.fps)})`),
  call: { call: 'film2d', doc: s.doc, look: LOOK, fps: s.fps, from: 0, frames: s.span * s.fps, hash: true },
});
/** A scene's film, then its windows in time's order. */
const asked = (s: Staged): Ask[] => [filmed(s), ...s.windows.map((at) => windowed(s, at))];
const isPicture = (frame: string | undefined): frame is string => frame !== undefined && /^(png|pixel_hash) /.test(frame);

/**
 * What `bin` draws for `asks` in one `deep-gpu run` process, under a planted program when one is named. A process that
 * ends without its answers is `gone`: a failure of the checkout's, and nothing to compare with of the merge base's.
 */
function draw(bin: string, out: string, who: string, asks: Ask[], gone: (why: string) => never, planted?: (typeof PLANTS)[number]): Frames {
  mkdirSync(out, { recursive: true });
  const replies = ((): JsonObject[] => {
    try {
      return runGpu(bin, out, asks.map((a) => a.call), planted as unknown as Planted467 | undefined);
    } catch (e) {
      const said = e instanceof Error ? e.message : String(e);
      if (said.includes('INCONCLUSIVE:')) throw e;
      return gone(`${who} drew nothing: ${said.slice(0, 3000)}`);
    }
  })();
  const frames: Frames = new Map();
  asks.forEach((a, i) => {
    const r = replies[i]!;
    if (r['code'] === 'unsupported_platform') inconclusive(`${who} reports unsupported_platform`);
    if (r['code'] !== undefined) for (const name of a.names) frames.set(name, `code ${String(r['code'])} ${String(r['path'] ?? '')}`);
    else if (a.call['call'] === 'window2d') frames.set(a.names[0]!, `png ${sha256(hasFile(out, r['window'], 'png', `${who}: ${a.names[0]!}`))}`);
    else {
      for (const row of Array.isArray(r['frames']) ? r['frames'] : []) {
        const f = row as JsonObject; const name = a.names[f['frame'] as number];
        if (name !== undefined && typeof f['pixel_hash'] === 'string') frames.set(name, `pixel_hash ${f['pixel_hash']}`);
      }
    }
  });
  return frames;
}
const failed = (why: string): never => expect.fail(why);
/** How two pictures of one window differ: how many pixels, and the first of them in rows. */
function apart(here: string, there: string, got: string, want: string): string {
  const [p, q] = [decodePng(readFileSync(join(here, `${got.slice(4)}.png`))), decodePng(readFileSync(join(there, `${want.slice(4)}.png`)))];
  if (p.width !== q.width || p.height !== q.height) return `${p.width} × ${p.height} px where the merge base has ${q.width} × ${q.height}`;
  let count = 0; let first = '';
  for (let i = 0; i < p.rgba.length; i += 4) {
    if (p.rgba[i] === q.rgba[i] && p.rgba[i + 1] === q.rgba[i + 1] && p.rgba[i + 2] === q.rgba[i + 2] && p.rgba[i + 3] === q.rgba[i + 3]) continue;
    if (count++ === 0) first = `pixel (${(i / 4) % p.width}, ${Math.floor(i / 4 / p.width)}) reads ${[...p.rgba.subarray(i, i + 4)].join(', ')} where the merge base reads ${[...q.rgba.subarray(i, i + 4)].join(', ')}`;
  }
  return count ? `${count} of ${p.width * p.height} pixels differ, the first ${first}` : 'the same pixels in other bytes';
}

describe(`${AC2} lit groups whose lights and occluders move stay as the merge base draws them`, () => {
  it(`${AC2} every frame of eight scenes of moving lights and occluders is byte-identical to the merge base's, and each planted shadow is caught in each scene`, () => {
    // The scenes hold what the README says of them, on any platform.
    expect(COUNTS, 'each scene\'s lights, occluding outlines, occluder segments and channels').toEqual([
      ['moving-walk-grid', 4, 15, 480, 2], ['moving-walk-seeded', 4, 12, 329, 2], ['moving-drift', 4, 12, 195, 24], ['moving-short-range', 4, 6, 104, 4],
      ['moving-beside', 3, 3, 40, 4], ['moving-yard', 4, 9, 86, 6], ['moving-dusk', 4, 8, 184, 5], ['moving-cap', 16, 68, 4096, 14],
    ]);
    none(STAGE.flatMap((s) => [
      ...(distinctCorners(s.rocks.flatMap((r) => r.polys)) ? [] : [`${s.id}: an outline has two corners in a row at one place`]),
      ...Object.entries(s.doc['channels'] as JsonObject).filter(([, c]) => typeof targeted(s.doc, String((c as JsonObject)['target'])) !== 'number').map(([id]) => `${s.id}: the channel ${id} targets no number of the document`),
      ...(s.windows.every((at) => at >= 0 && at < s.span) && s.windows[s.under] !== undefined ? [] : [`${s.id}: a window lies outside the span, or none is drawn under the planted programs`]),
    ]), 'each scene is a document whose channels drive it');
    requireMetal();
    let built: ReturnType<typeof base>;
    try { built = base(); } catch (e) { inconclusive(`the merge base can't be exported or built, so there is nothing to compare with: ${(e as Error).message.slice(0, 1500)}`); }
    const [here, there] = [join(dir(), 'head'), join(dir(), 'base')];
    const names = STAGE.flatMap((s) => asked(s).flatMap((a) => a.names));

    // The merge base's frames: every one a picture, and each scene's frames move.
    const want: Frames = new Map(STAGE.flatMap((s) => [...draw(built.gpu, there, `the merge base's deep-gpu on ${s.id}`, asked(s), inconclusive)]));
    const missing = names.filter((n) => !isPicture(want.get(n))).map((n) => `${n}: ${want.get(n) ?? 'nothing'}`);
    if (missing.length) inconclusive(`the merge base ${built.rev.slice(0, 12)} draws no picture of ${missing.length} of ${names.length} frames, so they can't be compared:\n  ${missing.slice(0, 20).join('\n  ')}`);
    const still = STAGE.flatMap((s) => [filmed(s).names, s.windows.flatMap((at) => windowed(s, at).names)].flatMap((of) => {
      const distinct = new Set(of.map((n) => want.get(n))).size;
      return distinct > 1 && 2 * distinct >= of.length ? [] : [`${of[0]!} and the ${of.length - 1} after it hold ${distinct} frame${distinct === 1 ? '' : 's'} at ${of.length} times`];
    }));

    // The comparison, shown failing on the wrong programs the base holds: one window of each scene under each.
    const unshown: string[] = [];
    for (const plant of PLANTS) {
      const wrong = draw(head(), here, `the checkout's deep-gpu under --planted ${plant}`, STAGE.map((s) => windowed(s, s.windows[s.under]!)), failed, plant);
      for (const s of STAGE) {
        const [name] = windowed(s, s.windows[s.under]!).names; const frame = wrong.get(name!);
        if (!isPicture(frame)) unshown.push(`${name!}, drawn under --planted ${plant}, is no picture: ${frame ?? 'nothing'}`);
        else if (frame === want.get(name!)) unshown.push(`${name!}: drawn under --planted ${plant} it is the merge base's frame, ${frame}`);
      }
    }

    // The right program's frames against the merge base's.
    const got: Frames = new Map(STAGE.flatMap((s) => [...draw(head(), here, `the checkout's deep-gpu on ${s.id}`, asked(s), failed)]));
    const off = names.filter((n) => got.get(n) !== want.get(n));
    // Of each scene: its first three differing film frames and its first two differing windows, those with their pixels.
    const differing = STAGE.flatMap((s) => {
      const mine = off.filter((n) => n.startsWith(`${s.id}: `));
      return [...mine.filter((n) => n.includes(': film ')).slice(0, 3), ...mine.filter((n) => n.includes(': window ')).slice(0, 2)].map((n) => {
        const [frame, theirs] = [got.get(n) ?? 'nothing', want.get(n)!];
        const pixels = frame.startsWith('png ') && theirs.startsWith('png ') ? ` (${apart(here, there, frame, theirs)})` : '';
        return `${n}: ${frame} where the merge base has ${theirs}${pixels}; ${mine.length} of the scene's ${asked(s).flatMap((a) => a.names).length} frames differ`;
      });
    });
    const windows = names.filter((n) => n.includes(': window ')).length;
    const byScene = STAGE.map((s) => `${s.id} ${off.filter((n) => n.startsWith(`${s.id}: `)).length}`).join(', ');
    console.log(`${AC2}: ${STAGE.length} scenes, ${names.length} frames (${names.length - windows} film frames and ${windows} windows) drawn by the checkout and by the merge base ${built.rev.slice(0, 12)}; ${off.length} differ (${byScene}). ${PLANTS.length} planted programs on ${STAGE.length} windows each: ${PLANTS.length * STAGE.length - unshown.length} caught`);
    none(unshown, 'the comparison fails on each planted program in each scene');
    none(still, 'each scene moves: of its film frames, and of its windows, more than one is a frame of its own and at least half are');
    none(differing, `${off.length} of ${names.length} frames the checkout draws other than the merge base ${built.rev.slice(0, 12)} does, the first of each scene`);
  });
});

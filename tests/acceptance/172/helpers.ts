// Test-side tools for the #172 acceptance tests (README: The surface under test): `deep-show` built per Cargo feature
// set and driven by #393's `deep-show run` scenarios, as #169's suite drives it (its builds, scenario and `deep show`
// are imported from ../169/helpers.ts, read only); the documents the criteria describe, written here so every file
// judges the same pieces; the web export's call, receipt and folder; the app's own record of a piece (deep-show's
// `logic` and `physics_bake` calls, `eval`'s arrays and paths, and deep-physics's bake of the scene for the world's
// checkpoints, as #533's, #522's and #1918's suites read them); a folder served over HTTP by a child process that logs
// every response; and Google Chrome, headless with WebGPU on, driven over its DevTools protocol by this file alone (no
// browser-automation library), reading the bundle's player through `probe()`. Nothing here stands in for the export,
// the bundle, the player or the app: every value a test compares comes from `deep-show`, `deep-physics`, the files the
// export wrote or the browser, and every expected value from the issue's text and the design.

import { spawn, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect } from 'vitest';
import {
  FLICKS, FULL, LICENSE, REPO, TIMEOUT, arr, blocked, failsNaming, filesUnder, hex64, inconclusive, int, isObject, mentions, none, obj,
  present, presented, putEvidence, referenceMacProblem, refusedUnwritten, runShow, scenarioOf, sha256, show, solidPng, str, useFileTemp,
  useShow, useTemp, type JsonObject, type JsonValue, type Size,
} from '../169/helpers.ts';
// The scenario, `deep show`, the builds and the JSON rules are #169's (its README: The surface under test).
import { entryAt, layoutFor, type Program } from '../533/helpers.ts';
// (533's entryAt is a region entry's offset in a logic item's layout; this file's input track entries are trackEntry.)
import { physics, prebuild as prebuildPhysics } from '../2009/helpers.ts';

export {
  FLICKS, FULL, REPO, TIMEOUT, arr, blocked, failsNaming, filesUnder, hex64, inconclusive, int, isObject, mentions, none, obj, present, presented,
  putEvidence, referenceMacProblem, refusedUnwritten, runShow, scenarioOf, sha256, show, str, useFileTemp, useShow, useTemp,
  physics, prebuildPhysics,
};
export type { JsonObject, JsonValue, Size };

/** cargo on PATH: the pinned toolchain's folder first when it is there (the READMEs of #169 and #2012 do the same). */
const TOOLCHAIN = join(homedir(), '.rustup', 'toolchains', '1.99.1-aarch64-apple-darwin', 'bin');
if (existsSync(TOOLCHAIN) && !(process.env['PATH'] ?? '').split(':').includes(TOOLCHAIN)) process.env['PATH'] = `${TOOLCHAIN}:${process.env['PATH'] ?? ''}`;

/** Each criterion's ID: `#172.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs). */
export const AC = {
  1: 'AC1 #172.36bfe3c1',
  2: 'AC2 #172.33b3fb42',
  3: 'AC3 #172.94f85be4',
  4: 'AC4 #172.1e1f958d',
  5: 'AC5 #172.01200175',
  6: 'AC6 #172.c41df47e',
  7: 'AC7 #172.4780d9da',
  8: 'AC8 #172.d308bc55',
  9: 'AC9 #172.811cf803',
  10: 'AC10 #172.f6838f04',
} as const;

/** The step of every piece here: 1/60 s, 11,760,000 flicks. */
export const STEP = FLICKS / 60;
/** A step's time in seconds, as a host sets `currentTime`. */
export const secondsOf = (k: number): number => k / 60;
const same = (a: JsonValue | undefined, b: JsonValue | undefined): boolean => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------------------------------
// Builds (README: Cargo features of deep-show)

/** Criterion 2's build: the full set with the test canvas module `test.native`, which no player module set holds. */
export const WEB_LACKS = 'full,test-web-lacks';

/** mulberry32: a fixed-seed generator of u32 words. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}
/** `count` distinct steps in 1 … `max`, drawn by a generator seeded with `seed`, sorted. */
export function seededSteps(seed: number, count: number, max: number): number[] {
  const next = rng(seed);
  const out = new Set<number>();
  while (out.size < count) out.add(1 + (next() % max));
  return [...out].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------------------------------
// Documents (#391's envelope as you send it). IDs are 26 Crockford characters.

const ulid = (k: number): string => `01JB172D${String(k).padStart(18, '0')}`;
export const DOC = { lab: ulid(1), stages: ulid(2), pictures: ulid(3), status: ulid(4), capture: ulid(5), strip: ulid(6), background: ulid(7), points: ulid(8), native: ulid(9), portability: ulid(10), parity: ulid(11) } as const;

type V3 = [number, number, number];
/** CC0, made at test time (an asset's license, as #169's LICENSE with its own credit). */
export const LICENSE_OF = (credit: string): JsonObject => ({ id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit });
const order = (k: number): string => `a${String(k).padStart(4, '0')}`;

/** A world document on the pinned backend (World and backend `physics.world@1`), stepping at 60 Hz. */
export function world60(parts: JsonObject): JsonObject {
  return {
    kind: 'physics.world@1', dimensions: 3, step_rate: 60, substeps: 4, gravity: [0, -9.81, 0], seed: 172, mode: 'dynamic',
    capacity: { bodies: 64, shapes: 64, joints: 64, contacts: 256, particles: 0 }, backend: { name: 'rapier3d', version: '=0.36.1' },
    ...parts,
  };
}
/** A 3D scene listing `worlds`, its items by ID (each gets its `id`, `name` and `order`), and `extra` over the envelope. */
export function sceneDoc(id: string, title: string, span: string, items: Record<string, JsonObject>, extra: JsonObject): JsonObject {
  const withIds: JsonObject = {};
  let k = 0;
  for (const [itemId, item] of Object.entries(items)) withIds[itemId] = { id: itemId, name: itemId, order: order(k++), ...item };
  return {
    format: 1, id, profile: 'scene', title, description: `${title}: a piece the #172 acceptance tests export to the web.`, size: [640, 360], camera: 'cam', seed: 172,
    transport: { span, frame_rate: [60, 1] }, ...extra, items: withIds,
  };
}
export const camera = (position: V3, target: V3): JsonObject => ({ kind: 'camera@1', params: { projection: 'perspective', position, target, fov: 40 } });
export const markBox = (size: V3, pos?: V3): JsonObject => ({ kind: 'mark.box@1', params: { size }, ...(pos ? { at: { pos } } : {}) });

// The lab (criteria 1, 2, 3, 4, 6, 7, 8 and 10): a 3D scene of 10 s at 60 steps a second (600 steps) listing the world
// `field`, a ball on turf before a goal, kicked toward the goal at (6, 3, 0.4) m/s by each entry of the press control
// `kick` (a launch derived from the control's entries, #522's form); the logic item `scorer`, which reads `kick` and
// keeps score, adding the number of kick entries each step reads to its f64 array `score`; and the readout `score_bar`,
// a bar a driver moves a quarter metre along x for each hit in `field.occurrences` (#1918's tally: at the base a motion
// driver can't read a logic array in a scene with a world, so the readout counts the world's hits; `scorer.score` is
// read through `eval`'s arrays). The world's output binds the ball's pose to the scene's ball. Its recorded input
// track: kicks at steps 30, 150, 270, 390 and 510.

export const WORLD = 'field';
export const LOGIC = 'scorer';
export const LAB_STEPS = 600;
export const KICK_STEPS = [30, 150, 270, 390, 510] as const;
/** The stable IDs of the lab's evaluated data the tests compare through `probe()` and `eval` (README: probe()): the
 * logic item's array. At the base, `eval` with a `track` replays the logic on it but not the scene's world (the ball and
 * the hit bar read their values with no kick), so the world's outputs are compared by its step and full-state hashes. */
export const LAB_ARRAYS = [`${LOGIC}.score`] as const;
export const LAB_PATHS: readonly string[] = [];
export const LAB_VALUES: readonly string[] = [...LAB_ARRAYS, ...LAB_PATHS];

/** An input track entry (Input track; #504's form): `{t: flicks, seq, control, value, writer, player}`. */
export const trackEntry = (k: number, control: string, value: JsonValue, seq = 0): JsonObject => ({ t: k * STEP, seq, control, value, writer: 'you', player: 1 });
export const labTrack = (): JsonObject[] => KICK_STEPS.map((k) => trackEntry(k, 'kick', 1));

/** A logic program's WebAssembly bytes, written in test code (Logic `logic@1`: one memory of one page whose maximum is
 * its minimum, immutable i32 globals `reads_at` 0 and `writes_at` 4096, `init(seed: i64)` doing nothing and
 * `step(k: i64)` running `step`'s instructions; no imports). */
function logicModule(step: number[]): Program {
  const uleb = (n: number): number[] => { const o: number[] = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; o.push(b); } while (n); return o; };
  const name = (s: string): number[] => [...uleb(s.length), ...Buffer.from(s, 'latin1')];
  const section = (id: number, body: number[]): number[] => [id, ...uleb(body.length), ...body];
  const vec = (items: number[][]): number[] => [...uleb(items.length), ...items.flat()];
  const body = (code: number[]): number[] => { const b = [0x00, ...code, 0x0b]; return [...uleb(b.length), ...b]; };
  const bytes = Buffer.from([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, vec([[0x60, 0x01, 0x7e, 0x00]])),
    ...section(3, vec([[0x00], [0x00]])),
    ...section(5, vec([[0x01, 0x01, 0x01]])),
    ...section(6, vec([[0x7f, 0x00, 0x41, ...sleb(0), 0x0b], [0x7f, 0x00, 0x41, ...sleb(4096), 0x0b]])),
    ...section(7, vec([[...name('memory'), 0x02, 0x00], [...name('reads_at'), 0x03, 0x00], [...name('writes_at'), 0x03, 0x01], [...name('init'), 0x00, 0x00], [...name('step'), 0x00, 0x01]])),
    ...section(10, vec([body([]), body(step)])),
  ]);
  return { name: `logic_${sha256(bytes).slice(0, 8)}`, bytes, b64: bytes.toString('base64'), sha: sha256(bytes) };
}
function sleb(n: number): number[] {
  const o: number[] = [];
  for (;;) { const b = n & 0x7f; n >>= 7; if ((n === 0 && !(b & 0x40)) || (n === -1 && (b & 0x40))) { o.push(b); return o; } o.push(b | 0x80); }
}
/** `scorer`'s program, built against the layout deep-logic's `check` reports for its reads and writes (#533's layout
 * probe): each step, score (f64) += the number of `kick` entries the step read (the u32 at the control's slot). */
let scorer: Program | undefined;
export function scorerProgram(): Program {
  if (scorer) return scorer;
  const writes = { score: { type: 'f64' as const } };
  const l = layoutFor({ program: logicModule([]), reads: ['kick'], writes }, { controls: ['kick'] });
  const kick = entryAt(l, 'reads', 'kick').offset;
  const score = 4096 + entryAt(l, 'writes', 'score').offset;
  const i32 = (n: number): number[] => [0x41, ...sleb(n)];
  // i32.const score; i32.const score; f64.load; i32.const kick; i32.load; f64.convert_i32_u; f64.add; f64.store
  scorer = logicModule([...i32(score), ...i32(score), 0x2b, 0x03, 0x00, ...i32(kick), 0x28, 0x02, 0x00, 0xb8, 0xa0, 0x39, 0x03, 0x00]);
  return scorer;
}

/** The lab, its program put in `evidence` (the scenario's store, where a document's assets are read from). */
export function labDoc(evidence: string): JsonObject {
  const program = scorerProgram();
  putEvidence(evidence, program.bytes);
  const field = world60({
    contact_materials: { turf: { friction: 0.6, restitution: 0.1, density: 1000 }, leather: { friction: 0.5, restitution: 0.4, density: 80 } },
    shapes: { floor: { kind: 'box', half: [30, 0.1, 30] }, ball: { kind: 'sphere', radius: 0.11 }, post: { kind: 'box', half: [0.06, 1.0, 0.06] }, bar: { kind: 'box', half: [0.06, 0.06, 1.56] } },
    bodies: {
      floor: { kind: 'static', shapes: [{ shape: 'floor', contact_material: 'turf' }], pose: { pos: [0, -0.1, 0] } },
      post_left: { kind: 'static', shapes: [{ shape: 'post', contact_material: 'turf' }], pose: { pos: [8, 1.0, -1.5] } },
      post_right: { kind: 'static', shapes: [{ shape: 'post', contact_material: 'turf' }], pose: { pos: [8, 1.0, 1.5] } },
      crossbar: { kind: 'static', shapes: [{ shape: 'bar', contact_material: 'turf' }], pose: { pos: [8, 2.06, 0] } },
      ball: { kind: 'dynamic', shapes: [{ shape: 'ball', contact_material: 'leather' }], pose: { pos: [0, 0.11, 0] }, mass: 0.43 },
    },
    checkpoint: { every: 60 },
    inputs: { kick: { kind: 'launch', targets: ['ball'], on: { control: 'kick', each: 'entry' }, data: { linear: [6, 3, 0.4] } } },
    outputs: { ball: { from: 'ball', read: 'pose', to: 'items/ball/at' } },
  });
  return sceneDoc(DOC.lab, 'A kicking lab', '10s', {
    cam: camera([4, 3, 12], [4, 0.5, 0]),
    ball: markBox([0.22, 0.22, 0.22]),
    goal: markBox([0.12, 2.12, 3.12], [8, 1.06, 0]),
    score_bar: markBox([0.2, 0.2, 0.2], [0, 3, 0]),
    [LOGIC]: { kind: 'logic@1', params: { program: program.sha, step_rate: 60, reads: ['kick'], writes: { score: { type: 'f64' } } } },
  }, {
    requires: { modules: { scene3d: '^1', logic: '^1' } },
    controls: { kick: { kind: 'press', class: 'document', label: 'Kick', role: 'button' } },
    worlds: { [WORLD]: field },
    drivers: { readout: { target: 'items/score_bar/at/pos/0', expr: '0.25 * count(h)', vars: { h: { list: `${WORLD}.occurrences`, kinds: ['hit'] } } } },
    assets: { scorer_program: { sha256: program.sha, license: LICENSE } },
  });
}

// The piece with stages (criteria 5 and 10): a 2D film of 16 s at 30 fps, 320 × 180, with four stage markers
// (Marker: present mode) `opening` at 0 s, `rising` at 4 s, `summit` at 8 s and `descent` at 12 s, the fourth; a dot a
// driver moves along x with time, and a slider `year` (1900 to 2100, default 2000) whose value a driver puts in the
// dot's y. No logic and no world, so its evaluated data alone says where it is.

export const STAGES = ['opening', 'rising', 'summit', 'descent'] as const;
export const STAGE_AT: Record<(typeof STAGES)[number], number> = { opening: 0, rising: 4, summit: 8, descent: 12 };
export const STAGE_PATHS = ['items/dot/at/pos/0', 'items/dot/at/pos/1', 'controls/year/value'] as const;
export const YEAR_DEFAULT = 2000;
const rect2d = (id: string, box: [number, number, number, number], role: string, k: number, extra: JsonObject = {}): JsonObject =>
  ({ id, kind: 'rect@1', name: id, order: order(k), params: { box, paint: { fill: { role } } }, at: { pos: [0, 0, 0] }, ...extra });
export function stagesDoc(): JsonObject {
  const items = [
    { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0000cam', params: { projection: 'orthographic', target: [160, 90, 0], view_width: 320 } },
    rect2d('back', [0, 0, 320, 180], 'ground', 1, { role: 'decoration' }),
    rect2d('band', [0, 120, 320, 60], 'ink', 2, { role: 'decoration' }),
    rect2d('dot', [0, 0, 12, 12], 'accent', 3, { role: 'part' }),
  ];
  const markers: JsonObject = {};
  for (const s of STAGES) markers[s] = { kind: 'stage', name: s, t: `${STAGE_AT[s]}s` };
  return {
    format: 1, id: DOC.stages, profile: 'film', title: 'A walk in four stages', description: 'A dot that walks through four stages, for the #172 link tests.',
    size: [320, 180], camera: 'cam', transport: { span: '16s', frame_rate: [30, 1] },
    items: Object.fromEntries(items.map((i) => [String(i['id']), i])),
    markers,
    controls: { year: { kind: 'slider', class: 'document', label: 'Year', role: 'slider', range: [1900, 2100], default: YEAR_DEFAULT, increment: 1 } },
    drivers: {
      walk: { target: 'items/dot/at/pos/0', expr: '10 + 18 * t', vars: { t: 'time' } },
      lift: { target: 'items/dot/at/pos/1', expr: '20 + 0.4 * (y - 1900)', vars: { y: 'controls/year/value' } },
    },
  };
}

// The pictures (criterion 9): a 2D figure, 640 × 360, holding a 2,048 × 2,048 PNG drawn in a 256 px box and 64
// thumbnails, each its own 64 × 64 PNG of another colour, drawn 32 px apart in an 8 × 8 grid.

export const BIG = 2048;
export const THUMBS = 64;
export function picturesDoc(evidence: string): { doc: JsonObject; big: string; thumbs: string[] } {
  const big = putEvidence(evidence, solidPng(BIG, BIG, [40, 90, 160]));
  const thumbs = Array.from({ length: THUMBS }, (_, i) => putEvidence(evidence, solidPng(64, 64, [(i * 37) % 256, (i * 91) % 256, (i * 151) % 256])));
  const items: JsonObject[] = [
    { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0000cam', params: { projection: 'orthographic', target: [320, 180, 0], view_width: 640 } },
    rect2d('back', [0, 0, 640, 360], 'ground', 1, { role: 'decoration' }),
    { id: 'poster', kind: 'image@1', name: 'Poster', role: 'part', order: order(2), params: { asset: big, box: [16, 16, 256, 256], fit: 'fill', alt: 'A large test picture' } },
    ...thumbs.map((sha, i) => ({ id: `thumb_${i}`, kind: 'image@1', name: `Thumbnail ${i}`, role: 'part', order: order(3 + i), params: { asset: sha, box: [300 + 32 * (i % 8), 16 + 32 * Math.floor(i / 8), 28, 28], fit: 'fill', alt: `Test thumbnail ${i}` } })),
  ];
  const assets: JsonObject = { poster: { sha256: big, license: LICENSE } };
  thumbs.forEach((t, i) => { assets[`thumb_${i}`] = { sha256: t, license: LICENSE }; });
  return {
    big, thumbs,
    doc: {
      format: 1, id: DOC.pictures, profile: 'figure', title: 'A poster and its thumbnails', description: 'One large picture and sixty-four small ones, for the #172 image tests.',
      size: [640, 360], camera: 'cam', transport: { span: '2s', frame_rate: [30, 1] }, items: Object.fromEntries(items.map((i) => [String(i['id']), i])), assets,
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// The web export (README: `export` with `video.codec: web`)

export interface WebAsk { track?: JsonObject[]; web?: JsonObject }
export const webExport = (doc: string, out: string, o: WebAsk = {}): JsonObject => ({
  call: 'export', doc, out, video: { codec: 'web', ...(o.web ? { web: o.web } : {}) }, ...(o.track ? { track: o.track } : {}),
});
export interface GpuNeeds { features: string[]; any_of: string[][]; limits: Record<string, number> }
export interface WebReceipt {
  player: { core_version: string; module_set_digest: string; hash: string };
  fallback: JsonValue; bytes: number; refused: JsonValue[]; gpu_needs: GpuNeeds; files: { path: string; sha256: string; raw: JsonObject }[]; raw: JsonObject;
}
const strings = (v: JsonValue | undefined, what: string): string[] => arr(v, what).map((x, i) => str(x, `${what}[${i}]`));
/** A delivered bundle's receipt; any other outcome fails, naming it. */
export function webReceiptOf(reply: JsonObject | undefined, what: string): WebReceipt {
  const r = obj(reply, what);
  expect(r['outcome'], `${what} is exported: ${show(r, 3000)}`).toBe('exported');
  const receipt = obj(r['receipt'], `${what}: receipt`);
  const player = obj(receipt['player'], `${what}: receipt.player`);
  const needs = obj(receipt['gpu_needs'], `${what}: receipt.gpu_needs`);
  const limits = obj(needs['limits'], `${what}: receipt.gpu_needs.limits`);
  const files = arr(receipt['files'], `${what}: receipt.files`).map((v, i) => {
    const f = obj(v, `${what}: receipt.files[${i}]`);
    return { path: str(f['path'], `${what}: receipt.files[${i}].path`), sha256: hex64(f['sha256'], `${what}: receipt.files[${i}].sha256`), raw: f };
  });
  return {
    player: { core_version: str(player['core_version'], `${what}: receipt.player.core_version`), module_set_digest: str(player['module_set_digest'], `${what}: receipt.player.module_set_digest`), hash: hex64(player['hash'], `${what}: receipt.player.hash`) },
    fallback: receipt['fallback'] ?? null, bytes: int(receipt['bytes'], `${what}: receipt.bytes`), refused: arr(receipt['refused'], `${what}: receipt.refused`),
    gpu_needs: {
      features: strings(needs['features'], `${what}: receipt.gpu_needs.features`),
      any_of: arr(needs['any_of'], `${what}: receipt.gpu_needs.any_of`).map((s, i) => strings(s, `${what}: receipt.gpu_needs.any_of[${i}]`)),
      limits: Object.fromEntries(Object.entries(limits).map(([k, v]) => [k, int(v, `${what}: receipt.gpu_needs.limits.${k}`)])),
    },
    files, raw: receipt,
  };
}
/** The bundle against its receipt: every file the receipt names is in the folder with its SHA-256, every file in the
 * folder is named, the index page is there, and the player's hash is one of the files. Each failure names the file. */
export function bundleFailures(out: string, receipt: WebReceipt, what: string): string[] {
  const f: string[] = [];
  const disk = filesUnder(out);
  const named = new Map(receipt.files.map((x) => [x.path, x.sha256]));
  for (const [path, want] of named) {
    const bytes = disk.get(path);
    if (!bytes) f.push(`${what}: ${path} is named by the receipt but not in the bundle`);
    else if (sha256(bytes) !== want) f.push(`${what}: ${path} hashes to ${sha256(bytes)}, the receipt names ${want}`);
  }
  for (const path of disk.keys()) if (!named.has(path)) f.push(`${what}: ${path} is in the bundle but the receipt doesn't name it`);
  if (!disk.has('index.html')) f.push(`${what}: the bundle has no index.html`);
  if (!receipt.files.some((x) => x.sha256 === receipt.player.hash)) f.push(`${what}: the player ${receipt.player.hash} is not one of the receipt's files`);
  return f;
}
/** The receipt's file that is logic item `item`'s rewritten program (`logic: {item, program}`, README: The receipt),
 * `program` the SHA-256 the document names. */
export function rewrittenProgram(receipt: WebReceipt, item: string, program: string, what: string): WebReceipt['files'][number] {
  const f = receipt.files.find((x) => isObject(x.raw['logic']) && x.raw['logic']['item'] === item);
  expect(f, `${what}: a file is marked logic: {item: ${item}} (the rewritten program of the document's ${program})`).toBeTruthy();
  expect(obj(f!.raw['logic'], `${what}: its logic`)['program'], `${what}: it names the document's program`).toBe(program);
  return f!;
}
/** The receipt's files that are reduced levels of an image (`level: {of: <the source's SHA-256>}`). */
export const levelsOf = (receipt: WebReceipt): WebReceipt['files'] => receipt.files.filter((x) => isObject(x.raw['level']));
/** The path of the bundle's player file (the receipt's player hash). */
export function playerPath(receipt: WebReceipt, what: string): string {
  const p = receipt.files.find((x) => x.sha256 === receipt.player.hash);
  expect(p, `${what}: the receipt's files hold the player ${receipt.player.hash}`).toBeTruthy();
  return p!.path;
}
/** Two bundles byte for byte: null when every path and every byte agree, else the first difference, naming the file
 * and, for one in both, the first byte offset that differs. Paths are compared sorted, so file-system order can't
 * enter. */
export function bundleDifference(a: string, b: string): string | null {
  const x = filesUnder(a); const y = filesUnder(b);
  const paths = [...new Set([...x.keys(), ...y.keys()])].sort();
  for (const path of paths) {
    const p = x.get(path); const q = y.get(path);
    if (!p || !q) return `${path} is only in the ${p ? 'first' : 'second'} bundle`;
    if (p.equals(q)) continue;
    const n = Math.min(p.length, q.length);
    let i = 0;
    while (i < n && p[i] === q[i]) i++;
    return `${path} differs first at byte ${i} (${p.length} and ${q.length} bytes)`;
  }
  return null;
}
/** A copy of a bundle folder to change in test code, and the copy's path. */
export function copyBundle(out: string, to: string): string {
  cpSync(out, to, { recursive: true });
  return to;
}

// ---------------------------------------------------------------------------------------------------
// The app's record of the lab (README: The app's side): deep-show's `logic` (each step's hash per logic item and its
// checkpoints with their deep hashes, #532's, #213's form), `physics_bake` (the world's step hashes and the entries it
// keeps, #522's form) and `eval` at given steps (#497's `arrays`, #1918's `paths`); and deep-physics's `bake` of the
// same scene and world on the kept entries with `checkpoints: true` (#2009's, #2010's form), whose step hashes must be
// physics_bake's, for the world's checkpoints and their deep hashes.

export interface Checkpoint { step: number; hash: string }
export interface AppRecord {
  /** The world's step hashes, index k the state after k steps (index 0 as built). */
  physics: string[];
  /** The logic item's step hashes, index k the hash after step k ran (so after k + 1 steps). */
  logic: string[];
  checkpoints: Record<string, Checkpoint[]>;
  /** Evaluated data by stable ID at each step asked. */
  values: Map<number, Record<string, JsonValue>>;
}
const evalAt = (doc: string, k: number, track: JsonObject[], arrays: readonly string[], paths: readonly string[]): JsonObject =>
  ({ call: 'eval', doc, t: k * STEP, track, ...(arrays.length ? { arrays: [...arrays] } : {}), ...(paths.length ? { paths: [...paths] } : {}) });
/** Evaluated data by stable ID from an `eval` reply: each array by name, each path by path. */
export function evaluated(reply: JsonObject | undefined, what: string): Record<string, JsonValue> {
  const r = obj(reply, what);
  expect(r['outcome'], `${what} is evaluated: ${show(r, 1500)}`).toBe('evaluated');
  return { ...(isObject(r['arrays']) ? r['arrays'] : {}), ...(isObject(r['values']) ? r['values'] : {}) };
}
/** The app's record of the lab on `track` over `steps` steps, with evaluated data at `at` (steps). One `deep-show run`
 * presents it and asks `logic`, `physics_bake` and each `eval`; then deep-physics bakes the scene's world on the
 * entries physics_bake kept. */
export function appRecord(bin: string, evidence: string, document: JsonObject, track: JsonObject[], at: readonly number[], what: string, steps = LAB_STEPS): AppRecord {
  const doc = String(document['id']);
  const calls: JsonObject[] = [present(doc, document), { call: 'logic', doc, steps, track }, { call: 'physics_bake', doc, world: WORLD, track }, ...at.map((k) => evalAt(doc, k, track, LAB_ARRAYS, LAB_PATHS))];
  const r = runShow(bin, scenarioOf({ evidence, docs: [doc], calls }), `${what}: the app`);
  presented(r[0], `${what}: the lab`);
  const logic = obj(r[1], `${what}: logic`);
  expect(logic['code'], `${what}: the logic call answers, not refuses: ${show(logic)}`).toBeUndefined();
  const rows = arr(logic['steps'], `${what}: logic.steps`).map((v, i) => obj(v, `${what}: logic.steps[${i}]`));
  expect(rows.length, `${what}: the logic replay runs ${steps} steps`).toBe(steps);
  const logicHashes = rows.map((row, i) => str(obj(row['hash'], `${what}: logic.steps[${i}].hash`)[LOGIC], `${what}: logic.steps[${i}].hash.${LOGIC}`));
  const logicCheckpoints = arr(obj(logic['checkpoints'], `${what}: logic.checkpoints`)[LOGIC], `${what}: logic.checkpoints.${LOGIC}`)
    .map((v, i) => { const c = obj(v, `${what}: logic.checkpoints.${LOGIC}[${i}]`); return { step: int(c['step'], `${what}: its step`), hash: str(c['deep_hash'], `${what}: its deep_hash`) }; });
  const baked = obj(r[2], `${what}: physics_bake`);
  expect(baked['ok'], `${what}: physics_bake answers the world's bake: ${show(baked)}`).toBe(true);
  const physicsHashes = strings(baked['step_hashes'], `${what}: physics_bake.step_hashes`);
  expect(physicsHashes.length, `${what}: the world's bake holds ${steps + 1} step hashes`).toBe(steps + 1);
  const kept = arr(baked['inputs'], `${what}: physics_bake.inputs`).map((v, i) => {
    const o = obj(v, `${what}: physics_bake.inputs[${i}]`);
    return { step: o['step'] ?? null, kind: o['kind'] ?? null, target: o['target'] ?? null, ...(o['data'] === undefined ? {} : { data: o['data'] }) } as JsonObject;
  });
  const values = new Map<number, Record<string, JsonValue>>();
  at.forEach((k, i) => values.set(k, evaluated(r[3 + i], `${what}: eval at step ${k}`)));
  const [deep] = physics([{ call: 'bake', scene: document, world: WORLD, steps, frame_rate: [60, 1], track: kept, read: [], checkpoints: true }]);
  const d = obj(deep, `${what}: deep-physics's bake of the scene`);
  expect(strings(d['step_hashes'], `${what}: deep-physics step_hashes`), `${what}: deep-physics's bake of the scene's world on the kept entries is physics_bake's, step for step`).toEqual(physicsHashes);
  const worldCheckpoints = arr(d['checkpoints'], `${what}: deep-physics checkpoints`).map((v, i) => {
    const c = obj(v, `${what}: deep-physics checkpoints[${i}]`);
    return { step: int(c['step'], `${what}: checkpoint step`), hash: str(c['deep_hash'], `${what}: checkpoint deep_hash`) };
  });
  return { physics: physicsHashes, logic: logicHashes, checkpoints: { [WORLD]: worldCheckpoints, [LOGIC]: logicCheckpoints }, values };
}
/** The app's evaluated data of a document at the steps' times (a piece without logic or worlds). */
export function appValues(bin: string, evidence: string, document: JsonObject, times: readonly number[], paths: readonly string[], what: string): Record<string, JsonValue>[] {
  const doc = String(document['id']);
  const r = runShow(bin, scenarioOf({ evidence, docs: [doc], calls: [present(doc, document), ...times.map((s) => ({ call: 'eval', doc, t: Math.round(s * FLICKS), paths: [...paths] }))] }), `${what}: the app`);
  presented(r[0], what);
  return times.map((s, i) => evaluated(r[1 + i], `${what}: eval at ${s} s`));
}

// ---------------------------------------------------------------------------------------------------
// probe() (README: probe())

export interface Probe {
  step: number; step_hash: Record<string, string | null>; checkpoint_hashes: Record<string, Checkpoint[]>; backend: string; adapter: JsonValue;
  values: Record<string, JsonValue>; raw: JsonObject;
}
export function probeOf(v: JsonValue | undefined, what: string): Probe {
  const p = obj(v, `${what}: probe()`);
  const cps = obj(p['checkpoint_hashes'], `${what}: probe().checkpoint_hashes`);
  return {
    step: int(p['step'], `${what}: probe().step`),
    step_hash: obj(p['step_hash'], `${what}: probe().step_hash`) as Record<string, string | null>,
    checkpoint_hashes: Object.fromEntries(Object.entries(cps).map(([id, list]) => [id, arr(list, `${what}: probe().checkpoint_hashes.${id}`).map((c, i) => {
      const o = obj(c, `${what}: probe().checkpoint_hashes.${id}[${i}]`);
      return { step: int(o['step'], `${what}: its step`), hash: str(o['hash'], `${what}: its hash`) };
    })])),
    backend: str(p['backend'], `${what}: probe().backend`), adapter: p['adapter'] ?? null,
    values: obj(p['values'], `${what}: probe().values`), raw: p,
  };
}
/** The player's step against the app's: its step, the world's and the logic item's step hashes, and the evaluated
 * data the app has for that step. Each failure names the step and what differs. */
export function stepFailures(where: string, p: Probe, app: AppRecord, k: number): string[] {
  const f: string[] = [];
  if (p.step !== k) return [`${where}: probe().step is ${p.step}, not ${k}`];
  if (p.step_hash[WORLD] !== app.physics[k]) f.push(`${where}: step ${k}: the world ${WORLD}'s step hash is ${String(p.step_hash[WORLD])} in the player, ${app.physics[k]} in the app`);
  if (k >= 1 && p.step_hash[LOGIC] !== app.logic[k - 1]) f.push(`${where}: step ${k}: the logic item ${LOGIC}'s step hash is ${String(p.step_hash[LOGIC])} in the player, ${app.logic[k - 1]} in the app`);
  const want = app.values.get(k);
  if (want) for (const id of LAB_VALUES) if (!same(p.values[id], want[id])) f.push(`${where}: step ${k}: ${id} is ${show(p.values[id] ?? null, 200)} in the player, ${show(want[id] ?? null, 200)} in the app`);
  return f;
}
/** Every checkpoint the app's run took at or before the player's step, with its full-state hash, against the player's. */
export function checkpointFailures(where: string, p: Probe, app: AppRecord): string[] {
  const f: string[] = [];
  for (const id of [WORLD, LOGIC]) {
    const want = (app.checkpoints[id] ?? []).filter((c) => c.step <= p.step);
    const got = (p.checkpoint_hashes[id] ?? []).filter((c) => c.step <= p.step);
    if (!want.length) f.push(`${where}: the app's run of ${id} took no checkpoint at or before step ${p.step}`);
    const byStep = new Map(got.map((c) => [c.step, c.hash]));
    for (const c of want) {
      const h = byStep.get(c.step);
      if (h === undefined) f.push(`${where}: ${id} has no checkpoint at step ${c.step} in the player (the app's full-state hash there is ${c.hash})`);
      else if (h !== c.hash) f.push(`${where}: ${id}'s full-state hash at checkpoint step ${c.step} is ${h} in the player, ${c.hash} in the app`);
    }
    for (const c of got) if (!want.some((w) => w.step === c.step)) f.push(`${where}: ${id} has a checkpoint at step ${c.step} in the player that the app's run hasn't`);
  }
  return f;
}

// ---------------------------------------------------------------------------------------------------
// A bundle served over HTTP (README: The server). A child process of its own, as #105's suite runs its listener,
// since `deep-show run` under spawnSync blocks this process's event loop. No cross-origin isolation headers. Each
// response is logged as `<status> <path> <sha256 of the body sent>`; `/.canary` answers a blank page, unlogged.

const SERVER = `
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const [root, log] = process.argv.slice(1);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' };
const s = http.createServer((q, r) => {
  const url = decodeURIComponent((q.url || '/').split('?')[0].split('#')[0]);
  if (url === '/.canary') { r.setHeader('content-type', 'text/html'); r.end('<!doctype html><title>canary</title>'); return; }
  const rel = url === '/' ? 'index.html' : url.replace(/^\\/+/, '');
  const file = path.resolve(root, rel);
  let body = null;
  if (file.startsWith(path.resolve(root) + path.sep)) { try { body = fs.readFileSync(file); } catch {} }
  if (!body) { fs.appendFileSync(log, '404 /' + rel + ' -\\n'); r.statusCode = 404; r.end(); return; }
  let type = types[path.extname(file)] || 'application/octet-stream';
  if (body.length >= 4 && body[0] === 0 && body[1] === 0x61 && body[2] === 0x73 && body[3] === 0x6d) type = 'application/wasm';
  r.setHeader('content-type', type);
  r.setHeader('cache-control', rel === 'index.html' ? 'no-cache' : 'max-age=31536000');
  fs.appendFileSync(log, '200 /' + rel + ' ' + crypto.createHash('sha256').update(body).digest('hex') + '\\n');
  r.end(body);
});
s.listen(0, '127.0.0.1', () => console.log(s.address().port));`;

export interface Served { status: number; path: string; sha: string }
export class Server {
  private child: ChildProcess | null = null;
  private dir = '';
  private log = '';
  origin = '';
  /** Serves `root`; resolves once it listens. */
  async start(root: string): Promise<string> {
    this.dir = mkdtempSync(join(tmpdir(), 'deep-172-server-'));
    this.log = join(this.dir, 'served.log');
    const child = spawn(process.execPath, ['-e', SERVER, root, this.log], { stdio: ['ignore', 'pipe', 'inherit'] });
    this.child = child;
    const port = await new Promise<number>((done, fail) => { child.stdout!.once('data', (d: Buffer) => done(Number(String(d).trim()))); child.once('error', fail); });
    this.origin = `http://127.0.0.1:${port}`;
    return this.origin;
  }
  served(): Served[] {
    if (!this.log || !existsSync(this.log)) return [];
    return readFileSync(this.log, 'utf8').split('\n').filter(Boolean).map((l) => { const [status, path, sha] = l.split(' '); return { status: Number(status), path: path!.slice(1), sha: sha! }; });
  }
  async stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    if (child?.pid && child.exitCode === null) await new Promise<void>((done) => { child.once('exit', () => done()); child.kill(); });
    if (this.dir) rmSync(this.dir, { recursive: true, force: true });
    this.dir = ''; this.log = '';
  }
}
/** Every file the page was served is a file the receipt names, with the receipt's hash, and nothing was asked that
 * the bundle lacks. Each failure names the path. */
export function servedFailures(server: Server, receipt: WebReceipt, what: string): string[] {
  const named = new Map(receipt.files.map((x) => [x.path, x.sha256]));
  const f: string[] = [];
  for (const s of server.served()) {
    if (s.path === 'favicon.ico' && s.status === 404) continue; // the browser's own request, not the page's
    if (s.status !== 200) f.push(`${what}: the page asked for ${s.path}, which the bundle doesn't hold (${s.status})`);
    else if (named.get(s.path) !== s.sha) f.push(`${what}: the page loaded ${s.path} with SHA-256 ${s.sha}, the receipt names ${named.get(s.path) ?? 'no such file'}`);
  }
  if (!server.served().some((s) => s.status === 200 && s.sha === receipt.player.hash)) f.push(`${what}: the page never loaded the player the receipt names (${receipt.player.hash})`);
  return f;
}

// ---------------------------------------------------------------------------------------------------
// Google Chrome, headless with WebGPU on (README: The browser), over its DevTools protocol in flat sessions. Chrome
// runs in a process group of its own and is stopped by that PID; its profile is a fresh folder, removed after.

export const CHROME = process.env['CHROME_BIN'] ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CHROME_ARGS = [
  '--headless=new', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--use-mock-keychain',
  '--password-store=basic', '--disable-background-networking', '--disable-component-update', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist',
  '--autoplay-policy=no-user-gesture-required',
];
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

type Message = { id?: number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: { message: string }; sessionId?: string };
class Protocol {
  private n = 0;
  private readonly pending = new Map<number, { done: (r: Record<string, unknown>) => void; fail: (e: Error) => void }>();
  private readonly listeners: { session: string; method: string; on: (p: Record<string, unknown>) => void }[] = [];
  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(String(ev.data)) as Message;
      if (m.id !== undefined) {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) p?.fail(Error(m.error.message)); else p?.done(m.result ?? {});
      } else if (m.method) for (const l of this.listeners) if (l.session === (m.sessionId ?? '') && l.method === m.method) l.on(m.params ?? {});
    });
  }
  static async connect(url: string): Promise<Protocol> {
    const ws = new WebSocket(url);
    await new Promise<void>((done, fail) => { ws.addEventListener('open', () => done()); ws.addEventListener('error', () => fail(Error(`no DevTools connection at ${url}`))); });
    return new Protocol(ws);
  }
  send(method: string, params: Record<string, unknown> = {}, session = '', timeoutMs = 60_000): Promise<Record<string, unknown>> {
    const id = ++this.n;
    return new Promise((done, fail) => {
      const timer = setTimeout(() => { this.pending.delete(id); fail(Error(`${method}: no answer within ${timeoutMs} ms`)); }, timeoutMs);
      this.pending.set(id, { done: (r) => { clearTimeout(timer); done(r); }, fail: (e) => { clearTimeout(timer); fail(e); } });
      this.ws.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
    });
  }
  on(session: string, method: string, on: (p: Record<string, unknown>) => void): void { this.listeners.push({ session, method, on }); }
  close(): void { this.ws.close(); }
}

/** A test shim adapter (README: The shim adapter): `navigator.gpu.requestAdapter` answers the real adapter behind a
 * proxy whose `features` are exactly `features` (those the real one has) and whose `limits` are WebGPU's spec defaults
 * (a default device's limits) with `over` laid on top. Every `requestDevice` descriptor is logged in
 * `window.__deep172.requests` as `{requiredFeatures, requiredLimits}` before it is passed on; a request for a feature
 * the shim doesn't offer, or past a limit it offers, is refused as an adapter refuses it. */
export interface Shim { features: string[]; over: Record<string, number> }
const shimSource = (s: Shim): string => `(() => {
  const cfg = ${JSON.stringify(s)};
  const state = { requests: [], defaults: null };
  Object.defineProperty(window, '__deep172', { value: state });
  const gpu = navigator.gpu; if (!gpu) return;
  const real = gpu.requestAdapter.bind(gpu);
  gpu.requestAdapter = async (options) => {
    // A default device from an adapter of its own (an adapter makes one device), for the spec defaults.
    const spare = await real(options); if (!spare) return spare;
    const d = await spare.requestDevice(); const defaults = {}; for (const k in d.limits) defaults[k] = d.limits[k]; d.destroy();
    state.defaults = defaults;
    const a = await real(options); if (!a) return a;
    const limits = Object.freeze(Object.assign({}, defaults, cfg.over));
    const features = new Set(cfg.features.filter((f) => a.features.has(f)));
    return new Proxy(a, { get(t, p) {
      if (p === 'limits') return limits;
      if (p === 'features') return features;
      if (p === 'requestDevice') return async (desc) => {
        const want = desc || {};
        const requiredLimits = {}; for (const k in (want.requiredLimits || {})) requiredLimits[k] = want.requiredLimits[k];
        state.requests.push({ requiredFeatures: [...(want.requiredFeatures || [])].map(String), requiredLimits });
        for (const f of want.requiredFeatures || []) if (!features.has(f)) throw new TypeError('the shim adapter offers no feature ' + f);
        for (const k in requiredLimits) if (!(k in limits) || (k.startsWith('min') ? requiredLimits[k] < limits[k] : requiredLimits[k] > limits[k])) throw new TypeError('the shim adapter offers ' + k + ' ' + limits[k] + ', not ' + requiredLimits[k]);
        return t.requestDevice(desc);
      };
      const v = Reflect.get(t, p); return typeof v === 'function' ? v.bind(t) : v;
    } });
  };
})();`;

/** One page in the browser (a target in a flat session), with what it asked the network for. */
export class Tab {
  readonly requests: string[] = [];
  readonly errors: string[] = [];
  constructor(private readonly cdp: Protocol, private readonly session: string, readonly target: string) {}
  /** A script's value in the page (its own JavaScript, as text), awaited; with `gesture`, as a user's. */
  async evaluate<T>(expression: string, timeoutMs = 60_000, gesture = false): Promise<T> {
    const r = await this.cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: gesture }, this.session, timeoutMs);
    const thrown = r['exceptionDetails'] as { text?: string; exception?: { description?: string } } | undefined;
    if (thrown) throw Error(`a script in the page threw: ${thrown.text ?? ''} ${thrown.exception?.description ?? ''}`);
    return (r['result'] as { value?: T } | undefined)?.value as T;
  }
  /** Waits until the page's player (the one `<deep-player>` of the index page) says `ready`, at most `ms`: whether it
   * did, and the notices the page shows (`[data-deep-notice]`). */
  async ready(ms = 60_000): Promise<{ ready: boolean; player: boolean; notices: string[] }> {
    const until = Date.now() + ms;
    let s = { ready: false, player: false, notices: [] as string[] };
    while (Date.now() < until) {
      s = await this.evaluate<typeof s>(`(() => { const p = document.querySelector('deep-player'); return { player: !!p, ready: !!(p && p.ready === true),
        notices: [...document.querySelectorAll('[data-deep-notice]')].map((e) => (e.textContent || '').trim()) }; })()`).catch(() => s);
      if (s.ready) return s;
      await sleep(100);
    }
    return s;
  }
  /** `ready`, or the test fails naming the notices; BLOCKED when the browser offers no WebGPU adapter here. */
  async mustBeReady(what: string, ms = 60_000): Promise<void> {
    const s = await this.ready(ms);
    if (!s.ready) {
      const gpu = await this.evaluate<string>(`(async () => !navigator.gpu ? 'no navigator.gpu' : (await navigator.gpu.requestAdapter()) ? '' : 'no adapter')()`).catch((e: Error) => e.message);
      if (gpu) blocked(`Chrome at ${CHROME} offers no WebGPU here (${gpu}); the player needs WebGPU in headless Chrome. Unblock: run on a Mac whose Chrome gives a WebGPU adapter headless`);
    }
    expect(s.ready, `${what}: the player (<deep-player>) is ready within ${ms} ms; it shows ${s.player ? 'a player' : 'no <deep-player>'}, notices ${JSON.stringify(s.notices)}, page errors ${JSON.stringify(this.errors.slice(0, 5))}`).toBe(true);
  }
  async probe(what: string): Promise<Probe> {
    return probeOf(await this.evaluate<JsonValue>(`(async () => { const v = await document.querySelector('deep-player').probe(); return JSON.parse(JSON.stringify(v)); })()`), what);
  }
  /** A host's seek (setting `currentTime` in seconds) to step k, waiting until probe() reads step k. */
  async seekStep(k: number, what: string): Promise<Probe> {
    await this.evaluate(`void (document.querySelector('deep-player').currentTime = ${secondsOf(k)})`);
    const until = Date.now() + 60_000;
    let p = await this.probe(what);
    while (p.step !== k && Date.now() < until) { await sleep(20); p = await this.probe(what); }
    expect(p.step, `${what}: a seek to ${secondsOf(k)} s lands on step ${k}`).toBe(k);
    return p;
  }
  /** play() from the start, resolving at `ended` (a user's gesture, so sound can't hold it). */
  async playToEnd(what: string, ms = 180_000): Promise<void> {
    const ended = await this.evaluate<boolean>(`new Promise((done) => { const p = document.querySelector('deep-player');
      const t = setTimeout(() => done(false), ${ms - 5_000}); p.addEventListener('ended', () => { clearTimeout(t); done(true); }, { once: true });
      p.currentTime = 0; p.play(); })`, ms, true);
    expect(ended, `${what}: the player plays to its end and fires ended`).toBe(true);
  }
  /** The device requests the shim logged, and the spec defaults it read (a default device's limits). */
  requestsLogged(): Promise<{ requests: LoggedRequest[]; defaults: Record<string, number> } | null> {
    return this.evaluate(`window.__deep172 ? { requests: window.__deep172.requests, defaults: window.__deep172.defaults || {} } : null`);
  }
  async close(): Promise<void> { await this.cdp.send('Target.closeTarget', { targetId: this.target }).catch(() => undefined); }
}

/** One browser for a test. Close it in a `finally`. */
export class Chrome {
  private constructor(private readonly chrome: ChildProcess, private readonly cdp: Protocol, private readonly profile: string) {}
  static async open(): Promise<Chrome> {
    if (!existsSync(CHROME)) blocked(`no Google Chrome at ${CHROME}; the player is played in headless Chrome with WebGPU. Unblock: install Google Chrome there or set CHROME_BIN`);
    const profile = mkdtempSync(join(tmpdir(), 'deep-172-chrome-'));
    const chrome = spawn(CHROME, [...CHROME_ARGS, `--user-data-dir=${profile}`, 'about:blank'], { detached: true, stdio: 'ignore' });
    const portFile = join(profile, 'DevToolsActivePort');
    const until = Date.now() + 60_000;
    while (!existsSync(portFile) || readFileSync(portFile, 'utf8').split('\n').length < 2) {
      if (Date.now() > until || chrome.exitCode !== null) { stop(chrome, profile); blocked(`${CHROME} opened no DevTools port within 60 s (exit ${String(chrome.exitCode)}). Unblock: run where headless Chrome starts`); }
      await sleep(100);
    }
    const [port, path] = readFileSync(portFile, 'utf8').split('\n');
    let cdp: Protocol;
    try { cdp = await Protocol.connect(`ws://127.0.0.1:${port!.trim()}${path!.trim()}`); } catch (e) { stop(chrome, profile); return blocked((e as Error).message); }
    return new Chrome(chrome, cdp, profile);
  }
  /** Opens `url` in a new page of `viewport` px (device scale 1), the shim installed first when given. */
  async open(url: string, o: { viewport?: Size; shim?: Shim } = {}): Promise<Tab> {
    const { targetId } = await this.cdp.send('Target.createTarget', { url: 'about:blank' }) as { targetId: string };
    const { sessionId } = await this.cdp.send('Target.attachToTarget', { targetId, flatten: true }) as { sessionId: string };
    const tab = new Tab(this.cdp, sessionId, targetId);
    this.cdp.on(sessionId, 'Network.requestWillBeSent', (p) => tab.requests.push(String((p['request'] as { url?: string } | undefined)?.url ?? '')));
    this.cdp.on(sessionId, 'Runtime.exceptionThrown', (p) => tab.errors.push(JSON.stringify(p['exceptionDetails'] ?? p).slice(0, 500)));
    await this.cdp.send('Network.enable', {}, sessionId);
    await this.cdp.send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);
    await this.cdp.send('Page.enable', {}, sessionId);
    await this.cdp.send('Runtime.enable', {}, sessionId);
    const [w, h] = o.viewport ?? [1280, 720];
    await this.cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }, sessionId);
    if (o.shim) await this.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: shimSource(o.shim) }, sessionId);
    await this.cdp.send('Page.navigate', { url }, sessionId).catch(() => undefined);
    return tab;
  }
  async close(): Promise<void> {
    await this.cdp.send('Browser.close', {}, '', 5_000).catch(() => undefined);
    this.cdp.close();
    stop(this.chrome, this.profile);
  }
}
function stop(chrome: ChildProcess, profile: string): void {
  if (chrome.pid && chrome.exitCode === null) { try { process.kill(-chrome.pid, 'SIGKILL'); } catch { /* already gone */ } }
  rmSync(profile, { recursive: true, force: true });
}

/** A bundle served and opened in a browser for one test: the server, the browser, and the page at `fragment`. */
export interface Played { server: Server; chrome: Chrome; tab: Tab }
export async function play(folder: string, o: { fragment?: string; viewport?: Size; shim?: Shim } = {}): Promise<Played> {
  const server = new Server();
  const origin = await server.start(folder);
  let chrome: Chrome;
  try { chrome = await Chrome.open(); } catch (e) { await server.stop(); throw e; }
  const tab = await chrome.open(`${origin}/index.html${o.fragment ?? ''}`, { ...(o.viewport ? { viewport: o.viewport } : {}), ...(o.shim ? { shim: o.shim } : {}) });
  return { server, chrome, tab };
}
export async function done(p: Played | undefined): Promise<void> {
  if (!p) return;
  await p.chrome.close();
  await p.server.stop();
}
/** Played pages left open by a test that failed, closed after the file. */
export function useBrowsers(): (p: Played) => Played {
  const open: Played[] = [];
  afterAll(async () => { for (const p of open.splice(0)) await done(p); });
  return (p) => { open.push(p); return p; };
}

// ---------------------------------------------------------------------------------------------------
// The device request against gpu_needs (criterion 8)

/** A logged device request against the receipt's `gpu_needs`: its features are every needed feature, one of each
 * `any_of` set at most, and nothing else; its limits are `gpu_needs.limits`, and any other limit it names is at
 * WebGPU's spec default (`defaults`, a default device's limits), which asks for nothing more. Each failure names the
 * feature or the limit, with both values. */
export function requestFailures(req: LoggedRequest, needs: GpuNeeds, defaults: Record<string, number>, what: string): string[] {
  const f: string[] = [];
  const asked = new Set(req.requiredFeatures);
  for (const x of needs.features) if (!asked.has(x)) f.push(`${what}: the device request leaves out the needed feature ${x}`);
  const optional = new Set(needs.any_of.flat());
  for (const x of asked) if (!needs.features.includes(x) && !optional.has(x)) f.push(`${what}: the device request asks for the feature ${x}, which gpu_needs doesn't list`);
  for (const set of needs.any_of) if (set.filter((x) => asked.has(x)).length > 1) f.push(`${what}: the device request asks for more than one of ${set.join(', ')}`);
  for (const [k, v] of Object.entries(req.requiredLimits)) {
    const want = needs.limits[k] ?? defaults[k];
    if (v !== want) f.push(`${what}: the device request asks for ${k} ${v}, gpu_needs lists ${needs.limits[k] ?? `none (the spec default is ${String(defaults[k])})`}`);
  }
  for (const [k, v] of Object.entries(needs.limits)) if (!(k in req.requiredLimits) && v !== defaults[k]) f.push(`${what}: the device request leaves out ${k} ${v}, which gpu_needs lists`);
  return f;
}
export interface LoggedRequest { requiredFeatures: string[]; requiredLimits: Record<string, number> }
/** The shim of spec-default limits with exactly the lab's features: `gpu_needs.features` and the first of each `any_of`
 * set. */
export const needsShim = (needs: GpuNeeds, over: Record<string, number> = {}): Shim => ({ features: [...needs.features, ...needs.any_of.map((s) => s[0]!).filter(Boolean)], over });

// ---------------------------------------------------------------------------------------------------
// WebAssembly read in test code (criterion 3): whether a module declares shared memory, from its own sections.

function leb(b: Buffer, at: number): [number, number] {
  let v = 0; let shift = 0; let i = at;
  for (;;) { const x = b[i++]!; v += (x & 0x7f) * 2 ** shift; shift += 7; if (!(x & 0x80)) return [v, i]; }
}
/** Each memory a WebAssembly module defines or imports, and whether its limits say shared (flag bit 1). */
export function wasmMemories(b: Buffer): { where: 'import' | 'defined'; shared: boolean }[] {
  const out: { where: 'import' | 'defined'; shared: boolean }[] = [];
  let i = 8;
  const limits = (at: number): [boolean, number] => {
    const flags = b[at]!; let j = at + 1;
    [, j] = leb(b, j);
    if (flags & 1) [, j] = leb(b, j);
    return [(flags & 2) !== 0, j];
  };
  while (i < b.length) {
    const id = b[i]!;
    const [size, body] = leb(b, i + 1);
    const end = body + size;
    if (id === 2) {
      let [n, j] = leb(b, body);
      for (; n > 0; n--) {
        let len: number;
        [len, j] = leb(b, j); j += len;
        [len, j] = leb(b, j); j += len;
        const kind = b[j++]!;
        if (kind === 0) [, j] = leb(b, j);
        else if (kind === 1) { j += 1; [, j] = limits(j); }
        else if (kind === 2) { const [shared, k] = limits(j); out.push({ where: 'import', shared }); j = k; }
        else if (kind === 3) j += 2;
        else if (kind === 4) { j += 1; [, j] = leb(b, j); }
        else break;
      }
    } else if (id === 5) {
      let [n, j] = leb(b, body);
      for (; n > 0; n--) { const [shared, k] = limits(j); out.push({ where: 'defined', shared }); j = k; }
    }
    i = end;
  }
  return out;
}
export const isWasm = (b: Buffer): boolean => b.length >= 8 && b.readUInt32BE(0) === 0x0061736d;

// ---------------------------------------------------------------------------------------------------
// Timings (criteria 4 and 9): the repo's perf rule, as #169's budgets judge it.

interface Benchmark {
  validateBudgets(current: unknown, base: unknown): void;
  fingerprint(): Record<string, unknown>;
  judgeLimit(input: { limit: number; runs: number[]; fingerprint: Record<string, unknown>; loads: { start: number; end: number }[] }): { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'BLOCKED'; reason?: string };
}
export const benchmark = (): Promise<Benchmark> => import(join(REPO, 'scripts', 'benchmark.mjs')) as Promise<Benchmark>;
/** Five runs judged against a limit by the repo's `judgeLimit`: FAIL fails, anything but PASS is INCONCLUSIVE. */
export async function judged(id: string, what: string, limit: number, runs: number[], loads: { start: number; end: number }[], unit: string): Promise<void> {
  const { fingerprint, judgeLimit } = await benchmark();
  const machine = fingerprint();
  const result = judgeLimit({ limit, runs, fingerprint: machine, loads });
  const reading = `${what}: ${runs.map((x) => x.toFixed(3)).join(', ')} ${unit} against ${limit} ${unit} on ${String(machine['model'])}: ${result.status}${result.reason ? ` (${result.reason})` : ''}`;
  console.log(`${id} ${reading}`);
  expect(result.status, reading).not.toBe('FAIL');
  if (result.status !== 'PASS') inconclusive(reading);
}

// ---------------------------------------------------------------------------------------------------
// A lab exported in one run, kept for the file (several tests of a file read one bundle).

export interface Exported { out: string; receipt: WebReceipt; replies: JsonObject[] }
/** One `deep-show run`: the document shown, then its web export into a fresh folder (`planted` the scenario's key). */
export function exportOnce(bin: string, evidence: string, document: JsonObject, out: string, what: string, o: { track?: JsonObject[]; planted?: string; agent?: boolean; scenario?: JsonObject } = {}): JsonObject {
  const doc = String(document['id']);
  const sc = { ...scenarioOf({ evidence, docs: [doc], calls: [present(doc, document, { agent: o.agent ?? false }), webExport(doc, out, o.track ? { track: o.track } : {})], ...(o.planted ? { planted: o.planted } : {}) }), ...(o.scenario ?? {}) };
  const r = runShow(bin, sc, what);
  presented(r[0], what);
  return r[1]!;
}
export function exportLab(bin: string, evidence: string, out: string, what: string, planted?: string): Exported {
  const reply = exportOnce(bin, evidence, labDoc(evidence), out, what, { track: labTrack(), ...(planted ? { planted } : {}) });
  const receipt = webReceiptOf(reply, what);
  return { out, receipt, replies: [reply] };
}
/** The bundle's file at `path` read whole. */
export const readBundle = (out: string, path: string): Buffer => readFileSync(join(out, path));

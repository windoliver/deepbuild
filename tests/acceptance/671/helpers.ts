// Test-side tools for the #671 acceptance tests: the merged `deep-show` (#393, with #96's shared documents) and
// `deep-gpu` (#377, with #378's `view3d`) binaries, built once per file and driven by JSON lines; the world the
// two test agents send their documents in (sessions, the process table, the panel, the minted document); the
// hub's current revision read back and handed to the GPU layer's view; the view3d reply with the `clicks` this
// suite adds; PNG reading and writing; the object-ID target; the checks each criterion makes, each returning its
// failures as sentences that name what failed; and the proof kept for the issue's Proof line. Nothing here stands
// in for deep show, the hub, the GPU layer, scene3d, the render worker, the compositor or the blank guard.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/671 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const GPU_BIN = 'deep-gpu';
export const SHOW_BIN = 'deep-show';
type BinName = typeof GPU_BIN | typeof SHOW_BIN;
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);

/**
 * Where the proof is kept (the issue's Proof line: the snapshots with their hashes, the noop lane's encode
 * counts, the pick results and the per-frame label capture). Each test rewrites its own files there; nothing
 * reads them back.
 */
export const PROOF_DIR = join(tmpdir(), 'deep-671-proof');

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonValue[];
}
export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${JSON.stringify(value)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe('string');
  return value as string;
}
export function strs(value: JsonValue | undefined, what: string): string[] {
  return arr(value, what).map((v, i) => str(v, `${what}[${i}]`));
}
export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
export const SHA = /^[0-9a-f]{64}$/;
export const clone = <T extends JsonValue>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function fixture(name: string): JsonObject {
  const value = JSON.parse(readFileSync(join(HERE, 'fixtures', name), 'utf8')) as JsonValue;
  if (!isObject(value)) throw Error(`fixture ${name} is not a JSON object`);
  return value;
}

/** Every JSON number anywhere in a value, by path (the blank guard's BLOCKED reply holds none). */
export function numbersIn(value: JsonValue | undefined, path = ''): string[] {
  if (typeof value === 'number') return [path || '(the value)'];
  if (Array.isArray(value)) return value.flatMap((v, i) => numbersIn(v, `${path}[${i}]`));
  if (isObject(value)) return Object.entries(value).flatMap(([k, v]) => numbersIn(v, path ? `${path}.${k}` : k));
  return [];
}

// ---------------------------------------------------------------------------------------------------
// Builds: each binary built once per file with `cargo build --locked --bin <name>`, copied out of
// target/debug under its own name, as #377's and #378's suites do; a test that uses a build that failed fails.

function cargoBuild(name: BinName): string {
  const args = ['build', '--locked', '--bin', name];
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}

export interface Bins { bin: (name: BinName) => string }

export function useBins(names: readonly BinName[]): Bins {
  let dir = '';
  const made = new Map<BinName, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-671-bins-'));
    for (const name of names) {
      const error = cargoBuild(name);
      const bin = join(dir, exe(name));
      if (error === '') copyFileSync(join(REPO, 'target', 'debug', exe(name)), bin);
      made.set(name, { bin, error });
    }
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return {
    bin(name: BinName): string {
      const entry = made.get(name);
      if (!entry) throw Error(`the file didn't list ${name} in useBins`);
      expect(entry.error, `the binary builds: cargo build --locked --bin ${name}`).toBe('');
      return entry.bin;
    },
  };
}

/** A fresh folder per test (the evidence store, the hub's document, targets, captures), deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-671-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

export interface Started { status: number | null; signal: string | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string }

export function start(bin: string, args: string[], inputs: (JsonValue | string)[], timeoutMs = 1_800_000): Started {
  const text = inputs.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join('\n');
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const run = spawnSync(bin, args, { cwd: REPO, input: inputs.length ? `${text}\n` : '', encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${bin} ${args.join(' ')}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  const lines = stdout.split('\n').filter((line) => line !== '').map((line) => {
    try { return JSON.parse(line) as JsonValue; } catch { return line; }
  });
  return { status: run.status, signal: run.signal, timedOut, lines, stdout, stderr: run.stderr ?? '' };
}

/** Fails with an INCONCLUSIVE message off macOS: these pixels come from the GPU on the reference platform. */
export function requireGpu(): void {
  expect(process.platform, 'INCONCLUSIVE: the GPU layer and 3D render-back draw these pixels on macOS\'s Metal device, the reference platform; this is not a pass').toBe('darwin');
}

// ---------------------------------------------------------------------------------------------------
// The world (README: The surface under test): two test agents, the processes their `deep show` runs in,
// the panel, and the document the hub minted for the scene.

/** The agent whose test process sends the scene: 200 boxes on a ground plane under an orbiting camera. */
export const SCENE_AGENT = { id: 'sess-scene', thread: 'thread-scene', name: 'Test agent: 3D scene', process: { pid: 4100, start: 1_000 } } as const;
/** The agent whose test process sends the 2D label, in a writer layer of its own. */
export const LABEL_AGENT = { id: 'sess-label', thread: 'thread-label', name: 'Test agent: 2D label', process: { pid: 5100, start: 2_000 } } as const;

/** The OS process table the peer check reads: each test process runs `deep show` inside its agent's tree. */
export const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 },
  { pid: 3001, ppid: 1, start: 110 }, // your shell
  { pid: 4100, ppid: 3001, start: 1_000 }, // the scene's agent
  { pid: 4101, ppid: 4100, start: 1_100 }, // its tool shell
  { pid: 4102, ppid: 4101, start: 1_200 }, // the test process that sends the scene with `deep show`
  { pid: 5100, ppid: 3001, start: 2_000 }, // the label's agent
  { pid: 5101, ppid: 5100, start: 2_100 }, // its tool shell
  { pid: 5102, ppid: 5101, start: 2_200 }, // the test process that sends the label with `deep show`
];
export const IN_SCENE_AGENT: JsonObject = { pid: 4102, start: 1_200 };
export const IN_LABEL_AGENT: JsonObject = { pid: 5102, start: 2_200 };

/** A writer as #96's README writes a layer's `writer` field: `<kind>:<id>`. */
export const writerText = (agent: { thread: string }): string => `agent:${agent.thread}`;

/** The document the hub minted for the scene, and the panel it draws on. */
export const DOC = '01JB7D00000000000000000671';
export const PANELS: JsonObject = { main: { rect: [0, 0, 800, 600] } };

/** The scene as its agent sends it (no `id`, no `layers`, no item `layer`). */
export const SCENE = fixture('scene.json');
/** The 2D label as its agent sends it: a frame holding a tag and a pin, and an overlay anchored to a box. */
export const LABEL = fixture('label.json');
/** The look the GPU layer's view draws with (fixtures/look.json): the clean look's four roles as flat, measurable colors. */
export const LOOK = fixture('look.json');

/** The shared envelope both agents send; the hub minted the document with it, and no layer or item (#96's `docs[…].document`). */
export function minted(): JsonObject {
  const { items: _items, channels: _channels, ...envelope } = clone(SCENE);
  return { ...envelope, layers: {}, items: {} };
}

export const SIZE: [number, number] = [640, 480];
export const FPS = 60;
/** The orbit: one turn in 5 s, frames 0 … 299 at 60 fps; the camera holds still from frame 300 (5 s). */
export const ORBIT_FRAMES = 300;
/** The checkpoint's run: the orbit, then the camera still to 5.5 s, with one box moved before frame 310. */
export const RUN_FRAMES = 330;
export const MOVE_FRAME = 310;
/** The box at the orbit's target, [0, 0.5, 0]: it projects to the view's centre at every azimuth. */
export const CENTER_BOX = 'box-10-05';
/** The box the 2D label is anchored to, 1.5 m above its centre. */
export const LABELED_BOX = 'box-02-01';
/** The 3D point mark at the label's anchor ([-12, 2, -6]), drawn in the 3D writer layer so the anchor can be measured. */
export const BEACON = 'beacon';
/** The box one patch moves 0.6 m along +x before frame 310. */
export const MOVED_BOX = 'box-17-08';
export const MOVED_TO: [number, number, number] = [11.1, 0.5, 4.5];
/** The window the view sits in, its page a flat dark grey, as #378's anchor test sets it. */
export const WINDOW = { size: [SIZE[0] + 80, SIZE[1] + 80] as [number, number], view: [40, 40] as [number, number], page: [32, 32, 32] as [number, number, number] };

/** The scene's items of a 3D kind (camera@1 and mark.*), which its writer layer holds. */
export const is3dKind = (kind: string): boolean => kind === 'camera@1' || kind.startsWith('mark.');
/** The scene's drawn 3D items: every mark (the ground plane, the 200 boxes, the beacon). */
export function drawn3d(): string[] {
  return Object.entries(obj(SCENE['items'], 'the scene\'s items')).filter(([, v]) => String((v as JsonObject)['kind']).startsWith('mark.')).map(([id]) => id).sort();
}
export function boxIds(): string[] {
  return Object.keys(obj(SCENE['items'], 'the scene\'s items')).filter((id) => /^box-\d\d-\d\d$/.test(id)).sort();
}

/** `deep show` from a test process, at `t`, of `size` px, with or without a snapshot. */
export function show(peer: JsonObject, document: JsonObject, pixels: boolean, t = '0s'): JsonObject {
  return { call: 'deep show', peer, doc: DOC, document, t, size: SIZE, include: pixels ? ['issues', 'pixels'] : ['issues'] };
}
export const SCREEN: JsonObject = { call: 'screen' };
export const READ: JsonObject = { call: 'read', doc: DOC };

export function scenario(evidence: string, calls: JsonObject[]): JsonObject {
  const session = (a: typeof SCENE_AGENT | typeof LABEL_AGENT): JsonObject => ({ thread: a.thread, name: a.name, process: { ...a.process } });
  return {
    evidence,
    sessions: { [SCENE_AGENT.id]: session(SCENE_AGENT), [LABEL_AGENT.id]: session(LABEL_AGENT) },
    processes: PROCESSES,
    panels: PANELS,
    docs: { [DOC]: { panel: 'main', document: minted() } },
    calls,
  };
}

/** The checkpoint's calls: the scene (with a snapshot at 0 s when asked), then the label, the screen and the hub's current revision. */
export const checkpointCalls = (pixels: boolean): JsonObject[] => [show(IN_SCENE_AGENT, SCENE, pixels), show(IN_LABEL_AGENT, LABEL, false), SCREEN, READ];

/** One `deep-show run` process, one scenario per stdin line; each line's replies. */
export function showLines(bin: string, scenarios: JsonObject[]): JsonObject[][] {
  const s = start(bin, ['run'], scenarios, 600_000);
  const name = `${SHOW_BIN} run`;
  expect(s.timedOut, `${name} finished within its timeout`).toBe(false);
  expect(s.status, `${name} exited 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-3000)}`).toBe(0);
  expect(s.lines.length, `${name}: one output line per input line`).toBe(scenarios.length);
  return s.lines.map((line, i) => {
    const out = obj(line, `${name}: answer ${i + 1}`);
    expect(out['ok'], `${name} refused scenario ${i + 1}: ${JSON.stringify(out).slice(0, 2000)}`).toBe(true);
    const replies = arr(out['replies'], `${name}: answer ${i + 1}'s replies`).map((r, j) => obj(r, `replies[${j}]`));
    expect(replies.length, `${name}: one reply per call`).toBe(arr(scenarios[i]!['calls'], 'the scenario\'s calls').length);
    return replies;
  });
}

export interface Issue { code: string; severity: string; ids: string[]; path?: string }
export function issues(reply: JsonObject, what: string): Issue[] {
  return arr(reply['issues'] ?? null, `${what}: issues`).map((v, i) => {
    const o = obj(v, `${what}: issues[${i}]`);
    return { code: str(o['code'], `${what}: issues[${i}].code`), severity: str(o['severity'], `${what}: issues[${i}].severity`), ids: strs(o['ids'], `${what}: issues[${i}].ids`), ...(typeof o['path'] === 'string' ? { path: o['path'] } : {}) };
  });
}

/** A `deep show` reply presented with no issue of any severity; INCONCLUSIVE when the platform can't draw it. */
export function expectPresentedClean(reply: JsonObject, what: string): void {
  const list = arr(reply['issues'] ?? [], `${what}: issues`);
  if (JSON.stringify(list).includes('"unsupported_platform"')) expect.fail(`INCONCLUSIVE: ${what} reports unsupported_platform; this is not a pass`);
  expect(list, `${what} raises no issue of any severity: ${JSON.stringify(list).slice(0, 1500)}`).toEqual([]);
  expect(reply['outcome'], `${what} is presented: ${JSON.stringify(reply).slice(0, 1500)}`).toBe('presented');
}

export interface Snapshot { sha256: string; w: number; h: number }
export function snapshots(reply: JsonObject, what: string): Snapshot[] {
  return arr(reply['snapshots'] ?? [], `${what}: snapshots`).map((v, i) => {
    const o = obj(v, `${what}: snapshots[${i}]`);
    return { sha256: str(o['sha256'], `${what}: snapshots[${i}].sha256`), w: num(o['w'], 'w'), h: num(o['h'], 'h') };
  });
}

/** The bytes of one piece of evidence, read by its hash through the evidence store's public entry. */
export async function readEvidence(root: string, hash: string): Promise<Buffer> {
  const store = await openEvidenceStore({ root });
  return Buffer.from(await store.read(hash));
}

export interface Band { layer: string; owner: JsonObject; band: string }
export function bands(reply: JsonObject): Band[] {
  return arr(reply['bands'], 'screen: bands').map((v, i) => {
    const o = obj(v, `screen: bands[${i}]`);
    return { layer: str(o['layer'], `screen: bands[${i}].layer`), owner: isObject(o['owner']) ? o['owner'] : {}, band: str(o['band'], `screen: bands[${i}].band`) };
  });
}

/** The hub's current revision as `read` gives it (#96): the stored document, with its layers and every item's layer. */
export function readDocument(reply: JsonObject): JsonObject {
  return obj(reply['document'], `read: the document (${JSON.stringify(reply).slice(0, 600)})`);
}

/** The layer holding each listed item in the hub's document, and that layer's writer; each problem names the item. */
export function layerOf(doc: JsonObject, id: string): { layer: string | null; writer: string | null } {
  const items = isObject(doc['items']) ? doc['items'] : {};
  const item = items[id];
  const layer = isObject(item) && typeof item['layer'] === 'string' ? item['layer'] : null;
  const layers = isObject(doc['layers']) ? doc['layers'] : {};
  const entry = layer ? layers[layer] : undefined;
  const writer = isObject(entry) && typeof entry['writer'] === 'string' ? entry['writer'] : null;
  return { layer, writer };
}

/**
 * Sends the scene and the label through `deep show`, as the two test agents, and returns the hub's current
 * revision (the document the GPU layer's view draws), written to `out` as the view3d call takes it.
 */
export function viaDeepShow(showBin: string, out: string, what: string): { doc: JsonObject; path: string; sceneWriter: string } {
  const evidence = join(out, 'evidence');
  mkdirSync(evidence, { recursive: true });
  const [replies] = showLines(showBin, [scenario(evidence, checkpointCalls(false))]) as [JsonObject[]];
  const [scene, label, , read] = replies as [JsonObject, JsonObject, JsonObject, JsonObject];
  expectPresentedClean(scene, `${what}: the scene's deep show`);
  expectPresentedClean(label, `${what}: the label's deep show`);
  const doc = readDocument(read);
  const sceneWriter = writerText(SCENE_AGENT);
  expect(layerOf(doc, CENTER_BOX).writer, `${what}: the hub holds the scene in its agent's writer layer`).toBe(sceneWriter);
  const path = join(out, 'hub-document.json');
  writeFileSync(path, JSON.stringify(doc));
  return { doc, path, sceneWriter };
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--backend noop] [--planted <name>]` (#377) and its `view3d` call (#378), with the `clicks`
// this suite adds (README: The surface under test).

export interface Startup { backend?: 'noop'; planted?: 'encodes_every_frame' }
export const startArgs = (s: Startup = {}): string[] =>
  ['run', ...(s.backend ? ['--backend', s.backend] : []), ...(s.planted ? ['--planted', s.planted] : [])];

/** One scenario, accepted, with one reply per call. */
export function runGpu(bin: string, out: string, calls: JsonObject[], startup: Startup = {}): JsonObject[] {
  const args = startArgs(startup);
  const s = start(bin, args, [{ out, calls }]);
  const shown = `${GPU_BIN} ${args.join(' ')}`;
  expect(s.timedOut, `${shown} finished within its timeout`).toBe(false);
  expect(s.status, `${shown} exited 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-3000)}`).toBe(0);
  expect(s.lines.length, `${shown}: one output line per input line`).toBe(1);
  const answer = obj(s.lines[0], `${shown}: the answer`);
  expect(answer['ok'], `${shown} refused the scenario: ${JSON.stringify(answer).slice(0, 2000)}`).toBe(true);
  const replies = arr(answer['replies'], 'run: replies').map((r, i) => obj(r, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(calls.length);
  return replies;
}

export interface Click { frame: number; at: [number, number] }
export interface View3Call {
  doc: string; look: JsonObject; size: [number, number];
  frames?: number; fps?: number;
  patches?: { frame: number; writer: string; ops: JsonObject[] }[];
  targets?: ('final' | 'linear' | 'ids')[];
  capture?: 'every' | number[];
  window?: { size: [number, number]; view: [number, number]; page: [number, number, number] };
  counts?: boolean;
  clicks?: Click[];
}
export const view3d = (c: View3Call): JsonObject => ({ call: 'view3d', ...(c as unknown as JsonObject) });

/** The move: the scene's agent sets the moved box's position before frame 310. */
export const movePatch = (writer: string): { frame: number; writer: string; ops: JsonObject[] } =>
  ({ frame: MOVE_FRAME, writer, ops: [{ op: 'set', id: MOVED_BOX, path: `items/${MOVED_BOX}/at/pos`, value: MOVED_TO }] });

export interface Batch { batch: string; items: string[] }
export interface Picked { at: [number, number]; pick: string | null }
export interface Frame3 {
  frame: number; frame_seq: number; pixel_hash: string | null;
  ids: string | null; picks: Map<number, string> | null; window: string | null;
  encoded: Batch[] | null; replayed: number | null; instances_written: number | null;
  clicks: Picked[] | null;
}
export interface View3 { frames: Frame3[]; raw: JsonObject }

const optStr = (v: JsonValue | undefined, what: string): string | null => (v === undefined || v === null ? null : str(v, what));
const optNum = (v: JsonValue | undefined, what: string): number | null => (v === undefined || v === null ? null : num(v, what));

/** A view3d reply; INCONCLUSIVE when the binary says the platform can't draw it. */
export function view3Reply(reply: JsonObject, what: string): View3 {
  if (reply['code'] === 'unsupported_platform') expect.fail(`INCONCLUSIVE: ${what} reports unsupported_platform; this is not a pass`);
  expect(reply['code'], `${what} was answered, not refused: ${JSON.stringify(reply).slice(0, 1500)}`).toBeUndefined();
  const frames = arr(reply['frames'], `${what}: frames`).map((v, i): Frame3 => {
    const f = obj(v, `${what}: frames[${i}]`);
    const at = `${what}: frames[${i}]`;
    const pixel = optStr(f['pixel_hash'], `${at}.pixel_hash`);
    if (pixel !== null) expect(pixel, `${at}.pixel_hash is a SHA-256 in lowercase hex`).toMatch(SHA);
    let picks: Map<number, string> | null = null;
    if (f['picks'] !== undefined && f['picks'] !== null) {
      picks = new Map(Object.entries(obj(f['picks'], `${at}.picks`)).map(([k, id]) => {
        expect(k, `${at}.picks keys are pick IDs in decimal`).toMatch(/^[1-9][0-9]*$/);
        return [Number(k), str(id, `${at}.picks[${k}]`)];
      }));
    }
    const encoded = f['encoded'] === undefined ? null : arr(f['encoded'], `${at}.encoded`).map((b, j): Batch => {
      const o = obj(b, `${at}.encoded[${j}]`);
      return { batch: str(o['batch'], `${at}.encoded[${j}].batch`), items: strs(o['items'], `${at}.encoded[${j}].items`) };
    });
    const clicks = f['clicks'] === undefined ? null : arr(f['clicks'], `${at}.clicks`).map((c, j): Picked => {
      const o = obj(c, `${at}.clicks[${j}]`);
      const xy = arr(o['at'], `${at}.clicks[${j}].at`).map((n) => num(n, `${at}.clicks[${j}].at`));
      expect(Object.hasOwn(o, 'pick'), `${at}.clicks[${j}] carries its pick (an item ID or null)`).toBe(true);
      return { at: [xy[0]!, xy[1]!], pick: o['pick'] === null ? null : str(o['pick'], `${at}.clicks[${j}].pick`) };
    });
    return {
      frame: num(f['frame'], `${at}.frame`), frame_seq: num(f['frame_seq'], `${at}.frame_seq`), pixel_hash: pixel,
      ids: optStr(f['ids'], `${at}.ids`), picks, window: optStr(f['window'], `${at}.window`), encoded,
      replayed: optNum(f['replayed'], `${at}.replayed`), instances_written: optNum(f['instances_written'], `${at}.instances_written`), clicks,
    };
  });
  return { frames, raw: reply };
}

/** A reply that latched every frame 0 … count − 1 once, in order. */
export function everyFrame(v: View3, count: number, what: string): void {
  expect(v.frames.map((f) => f.frame), `${what}: every frame from 0 to ${count - 1} presented once, in order`).toEqual(Array.from({ length: count }, (_, i) => i));
}

export function frameAt(v: View3, n: number, what: string): Frame3 {
  const f = v.frames.find((x) => x.frame === n);
  expect(f, `${what}: frame ${n} is in the reply`).toBeDefined();
  return f!;
}

/**
 * Criterion 2's count, on the run's frames: frame 0 encodes each batch once (no batch name twice) and its
 * batches hold every drawn 3D item of the scene; no later frame encodes any batch, the move's frame included;
 * the move's frame writes at least one instance record (the move reached the GPU layer). Each problem names its
 * frame and every batch it encoded.
 */
export function encodeProblems(frames: Frame3[], drawn: string[], what: string): string[] {
  const problems: string[] = [];
  const first = frames[0];
  if (!first || first.frame !== 0) return [`${what}: frame 0 is missing`];
  if (first.encoded === null) return [`${what}: frame 0 carries no encode counts`];
  const names = first.encoded.map((b) => b.batch);
  const twice = names.filter((n, i) => names.indexOf(n) !== i);
  if (twice.length) problems.push(`${what}: frame 0 encodes batch ${[...new Set(twice)].join(', ')} more than once`);
  const inBatches = new Set(first.encoded.flatMap((b) => b.items));
  const missing = drawn.filter((id) => !inBatches.has(id));
  if (missing.length) problems.push(`${what}: frame 0's batches leave out ${missing.length} drawn items (${missing.slice(0, 5).join(', ')})`);
  for (const f of frames.slice(1)) {
    if (f.encoded === null) { problems.push(`${what}: frame ${f.frame} carries no encode counts`); continue; }
    for (const b of f.encoded) {
      const when = f.frame === MOVE_FRAME ? ', after the move' : f.frame < ORBIT_FRAMES ? ', during the orbit' : '';
      problems.push(`${what}: frame ${f.frame} encodes batch ${b.batch} again${when} (${b.items.length} items: ${b.items.slice(0, 3).join(', ')}${b.items.length > 3 ? ', …' : ''})`);
    }
  }
  const moved = frames.find((f) => f.frame === MOVE_FRAME);
  if (!moved) problems.push(`${what}: frame ${MOVE_FRAME}, the move's, is missing`);
  else if (moved.instances_written === null || moved.instances_written < 1) problems.push(`${what}: frame ${MOVE_FRAME} writes ${moved.instances_written ?? 'no'} instance records: the move of ${MOVED_BOX} didn't reach the GPU layer`);
  return problems;
}

// ---------------------------------------------------------------------------------------------------
// PNGs: reading targets and captures the binaries wrote, and writing the blank twin.

export interface Image { width: number; height: number; /** RGBA, row-major. */ rgba: Uint8Array }

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Reads an 8-bit RGB or RGBA PNG with no interlace; `channels` is the file's own (3 or 4). */
export function decodePng(file: Buffer): Image & { channels: number } {
  if (!file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('not a PNG');
  let at = 8;
  let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (at < file.length) {
    const length = file.readUInt32BE(at);
    const type = file.toString('latin1', at + 4, at + 8);
    const body = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!;
    } else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) throw Error(`PNG is depth ${depth}, color type ${color}, interlace ${interlace}; the reader takes 8-bit RGB/RGBA, no interlace`);
  const channels = color === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels]! : 0;
      const b = previous[i]!;
      const c = i >= channels ? previous[i - channels]! : 0;
      const x = line[i]!;
      let v: number;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: v = x + paeth(a, b, c); break;
        default: throw Error(`PNG filter ${filter}`);
      }
      line[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      rgba[o] = line[x * channels]!; rgba[o + 1] = line[x * channels + 1]!; rgba[o + 2] = line[x * channels + 2]!;
      rgba[o + 3] = channels === 4 ? line[x * channels + 3]! : 255;
    }
    previous = line;
  }
  return { width, height, rgba, channels };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(4); head.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), body]);
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(typed));
  return Buffer.concat([head, typed, tail]);
}

/** An 8-bit RGBA PNG of an image. */
export function encodePng(image: Image): Buffer {
  const { width, height, rgba } = image;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (1 + width * 4) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** The SHA-256 of an image's pixels as 8-bit RGBA, rows top-down, no padding: its pixel hash. */
export const pixelHash = (image: Image): string => sha256(image.rgba);

function readNamed(out: string, hash: string | null, ext: string, what: string): Buffer {
  expect(hash, `${what} is written`).not.toBeNull();
  expect(hash, `${what} is named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${hash}.${ext}`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(hash);
  return file;
}

/** An 8-bit PNG the GPU layer wrote (`window`, `ids`). */
export function readPng(out: string, hash: string | null, what: string): Image & { channels: number } {
  return decodePng(readNamed(out, hash, 'png', what));
}

/** The share of an image's pixels in each color, most common first. */
export function colorShares(image: Image): number[] {
  const counts = new Map<number, number>();
  for (let i = 0; i < image.rgba.length; i += 4) {
    const key = (image.rgba[i]! << 16) | (image.rgba[i + 1]! << 8) | image.rgba[i + 2]!;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const n = image.width * image.height;
  return [...counts.values()].sort((a, b) => b - a).map((c) => c / n);
}

// ---------------------------------------------------------------------------------------------------
// The object-ID target: an 8-bit RGBA PNG whose pixel holds pick ID r + 2^8 g + 2^16 b + 2^24 a (0: nothing
// drawn), with the frame's `picks` naming the item each pick ID stands for (#378).

export interface Ids { width: number; height: number; at: (x: number, y: number) => string | null; pixels: Map<string, [number, number][]> }
export function readIds(out: string, f: Frame3, what: string): Ids {
  const png = readPng(out, f.ids, what);
  expect(png.channels, `${what} is an RGBA PNG (the pick ID's top byte is its alpha)`).toBe(4);
  expect(f.picks, `${what}: the frame names the item each pick ID stands for`).not.toBeNull();
  const picks = f.picks!;
  const items: (string | null)[] = new Array(png.width * png.height);
  const pixels = new Map<string, [number, number][]>();
  const unknown = new Set<number>();
  for (let i = 0; i < items.length; i++) {
    const o = i * 4;
    const pick = (png.rgba[o]! + png.rgba[o + 1]! * 256 + png.rgba[o + 2]! * 65_536 + png.rgba[o + 3]! * 16_777_216) >>> 0;
    if (pick === 0) { items[i] = null; continue; }
    const id = picks.get(pick);
    if (id === undefined) { unknown.add(pick); items[i] = null; continue; }
    items[i] = id;
    const x = i % png.width; const y = Math.floor(i / png.width);
    const list = pixels.get(id);
    if (list) list.push([x, y]); else pixels.set(id, [[x, y]]);
  }
  expect([...unknown].slice(0, 5), `${what}: every pick ID in the target names an item in the frame's picks`).toEqual([]);
  return {
    width: png.width, height: png.height, pixels,
    at: (x: number, y: number) => (x < 0 || y < 0 || x >= png.width || y >= png.height ? null : items[Math.floor(y) * png.width + Math.floor(x)]!),
  };
}

/** The centre of an item's pixels in the ID target (pixel centres at +0.5), in view px, and how many there are. */
export function idCentroid(ids: Ids, id: string): { x: number; y: number; n: number } {
  const list = ids.pixels.get(id) ?? [];
  let sx = 0; let sy = 0;
  for (const [x, y] of list) { sx += x + 0.5; sy += y + 0.5; }
  return { x: list.length ? sx / list.length : NaN, y: list.length ? sy / list.length : NaN, n: list.length };
}

/**
 * Pixels whose 5 × 5 neighbourhood the ID target gives to one item (or to nothing, for `null`), scanning a
 * coarse grid of the view; the first found for each item, as click points at the pixel's centre.
 */
export function solidSpots(ids: Ids, step = 6): Map<string | null, [number, number]> {
  const spots = new Map<string | null, [number, number]>();
  for (let y = 4; y < ids.height - 4; y += step) for (let x = 4; x < ids.width - 4; x += step) {
    const id = ids.at(x, y);
    if (spots.has(id)) continue;
    let solid = true;
    for (let dy = -2; dy <= 2 && solid; dy++) for (let dx = -2; dx <= 2 && solid; dx++) if (ids.at(x + dx, y + dy) !== id) solid = false;
    if (solid) spots.set(id, [x + 0.5, y + 0.5]);
  }
  return spots;
}

// ---------------------------------------------------------------------------------------------------
// Ink measures on a window capture: the weighted centroid of one color family.

export type Weight = (r: number, g: number, b: number) => number;
export const greenness: Weight = (r, g, b) => Math.max(0, (g - Math.max(r, b)) / 255);

export interface Ink { mass: number; cx: number; cy: number }
/** The weighted centroid of an image's pixels by a weight (pixel centres at +0.5), within a region if given. */
export function ink(image: Image, weight: Weight, region?: [number, number, number, number]): Ink {
  const [x0, y0, x1, y1] = region ?? [0, 0, image.width, image.height];
  let m = 0; let sx = 0; let sy = 0;
  for (let y = Math.max(0, y0); y < Math.min(image.height, y1); y++) for (let x = Math.max(0, x0); x < Math.min(image.width, x1); x++) {
    const o = (y * image.width + x) * 4;
    const w = weight(image.rgba[o]!, image.rgba[o + 1]!, image.rgba[o + 2]!);
    if (w <= 0.02) continue;
    m += w; sx += w * (x + 0.5); sy += w * (y + 0.5);
  }
  return { mass: m, cx: m ? sx / m : NaN, cy: m ? sy / m : NaN };
}

/** One presented frame of the label capture: where the anchor (the beacon) and the label's pin sit, in window px. */
export interface LabelFrame { frame: number; frame_seq: number; anchor: [number, number]; pin: [number, number]; beaconPixels: number; pinMass: number }

/** Criterion 4: in every presented frame the label's pin is within 0.5 px of its anchor on the box; each failure names the frame. */
export function labelProblems(list: LabelFrame[], what: string, tolerance = 0.5): string[] {
  return list.flatMap((p) => {
    const d = Math.hypot(p.pin[0] - p.anchor[0], p.pin[1] - p.anchor[1]);
    return d <= tolerance ? [] : [`${what}: presented frame ${p.frame} (frame_seq ${p.frame_seq}): the label is ${Number.isFinite(d) ? d.toFixed(2) : 'not'} px from its anchor on ${LABELED_BOX}`];
  });
}

// ---------------------------------------------------------------------------------------------------
// The proof

/** Keeps one piece of proof as JSON under PROOF_DIR. */
export function keepProof(name: string, value: unknown): void {
  mkdirSync(PROOF_DIR, { recursive: true });
  writeFileSync(join(PROOF_DIR, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
}

/** Keeps an image file under PROOF_DIR. */
export function keepPng(name: string, png: Buffer): void {
  mkdirSync(PROOF_DIR, { recursive: true });
  writeFileSync(join(PROOF_DIR, `${name}.png`), png);
}

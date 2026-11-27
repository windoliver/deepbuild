// Test-side tools for the #1042 acceptance tests (README: The surface under test): `deep-show` built once per file
// and driven by `deep-show run` scenarios, as #1041's suite drives it (its helpers copied and cut down; nothing is
// imported from another suite); the three pieces (the gauge, the yard and the scroll); the web export with its
// `web.sources`; the app's own still of a frame; a bundle read back from its folder; and the cleanup of everything a
// test starts. The servers, the browser and the scripted session are in web.ts and the judges in judges.ts, neither of
// which needs the test runner. Nothing here stands in for the export, the bundle, the player or the app: every value
// a test compares comes from `deep-show`, the browser or a stand-in server's own record, and every expected value
// from the issue's text and the design.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';
import { decodePng, isObject, type Image, type JsonObject, type JsonValue } from './judges.ts';
import { Browser, BundleServer, Source, makeCerts, type Certs } from './web.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1042 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** cargo on PATH: the pinned toolchain's folder first when it is there (as #172's helpers put it). */
const TOOLCHAIN = join(homedir(), '.rustup', 'toolchains', '1.99.1-aarch64-apple-darwin', 'bin');
if (existsSync(TOOLCHAIN) && !(process.env['PATH'] ?? '').split(':').includes(TOOLCHAIN)) process.env['PATH'] = `${TOOLCHAIN}:${process.env['PATH'] ?? ''}`;

/** Every `it` and every hook passes this: a first build of `deep-show` takes many minutes on a loaded machine, and
 * criterion 1's session alone plays for 10 minutes. */
export const TIMEOUT = 3_600_000;

/** Each criterion's ID: `#1042.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs). */
export const AC = {
  1: 'AC1 #1042.c144d9ce',
  2: 'AC2 #1042.8f1f57d3',
  3: 'AC3 #1042.5bc230da',
  4: 'AC4 #1042.ed73d00d',
} as const;

// ---------------------------------------------------------------------------------------------------
// JSON and the failure rules

export const show = (v: JsonValue | undefined, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${show(v, 600)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${show(v, 600)}`).toBe(true);
  return v as JsonValue[];
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${show(v, 600)}`).toBe('string');
  return v as string;
}
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 30).join('\n  ')}`).toEqual([]);
}
/** A wrong program's run: this suite's own check fails on it, and some failure names `named`. */
export function failsNaming(failures: readonly string[], named: string, what: string): void {
  expect(failures.length, `${what}: the check fails the wrong program`).toBeGreaterThan(0);
  expect(failures.some((f) => f.includes(named)), `${what}: a failure names "${named}"; the failures: ${failures.slice(0, 8).join(' | ')}`).toBe(true);
}
/** The criterion stays open, whatever the reason: never a pass (AGENTS.md: the four invariants). */
export function inconclusive(reason: string): never {
  return expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');

// ---------------------------------------------------------------------------------------------------
// The build, temp folders, and what a test starts and must stop

/** `deep-show` with the full set, built once in the file's beforeAll as #1041's suite builds it, copied out of the
 * target folder; a test that uses a build that failed fails with cargo's error. */
export function useShow(): () => string {
  let dir = '';
  let bin = '';
  let error = 'the build did not run';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1042-bin-'));
    bin = join(dir, 'deep-show');
    const args = ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', 'full'];
    const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
    const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
    if (r.error) error = `cargo could not run: ${r.error.message}`;
    else if (r.status !== 0) error = `cargo ${args.join(' ')} failed:\n${(r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download/.test(l)).join('\n').slice(-4000)}`;
    else { copyFileSync(join(TARGET, 'debug', 'deep-show'), bin); error = ''; }
  }, TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; }, TIMEOUT);
  return (): string => {
    expect(error, 'the binary builds: deep-show with features full').toBe('');
    return bin;
  };
}
/** Fresh folders for a test (evidence stores, bundles, stills), all deleted after it. */
export function useTemp(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); }, TIMEOUT);
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-1042-')); made.push(d); return d; };
}
/** The servers, sources, certificates and browsers a test starts, each stopped by its own PID and its folders removed
 * after the test, whether it passed or not. */
export function useWeb(): { serve: (root: string) => Promise<BundleServer>; source: () => Promise<{ source: Source; certs: Certs }>; browser: (pins?: readonly string[]) => Promise<Browser> } {
  const closers: (() => Promise<void> | void)[] = [];
  afterEach(async () => { for (const close of closers.splice(0).reverse()) { try { await close(); } catch { /* already closed */ } } }, TIMEOUT);
  return {
    serve: async (root) => { const s = new BundleServer(); closers.push(() => s.stop()); await s.start(root); return s; },
    source: async () => {
      const certs = makeCerts();
      closers.push(() => rmSync(certs.dir, { recursive: true, force: true }));
      const source = new Source();
      closers.push(() => source.stop());
      await source.start(certs);
      return { source, certs };
    },
    browser: async (pins = []) => { const b = await Browser.open(pins); closers.push(() => b.close()); return b; },
  };
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run` (one scenario line in, one answer line out, exit 0)

export function runShow(bin: string, sc: JsonObject, what: string): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  expect(timedOut, `${what}: deep-show run finished within its timeout`).toBe(false);
  expect(r.error?.message ?? '', `${what}: deep-show run ran`).toBe('');
  const stdout = r.stdout ?? '';
  expect(r.status, `${what}: deep-show run exits 0; stdout: ${stdout.slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: deep-show run writes one answer line`).toBe(1);
  let out: JsonValue;
  try { out = JSON.parse(lines[0]!) as JsonValue; } catch { return expect.fail(`${what}: the answer line is not JSON: ${lines[0]!.slice(0, 500)}`); }
  const answer = obj(out, `${what}: the answer`);
  expect(answer['ok'], `${what}: deep-show run takes the scenario: ${show(answer, 3000)}`).toBe(true);
  const replies = arr(answer['replies'], `${what}: replies`).map((v, i) => obj(v, `${what}: replies[${i}]`));
  expect(replies.length, `${what}: one reply per call`).toBe(arr(sc['calls'], 'calls').length);
  return replies;
}

/** The scenario's world, as #169's and #172's: you and an agent's session, the process table, one panel and the
 * document on it, and the record the agent's session holds. */
const AGENT = { id: 'sess-1042', thread: 'thread-1042', name: 'Test agent: public sources in the web player', process: { pid: 4100, start: 1_000 } } as const;
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 },
  { pid: 4100, ppid: 3001, start: 1_000 }, { pid: 4101, ppid: 4100, start: 1_100 }, { pid: 4102, ppid: 4101, start: 1_200 },
];
/** `deep show` from your shell acts as you; from the agent's tree, as the agent. */
const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
const AGENT_PEER: JsonObject = { pid: 4102, start: 1_200 };

const ulid = (kind: string, k: number): string => `01JB1042${kind}${String(k).padStart(17, '0')}`;
/** The documents' IDs. */
export const DOC = { gauge: ulid('D', 1), pair: ulid('D', 2), yard: ulid('D', 3), scroll: ulid('D', 4) } as const;
/** The two readings a piece binds: the one its public source gives, and the one whose source answers only with a
 * key. A source's `reading` is the ID; a bound value names it by its handle, `reading:<ID>`. */
export const OUTSIDE = ulid('R', 1);
export const KEYED = ulid('R', 2);
/** The readings as the app recorded them before the export (ms since the epoch: 2026-11-24T09:30:00Z). */
const RECORD: JsonObject = {
  [`reading:${OUTSIDE}`]: { session: AGENT.id, value: 18.5, as_of: 1_795_512_600_000 },
  [`reading:${KEYED}`]: { session: AGENT.id, value: 6.5, as_of: 1_795_512_600_000 },
};
/** The scenario's own keys this suite adds (README: The scenario): the authority the export trusts when it asks a
 * declared source, and the app's secret store holding the key the keyed stand-in answers to. */
export interface World { source_ca?: string; secrets?: JsonObject }
function scenario(evidence: string, doc: string, calls: JsonObject[], world: World = {}): JsonObject {
  return {
    evidence, sessions: { [AGENT.id]: { thread: AGENT.thread, name: AGENT.name, process: { ...AGENT.process } } }, processes: PROCESSES,
    panels: { main: { rect: [0, 0, 1280, 720] } }, docs: { [doc]: { panel: 'main' } }, record: RECORD,
    ...(world.source_ca ? { source_ca: world.source_ca } : {}), ...(world.secrets ? { secrets: world.secrets } : {}), calls,
  };
}
/** `deep show` of a whole revision with its issues, from your shell or, with `agent`, from the agent's tree. */
const present = (doc: string, document: JsonObject, agent: boolean): JsonObject => ({ call: 'deep show', peer: agent ? AGENT_PEER : YOU_PEER, doc, document, include: ['issues'] });
/** The revision is presented, with no item skipped as a kind the build doesn't know. */
function presented(reply: JsonObject | undefined, what: string): void {
  const r = obj(reply, what);
  const notes = [...(Array.isArray(r['notices']) ? r['notices'] : []), ...(Array.isArray(r['issues']) ? r['issues'] : [])].filter(isObject);
  expect(notes.filter((n) => n['code'] === 'unknown_kind').map((n) => show(n)), `${what}: no item skipped as a kind the build doesn't know`).toEqual([]);
  expect(r['outcome'], `${what} is presented: ${show(r, 3000)}`).toBe('presented');
}

// ---------------------------------------------------------------------------------------------------
// The pieces (README: Fixtures). 2D: u = px, y down. 3D: metres, +Y up.

const order = (k: number): string => `a${String(k).padStart(4, '0')}`;
const rect = (id: string, box: [number, number, number, number], role: string, k: number, part: string): JsonObject =>
  ({ id, kind: 'rect@1', name: id, order: order(k), role: part, params: { box, paint: { fill: { role } } }, at: { pos: [0, 0, 0] } });
const camera2d = (w: number, h: number): JsonObject => ({ id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0000cam', params: { projection: 'orthographic', target: [w / 2, h / 2, 0], view_width: w } });
const data = (id: string, name: string, k: number, y: number): JsonObject =>
  ({ id, kind: 'text@1', name, role: 'data', order: order(k), params: { text: '', font: 'body', size: 24, box: { w: 200, h: 32 }, align: 'start' }, at: { pos: [24, y, 0] } });

/** The gauge's length: criterion 1's 10 minutes, which the session plays from start to end. */
export const SESSION_SECONDS = 600;
/** The seconds between two asks of a source, the least the design's Fields allow. */
export const EVERY = 60;
/** The bound value that shows the public source's reading, and the one that shows the keyed source's. */
export const OUTSIDE_NOW = 'outside_now';
export const KEYED_NOW = 'keyed_now';

/** The gauge: a 2D film of `seconds` s at 30 frames a second, a dot a driver walks with time and a `data` text whose
 * words the bound value `outside_now` fills from the reading the piece's public source gives. With `pair`, the same
 * piece as another document that also binds the reading whose source answers only with a key. */
export function gaugeDoc(seconds: number, pair = false): JsonObject {
  const items = [
    camera2d(320, 180), rect('back', [0, 0, 320, 180], 'ground', 1, 'decoration'), rect('band', [0, 120, 320, 60], 'ink', 2, 'decoration'), rect('dot', [0, 100, 12, 12], 'accent', 3, 'part'),
    data('readout', 'Outside now', 4, 30), ...(pair ? [data('keyed_readout', 'Behind the key', 5, 66)] : []),
  ];
  const bind = (item: string, reading: string): JsonObject => ({ target: `items/${item}/params/text`, source: `reading:${reading}` });
  return {
    format: 1, id: pair ? DOC.pair : DOC.gauge, profile: 'film', title: pair ? 'A gauge behind a key' : 'A gauge on a public source',
    description: 'A readout that follows a source, for the #1042 acceptance tests.', size: [320, 180], camera: 'cam',
    transport: { span: `${seconds}s`, frame_rate: [30, 1] },
    items: Object.fromEntries(items.map((i) => [String(i['id']), i])),
    drivers: { walk: { target: 'items/dot/at/pos/0', expr: `10 + ${300 / seconds} * t`, vars: { t: 'time' } } },
    bound_values: { [OUTSIDE_NOW]: bind('readout', OUTSIDE), ...(pair ? { [KEYED_NOW]: bind('keyed_readout', KEYED) } : {}) },
  };
}

/** The yard's one shadowed light, and its length in seconds and steps. */
export const SUN = 'sun';
export const YARD_SECONDS = 4;
export const YARD_STEPS = YARD_SECONDS * 60;
/** The yard: a 3D scene of 4 s at 60 frames a second whose light policy names ray-traced shadows, as the design
 * spells it (Light: ray traced: `rays` and `effects` on the light policy). A floor, a crate a driver slides across
 * it, and one light that casts a shadow: the key sun. */
export function yardDoc(): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: [5, 4, 9], target: [0, 0.5, 0], fov: 40 } },
    floor: { kind: 'mark.box@1', params: { size: [10, 0.2, 10] }, at: { pos: [0, -0.1, 0] } },
    crate: { kind: 'mark.box@1', params: { size: [1, 1, 1] }, at: { pos: [-1.5, 0.5, 0] } },
    [SUN]: { kind: 'light.sun@1', params: { illuminance: Math.PI, shadow: true }, at: { rot: [-45, 20, 0] } },
  };
  const withIds: JsonObject = {};
  Object.entries(items).forEach(([id, item], k) => { withIds[id] = { id, name: id, order: order(k), ...item }; });
  return {
    format: 1, id: DOC.yard, profile: 'scene', title: 'A yard in the sun', description: 'A crate that slides across a yard under one shadowed light, for the #1042 acceptance tests.',
    size: [640, 360], camera: 'cam', seed: 1042, transport: { span: `${YARD_SECONDS}s`, frame_rate: [60, 1] }, requires: { modules: { scene3d: '^1' } },
    light_policy: { rays: 'auto', effects: ['shadows'] },
    drivers: { slide: { target: 'items/crate/at/pos/0', expr: '-1.5 + 0.75 * t', vars: { t: 'time' } } },
    items: withIds,
  };
}

/** The scroll's text: the first forty characters of the Thousand Character Classic, in simplified forms. The test
 * counts them: 40 graphemes, all distinct, each of the Han script. */
export const HAN_TEXT = '天地玄黄宇宙洪荒日月盈昃辰宿列张寒来暑往秋收冬藏闰余成岁律吕调阳云腾致雨露结为霜';
/** The scroll's size, the box its text is set in ([x, y, w, h], px) and the least ink the app's render of 40
 * graphemes at 26 px leaves there (30 px a grapheme: a line of one is more). */
export const SCROLL_SIZE = [640, 360] as const;
export const SCROLL_BOX = [20, 24, 600, 168] as const;
export const SCROLL_INK = 40 * 30;
/** The scroll: a 2D film of 4 s at 30 frames a second showing HAN_TEXT in the body role, whose Han graphemes the
 * look's fallback list sets in the bundled CJK face; a dot a driver walks under it, so no two frames are alike. */
export function scrollDoc(): JsonObject {
  const [w, h] = SCROLL_SIZE;
  const items = [
    camera2d(w, h), rect('back', [0, 0, w, h], 'ground', 1, 'decoration'), rect('band', [0, 300, w, 60], 'ink', 2, 'decoration'), rect('dot', [0, 250, 12, 12], 'accent', 3, 'part'),
    { id: 'verse', kind: 'text@1', name: 'Verse', role: 'label', order: order(4), params: { text: HAN_TEXT, font: 'body', size: 26, box: { w: SCROLL_BOX[2], h: SCROLL_BOX[3] }, align: 'start' }, at: { pos: [SCROLL_BOX[0], SCROLL_BOX[1], 0] } },
  ];
  return {
    format: 1, id: DOC.scroll, profile: 'film', title: 'A verse in Han', description: 'Forty Han graphemes on a page, for the #1042 acceptance tests.', size: [w, h], camera: 'cam',
    transport: { span: '4s', frame_rate: [30, 1] },
    items: Object.fromEntries(items.map((i) => [String(i['id']), i])),
    drivers: { walk: { target: 'items/dot/at/pos/0', expr: '10 + 150 * t', vars: { t: 'time' } } },
  };
}
/** The graphemes of a text (UAX #29 clusters). */
export const graphemes = (text: string): string[] => [...new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(text)].map((s) => s.segment);

// ---------------------------------------------------------------------------------------------------
// The web export (Export: web player): `{call: "export", doc, out, video: {codec: "web", web?: {sources}}, track}`,
// as #172's suite asks for it; `out` is the bundle's folder, written whole or not at all.

/** A public source a piece declares (Export: web player, Fields). */
export interface Declared { reading: string; url: string; every: number; path: string }
/** One `deep-show run`: the piece shown, then its web export into `out`; the export's reply. */
export function exportWeb(bin: string, evidence: string, document: JsonObject, out: string, what: string, o: { sources?: readonly Declared[]; agent?: boolean; world?: World } = {}): JsonObject {
  const doc = String(document['id']);
  const video: JsonObject = { codec: 'web', ...(o.sources ? { web: { sources: o.sources.map((s) => ({ ...s })) } } : {}) };
  const r = runShow(bin, scenario(evidence, doc, [present(doc, document, o.agent ?? false), { call: 'export', doc, out, video, track: [] }], o.world), what);
  presented(r[0], what);
  return r[1]!;
}
/** A bundle file as its receipt lists it. */
export interface Listed { path: string; sha256: string; raw: JsonObject }
/** A delivered bundle's receipt and the files it lists; any other outcome fails, naming it. */
export function receiptOf(reply: JsonObject, out: string, what: string): { receipt: JsonObject; files: Listed[] } {
  expect(reply['outcome'], `${what} is exported, with no refusal: ${show(reply, 3000)}`).toBe('exported');
  expect(existsSync(join(out, 'index.html')), `${what}: the bundle has its index page`).toBe(true);
  const receipt = obj(reply['receipt'], `${what}: receipt`);
  const files = arr(receipt['files'], `${what}: receipt.files`).map((v, i) => {
    const f = obj(v, `${what}: receipt.files[${i}]`);
    return { path: str(f['path'], `${what}: receipt.files[${i}].path`), sha256: str(f['sha256'], `${what}: receipt.files[${i}].sha256`), raw: f };
  });
  return { receipt, files };
}
/** Every file under `dir`, by its path from `dir`. */
export function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name).slice(dir.length + 1)).sort();
}

/** What the index page's manifest says of the bundle (README: The bundle's fonts): each file with the SHA-256 the
 * player keys it by, and each font by its face's file name. */
export interface Manifest { raw: JsonObject; files: { path: string; sha256: string; keyed: string; inflated: number | null }[]; fonts: { file: string; sha256: string }[] }
const MANIFEST = /(<script type="application\/json" id="deep-bundle">)([\s\S]*?)(<\/script>)/;
export function manifestOf(out: string, what: string): Manifest {
  const page = readFileSync(join(out, 'index.html'), 'utf8');
  const m = MANIFEST.exec(page);
  expect(m !== null, `${what}: the index page carries its manifest (the JSON of <script type="application/json" id="deep-bundle">)`).toBe(true);
  const raw = obj(JSON.parse(m![2]!) as JsonValue, `${what}: the manifest`);
  const files = arr(raw['files'], `${what}: the manifest's files`).map((v, i) => {
    const f = obj(v, `${what}: the manifest's files[${i}]`);
    const sha = str(f['sha256'], `${what}: the manifest's files[${i}].sha256`);
    const inflated = isObject(f['inflated']) ? f['inflated'] : null;
    return { path: str(f['path'], `${what}: the manifest's files[${i}].path`), sha256: sha, keyed: inflated ? str(inflated['sha256'], `${what}: the manifest's files[${i}].inflated.sha256`) : sha, inflated: inflated ? Number(inflated['bytes']) : null };
  });
  const fonts = arr(raw['fonts'], `${what}: the manifest's fonts`).map((v, i) => {
    const f = obj(v, `${what}: the manifest's fonts[${i}]`);
    return { file: str(f['file'], `${what}: the manifest's fonts[${i}].file`), sha256: str(f['sha256'], `${what}: the manifest's fonts[${i}].sha256`) };
  });
  return { raw, files, fonts };
}
/** The bytes the player keys by `sha` (a file's own, or what its stored bytes inflate to), read from the bundle's
 * folder and held to that SHA-256. */
export function bundleBytes(out: string, m: Manifest, sha: string, what: string): Buffer {
  const f = m.files.find((x) => x.keyed === sha);
  expect(f, `${what}: the manifest lists a file the player keys by ${sha}`).toBeTruthy();
  const stored = readFileSync(join(out, f!.path));
  const bytes = f!.inflated === null ? stored : gunzipSync(stored);
  expect(sha256(bytes), `${what}: ${f!.path} holds the bytes its SHA-256 names`).toBe(sha);
  return bytes;
}

/** The repo's own CJK face, by its file name among the bundled faces, its bytes, and its licence text. */
export const CJK_FACE = 'NotoSansSC-Regular.otf';
export const cjkFace = (): Buffer => readFileSync(join(REPO, 'crates', 'deep-text', 'fonts', CJK_FACE));
export const cjkLicence = (): Buffer => readFileSync(join(REPO, 'crates', 'deep-text', 'fonts', 'LICENSE-NotoSansSC.txt'));
/** The code points of a text, in order. */
export const codePoints = (text: string): number[] => [...text].map((c) => c.codePointAt(0)!);

/** A copy of the bundle at `out` in `to` whose CJK font is `wrong`: the wrong program criterion 3's render check
 * must fail (README: Planted programs). The copy is whole by its own hashes (the font is a file the manifest lists,
 * named by its SHA-256), so the player loads it as it loads any bundle. */
export function bundleWithFont(out: string, to: string, wrong: Buffer, what: string): string {
  cpSync(out, to, { recursive: true });
  const page = readFileSync(join(to, 'index.html'), 'utf8');
  const m = MANIFEST.exec(page);
  expect(m !== null, `${what}: the index page carries its manifest`).toBe(true);
  const raw = obj(JSON.parse(m![2]!) as JsonValue, `${what}: the manifest`);
  const sha = sha256(wrong);
  const font = arr(raw['fonts'], `${what}: the manifest's fonts`).filter(isObject).find((f) => f['file'] === CJK_FACE);
  expect(font, `${what}: the manifest names the CJK face ${CJK_FACE}`).toBeTruthy();
  font!['sha256'] = sha;
  arr(raw['files'], `${what}: the manifest's files`).push({ path: `${sha}.otf`, sha256: sha });
  writeFileSync(join(to, `${sha}.otf`), wrong);
  writeFileSync(join(to, 'index.html'), page.replace(MANIFEST, (_all, open: string, _old: string, close: string) => `${open}${JSON.stringify(raw).replaceAll('</', '<\\/')}${close}`));
  return to;
}

// ---------------------------------------------------------------------------------------------------
// The app's own render of a frame (README: The app's side): #501's png_seq still export, at the piece's own size.

/** One `deep-show run`: the piece shown, then its frame at `t` exported as one PNG into `dir`; that picture. */
export function appStill(bin: string, evidence: string, document: JsonObject, t: string, size: readonly [number, number], rate: readonly [number, number], dir: string, what: string): Image {
  const doc = String(document['id']);
  mkdirSync(dir, { recursive: true });
  const out = join(dir, 'app-still');
  const r = runShow(bin, scenario(evidence, doc, [present(doc, document, false), { call: 'export', doc, out, video: { codec: 'png_seq' }, size: [...size], frame_rate: [...rate], track: [], range: { still: { t } } }]), what);
  presented(r[0], what);
  expect(obj(r[1], what)['outcome'], `${what}: the app's still is exported: ${show(r[1], 2000)}`).toBe('exported');
  const pngs = filesUnder(out).filter((f) => f.toLowerCase().endsWith('.png'));
  expect(pngs.length, `${what}: the still export wrote one PNG: ${pngs.join(', ')}`).toBe(1);
  return decodePng(readFileSync(join(out, pngs[0]!)));
}

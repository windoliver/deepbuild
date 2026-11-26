// #3360: the shipped fixture `parity/logic/readers.board` is meant to show its counter at zero, so at 0 s its
// caption, its `labels` mark set and its `choices` flip all find the entry they map 0 to.
//
// Criterion 5bf370a9: "`deep show` of the shipped fixture `parity/logic/readers.board` at 0s with `include:
// ['issues']` lists no `copy.missing` and no `flip.unmapped` issue".
// Criterion 80772b65: "At 0s the fixture's `counter.presses` reads 0, so its caption shows the `labels` entry `0`,
// and `choices` shows its child `dot`".
//
// Everything goes through `deep-show run` (#393): the fixture's document is the one the build's `manifest` lists,
// never a copy written here. README.md maps each clause to the reply field it reads.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, constants, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const TIMEOUT = 600_000;
const FIXTURE = 'parity/logic/readers.board';
const DOC = '01JB3360000000000000000001';
const YOU = { pid: 3002, start: 3_000 };

const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
const show = (v: unknown, n = 1500): string => (JSON.stringify(v) ?? String(v)).slice(0, n);

// ---------------------------------------------------------------------------------------------------
// The binary: `deep-show`, from DEEP_BIN_DIR when the proof run supplies it, else this checkout's debug build.

const supplied = process.env.DEEP_BIN_DIR;
const binDir = supplied === undefined ? join(REPO, 'target', 'debug') : resolve(supplied);
const SHOW_BIN = join(binDir, 'deep-show');

let work = '';
beforeAll(() => {
  if (supplied === undefined) {
    const run = spawnSync('cargo', ['build', '--locked', '--bin', 'deep-show'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (run.error || run.status !== 0) throw Error(`BLOCKED: cargo build --locked --bin deep-show failed: ${run.error?.message ?? run.stderr.slice(-3000)}`);
  }
  try {
    accessSync(SHOW_BIN, constants.X_OK);
  } catch {
    throw Error(`BLOCKED: ${SHOW_BIN} is missing or not executable`);
  }
  work = mkdtempSync(join(tmpdir(), 'deep-3360-'));
}, 3_600_000);
afterAll(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario in, one reply per call out.

function run(calls: JsonObject[]): { replies: JsonObject[]; evidence: string } {
  const evidence = mkdtempSync(join(work, 'ev-'));
  const scenario = {
    evidence, sessions: {}, processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: YOU.pid, ppid: 1, start: YOU.start }],
    panels: { main: { rect: [0, 0, 800, 600] } }, docs: { [DOC]: { panel: 'main' } }, goldens: join(evidence, 'goldens'), calls,
  };
  const r = spawnSync(SHOW_BIN, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  expect(r.status, `deep-show run exits 0; stdout ${r.stdout?.slice(0, 800)}; stderr ${r.stderr?.slice(-800)}`).toBe(0);
  const out = JSON.parse(r.stdout.split('\n').filter((l) => l !== '')[0] ?? 'null') as JsonValue;
  expect(isObject(out) && out['ok'], `deep-show run takes the scenario: ${show(out)}`).toBe(true);
  const replies = (out as JsonObject)['replies'] as JsonObject[];
  expect(replies.length, 'one reply per call').toBe(calls.length);
  return { replies, evidence };
}

/** The shipped fixture's document, as the build's `manifest` lists it. */
function fixtureDocument(): JsonObject {
  const [manifest] = run([{ call: 'manifest' }]).replies;
  const fixtures = (Array.isArray(manifest!['fixtures']) ? manifest!['fixtures'] : []).filter(isObject);
  const f = fixtures.find((x) => x['name'] === FIXTURE);
  expect(f, `the manifest lists ${FIXTURE}; it lists ${fixtures.length} fixtures`).toBeDefined();
  expect(isObject(f!['document']), `${FIXTURE}'s manifest row holds its document`).toBe(true);
  return f!['document'] as JsonObject;
}

const presentAt0 = (document: JsonObject): JsonObject =>
  ({ call: 'deep show', peer: YOU, doc: DOC, document, include: ['issues'], t: '0s' });

// ---------------------------------------------------------------------------------------------------
// The snapshot: an 8-bit RGBA PNG in the evidence store, named by its SHA-256.

/** The stored bytes of `sha`: the store keeps each at `<sha[0..2]>/<sha[2..]>`, and they hash to their name. */
function stored(root: string, sha: string): Buffer {
  expect(sha, 'the snapshot is named by a SHA-256').toMatch(/^[0-9a-f]{64}$/);
  const file = join(root, sha.slice(0, 2), sha.slice(2));
  expect(existsSync(file), `the snapshot ${sha} is in the evidence store`).toBe(true);
  const bytes = readFileSync(file);
  expect(createHash('sha256').update(bytes).digest('hex'), 'the stored snapshot hashes to its name').toBe(sha);
  return bytes;
}
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
function decodeRgbaPng(file: Buffer): { width: number; height: number; rgba: Uint8Array } {
  expect(file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'the snapshot is a PNG').toBe(true);
  let at = 8; let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (at < file.length) {
    const len = file.readUInt32BE(at); const type = file.toString('latin1', at + 4, at + 8); const body = file.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; }
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + len;
  }
  expect([depth, color, interlace], 'the snapshot is an 8-bit RGBA PNG with no interlace').toEqual([8, 6, 0]);
  const stride = width * 4;
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? line[i - 4]! : 0; const b = previous[i]!; const c = i >= 4 ? previous[i - 4]! : 0; const x = line[i]!;
      line[i] = (filter === 0 ? x : filter === 1 ? x + a : filter === 2 ? x + b : filter === 3 ? x + ((a + b) >> 1) : x + paeth(a, b, c)) & 255;
    }
    rgba.set(line, y * stride);
    previous = line;
  }
  return { width, height, rgba };
}

// ---------------------------------------------------------------------------------------------------

describe(`#3360: ${FIXTURE} at 0 s shows its counter at zero`, () => {
  it('#3360.5bf370a9 deep show of the fixture at 0s with include issues lists no copy.missing and no flip.unmapped', () => {
    const document = fixtureDocument();
    const [shown] = run([presentAt0(document)]).replies;
    expect(shown!['outcome'], `deep show presents the fixture: ${show(shown)}`).toBe('presented');
    expect(Array.isArray(shown!['issues']), `the reply carries its issues: ${show(shown)}`).toBe(true);
    const unwanted = (shown!['issues'] as JsonValue[]).filter(isObject).filter((i) => i['code'] === 'copy.missing' || i['code'] === 'flip.unmapped')
      .map((i) => `${String(i['code'])} ids ${show(i['ids'])} actual ${show(i['actual'])}`);
    expect(unwanted, `deep show lists no copy.missing and no flip.unmapped issue:\n  ${unwanted.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it('#3360.80772b65 at 0s counter.presses reads 0, the caption shows the labels entry 0, and choices shows its child dot', () => {
    const document = fixtureDocument();
    // The entry `0` of the `labels` table, in the session's default locale, as the fixture writes it.
    const copy = isObject(document['data']) && isObject(document['data']['copy']) ? document['data']['copy'] : {};
    const en = isObject(copy['en']) && isObject(copy['en']['labels']) ? copy['en']['labels'] : {};
    const zero = en['0'];
    expect(typeof zero, `the fixture's en labels table holds an entry 0: ${show(copy)}`).toBe('string');
    const items = isObject(document['items']) ? document['items'] : {};
    const dot = isObject(items['dot']) && isObject(items['dot']['params']) ? items['dot']['params'] : {};
    const center = Array.isArray(dot['center']) ? (dot['center'] as number[]) : [];
    expect(center.length, `the fixture's dot has a center: ${show(items['dot'])}`).toBe(2);

    const { replies, evidence } = run([
      presentAt0(document),
      { call: 'eval', doc: DOC, t: '0s', arrays: ['counter.presses'], texts: true, pixels: true },
    ]);
    const [shown, frame] = replies;
    expect(shown!['outcome'], `deep show presents the fixture: ${show(shown)}`).toBe('presented');
    expect(frame!['outcome'], `eval evaluates the frame at 0 s: ${show(frame)}`).toBe('evaluated');

    // counter.presses, as the frame at 0 s reads it.
    const arrays = isObject(frame!['arrays']) ? frame!['arrays'] : {};
    expect.soft(arrays['counter.presses'], `counter.presses at 0 s: ${show(arrays)}`).toBe(0);

    // The string the caption draws at 0 s.
    const texts = isObject(frame!['texts']) ? frame!['texts'] : {};
    expect.soft(texts['caption'], `the caption draws the labels entry 0 (${show(zero)}); the frame draws ${show(texts)}`).toBe(zero);

    // choices shows dot: the frame's snapshot draws the dot at its center, where the ground shows when no child is.
    const snaps = Array.isArray(frame!['snapshots']) ? frame!['snapshots'].filter(isObject) : [];
    expect(snaps.length, `eval's frame at 0 s holds a snapshot: ${show(frame!['snapshots'])}`).toBe(1);
    const sha = String(snaps[0]!['sha256']);
    const png = decodeRgbaPng(stored(evidence, sha));
    const size = Array.isArray(document['size']) ? (document['size'] as number[]) : [];
    expect([png.width, png.height], 'the snapshot is the document\'s size').toEqual(size);
    const px = (x: number, y: number): number[] => [...png.rgba.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4)];
    const ground = px(png.width - 2, png.height - 2);
    const atDot = px(Math.round(center[0]!), Math.round(center[1]!));
    expect.soft(atDot, `choices shows dot: the pixel at the dot's center ${show(center)} is the dot's, not the ground ${show(ground)}`).not.toEqual(ground);
  }, TIMEOUT);
});

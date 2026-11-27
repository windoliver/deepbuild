// Test-side tools for the #231 Oracle lane: `deep-show` built once (or taken from DEEP_231_BIN_DIR) and driven by one
// JSON scenario on stdin (`deep-show run`); the hold films the upstream law's cases need, made at test time; the
// `export` call and the reader of its reply's `work`, the export's work counters. Nothing here stands in for the
// export: its counters are read from what `deep-show` answers. Suites don't import each other, so the few tools this
// one shares with the #231 suite are written again here. The judge is in judges.ts and is shown failing its planted
// set when this file loads. README: The surface under test.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, expect, vi } from 'vitest';
import { proveJudges, type Work } from './judges.ts';

export * from './judges.ts';

// A first cargo build takes many minutes.
vi.setConfig({ testTimeout: 3_600_000, hookTimeout: 3_600_000 });
proveJudges();

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/231-oracle is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
/** Criterion 1's ID (scripts/proof-change.mjs `criterionId`), the one criterion the oracle map links a test to. */
export const AC1 = 'AC1 #231.ceba88e3';

const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
const show = (v: JsonValue | undefined, n = 1200): string => JSON.stringify(v)?.slice(0, n) ?? 'undefined';
function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${show(v, 600)}`).toBe(true);
  return v as JsonObject;
}
function count(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isSafeInteger(v) && v >= 0, `${what} is a whole number, zero or more, got ${show(v)}`).toBe(true);
  return v as number;
}
/** Something the test needs is missing here: never a pass. */
export function blocked(reason: string): never {
  return expect.fail(`BLOCKED: ${reason}; this is not a pass`);
}

// ---------------------------------------------------------------------------------------------------
// The build: `cargo build --locked --bin deep-show --no-default-features --features full`, made when the test first
// needs it and copied out of the target folder; with DEEP_231_BIN_DIR set, `deep-show-full` is taken from that folder
// and no cargo runs. A build that can't be had reads BLOCKED.

export function useShow(): () => string {
  let dir = ''; let bin = '';
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (): string => {
    if (bin) return bin;
    const supplied = process.env['DEEP_231_BIN_DIR'];
    if (supplied !== undefined) {
      const at = join(resolve(supplied), 'deep-show-full');
      if (!existsSync(at)) blocked(`DEEP_231_BIN_DIR names ${supplied}, which holds no deep-show-full (deep-show built with --no-default-features --features full)`);
      bin = at;
      return bin;
    }
    const args = ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', 'full'];
    const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    if (r.error) blocked(`cargo could not run (${r.error.message}); put the pinned toolchain on PATH (README: Run them)`);
    if (r.status !== 0) blocked(`deep-show doesn't build: cargo ${args.join(' ')} failed:\n${r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download/.test(l)).join('\n').slice(-4000)}`);
    dir = mkdtempSync(join(tmpdir(), 'deep-231-oracle-bins-'));
    const target = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
    bin = join(dir, 'deep-show-full');
    copyFileSync(join(target, 'debug', 'deep-show'), bin);
    return bin;
  };
}
/** A fresh folder per call, deleted after the test. */
export function useTemp(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-231-oracle-')); made.push(d); return d; };
}

// ---------------------------------------------------------------------------------------------------
// The hold films: the upstream's cases, as our documents (README: Fixtures)

const FLICKS = 705_600_000;
/** The upstream harness tells every scene at 10 frames a second. */
export const FPS = 10;
const SR = 48_000;
const CC0: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Made at test time by the #231 Oracle acceptance tests.' };
function putEvidence(evidence: string, bytes: Uint8Array): string {
  const h = createHash('sha256').update(bytes).digest('hex');
  mkdirSync(join(evidence, h.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, h.slice(0, 2), h.slice(2)), bytes);
  return h;
}
/** A stereo 32-bit float WAV of `secs` seconds: 440 Hz left at 0.2 and 660 Hz right at 0.15. */
function tone(secs: number): Buffer {
  const frames = secs * SR; const data = frames * 8;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + data, 4); b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16); b.writeUInt16LE(3, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 8, 28); b.writeUInt16LE(8, 32); b.writeUInt16LE(32, 34);
  b.write('data', 36, 'ascii'); b.writeUInt32LE(data, 40);
  for (let i = 0; i < frames; i++) { b.writeFloatLE(0.2 * Math.sin((2 * Math.PI * 440 * i) / SR), 44 + 8 * i); b.writeFloatLE(0.15 * Math.sin((2 * Math.PI * 660 * i) / SR), 48 + 8 * i); }
  return b;
}

/** The still things a film holds, one a case: each a kind with nothing that reads the time, as the upstream draws any
 * object that has no updater. */
export const SUBJECTS = ['rect', 'circle', 'path'] as const;
export type Subject = (typeof SUBJECTS)[number];
function subject(which: Subject): JsonObject {
  const base = { id: 'subject', name: `The held ${which}`, order: 'a2' };
  if (which === 'rect') return { ...base, kind: 'rect@1', params: { box: [120, 50, 80, 80], paint: { fill: { role: 'accent' } } } };
  if (which === 'circle') return { ...base, kind: 'circle@1', params: { center: [160, 90], r: 44, paint: { fill: { role: 'accent' } } } };
  return { ...base, kind: 'path@1', params: { d: 'M 60 140 C 110 30 210 150 260 40 L 260 140 Z', paint: { fill: { role: 'muted' } } } };
}
/** A film that adds one still thing and waits `secs` seconds: 320 × 180 at 10 fps, a ground and the subject, no
 * channel, with a stereo tone. */
export function holdFilm(evidence: string, which: Subject, secs: number): JsonObject {
  const sha = putEvidence(evidence, tone(secs));
  return {
    format: 1, id: `oracle-hold-${which}-${secs}s`, profile: 'film', title: `A ${which} held for ${secs} s`,
    description: 'A film the #231 Oracle acceptance tests export: one still thing, held.',
    size: [320, 180], camera: 'cam', transport: { span: secs * FLICKS, frame_rate: [FPS, 1], sample_rate: SR },
    items: {
      cam: { id: 'cam', kind: 'camera@1', name: 'Camera cam', order: 'a0cam', params: { projection: 'orthographic', target: [160, 90, 0], view_width: 320 } },
      back: { id: 'back', kind: 'rect@1', name: 'Ground', order: 'a1', params: { box: [0, 0, 320, 180], paint: { fill: { role: 'ground' } } } },
      subject: subject(which),
    },
    channels: {}, assets: { sound: { sha256: sha, license: CC0 } }, strips: { sound: { track: 1, src: sha, start: 0, in: 0, out: secs * FLICKS, rate: 1 } },
  };
}

// ---------------------------------------------------------------------------------------------------
// One export in a fresh `deep-show run`, and its work counters

const DOC = '01JB231R000000000000000001';
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 }];

/** The film delivered as H.264 with AAC: the frames its receipt counts and the reply's `work`. */
export function exported(bin: string, dir: string, which: Subject, secs: number): { frames: number; work: Work } {
  const evidence = join(dir, `evidence-${which}-${secs}`);
  mkdirSync(evidence, { recursive: true });
  const what = `a ${which} held for ${secs} s`;
  const sc: JsonObject = {
    evidence, sessions: {}, processes: PROCESSES, panels: { main: { rect: [0, 0, 1280, 720] } }, docs: { [DOC]: { panel: 'main' } },
    calls: [
      { call: 'deep show', peer: { pid: 3002, start: 3_000 }, doc: DOC, document: holdFilm(evidence, which, secs), include: ['issues'] },
      { call: 'export', doc: DOC, out: join(dir, `${which}-${secs}s.mp4`), video: { codec: 'h264' }, audio: { codec: 'aac' } },
    ],
  };
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 3_000_000, killSignal: 'SIGKILL' });
  if (r.error) throw Error(`${what}: deep-show run: ${r.error.message}`);
  expect(r.status, `${what}: deep-show run exits 0; stdout: ${(r.stdout ?? '').slice(0, 800)}; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: one answer line`).toBe(1);
  const answer = obj(JSON.parse(lines[0]!) as JsonValue, `${what}: the answer`);
  expect(answer['ok'], `${what}: deep-show run answers the scenario ok; got ${show(answer, 800)}`).toBe(true);
  const replies = Array.isArray(answer['replies']) ? answer['replies'].filter(isObject) : [];
  expect(replies.length, `${what}: one reply per call`).toBe(2);
  expect(replies[0]!['outcome'], `${what}: the document is presented: ${show(replies[0])}`).toBe('presented');
  const reply = replies[1]!;
  expect(reply['outcome'], `${what} is exported: ${show(reply, 1200)}`).toBe('exported');
  const w = obj(reply['work'], `${what}: the reply's work (the export's work counters)`);
  const fid = obj(w['fidelity'], `${what}: work.fidelity`);
  const c = (k: string): number => count(w[k], `${what}: work.${k}`);
  return {
    frames: count(obj(reply['receipt'], `${what}: receipt`)['frames'], `${what}: receipt.frames`),
    work: {
      draws: c('draws'), hashes: c('hashes'), fidelity: { draws: count(fid['draws'], `${what}: work.fidelity.draws`), hashes: count(fid['hashes'], `${what}: work.fidelity.hashes`) },
      frames_read_back: c('frames_read_back'), digests_read_back: c('digests_read_back'), digest_bytes_read_back: c('digest_bytes_read_back'),
    },
  };
}

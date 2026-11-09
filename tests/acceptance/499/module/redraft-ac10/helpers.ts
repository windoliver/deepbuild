// Test-side tools for the blind redraft of #499's AC10 (REDRAFT.md): `deep-show` built once per file and driven by one
// JSON-lines scenario (`deep-show run`, #393 and #96's shared documents); a recording with a picture and a sound made
// by ffmpeg at test time and put into the evidence store; a film stored at revision 0 that shows the recording as an
// `image@1` playing its frames and plays its sound as a strip of the same asset; the agent's patches; and the suite's
// own check, which returns failures as sentences naming the code or field that failed, so the planted check is shown
// failing on the same judgment the real program passes. Nothing here stands in for the hub or the document check.

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';
import { openEvidenceStore } from '../../../../../packages/evidence/src/index.ts';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/499/module/redraft-ac10 is five levels down). */
export const REPO = join(HERE, '..', '..', '..', '..', '..');
const SHOW_BIN = 'deep-show';
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: JsonValue | undefined): string => JSON.stringify(v ?? null).slice(0, 900);
const asObj = (v: JsonValue | undefined): JsonObject => (isObject(v) ? v : {});
const asArr = (v: JsonValue | undefined): JsonValue[] => (Array.isArray(v) ? v : []);

// ---------------------------------------------------------------------------------------------------
// The build: once per file with `cargo build --locked --bin deep-show`, copied out of target/debug.

export function useShow(): () => string {
  let dir = '';
  let error = 'not built';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-499-ac10-bin-'));
    const args = ['build', '--locked', '--bin', SHOW_BIN];
    const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (run.error) error = `cargo could not run: ${run.error.message}`;
    else if (run.status !== 0) error = `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download/.test(l)).join('\n').slice(0, 4000)}`;
    else { error = ''; copyFileSync(join(REPO, 'target', 'debug', exe(SHOW_BIN)), join(dir, exe(SHOW_BIN))); }
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: cargo build --locked --bin ${SHOW_BIN}`).toBe('');
    return join(dir, exe(SHOW_BIN));
  };
}

/** A fresh folder per test (the evidence store and the recording), deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-499-ac10-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// The recording: 4 s of a 160 × 90 test picture at 30 fps with a 440 Hz tone at 48 kHz, H.264 and AAC in an MP4, made
// by ffmpeg only as a fixture. Without ffmpeg (and libx264) the test fails BLOCKED with its unblock line.

function findFfmpeg(): string | null {
  for (const c of [process.env['DEEP_FFMPEG'], 'ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg']) {
    if (!c) continue;
    const r = spawnSync(c, ['-hide_banner', '-encoders'], { encoding: 'utf8' });
    if (!r.error && r.status === 0 && /\blibx264\b/.test(r.stdout ?? '')) return c;
  }
  return null;
}

export function makeRecording(dir: string): Buffer {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) expect.fail('BLOCKED: the recording fixture is made by ffmpeg with libx264; none was found on PATH, /opt/homebrew/bin, /usr/local/bin or DEEP_FFMPEG. Unblock: brew install ffmpeg');
  const path = join(dir, 'recording.mp4');
  execFileSync(ffmpeg, [
    '-hide_banner', '-v', 'error', '-nostdin', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '4', '-c:v', 'libx264', '-bf', '0', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k',
    '-movflags', '+faststart', path,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  return readFileSync(path);
}

/** Puts the recording into the evidence store as you would drop one in; returns its hash. */
export async function putRecording(root: string, mp4: Buffer): Promise<string> {
  const store = await openEvidenceStore({ root });
  const put = await store.connect({ role: 'you', via: 'drop' }).put({
    bytes: mp4, declares: 'mp4', kind: 'video', source: 'tests/acceptance/499/module/redraft-ac10', redaction: 'complete',
    license: { name: 'CC0-1.0', allows: ['export', 'report', 'post'] },
  });
  if (put.status !== 'stored') throw Error(`the evidence store refused the test's recording: ${put.reason}`);
  return put.evidence.sha256;
}

// ---------------------------------------------------------------------------------------------------
// The film, its writer and its patches (REDRAFT.md: The surface).

const THREAD = 'thread-alpha';
const SESSION = 'sess-alpha';
const SESSIONS: JsonObject = { [SESSION]: { thread: THREAD, name: 'Claude Code: recording edit', process: { pid: 4100, start: 1_000 } } };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 4100, ppid: 1, start: 1_000 }];
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const DOC = ulid('01JB499D', 10);
export const PICTURE = 'rec.picture';
export const SOUND = 'rec.sound';

/** The film as stored (#96's form, revision 0): the recording's picture as an image item and its sound as a strip, linked. */
export function filmDoc(asset: string): JsonObject {
  const linked = { start: '2s', in: '1s', rate: [1, 1] };
  return {
    format: 1, profile: 'film', title: 'Recording with its sound',
    description: "A screen recording shown as an image that plays its frames, its sound a strip of the same asset on the same start, in and rate.",
    size: [640, 360], transport: { frame_rate: [30, 1], span: '10s' },
    assets: { 'rec.mp4': { sha256: asset, license: 'CC0-1.0' } },
    layers: { main: { writer: `agent:${THREAD}`, title: 'Claude Code: recording edit', order: 'a0' } },
    items: {
      [PICTURE]: {
        id: PICTURE, kind: 'image@1', layer: 'main', name: 'Recording picture', order: 'a1',
        params: { asset, box: [0, 0, 640, 360], fit: 'contain', alt: 'A test pattern recording', frames: { ...linked } },
      },
      [SOUND]: {
        id: SOUND, kind: 'media.strip@1', layer: 'main', name: 'Recording sound', order: 'a2',
        params: { track: 1, src: { asset }, ...linked },
      },
    },
  };
}

type Op = { op: 'set'; id: string; path: string; value: JsonValue };
const picturePath = (field: string): string => `items/${PICTURE}/params/frames/${field}`;
const soundPath = (field: string): string => `items/${SOUND}/params/${field}`;
const patchCall = (n: number, base: number, reason: string, ops: Op[]): JsonObject => ({
  call: 'deep_show', session: SESSION, doc: DOC, patch: { patch: ulid('01JB499P', n), doc: DOC, base, reason, ops },
});
/** Changes only the picture's start (the planted check still sees this one). */
export const startOnly = patchCall(1, 0, "move the recording's picture to 3 s", [{ op: 'set', id: PICTURE, path: picturePath('start'), value: '3s' }]);
/** Changes only the picture's rate: the criterion's patch that must never become current. */
export const rateOnly = patchCall(2, 0, "play the recording's picture at twice its speed", [{ op: 'set', id: PICTURE, path: picturePath('rate'), value: [2, 1] }]);
/** Changes the picture's rate and its sound strip's rate together, in one patch. */
export const rateBoth = patchCall(3, 0, 'play the recording and its sound at twice their speed', [
  { op: 'set', id: PICTURE, path: picturePath('rate'), value: [2, 1] },
  { op: 'set', id: SOUND, path: soundPath('rate'), value: [2, 1] },
]);
const read: JsonObject = { call: 'read', doc: DOC };
const revisions: JsonObject = { call: 'revisions', doc: DOC };

/** The calls, in order; `judge` reads their replies by these positions. */
export const CALLS: JsonObject[] = [read, startOnly, rateOnly, revisions, read, rateBoth, revisions, read];

/** The planted wrong program (REDRAFT.md): the document's A/V link check compares only `start`. */
export const PLANTED = 'av_link_start_only';

export function scenario(evidence: string, asset: string, planted?: string): JsonObject {
  return {
    evidence, sessions: SESSIONS, processes: PROCESSES,
    panels: { main: { rect: [0, 0, 640, 360] } },
    docs: { [DOC]: { panel: 'main', document: filmDoc(asset) } },
    calls: CALLS, ...(planted ? { planted } : {}),
  };
}

/** One `deep-show run`: exit 0, one line out, answered ok with one reply per call, or the test fails. */
export function runShow(bin: string, input: JsonObject, what: string): JsonObject[] {
  const run = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(input)}\n`, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 600_000, killSignal: 'SIGKILL' });
  expect(run.status, `${what}: deep-show run exits 0 (${run.signal ?? 'no signal'}); stderr: ${(run.stderr ?? '').slice(-1500)}`).toBe(0);
  const out = (run.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(out.length, `${what}: one output line for the one scenario line`).toBe(1);
  const answer = JSON.parse(out[0]!) as JsonValue;
  expect(isObject(answer) && answer['ok'], `${what}: deep-show run answers the scenario ok (a \`media.strip@1\` item, \`frames\` on an image@1${input['planted'] ? `, planted ${String(input['planted'])}` : ''}); got ${show(answer)}`).toBe(true);
  const replies = asArr(asObj(answer)['replies']).map(asObj);
  expect(replies.length, `${what}: one reply per call`).toBe(CALLS.length);
  return replies;
}

// ---------------------------------------------------------------------------------------------------
// The suite's own check (REDRAFT.md: Who checks what). Every sentence names its code or field in backticks.

/** A rational as a document or a reply may write it: `[p, q]`, a number, `"p/q"`; absent is the default 1. */
function rational(v: JsonValue | undefined): [bigint, bigint] | null {
  if (v === undefined || v === null) return [1n, 1n];
  if (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number' && Number.isInteger(x))) return [BigInt(v[0] as number), BigInt(v[1] as number)];
  if (typeof v === 'number' && Number.isInteger(v)) return [BigInt(v), 1n];
  const m = typeof v === 'string' ? /^(\d+)(?:\/(\d+))?$/.exec(v) : null;
  return m ? [BigInt(m[1]!), BigInt(m[2] ?? '1')] : null;
}
const sameRate = (v: JsonValue | undefined, p: number): boolean => { const r = rational(v); return r !== null && r[1] !== 0n && r[0] === BigInt(p) * r[1]; };

const issuesOf = (reply: JsonObject): JsonObject[] => asArr(reply['issues']).map(asObj);
const unlinked = (reply: JsonObject): JsonObject[] => issuesOf(reply).filter((i) => i['code'] === 'av_unlinked');
const namesBoth = (issue: JsonObject): boolean => { const ids = asArr(issue['ids']); return ids.includes(PICTURE) && ids.includes(SOUND); };
const pictureRate = (r: JsonObject): JsonValue | undefined => asObj(asObj(asObj(asObj(asObj(r['document'])['items'])[PICTURE])['params'])['frames'])['rate'];
const soundRate = (r: JsonObject): JsonValue | undefined => asObj(asObj(asObj(asObj(r['document'])['items'])[SOUND])['params'])['rate'];
const current = (r: JsonObject): JsonValue[] => asArr(r['revisions']).map(asObj).filter((row) => row['state'] === 'current').map((row) => row['rev'] ?? null);
const revs = (r: JsonObject): JsonValue[] => asArr(r['revisions']).map((row) => asObj(row)['rev'] ?? null);

/** Failures of a refused unlinking patch: refused, at the revision before it, with `av_unlinked` naming both items. */
function refusedUnlinked(what: string, r: JsonObject): string[] {
  const f: string[] = [];
  if (r['outcome'] !== 'refused') f.push(`${what}: \`outcome\` is ${show(r['outcome'])}; the document check must refuse it with \`av_unlinked\` (reply ${show(r)})`);
  if (r['rev'] !== 0) f.push(`${what}: \`rev\` is ${show(r['rev'])}; revision 0, the one before it, must stay current`);
  const found = unlinked(r);
  if (found.length === 0) f.push(`${what}: no \`av_unlinked\` issue among ${show(r['issues'])}`);
  else if (!found.some(namesBoth)) f.push(`${what}: the \`av_unlinked\` issue's \`ids\` ${show(found.map((i) => i['ids'] ?? null))} must name both ${PICTURE} and ${SOUND}`);
  return f;
}

/** Judges the eight replies to CALLS: an empty list is a pass. */
export function judge(replies: JsonObject[]): string[] {
  const [read0, start, rate, revsAfter, readAfter, both, revsBoth, readBoth] = replies.map(asObj) as [JsonObject, JsonObject, JsonObject, JsonObject, JsonObject, JsonObject, JsonObject, JsonObject];
  const f: string[] = [];
  // Revision 0: the stored film opens linked, with neither item in error.
  if (read0['rev'] !== 0) f.push(`the first \`read\`: \`rev\` is ${show(read0['rev'])}, not 0`);
  if (unlinked(read0).length > 0) f.push(`revision 0 is linked, yet its \`issues\` hold \`av_unlinked\`: ${show(unlinked(read0))}`);
  const broken = issuesOf(read0).filter((i) => i['severity'] === 'error' && asArr(i['ids']).some((id) => id === PICTURE || id === SOUND));
  if (broken.length > 0) f.push(`revision 0's \`issues\` hold errors on the picture or the strip, so it isn't a valid film: ${show(broken)}`);
  if (!sameRate(pictureRate(read0), 1) || !sameRate(soundRate(read0), 1)) f.push(`revision 0 reads the picture's \`frames.rate\` ${show(pictureRate(read0))} and the strip's \`rate\` ${show(soundRate(read0))}, not 1`);
  // The picture's start alone (the scope: start, in and rate must agree).
  f.push(...refusedUnlinked("the patch that changes only the picture's `frames.start`", start));
  // The criterion's patch: the picture's rate alone.
  f.push(...refusedUnlinked("the patch that changes only the picture's `frames.rate`", rate));
  if (JSON.stringify(current(revsAfter)) !== '[0]' || JSON.stringify(revs(revsAfter)) !== '[0]') f.push(`after the patch that changes only the picture's \`frames.rate\`, \`revisions\` lists ${show(revs(revsAfter))} with ${show(current(revsAfter))} current; it must list only revision 0, current`);
  if (readAfter['rev'] !== 0 || readAfter['hash'] !== read0['hash']) f.push(`after the patch that changes only the picture's \`frames.rate\`, \`read\` shows \`rev\` ${show(readAfter['rev'])} hash ${show(readAfter['hash'])}; revision 0 (hash ${show(read0['hash'])}) must stay current`);
  if (!sameRate(pictureRate(readAfter), 1)) f.push(`after the patch that changes only the picture's \`frames.rate\`, the current document reads it as ${show(pictureRate(readAfter))}, not 1`);
  // Both rates together, in one patch on revision 0.
  if (both['outcome'] !== 'applied' || both['rev'] !== 1) f.push(`the patch that changes the picture's \`frames.rate\` and the strip's \`rate\` together: \`outcome\` ${show(both['outcome'])} \`rev\` ${show(both['rev'])}; it must apply as revision 1 (reply ${show(both)})`);
  if (unlinked(both).length > 0) f.push(`the patch that changes both rates together still reports \`av_unlinked\`: ${show(unlinked(both))}`);
  if (JSON.stringify(current(revsBoth)) !== '[1]') f.push(`after the patch that changes both rates, \`revisions\` has ${show(current(revsBoth))} current; revision 1 must be`);
  if (readBoth['rev'] !== 1 || !sameRate(pictureRate(readBoth), 2) || !sameRate(soundRate(readBoth), 2)) f.push(`after the patch that changes both rates, \`read\` shows \`rev\` ${show(readBoth['rev'])} with the picture's \`frames.rate\` ${show(pictureRate(readBoth))} and the strip's \`rate\` ${show(soundRate(readBoth))}; revision 1 with both at 2 must be current`);
  if (unlinked(readBoth).length > 0) f.push(`revision 1 holds \`av_unlinked\` though both rates are 2: ${show(unlinked(readBoth))}`);
  return f;
}

/** The start-only patch's failures alone: the planted twin must still refuse it, as a check that compares `start` does. */
export const startFailures = (replies: JsonObject[]): string[] => refusedUnlinked("the patch that changes only the picture's `frames.start`", asObj(replies[1]));

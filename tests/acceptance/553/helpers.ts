// Test-side tools for the #553 acceptance tests (README: The surface under test). They reuse #549's suite for what it
// already drives (building `deep-show`, `deep-show run` without blocking this process, the scenario, the evidence
// store) and #551's for a copy's rollbacks and occurrences, and add what #553's criteria read: a match with the relay's
// late deliveries, saves and planted twins; a copy's voices, its audio thread's blocks and the WAV of what it rendered;
// its saves and their folder; net.budget's runs; the relay's frames; and the network seam's interop part. Nothing here
// stands in for the net module, the media module, a check, the relay, the player or the piece: every hash, voice,
// sample, save, report and frame a test reads is the implementation's own, and every expected value comes from the
// issue, the design and fixtures.ts.

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect } from 'vitest';
import {
  FULL, LIVE_MS, REPO, Script, TIMEOUT, arr, blocked, gaveUp, isObject, none, num, obj, presented, putEvidence, readFrame, runShow, scenario, show, str,
  useBuilds, useChildren, useTemp, type JsonObject, type JsonValue,
} from '../549/helpers.ts';
import { copy551Of, replayCall, hashesOf, occurrenceLines, sameHashes, trackFailures, trackLines, type Copy551 } from '../551/helpers.ts';
import { FADE_MS, sha256, type Planted, type Plays, type Program } from './fixtures.ts';

export {
  FULL, REPO, Script, TIMEOUT, arr, copy551Of, hashesOf, isObject, none, num, obj, occurrenceLines, presented, putEvidence, readFrame, replayCall, runShow, sameHashes, show, str,
  trackFailures, trackLines, useBuilds, useChildren, useTemp,
};
export type { Copy551, JsonObject, JsonValue };

/** Each criterion's ID: `#553.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs). */
export const AC = {
  1: 'AC1 #553.f47ade22',
  2: 'AC2 #553.369b7549',
  3: 'AC3 #553.265463c7',
  4: 'AC4 #553.b6df6698',
  5: 'AC5 #553.7ab062d9',
} as const;

/** A reading this machine can't decide: the test fails with this, never passes (invariant 2). */
export const inconclusive = (why: string): never => { throw Error(`INCONCLUSIVE: ${why}; this is not a pass`); };

// ---------------------------------------------------------------------------------------------------
// One `deep-show run` (#393): #549's world with this suite's planted names, the pieces presented, then one match.

export function world(evidence: string, docs: string[], calls: JsonObject[], planted?: Planted): JsonObject {
  return { ...scenario({ evidence, docs: docs.map((id) => ({ id })), calls }), ...(planted ? { planted } : {}) };
}
/** README: `match`. `deliver`: #551's; `log`: #549's; `saves_dir`: this job's; `secure`: #552's. */
export interface Deliver { player: number; step: number; to: number; at: number }
export interface MatchAsk {
  plays: Plays;
  relay?: { seed: number; log?: boolean; deliver?: Deliver[] };
  check?: 'net.rollback' | 'net.budget';
  savesDir?: string;
  secure?: number;
}
export function matchCall(doc: string, steps: number, o: MatchAsk): JsonObject {
  return {
    call: 'match', doc, steps, plays: o.plays as unknown as JsonObject, ...(o.relay ? { relay: o.relay as unknown as JsonObject } : {}),
    ...(o.check ? { check: o.check } : {}), ...(o.savesDir ? { saves_dir: o.savesDir } : {}), ...(o.secure !== undefined ? { secure: { seed: o.secure } } : {}),
  };
}
export interface Played { copies: Copy551[]; check: { verdict: string; failures: JsonObject[]; raw: JsonObject } | null; reply: JsonObject }
export interface PlayAsk extends MatchAsk { document: JsonObject; steps: number; assets: (Program | Buffer)[]; planted?: Planted }
/** The piece presented and its match played in one process over the test relay; a refusal fails, naming it. */
export async function play(bin: string, evidence: string, what: string, ask: PlayAsk): Promise<Played> {
  for (const a of ask.assets) putEvidence(evidence, Buffer.isBuffer(a) ? a : a.bytes);
  const doc = String(ask.document['id']);
  const s = new Script();
  s.present(doc, ask.document);
  const m = s.add(matchCall(doc, ask.steps, ask));
  const r = await runShow(bin, world(evidence, [doc], s.calls, ask.planted), what);
  presented(r[0], `${what}: the piece`);
  const reply = r[m]!;
  expect(reply['code'], `${what}: the match call answers, not refuses: ${show(reply, 1500)}`).toBeUndefined();
  const copies = arr(reply['copies'], `${what}: copies`).map((c, i) => copy551Of(c, `${what}: copies[${i}]`)).sort((a, b) => a.player - b.player);
  expect(copies.map((c) => c.player), `${what}: one copy a player, 1 and 2`).toEqual([1, 2]);
  let check: Played['check'] = null;
  if (ask.check) {
    const c = obj(reply['check'], `${what}: check (the check's report)`);
    check = { verdict: str(c['verdict'], `${what}: check.verdict`), failures: arr(c['failures'], `${what}: check.failures`).filter(isObject), raw: c };
  }
  return { copies, check, reply };
}

// ---------------------------------------------------------------------------------------------------
// A copy's report (README: A copy's report): #549's and #551's, with this job's `voices`, `audio` and `saves`.

/** A voice the copy's media module started from an occurrence: `start` the output sample it began at; `faded` the
 * output samples [from, to) over which it faded to silence once a rollback dropped its occurrence, or null. */
export interface Voice { spawn: string; step: number; kind: string; a: number; b: number; start: number; faded: { from: number; to: number } | null }
export function voicesOf(c: Copy551, what: string): Voice[] {
  const list = c.raw['voices'];
  expect(Array.isArray(list), `${what}: copy ${c.player} reports every voice it started (voices: [{spawn, step, kind, a, b, start, faded}]); its report holds ${Object.keys(c.raw).join(', ')}`).toBe(true);
  return (list as JsonValue[]).map((x, i) => {
    const w = `${what}: copy ${c.player}'s voices[${i}]`;
    const v = obj(x, w);
    const f = v['faded'] === null || v['faded'] === undefined ? null : obj(v['faded'], `${w}.faded`);
    return {
      spawn: str(v['spawn'], `${w}.spawn`), step: num(v['step'], `${w}.step`), kind: str(v['kind'], `${w}.kind`), a: num(v['a'], `${w}.a`), b: num(v['b'], `${w}.b`),
      start: num(v['start'], `${w}.start`), faded: f ? { from: num(f['from'], `${w}.faded.from`), to: num(f['to'], `${w}.faded.to`) } : null,
    };
  });
}
/** The copy's audio thread: every block it rendered, in the order it rendered them, and the WAV of those samples. */
export interface Audio { sampleRate: number; blocks: { from: number; count: number }[]; wav: string }
export function audioOf(c: Copy551, what: string): Audio {
  const a = obj(c.raw['audio'], `${what}: copy ${c.player} reports its audio thread (audio: {sample_rate, blocks, wav}); its report holds ${Object.keys(c.raw).join(', ')}`);
  const w = `${what}: copy ${c.player}'s audio`;
  return {
    sampleRate: num(a['sample_rate'], `${w}.sample_rate`),
    blocks: arr(a['blocks'], `${w}.blocks`).map((x, i) => { const b = obj(x, `${w}.blocks[${i}]`); return { from: num(b['from'], `${w}.blocks[${i}].from`), count: num(b['count'], `${w}.blocks[${i}].count`) }; }),
    wav: str(a['wav'], `${w}.wav`),
  };
}
/** Every output sample rendered once and in order: each block starts where the one before ended, from sample 0, up to
 * at least sample `upTo`. A block that starts before the last one ended renders samples again: the failure names the
 * first of them. */
export function onceInOrder(a: Audio, upTo: number, what: string): string[] {
  let end = 0;
  for (const [i, b] of a.blocks.entries()) {
    if (b.count <= 0) return [`${what}: block ${i} renders ${b.count} samples`];
    if (b.from < end) return [`${what}: the audio thread renders sample ${b.from} again (block ${i}, after sample ${end - 1} was rendered): the first sample it renders twice`];
    if (b.from > end) return [`${what}: the audio thread skips samples ${end} to ${b.from - 1} (block ${i})`];
    end = b.from + b.count;
  }
  return end < upTo ? [`${what}: the audio thread rendered samples up to ${end}, short of ${upTo}`] : [];
}
/** Five milliseconds of output. */
export const fadeSamples = (rate: number): number => Math.round((FADE_MS * rate) / 1000);

/** #15's evidence store: a file by its SHA-256, checked against it. */
export function evidenceBytes(evidence: string, sha: string, what: string): Buffer {
  const file = join(evidence, sha.slice(0, 2), sha.slice(2));
  expect(existsSync(file), `${what}: the evidence store holds ${sha}`).toBe(true);
  const bytes = readFileSync(file);
  expect(sha256(bytes), `${what}: the file's bytes hash to its name`).toBe(sha);
  return bytes;
}
/** A RIFF WAVE file of IEEE float 32-bit or PCM 16-bit samples: its rate and each channel. */
export interface Wav { rate: number; channels: Float32Array[] }
export function decodeWav(bytes: Buffer, what: string): Wav {
  expect(bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE', `${what} is a RIFF WAVE file`).toBe(true);
  let o = 12; let fmt: Buffer | null = null; let data: Buffer | null = null;
  while (o + 8 <= bytes.length) {
    const id = bytes.toString('ascii', o, o + 4); const len = bytes.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = bytes.subarray(o + 8, o + 8 + len);
    if (id === 'data') data = bytes.subarray(o + 8, o + 8 + len);
    o += 8 + len + (len % 2);
  }
  expect(fmt !== null && data !== null, `${what} has a fmt and a data chunk`).toBe(true);
  const tag = fmt!.readUInt16LE(0); const nch = fmt!.readUInt16LE(2); const rate = fmt!.readUInt32LE(4); const bits = fmt!.readUInt16LE(14);
  const real = tag === 0xfffe && fmt!.length >= 26 ? fmt!.readUInt16LE(24) : tag;
  expect((real === 3 && bits === 32) || (real === 1 && bits === 16), `${what} is float 32-bit or PCM 16-bit, got format ${real} at ${bits} bits`).toBe(true);
  const width = bits / 8; const frames = Math.floor(data!.length / (width * nch));
  const channels = Array.from({ length: nch }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) for (let c = 0; c < nch; c++) { const p = (i * nch + c) * width; channels[c]![i] = real === 3 ? data!.readFloatLE(p) : data!.readInt16LE(p) / 32768; }
  return { rate, channels };
}
/** The largest magnitude over every channel of output samples [from, to), each found through the blocks' order in the
 * WAV (which holds every rendered sample in render order). */
export function peak(wav: Wav, a: Audio, from: number, to: number): number {
  let best = 0;
  let base = 0;
  for (const b of a.blocks) {
    const lo = Math.max(from, b.from); const hi = Math.min(to, b.from + b.count);
    for (let s = lo; s < hi; s++) for (const ch of wav.channels) best = Math.max(best, Math.abs(ch[base + (s - b.from)] ?? 0));
    base += b.count;
  }
  return best;
}
/** A voice dropped by a rollback fades out over 5 ms, as its samples show: `faded` spans 5 ms after it began; the tone
 * sounds just before the fade, its first quarter is still loud and its last quieter, and silence follows. */
export function fadeFailures(v: Voice, wav: Wav, a: Audio, what: string): string[] {
  const f: string[] = [];
  if (!v.faded) return [`${what}: the voice of the ${v.kind} at step ${v.step} never faded (faded is null)`];
  const n = fadeSamples(a.sampleRate);
  const { from, to } = v.faded;
  if (Math.abs(to - from - n) > 1) f.push(`${what}: the voice of the ${v.kind} at step ${v.step} fades over samples ${from} to ${to}, ${to - from} samples, not 5 ms (${n} at ${a.sampleRate} Hz)`);
  if (!(from > v.start)) f.push(`${what}: the voice of the ${v.kind} at step ${v.step} fades from sample ${from}, not after it began at ${v.start}`);
  const q = Math.max(1, Math.floor(n / 4));
  const before = peak(wav, a, Math.max(v.start, from - n), from);
  const first = peak(wav, a, from, from + q);
  const last = peak(wav, a, to - q, to);
  const after = peak(wav, a, to, to + 10 * n);
  if (before < 0.1) f.push(`${what}: the tone doesn't sound before the fade (peak ${before.toFixed(4)} over the 5 ms before sample ${from})`);
  if (first < 0.05) f.push(`${what}: the fade's first quarter is already silent (peak ${first.toFixed(4)}): the voice is cut, not faded`);
  if (!(last < first)) f.push(`${what}: the fade's last quarter (peak ${last.toFixed(4)}) is no quieter than its first (${first.toFixed(4)})`);
  if (after > 1e-3) f.push(`${what}: the voice still sounds after its fade ended at sample ${to} (peak ${after.toFixed(4)} over the next 50 ms)`);
  return f;
}

/** A save the copy wrote (#189's SaveWritten, in the `logic` call's shape): its slot, step, file and whether it ended. */
export interface Saved { item: string; slot: number; step: number; hash: string; ended: boolean }
export function savesOf(c: Copy551, what: string): Saved[] {
  const list = c.raw['saves'];
  expect(Array.isArray(list), `${what}: copy ${c.player} reports the saves it wrote (saves: [{item, slot, step, hash, file, ended}]); its report holds ${Object.keys(c.raw).join(', ')}`).toBe(true);
  return (list as JsonValue[]).map((x, i) => {
    const w = `${what}: copy ${c.player}'s saves[${i}]`;
    const s = obj(x, w);
    return { item: str(s['item'], `${w}.item`), slot: num(s['slot'], `${w}.slot`), step: num(s['step'], `${w}.step`), hash: str(s['hash'], `${w}.hash`), ended: s['ended'] === true };
  });
}
/** A saves folder's kept saves, `<sha256>.save`, each with its header line (#534's format). */
export function keptSaves(dir: string, what: string): { hash: string; header: JsonObject }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /^[0-9a-f]{64}\.save$/.test(f)).map((f) => {
    const bytes = readFileSync(join(dir, f));
    expect(sha256(bytes), `${what}: ${f} is named by its sha256`).toBe(f.slice(0, 64));
    const nl = bytes.indexOf(0x0a);
    expect(nl, `${what}: ${f} holds a header line`).toBeGreaterThan(0);
    return { hash: f.slice(0, 64), header: obj(JSON.parse(bytes.subarray(0, nl).toString('utf8')) as JsonValue, `${what}: ${f}'s header`) };
  });
}

// ---------------------------------------------------------------------------------------------------
// net.budget (README: net.budget's report): #551's five runs, each `{step, step_ms, window_ms}`, with this job's
// `checkpoint_ms`; judged by the repo's rule for a timing budget (scripts/benchmark.mjs `judgeLimit`: five readings
// after a warm-up, on a reference Mac on mains power, Low Power Mode off, thermal state nominal, the load at each
// reading's start and end under the core count), never a pass otherwise.

export interface BudgetRun { stepMs: number; windowMs: number; checkpointMs: number }
export interface Budget { runs: BudgetRun[]; window: number; raw: JsonObject }
export function budgetOf(reply: JsonObject, what: string): Budget {
  const c = obj(reply['check'], `${what}: check (net.budget's report)`);
  expect(c['kind'], `${what}: the check is net.budget`).toBe('net.budget');
  const runs = arr(c['runs'], `${what}: check.runs (net.budget's five runs)`).map((x, i) => {
    const r = obj(x, `${what}: check.runs[${i}]`);
    return {
      stepMs: num(r['step_ms'], `${what}: check.runs[${i}].step_ms`), windowMs: num(r['window_ms'], `${what}: check.runs[${i}].window_ms`),
      checkpointMs: num(r['checkpoint_ms'], `${what}: check.runs[${i}].checkpoint_ms (one match step's rollback checkpoints, README: net.budget's report)`),
    };
  });
  expect(runs.length, `${what}: net.budget reports the five runs the rule takes`).toBe(5);
  return { runs, window: num(c['window'], `${what}: check.window`), raw: c };
}
interface Judged { status: string; reason?: string }
type Judge = (a: { limit: number; runs: number[]; fingerprint: JsonValue; loads: { start: number; end: number }[] }) => Judged;
/** One limit over five readings, each with the load at its start and end: PASS, FAIL (a failure line) or undecided
 * (an INCONCLUSIVE line); the caller fails on any FAIL and throws INCONCLUSIVE on any undecided one. */
export async function judged(limit: number, runs: number[], loads: { start: number; end: number }[], what: string): Promise<{ fail: string[]; undecided: string[] }> {
  const bench = await import(join(REPO, 'scripts', 'benchmark.mjs')) as { fingerprint: () => JsonValue; judgeLimit: Judge };
  const v = bench.judgeLimit({ limit, runs, fingerprint: bench.fingerprint(), loads });
  const said = `${what}: ${v.status} against ${limit} ms (runs ${JSON.stringify(runs)}; 1-minute load ${(loadavg()[0] ?? 0).toFixed(1)} on ${cpus().length} cores)${v.reason ? `: ${v.reason}` : ''}`;
  if (v.status === 'PASS') return { fail: [], undecided: [] };
  if (v.status === 'FAIL') return { fail: [said], undecided: [] };
  return { fail: [], undecided: [said] };
}
/** The load around one call, given to each of the five readings that call made. */
export async function withLoad<T>(f: () => Promise<T>): Promise<{ value: T; loads: { start: number; end: number }[] }> {
  const start = loadavg()[0] ?? 0;
  const value = await f();
  const end = loadavg()[0] ?? 0;
  return { value, loads: Array.from({ length: 5 }, () => ({ start, end })) };
}

// ---------------------------------------------------------------------------------------------------
// The relay's log (#549's rows with #550's `bytes` and #552's `messages`): each frame read in relay@1's documented
// layout (a 27-byte header, then each step as a u16 length and its bytes), each step's message beside its entries.

export interface Sent { player: number; step: number; bytes: Buffer; entries: JsonValue[]; members: string[] }
export interface LoggedFrame { player: number; count: number; size: number; messages: Sent[] }
export function framesOf(reply: JsonObject, what: string): LoggedFrame[] {
  const log = arr(obj(reply['relay'], `${what}: relay (the test relay's report)`)['log'], `${what}: relay.log`);
  expect(log.length, `${what}: the relay's log holds frames`).toBeGreaterThan(0);
  return log.map((x, i) => {
    const row = obj(x, `${what}: relay.log[${i}]`);
    const bytes = Buffer.from(str(row['bytes'], `${what}: relay.log[${i}].bytes (the frame, hex)`), 'hex');
    const frame = readFrame(bytes, `${what}: relay.log[${i}]`);
    const decoded = arr(row['messages'], `${what}: relay.log[${i}].messages`).filter(isObject);
    const messages: Sent[] = [];
    let o = 27;
    for (let k = 0; k < frame.count; k++) {
      expect(o + 2 <= bytes.length, `${what}: relay.log[${i}] holds step ${k}'s length`).toBe(true);
      const len = bytes.readUInt16LE(o);
      const step = frame.first + k;
      const m = decoded.find((d) => d['step'] === step);
      messages.push({
        player: num(row['player'], `${what}: relay.log[${i}].player`), step, bytes: bytes.subarray(o + 2, o + 2 + len),
        entries: m && Array.isArray(m['entries']) ? m['entries'] : [], members: m ? Object.keys(m).filter((key) => key !== 'entries').sort() : [],
      });
      o += 2 + len;
    }
    expect(o, `${what}: relay.log[${i}]'s steps fill the frame exactly, in relay@1's layout`).toBe(bytes.length);
    return { player: num(row['player'], `${what}: relay.log[${i}].player`), count: frame.count, size: bytes.length, messages };
  });
}
/** An entry's name, as the relay's log decodes it: `[name, value]`, or an object's `kind` or `control`. */
export const entryName = (e: JsonValue): string => (Array.isArray(e) ? String(e[0]) : isObject(e) ? String(e['kind'] ?? e['control'] ?? '') : '');
/** Each player's message for each step, as the first frame that carried it holds it. */
export function messagesOf(frames: readonly LoggedFrame[]): Map<string, Sent> {
  const out = new Map<string, Sent>();
  for (const f of frames) for (const m of f.messages) if (!out.has(`${m.player}:${m.step}`)) out.set(`${m.player}:${m.step}`, m);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The network seam's interop part (README: The interop part): `node scripts/net-interop.mjs`, its last stdout line
// `{"interop": Report}`. The process is stopped by its PID after its test (SIGTERM, then SIGKILL 10 s on).

const running = new Set<ChildProcess>();
afterEach(() => {
  for (const c of running) { c.kill('SIGTERM'); const t = setTimeout(() => c.kill('SIGKILL'), 10_000); t.unref(); }
  running.clear();
});
export interface InteropAsk { doc: string; evidence: string; plays: string; steps: number; seed: number; planted?: string }
export async function interop(o: InteropAsk, what: string): Promise<JsonObject> {
  const args = ['scripts/net-interop.mjs', '--doc', o.doc, '--evidence', o.evidence, '--plays', o.plays, '--steps', String(o.steps), '--seed', String(o.seed), ...(o.planted ? ['--planted', o.planted] : [])];
  const r = await new Promise<{ status: number | null; stdout: string; stderr: string; timedOut: boolean }>((done) => {
    const child = spawn(process.execPath, args, { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
    running.add(child);
    let stdout = ''; let stderr = ''; let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => { stdout += d; });
    child.stderr.setEncoding('utf8').on('data', (d: string) => { stderr = (stderr + d).slice(-20_000); });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 10_000).unref(); }, LIVE_MS);
    child.once('error', (e) => { clearTimeout(timer); running.delete(child); done({ status: null, stdout, stderr: `${process.execPath} could not run: ${e.message}`, timedOut }); });
    child.once('close', (status) => { clearTimeout(timer); running.delete(child); done({ status, stdout, stderr, timedOut }); });
  });
  if (r.timedOut) gaveUp(`${what}: the interop part didn't finish within ${Math.round(LIVE_MS / 60_000)} minutes`);
  const last = r.stdout.trim().split('\n').at(-1) ?? '';
  let parsed: JsonValue = null;
  try { parsed = JSON.parse(last) as JsonValue; } catch { /* named below */ }
  const report = isObject(parsed) && isObject(parsed['interop']) ? parsed['interop'] : null;
  expect(report, `${what}: the interop part's last line is {"interop": Report} (exit ${r.status}); stdout: ${r.stdout.slice(-1500)}; stderr: ${r.stderr.slice(-1500)}`).not.toBeNull();
  const status = str(report!['status'], `${what}: interop.status`);
  if (status === 'BLOCKED') blocked(`${what}: the interop part is BLOCKED: ${show(report!['reason'] ?? null, 600)}`);
  if (status === 'INCONCLUSIVE') inconclusive(`${what}: the interop part is INCONCLUSIVE: ${show(report!['reason'] ?? null, 600)}`);
  return report!;
}


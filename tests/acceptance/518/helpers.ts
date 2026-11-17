// Test-side tools for the #518 acceptance tests: `deep-show` built once per Cargo feature set and driven by one JSON
// scenario on stdin (`deep-show run`), with the scenario's `planted` key for the wrong programs that can only live in
// the product and its `job_tools` key for the encode tools a hub holds (README: The surface under test); the pinned
// merge base's `deep-show`, built once from this repository's history, for the criteria that compare with it; the
// suite's own encode tools, each a test plug-in that registers a tool of the job kind `encode` through
// `deep.registerJobTool` and whose program the export runs (fixtures/); the fixture films (#157's, by import); a run
// watched from outside (its files, its processes' memory, its clock); and the readers and judges the files share.
// Nothing here stands in for the export, its hand-off, its conversion pass, an encoder or the decode worker: each is
// read from what `deep-show` answers or writes, or from what a tool the suite owns was handed.

import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { availableParallelism, loadavg } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, expect } from 'vitest';
import {
  DOC, REPO, TIMEOUT, arr, blocked, ffmpegTools, filmDoc, hex64, isObject, mediaDecode, obj, present, presented, runShow, scenario, show, str,
  type FilmSpec, type JsonObject, type JsonValue,
} from '../157/helpers.ts';

export {
  DOC, FLICKS, FULL, H264_AAC, REPO, TIMEOUT, arr, blocked, exportCall, failsNaming, fidelityOf, filesUnder, filmDoc, framesNamed, getEvidence, hex64, hexes,
  inconclusive, int, isObject, issueLines, issuesOf, leftIn, meetsFloor, none, num, obj, putEvidence, readMovie, receiptOf, referenceMacProblem, runShow, scenario,
  sha256, show, str, trackOf, useFileTemp, useShow, useTemp, type FilmSpec, type JsonObject, type JsonValue, type Rate, type Receipt,
} from '../157/helpers.ts';
export { bgra, blake3, decodePng, fl, pngFrames } from '../501/helpers.ts';

/** Each criterion's ID (scripts/proof-change.mjs `criterionId` on the live issue text: the first eight hex digits of
 * the SHA-256 of the checkbox's text, trimmed, white space collapsed). */
export const AC = {
  1: 'AC1 #518.7ecf15cf',
  2: 'AC2 #518.3c98d3de',
  3: 'AC3 #518.0204e16d',
  4: 'AC4 #518.65044f7b',
  5: 'AC5 #518.326be00d',
  6: 'AC6 #518.a412bee0',
  7: 'AC7 #518.c5c5c15e',
  8: 'AC8 #518.b0585e2f',
  9: 'AC9 #518.40d2d493',
  10: 'AC10 #518.f259d9bf',
  11: 'AC11 #518.2feca46b',
  12: 'AC12 #518.3e752f74',
} as const;

/** The build with the native test encode tools (README: Cargo features of `deep-show`). */
export const TOOLS = 'full,test-encode-tools';

/** The wrong programs that can only live in the product, each chosen by the scenario's `planted` (README: Planted
 * programs). */
export type Planted =
  | 'handoff_drops_last_buffer' | 'handoff_sends_before_hash' | 'export_waits_for_slot_forever' | 'nv12_rounds_chroma_down'
  | 'export_clears_destination_first' | 'export_opens_tool_after_first_frame' | 'encode_reads_all_frames_first';

/** The native test tools of the `test-encode-tools` build, by name@version (README: The native test tools). */
export const NATIVE = {
  av1: 'test-av1@1.0.0',
  av1Drops: 'test-av1-drops-100th@1.0.0',
  av1Bt601: 'test-av1-bt601@1.0.0',
  frames: 'test-frames@1.0.0',
  redBefore: 'test-red-before@1.0.0',
  redAfter: 'test-red-after@1.0.0',
  keepsSlots: 'test-keeps-slots@1.0.0',
  open2s: 'test-open-2s@1.0.0',
  open0s: 'test-open-0s@1.0.0',
} as const;
/** The frame delay `test-frames`, `test-red-before`, `test-red-after` and `test-keeps-slots` register: a ring of four
 * slots. */
export const NATIVE_FRAME_DELAY = 2;

// ---------------------------------------------------------------------------------------------------
// The pinned merge base (criteria 1 and 8 compare with it): its `deep-show`, built once per machine from this
// repository's history into the target folder, as #1606's suite builds the merge base's deep-hook. Pinned rather than
// computed, so the comparison stays with the export as it was before #518 once main moves past it.

export const BASE = 'd8c46f0d58162ff0a4a483544149316aec960637';
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
const BASE_DIR = join(TARGET, 'base-518', BASE.slice(0, 12));
const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
};
const lastLines = (text: string, n = 4000): string => text.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download/.test(l)).join('\n').slice(-n);

/** Builds the merge base's `deep-show` (the shipped set) unless it is already there: '' or why it couldn't. */
function buildBase(): string {
  const bin = join(BASE_DIR, 'deep-show');
  if (existsSync(bin)) return '';
  const src = join(BASE_DIR, 'src');
  rmSync(src, { recursive: true, force: true });
  mkdirSync(src, { recursive: true });
  // The archive streams into tar: the repository's outgrows a buffer.
  const archived = spawnSync('bash', ['-c', 'set -o pipefail; git -C "$1" archive --format=tar "$2" | tar -xf - -C "$3"', 'bash', REPO, BASE, src], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (archived.error) return `the merge base ${BASE} could not be read out of this repository: ${archived.error.message}`;
  if (archived.status !== 0) return `the merge base ${BASE} is not in this repository's history (git archive exit ${String(archived.status)}): ${archived.stderr.slice(-1500)}. Unblock: git fetch origin ${BASE}`;
  const args = ['build', '--locked', '--offline', '--bin', 'deep-show', '--no-default-features', '--features', 'full', '--manifest-path', join(src, 'Cargo.toml'), '--target-dir', join(BASE_DIR, 'target')];
  const built = spawnSync('cargo', args, { cwd: src, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV } });
  if (built.error) return `cargo could not run for the merge base: ${built.error.message}`;
  if (built.status !== 0) return `deep-show at the merge base ${BASE} did not build (cargo ${args.slice(0, 8).join(' ')} …, exit ${String(built.status)}):\n${lastLines(built.stderr)}\nUnblock, when a crate is missing offline: cargo fetch --locked --manifest-path ${join(src, 'Cargo.toml')}`;
  copyFileSync(join(BASE_DIR, 'target', 'debug', 'deep-show'), bin);
  return '';
}
/** The merge base's `deep-show`, built in the file's `beforeAll` (not at all while `unless` gives a reason the file
 * won't use it); a test that uses it while it couldn't be built is BLOCKED, never a pass. */
export function useBase(unless?: () => Promise<string | null>): { bin: () => string } {
  let problem = 'the merge base was not built';
  beforeAll(async () => {
    const skip = unless ? await unless() : null;
    problem = skip ? `it was not built (${skip})` : buildBase();
  }, 2 * TIMEOUT);
  return {
    bin(): string {
      if (problem) blocked(`this criterion compares with the merge base, and ${problem}`);
      return join(BASE_DIR, 'deep-show');
    },
  };
}

/** One build step of the checkout (the hub's CLI, deep-hook): '' or why it failed. */
export function step(command: string, args: string[]): string {
  const r = spawnSync(command, args, { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV } });
  if (r.error) return `${command} could not run: ${r.error.message}`;
  if (r.status === 0) return '';
  return `${command} ${args.join(' ')} failed (exit ${String(r.status)}):\n${lastLines(`${r.stdout ?? ''}\n${r.stderr ?? ''}`)}`;
}

// ---------------------------------------------------------------------------------------------------
// The suite's encode tools (README: The suite's tools). One test plug-in (fixtures/plugin), copied per use, registers
// one tool of the job kind `encode` through `deep.registerJobTool`; its program (fixtures/tool, laid in ./tool) is a
// PNG sequence writer that takes its frames by copy and does what its plan says. The scenario's `job_tools` entry is
// read from the plug-in's own registration, run here against a recording `deep`.

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export type Behaviour =
  | { does: 'frames' }
  | { does: 'truncates'; cut_at: number }
  | { does: 'fails_open' }
  | { does: 'keeps'; after: number }
  | { does: 'slow'; hold_every: number; quiet_ms: number };
export interface SuiteTool { name: string; frame_delay: number; behaviour: Behaviour }
/** The suite's tools, each `<name>@1.0.0` of the plug-in `test/encode-<name>`. */
export const SUITE = {
  /** Hashes each frame it is handed and reports the hashes (criterion 4). */
  frames: { name: 'suite-frames', frame_delay: 0, behaviour: { does: 'frames' } },
  /** Writes frames 0 to 76 whole, cuts frame 77's file in half, writes none after, and reports success (criterion 3). */
  truncates: { name: 'suite-truncates', frame_delay: 0, behaviour: { does: 'truncates', cut_at: 77 } },
  /** Fails at its open (criterion 9). */
  failsOpen: { name: 'suite-fails-open', frame_delay: 0, behaviour: { does: 'fails_open' } },
  /** Answers every frame up to 500 and never a later one (criterion 6). */
  keeps: { name: 'suite-keeps-frames', frame_delay: 2, behaviour: { does: 'keeps', after: 500 } },
  /** From every 100th frame on, answers nothing until no frame has come for 400 ms; reports the most frames it held
   * unanswered (criterion 12). */
  slow: { name: 'suite-slow', frame_delay: 3, behaviour: { does: 'slow', hold_every: 100, quiet_ms: 400 } },
} as const satisfies Record<string, SuiteTool>;
export const toolId = (t: SuiteTool): string => `${t.name}@1.0.0`;

function unfixture(dir: string): void {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (lstatSync(path).isDirectory()) unfixture(path);
    else if (name.endsWith('.fixture')) renameSync(path, join(dir, name.slice(0, -'.fixture'.length)));
  }
}
/** The test plug-in for `tool`, laid in `dir`: its manifest, its code, and the tool's program and plan in ./tool. */
export function toolPlugin(dir: string, tool: SuiteTool): string {
  cpSync(join(FIXTURES, 'plugin'), dir, { recursive: true });
  cpSync(join(FIXTURES, 'tool'), join(dir, 'tool'), { recursive: true });
  unfixture(dir);
  writeFileSync(join(dir, 'tool', 'plan.json'), `${JSON.stringify({ tool: tool.name, version: '1.0.0', frame_delay: tool.frame_delay, behaviour: tool.behaviour }, null, 2)}\n`);
  const path = join(dir, 'deepbuild.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as JsonObject;
  manifest['id'] = `test/encode-${tool.name}`;
  manifest['job_tools'] = [{ kind: 'encode', tool: toolId(tool) }];
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}
/**
 * What the hub holds of a plug-in's encode tool, as the scenario's `job_tools` names it (README: `job_tools`): the
 * descriptor the plug-in's own code hands `deep.registerJobTool`, and the command the host runs the tool by (#1922:
 * Node on `<run.dir>/<run.entry>`, its working folder `run.dir`).
 */
export function jobTool(dir: string): JsonObject {
  const ran = spawnSync(process.execPath, [join(FIXTURES, 'register.mjs'), dir], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  expect(ran.status, `the test plug-in in ${dir} registers (node fixtures/register.mjs): ${ran.stderr.slice(-1500)}`).toBe(0);
  const calls = arr(JSON.parse(ran.stdout) as JsonValue, 'the plug-in\'s registrations').map((c, i) => obj(c, `registration ${i}`));
  expect(calls.map((c) => c['method']), 'the test plug-in registers one tool through deep.registerJobTool, and nothing else').toEqual(['registerJobTool']);
  const args = arr(calls[0]!['args'], 'deep.registerJobTool\'s arguments');
  expect(args[0], 'the tool joins the job kind encode').toBe('encode');
  const d = obj(args[1], 'the tool\'s descriptor');
  const run = obj(d['run'], 'the descriptor\'s run');
  const folder = join(dir, str(run['dir'], 'run.dir'));
  const manifest = JSON.parse(readFileSync(join(dir, 'deepbuild.json'), 'utf8')) as JsonObject;
  return {
    kind: 'encode', tool: str(d['tool'], 'the descriptor\'s tool'), plugin: str(manifest['id'], 'the manifest\'s id'),
    codecs: arr(d['codecs'], 'codecs'), containers: arr(d['containers'], 'containers'), hardware: d['hardware'] === true,
    input: str(d['input'], 'input'), frame_delay: d['frame_delay'] as number,
    argv: [process.execPath, join(folder, str(run['entry'], 'run.entry'))], cwd: folder,
  };
}
/** A fresh folder holding the test plug-in for `tool`, removed with `dir`, and its `job_tools` entry. */
export function suiteTool(dir: string, tool: SuiteTool): JsonObject {
  return jobTool(toolPlugin(join(mkdtempSync(join(dir, 'plugin-')), 'p'), tool));
}

// ---------------------------------------------------------------------------------------------------
// Runs

export interface RunOpts { planted?: Planted; tools?: JsonObject[] }
/** A scenario: document a presented, then `calls`; the hub's encode tools in `job_tools`, a wrong program in
 * `planted`. */
export function filmScenario(evidence: string, document: JsonObject | null, calls: JsonObject[], o: RunOpts = {}): JsonObject {
  const extra: JsonObject = {};
  if (o.planted) extra['planted'] = o.planted;
  if (o.tools) extra['job_tools'] = o.tools;
  return scenario(evidence, [...(document ? [present(DOC.a, document)] : []), ...calls], extra);
}
const label = (what: string, o: RunOpts): string => (o.planted ? `${what} (planted ${o.planted})` : what);
/** One scenario through `deep-show run`: the replies to `calls` (the document's own is checked and left out). */
export function filmRun(bin: string, evidence: string, document: JsonObject | null, calls: JsonObject[], what: string, o: RunOpts = {}): JsonObject[] {
  const replies = runShow(bin, filmScenario(evidence, document, calls, o), label(what, o));
  if (!document) return replies;
  presented(replies[0]!, `${label(what, o)}: the document`);
  return replies.slice(1);
}

/** The export guards' fixture film (#157's `filmDoc`: 160 × 90 at 24 fps, a ground, a side panel and bars that move a
 * pixel a frame, a 48 kHz stereo tone), `seconds` long. */
export const film = (evidence: string, seconds: number, o: Partial<FilmSpec> = {}): JsonObject => filmDoc(evidence, { frames: seconds * 24, ...o });
/** The 60 s fixture film's counts. */
export const FILM60 = { seconds: 60, frames: 1440, last: 1439, samples: 2_880_000, size: [160, 90] as [number, number] } as const;
/** An export that names a tool its brief pins (README: `export`). */
export const pinned = (tool: string): JsonObject => ({ tool, brief: { tools: [tool] } });
/** A PNG sequence, the codec every BGRA8 test tool writes. */
export const PNG_SEQ: JsonObject = { video: { codec: 'png_seq' } };

export interface WatchCtl { pid: number; elapsedMs: number; stop: (reason: string) => void }
export interface Watched { status: number | null; stdout: string; stderr: string; replies: JsonObject[] | null; ms: number; stopped: string | null }
/**
 * `deep-show run` started asynchronously and watched from outside: `tick` is called every `everyMs` while it runs and
 * may stop it, by its own PID, saying why. `ms` is the run's wall time by this process's clock.
 */
export function watchShow(bin: string, sc: JsonObject, o: { tick?: (ctl: WatchCtl) => void; everyMs?: number; timeoutMs?: number } = {}): Promise<Watched> {
  return new Promise((done) => {
    const started = performance.now();
    const child = spawn(bin, ['run'], { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let stopped: string | null = null; let over = false;
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d: Buffer) => { stderr = (stderr + d.toString('utf8')).slice(-20_000); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(`${JSON.stringify(sc)}\n`);
    const stop = (reason: string): void => {
      if (over || stopped !== null || child.pid === undefined) return;
      stopped = reason;
      try { process.kill(child.pid, 'SIGKILL'); } catch { /* it ended first */ }
    };
    const tick = o.tick;
    const poll = tick ? setInterval(() => { try { tick({ pid: child.pid ?? -1, elapsedMs: performance.now() - started, stop }); } catch { /* a file or a process went between listing and reading */ } }, o.everyMs ?? 200) : null;
    const timer = setTimeout(() => stop('still running at the test\'s own limit'), o.timeoutMs ?? 3_000_000);
    const finish = (status: number | null): void => {
      if (over) return;
      over = true;
      if (poll) clearInterval(poll);
      clearTimeout(timer);
      let replies: JsonObject[] | null = null;
      const line = stdout.split('\n').find((l) => l.trim() !== '');
      try {
        const answer = JSON.parse(line ?? 'null') as JsonValue;
        if (isObject(answer) && answer['ok'] === true && Array.isArray(answer['replies'])) replies = answer['replies'].filter(isObject);
      } catch { /* read by the caller from stdout */ }
      done({ status, stdout, stderr, replies, ms: performance.now() - started, stopped });
    };
    child.on('error', (e) => { stderr += e.message; finish(null); });
    child.on('close', (status) => finish(status));
  });
}

/** A watched run's replies to its calls after the document's own, or a failure naming why there are none. */
export function watchedFilm(w: Watched, calls: number, what: string): JsonObject[] {
  expect(w.stopped, `${what}: deep-show run ended by itself`).toBeNull();
  expect(w.status, `${what}: deep-show run exits 0; stdout: ${w.stdout.slice(0, 800)}; stderr: ${w.stderr.slice(-1500)}`).toBe(0);
  expect(w.replies, `${what}: one answer line, ok, with replies: ${w.stdout.slice(0, 800)}`).not.toBeNull();
  expect(w.replies!.length, `${what}: one reply per call`).toBe(calls + 1);
  presented(w.replies![0]!, `${what}: the document`);
  return w.replies!.slice(1);
}

/** The PNG frames under `dir` at any depth, by frame number: what a PNG sequence tool has written so far. */
export function pngsUnder(dir: string): number[] {
  const out: number[] = [];
  const walk = (d: string): void => {
    let names: string[] = [];
    try { names = readdirSync(d); } catch { return; }
    for (const e of names) {
      const m = /^(\d{6})\.png$/.exec(e);
      if (m) { out.push(Number(m[1])); continue; }
      let isDir = false;
      try { isDir = statSync(join(d, e)).isDirectory(); } catch { continue; }
      if (isDir) walk(join(d, e));
    }
  };
  walk(dir);
  return out;
}

/** Each descendant process of `pid` now: its PID, resident memory in bytes and command line. */
export function descendants(pid: number): { pid: number; rss: number; command: string }[] {
  const table = spawnSync('ps', ['-ax', '-o', 'pid=,ppid=,rss=,command='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (table.status !== 0) return [];
  const rows = table.stdout.split('\n').map((l) => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(l)).filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), rss: Number(m[3]) * 1024, command: m[4]! }));
  const ours = new Set<number>([pid]);
  for (let grew = true; grew;) { grew = false; for (const r of rows) if (!ours.has(r.pid) && ours.has(r.ppid)) { ours.add(r.pid); grew = true; } }
  return rows.filter((r) => r.pid !== pid && ours.has(r.pid)).map(({ pid: p, rss, command }) => ({ pid: p, rss, command }));
}

/** Why a clock reading taken now doesn't count: the one-minute load is above the core count (or can't be read). */
export function loadProblem(): string | null {
  const load = loadavg()[0];
  const cores = availableParallelism();
  if (load === undefined || !Number.isFinite(load)) return 'the machine\'s load can\'t be read';
  return load > cores ? `the one-minute load is ${load.toFixed(1)}, above the ${cores} cores` : null;
}

// ---------------------------------------------------------------------------------------------------
// Readers of a reply (README: the receipt, the outcomes)

export interface Encoder { name: string; version: string; hardware: boolean; tool: string; raw: JsonObject }
/** The receipt's `encoder {name, version, hardware}`, read strictly; `tool` is name@version. */
export function encoderOf(receipt: JsonObject, what: string): Encoder {
  const e = obj(receipt['encoder'], `${what}: receipt.encoder`);
  const name = str(e['name'], `${what}: receipt.encoder.name`);
  const version = str(e['version'], `${what}: receipt.encoder.version`);
  expect(typeof e['hardware'], `${what}: receipt.encoder.hardware is true or false, got ${show(e['hardware'] ?? null)}`).toBe('boolean');
  return { name, version, hardware: e['hardware'] === true, tool: `${name}@${version}`, raw: e };
}
/** A tool's name@version as the job API holds one (packages/extension-host/src/job-kinds.ts, `TOOL`). */
export const TOOL_ID = /^[a-z0-9][a-z0-9_-]*@\d+\.\d+\.\d+$/;
/** The receipt's `handoff`: how the frames reached the tool. */
export function handoffOf(receipt: JsonObject, what: string): 'surface' | 'copy' {
  const h = receipt['handoff'];
  expect(h === 'surface' || h === 'copy', `${what}: receipt.handoff is surface or copy, got ${show(h ?? null)}`).toBe(true);
  return h as 'surface' | 'copy';
}
/** A test tool's own report, as the receipt carries it in `encoder.report` (README: the receipt). */
export function reportOf(receipt: JsonObject, what: string): JsonObject {
  return obj(encoderOf(receipt, what).raw['report'], `${what}: receipt.encoder.report (the tool's own report)`);
}
/** The frame hashes a tool reports it was handed, in order. */
export function reportedFrames(receipt: JsonObject, what: string): string[] {
  return arr(reportOf(receipt, what)['frames'], `${what}: receipt.encoder.report.frames`).map((h, i) => hex64(h, `${what}: receipt.encoder.report.frames[${i}]`));
}
/** Every issue of a reply that isn't a delivery. */
export const issuesIn = (reply: JsonObject): JsonObject[] => (Array.isArray(reply['issues']) ? reply['issues'].filter(isObject) : []);
/** Whether a BLOCKED reply names a codec: in its own `codec`, or in the `codec` of the issue that blocked it. */
export const namesCodec = (reply: JsonObject, codec: string): boolean => reply['codec'] === codec || issuesIn(reply).some((i) => i['codec'] === codec);
/** Whether a reply names a tool: in its own `tool`, or in the `tool` of one of its issues. */
export const namesTool = (reply: JsonObject, tool: string): boolean => reply['tool'] === tool || issuesIn(reply).some((i) => i['tool'] === tool);
/**
 * Whether an export.color issue names the colour tags a file was written with, `nclx` being primaries, transfer and
 * matrix: in its `tags.nclx`, in its text as `p-t-m`, or as the three fields the base's issue quotes.
 */
export function namesTags(issue: JsonObject, nclx: [number, number, number]): boolean {
  const tags = issue['tags'];
  if (isObject(tags) && Array.isArray(tags['nclx']) && tags['nclx'].length === 3 && tags['nclx'].every((v, i) => v === nclx[i])) return true;
  const text = JSON.stringify(issue);
  if (text.includes(nclx.join('-'))) return true;
  return (['primaries', 'transfer', 'matrix'] as const).every((k, i) => new RegExp(`\\\\?"${k}\\\\?":\\s*${nclx[i]!}\\b`).test(text));
}
/** Everything under `dir`, files and folders, by relative path, sorted; none when `dir` isn't there. An export that
 * wasn't delivered leaves none of them: no file, and no temporary folder either. */
export function entriesIn(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string, prefix: string): void => {
    let names: string[] = [];
    try { names = readdirSync(d).sort(); } catch { return; }
    for (const e of names) {
      out.push(join(prefix, e));
      let isDir = false;
      try { isDir = lstatSync(join(d, e)).isDirectory(); } catch { continue; }
      if (isDir) walk(join(d, e), join(prefix, e));
    }
  };
  walk(dir, '');
  return out;
}
/** How many files of exactly `bytes` bytes the evidence store holds: with `readback: true` an export keeps each
 * frame it draws there, so the count says how many frames were drawn. */
export function filesOfSize(evidence: string, bytes: number): number {
  let n = 0;
  const walk = (d: string): void => {
    let names: string[] = [];
    try { names = readdirSync(d); } catch { return; }
    for (const e of names) {
      let st;
      try { st = statSync(join(d, e)); } catch { continue; }
      if (st.isDirectory()) walk(join(d, e)); else if (st.size === bytes) n++;
    }
  };
  walk(evidence);
  return n;
}

// ---------------------------------------------------------------------------------------------------
// Whether this machine's decode worker decodes AV1 (criterion 2), asked of the decode worker itself with an AV1 file
// the suite makes with FFmpeg, apart from every encode tool under test. Without an FFmpeg that encodes AV1 the answer
// can't be had, and the tests that need it are BLOCKED.

const AV1_ENCODERS: [string, string[]][] = [
  ['libsvtav1', ['-c:v', 'libsvtav1', '-preset', '12', '-crf', '35']],
  ['libaom-av1', ['-c:v', 'libaom-av1', '-cpu-used', '8', '-crf', '35', '-b:v', '0']],
  ['librav1e', ['-c:v', 'librav1e', '-speed', '10', '-qp', '120']],
];
/** A half-second 160 × 90 AV1 film in an MP4 at `path`, made by FFmpeg. */
function av1Sample(path: string): void {
  const { ffmpeg } = ffmpegTools();
  const listed = spawnSync(ffmpeg, ['-hide_banner', '-encoders'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const found = AV1_ENCODERS.find(([name]) => new RegExp(`\\s${name}\\s`).test(listed.stdout ?? ''));
  if (!found) blocked('whether the decode worker decodes AV1 is asked with an AV1 file made by FFmpeg, and this FFmpeg lists none of libsvtav1, libaom-av1 and librav1e. Unblock: install an FFmpeg built with one (brew install ffmpeg), or name it in DEEP_FFMPEG');
  const made = spawnSync(ffmpeg, ['-hide_banner', '-v', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=24:duration=0.5', '-pix_fmt', 'yuv420p', ...found![1], '-an', '-movflags', '+faststart', path], { encoding: 'utf8' });
  if (made.status !== 0 || !existsSync(path)) blocked(`FFmpeg's ${found![0]} could not make the AV1 file the decode worker is asked with: ${(made.stderr ?? '').slice(-800)}`);
}
/** Whether the decode worker of `bin` decodes AV1 on this machine: it is asked to decode one frame of an AV1 file. */
export function decodesAv1(bin: string, evidence: string, dir: string): boolean {
  const path = join(dir, 'av1-sample.mp4');
  av1Sample(path);
  const out = join(dir, 'av1-decoded');
  const [reply] = runShow(bin, scenario(evidence, [mediaDecode(path, out, { format: 'bgra', video_frames: 1 })]), 'the decode worker asked to decode an AV1 file');
  const decoded = reply!['decoded'];
  if (!isObject(decoded) || !Array.isArray(decoded['streams'])) return false;
  return decoded['streams'].some((s) => isObject(s) && s['type'] === 'video' && Array.isArray(s['frames'])
    && s['frames'].some((f) => isObject(f) && typeof f['file'] === 'string' && existsSync(join(out, f['file']))));
}


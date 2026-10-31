// Test-side tools for the #124 acceptance tests (README: The surface): the `deep-drive` binary built once and driven
// over its stdin, the recorded-run format and its replay, the verdict engine judging a replay's journey, the PNG reader,
// and the judges each criterion's tests share with the wrong programs they plant. Nothing here stands in for the
// replica: every reply comes from the binary, every frame from its files, every verdict from @deepbuild/verdicts.
// Processes are stopped by PID; nothing is stopped by name or port.
//
// Reused by import: #26's helpers (temporary homes, the seeded record, `deep hub run`, the hub's log) and #377's PNG reader.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { verdict, type ClaimInput, type Failure, type JourneyStep, type EvidenceSlot, type Verdict } from '../../../packages/verdicts/src/index.ts';
import * as t26 from '../26/helpers.ts';
import { decodePng, type Image } from '../377/helpers.ts';

export { t26, decodePng, type Image };
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Obj = { [key: string]: any };

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, '..', '..', '..');
export const FIXTURES = join(HERE, 'fixtures');
export const PANEL = {
  form: join(FIXTURES, 'panels', 'save-form'),
  twin: join(FIXTURES, 'panels', 'save-form-twin'),
  tries: join(FIXTURES, 'panels', 'tries'),
  many: join(FIXTURES, 'panels', 'many-nodes'),
};
export const RUNS = { 'claude-code': join(FIXTURES, 'runs', 'claude-code.run.json'), codex: join(FIXTURES, 'runs', 'codex.run.json') } as const;

/** The criteria, by `#124.<first 8 hex of SHA-256(text, whitespace collapsed)>` (scripts/proof-change.mjs, criterionId). */
export const ID = {
  replay: '#124.b486fffb',
  isolation: '#124.ca91d3c1',
  repeat: '#124.3c201481',
  mask: '#124.46173b23',
  budgets: '#124.b8efd107',
} as const;

/** The issue's numbers. */
export const FLICKS_PER_SECOND = 705_600_000;
export const FPS = 30;
export const FRAME_FLICKS = FLICKS_PER_SECOND / FPS; // 23,520,000
export const TIMEOUT_DEFAULT_MS = 5000;
export const SCROLL_PX = 200;
export const SCALE = 2;
export const LAUNCH_MS = 2000;
export const ACTION_MS = 50;
export const SNAPSHOT_MS = 20;
export const SNAPSHOT_NODES = 2000;
export const MEMORY_BYTES = 500_000_000;
export const REPLICAS_PER_MACHINE = 2;
/** The look's ink role, the mask's default fill: brand/palette.json's ink, opaque. */
export const INK: [number, number, number, number] = [...(JSON.parse(readFileSync(join(REPO, 'brand', 'palette.json'), 'utf8')).ink.rgb as [number, number, number]), 255];
/** The fixture field's fill (fixtures/panels/save-form/main.js, FIELD), drawn nowhere else. */
export const FIELD: [number, number, number] = [0x36, 0xd3, 0x99];
/** What fixtures/panels/tries writes to the clipboard on each click. */
export const MARKER = 'deepbuild-124-replica-clipboard-marker';
export const LIVE_VARIABLE = 'DEEP_DRIVE_LIVE';
export const LIVE = process.env[LIVE_VARIABLE] === '1';

export const sha256 = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function requireMacos(): void {
  if (process.platform !== 'darwin') expect.fail('INCONCLUSIVE: the replica renders with GPUI\'s offscreen Metal renderer, on macOS only; this is not a pass');
}

// ---------------------------------------------------------------------------------------------------
// Temporary folders (short: a socket path must fit in 104 bytes) and the processes this suite started.

const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dd124-'));
  made.push(dir);
  return dir;
}
const owned = new Set<number>();
export const own = (pid: number | undefined): void => { if (pid) { owned.add(pid); t26.own(pid); } };
export async function cleanup(): Promise<void> {
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 3000;
  while ([...owned].some(t26.alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) if (t26.alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  await t26.cleanup();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------------------------------
// The binary: `deep-drive`, a bin target of crates/deep-replica (README: The surface).

export const DRIVE_NAME = 'deep-drive';
export const DRIVE_BIN = join(REPO, 'target', 'debug', DRIVE_NAME);
let built: string | undefined;
/** Builds `deep-drive` once per process; BLOCKED with cargo's own words when it can't be built. */
export function buildDrive(): void {
  if (built === 'ok') return;
  if (built === undefined) {
    const r = spawnSync('cargo', ['build', '--locked', '-p', 'deep-replica', '--bin', DRIVE_NAME], { cwd: REPO, encoding: 'utf8', timeout: 1_800_000, maxBuffer: 64 * 1024 * 1024 });
    built = r.status === 0 && existsSync(DRIVE_BIN) ? 'ok' : `${r.error?.message ?? ''}${(r.stderr ?? '').split('\n').filter((l) => /error/.test(l)).slice(0, 6).join('\n')}`;
  }
  if (built !== 'ok') expect.fail(`BLOCKED: the ${DRIVE_NAME} binary can't be built (cargo build --locked -p deep-replica --bin ${DRIVE_NAME}): ${built}`);
}

export interface Reply { reply: Obj; ms: number }
/** One `deep-drive --out <dir>` process: JSON lines in on stdin, one JSON line back on stdout per call. */
export class Drive {
  private buffer = '';
  private readonly waiting: ((line: Obj) => void)[] = [];
  private exited = false;
  private constructor(readonly child: ChildProcess, readonly out: string, private stderr: string[] = []) {
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      this.buffer += d;
      for (let i = this.buffer.indexOf('\n'); i >= 0; i = this.buffer.indexOf('\n')) {
        const text = this.buffer.slice(0, i);
        this.buffer = this.buffer.slice(i + 1);
        let line: Obj;
        try { line = JSON.parse(text) as Obj; } catch { line = { unparsed: text }; }
        this.waiting.shift()?.(line);
      }
    });
    child.stderr!.setEncoding('utf8').on('data', (d: string) => { this.stderr.push(d); if (this.stderr.length > 200) this.stderr.shift(); });
    child.on('exit', () => { this.exited = true; for (const wake of this.waiting.splice(0)) wake({ exited: true, stderr: this.log() }); });
  }
  get pid(): number { return this.child.pid!; }
  log(): string { return this.stderr.join('').slice(-2000); }

  /** Starts the binary with `env` over this environment (HOME a temp home unless given); waits for `{"ready": true}`. */
  static async start(o: { home?: string; plant?: string; env?: Record<string, string | undefined> } = {}): Promise<Drive> {
    buildDrive();
    const out = join(tempDir(), 'out');
    mkdirSync(out, { recursive: true });
    const home = o.home ?? join(dirname(out), 'h');
    mkdirSync(home, { recursive: true });
    const env = t26.childEnv(home, { DEEP_DRIVE_PLANT: o.plant, ...o.env });
    const child = spawn(DRIVE_BIN, ['--out', out], { cwd: REPO, env, stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    const drive = new Drive(child, out);
    const first = await drive.next(120_000);
    if (first.ready !== true) expect.fail(`BLOCKED: ${DRIVE_NAME} didn't say {"ready": true}${o.plant ? ` with DEEP_DRIVE_PLANT=${o.plant}` : ''}: ${JSON.stringify(first).slice(0, 400)} ${drive.log()}`);
    return drive;
  }
  private next(timeoutMs: number): Promise<Obj> {
    if (this.exited) return Promise.resolve({ exited: true, stderr: this.log() });
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ timedOut: timeoutMs }), timeoutMs);
      this.waiting.push((line) => { clearTimeout(timer); resolve(line); });
    });
  }
  /** One call; its reply and the wall time from writing the line to reading the answer. */
  async call(args: Obj, timeoutMs = 120_000): Promise<Reply> {
    const at = performance.now();
    const answer = this.next(timeoutMs);
    this.child.stdin!.write(`${JSON.stringify(args)}\n`);
    const reply = await answer;
    const ms = performance.now() - at;
    if (reply.exited || reply.timedOut || reply.unparsed !== undefined) expect.fail(`BLOCKED: ${DRIVE_NAME} gave no JSON reply to ${String(args.call)}: ${JSON.stringify(reply).slice(0, 600)}`);
    return { reply, ms };
  }
  /** Stops the process by its PID. */
  async stop(): Promise<void> {
    try { this.child.stdin!.end(); } catch { /* closed */ }
    const deadline = Date.now() + 5000;
    while (!this.exited && Date.now() < deadline) await sleep(20);
    if (!this.exited) try { process.kill(this.pid, 'SIGKILL'); } catch { /* gone */ }
  }
}

/** A call that must succeed: its reply, failing the test with the binary's words when `ok` isn't true. */
export async function must(drive: Drive, args: Obj, what = String(args.call)): Promise<Obj> {
  const { reply } = await drive.call(args);
  expect(reply.ok, `${what}: ${JSON.stringify(reply).slice(0, 800)}`).toBe(true);
  return reply;
}
/** A fresh replica on `panel`; its handle. */
export async function launch(drive: Drive, launchArgs: Obj): Promise<string> {
  const reply = await must(drive, { call: 'launch', launch: launchArgs }, 'launch');
  expect(reply.replica, 'launch answers the replica\'s handle').toMatch(/^replica:[0-9A-Za-z]+$/);
  return reply.replica as string;
}

// ---------------------------------------------------------------------------------------------------
// Snapshots (#338's shape): {window, tree: Node, items}; a node is {role, name, value, bounds: [x, y, w, h], children}.

export interface Node { role: string; name: string | null; value: Json; bounds: [number, number, number, number]; children: Node[] }
export function flatten(node: Node, into: Node[] = []): Node[] {
  into.push(node);
  for (const child of node.children ?? []) flatten(child, into);
  return into;
}
export function nodesOf(snapshot: Obj): Node[] {
  expect(snapshot?.tree, `a snapshot has a tree: ${JSON.stringify(snapshot).slice(0, 300)}`).toBeTruthy();
  return flatten(snapshot.tree as Node);
}
/** The one node of a role (and name, when given); fails naming every match otherwise. */
export function only(snapshot: Obj, role: string, name?: string): Node {
  const found = nodesOf(snapshot).filter((n) => n.role === role && (name === undefined || n.name === name));
  expect(found.length, `exactly one ${role}${name ? ` named ${name}` : ''} in the snapshot, got ${JSON.stringify(found.map((n) => [n.name, n.bounds]))}`).toBe(1);
  return found[0]!;
}
export type Box = [number, number, number, number];
export const inside = (p: [number, number], b: Box): boolean => p[0] >= b[0] && p[0] < b[0] + b[2] && p[1] >= b[1] && p[1] < b[1] + b[3];

// ---------------------------------------------------------------------------------------------------
// Recorded runs (README: Recorded runs) and their replay.

export interface RunFile { format: 'deep_drive.run@1'; agent: { name: 'claude-code' | 'codex'; version: string }; session: string; panel: string; calls: Obj[] }
export function readRun(path: string): RunFile {
  const run = JSON.parse(readFileSync(path, 'utf8')) as RunFile;
  expect(run.format, `${path} is a deep_drive.run@1 file`).toBe('deep_drive.run@1');
  return run;
}
/**
 * A recorded run replayed in a fresh replica on `panel`: its launch with the panel put in, every other call with the new
 * replica's handle, then `close` if the run didn't end with one. The replies, in order, and the close's journey.
 */
export async function replay(run: RunFile, panel: string, o: { plant?: string; strip?: (call: Obj) => boolean; started?: (drive: Drive) => void } = {}): Promise<{ replies: Obj[]; journey: Obj; drive: Drive }> {
  const drive = await Drive.start(o.plant ? { plant: o.plant } : {});
  o.started?.(drive);
  const replies: Obj[] = [];
  let handle: string | null = null;
  const calls = run.calls.filter((c) => !o.strip?.(c));
  if (calls.at(-1)?.call !== 'close') calls.push({ call: 'close' });
  for (const c of calls) {
    const args = structuredClone(c);
    if (args.call === 'launch') args.launch = { ...args.launch, panel };
    else args.replica = handle;
    const { reply } = await drive.call(args);
    replies.push(reply);
    if (args.call === 'launch') {
      expect(reply.ok, `the replay launches a replica on ${panel}: ${JSON.stringify(reply).slice(0, 600)}`).toBe(true);
      handle = reply.replica;
    }
  }
  const closed = replies.at(-1)!;
  expect(closed.ok, `close answers the run's journey: ${JSON.stringify(closed).slice(0, 600)}`).toBe(true);
  expect(closed.journey, 'close answers the run\'s journey').toBeTruthy();
  return { replies, journey: closed.journey as Obj, drive };
}

// ---------------------------------------------------------------------------------------------------
// The verdict engine on a replay's journey: the run record a journey check's runner makes from `close`'s journey.

const COMMIT = 'a'.repeat(40);
export const JOURNEY_CHECK = 'journey:save-form';
export const REQ = 'req:01KB124SAVEFORM00000000000#R1';
/**
 * Judges one journey as the one run of the definition's journey check on the claim's commit. The requirement is one that
 * must keep passing (`on_base: 'passes'`), so the engine needs no merge-base run and a failure is the claim's own: it
 * becomes a send-back, not a fix task.
 */
export function judge(journey: Obj, claim = 'claim:01KB124CLAIM0000000000000001'): Verdict {
  const check = {
    check: JOURNEY_CHECK, digest: `d1:${sha256('journey save-form')}`, source: 'definition' as const, depth: 'journey' as const, proof: 'journey' as const,
    covers: [REQ], environment: { os: 'darwin-arm64' }, tools: { 'deep-drive': '0.0.0' },
  };
  const input: ClaimInput = {
    claim, agent: 'session:01KB124AGENT000000000000001', repo: 'deepbuild', task: 'task:01KB124TASK00000000000000001', commit: COMMIT,
    requirements: [{ req: REQ, depth: 'journey', oracle: 'code', on_base: 'passes' }],
    checks: [check],
    runs: [{
      run: 'run:01KB124RUN000000000000000001', check: JOURNEY_CHECK, claim, commit: COMMIT, digest: check.digest, environment: check.environment, tools: check.tools,
      outcome: journey.outcome, ended: Date.UTC(2026, 9, 30), tests_run: journey.tests_run, reads: [], failures: journey.failures as Failure[],
      evidence: journey.evidence as EvidenceSlot[], kept: true, steps: journey.steps as JourneyStep[],
    }],
    changes: [], waivers: [], now: Date.UTC(2026, 9, 30, 1),
  };
  return verdict(input);
}

// ---------------------------------------------------------------------------------------------------
// Criterion 4's judge: a masked recording against an unmasked recording of the same run (README: Criterion 4).

export interface Frame { t: number; image: Image; masks: Box[] }
export interface Recording { frames: Frame[]; fill: number[] }
const at = (img: Image, x: number, y: number): number => (y * img.width + x) * 4;
const isField = (img: Image, o: number): boolean => img.rgba[o] === FIELD[0] && img.rgba[o + 1] === FIELD[1] && img.rgba[o + 2] === FIELD[2];
/**
 * Every way the masked recording breaks criterion 4, frame by frame: none for a recording whose every frame, mid-scroll
 * ones included, fills the field's box with the ink role and leaves no pixel of the field showing anywhere. `start` and
 * `end` are the field's bounds from `see` before and after the scroll; `scrollPx` the scroll in points.
 */
export function maskProblems(masked: Recording, unmasked: Recording, o: { start: Box; end: Box; scrollPx: number; scale: number }): string[] {
  const problems: string[] = [];
  const p = (s: string) => { if (problems.length < 40) problems.push(s); };
  if (!masked.fill || masked.fill.length !== 4 || masked.fill.some((v, i) => v !== INK[i])) p(`the mask fills with ${JSON.stringify(masked.fill)}, not the look's ink role ${JSON.stringify(INK)}`);
  const fill = INK;
  if (masked.frames.length < 2) p(`the recording has ${masked.frames.length} frames`);
  if (masked.frames.length !== unmasked.frames.length) p(`the masked recording has ${masked.frames.length} frames and the unmasked one of the same run ${unmasked.frames.length}`);
  for (let i = 1; i < masked.frames.length; i++) {
    const step = masked.frames[i]!.t - masked.frames[i - 1]!.t;
    if (step !== FRAME_FLICKS) p(`frame ${i} comes ${step} flicks after frame ${i - 1}, not one frame at ${FPS} fps (${FRAME_FLICKS}): a frame is missing or extra`);
  }
  const ys: number[] = [];
  masked.frames.forEach((frame, k) => {
    const plain = unmasked.frames[k];
    if (!plain || plain.t !== frame.t) { p(`frame ${k} at ${frame.t} has no unmasked frame at the same time`); return; }
    const img = frame.image;
    if (img.width !== plain.image.width || img.height !== plain.image.height) { p(`frame ${k} is ${img.width}x${img.height}, its unmasked twin ${plain.image.width}x${plain.image.height}`); return; }
    if (frame.masks.length !== 1) { p(`frame ${k} lists ${frame.masks.length} masked boxes, not the email field's one`); return; }
    const box = frame.masks[0]!;
    ys.push(box[1]);
    if (box[0] !== o.start[0] || box[2] !== o.start[2] || box[3] !== o.start[3]) p(`frame ${k}'s masked box ${JSON.stringify(box)} isn't the field's x, width and height ${JSON.stringify(o.start)}`);
    const x0 = Math.max(0, box[0]), y0 = Math.max(0, box[1]), x1 = Math.min(img.width, box[0] + box[2]), y1 = Math.min(img.height, box[1] + box[3]);
    let wrong = 0, first: [number, number] | null = null;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const q = at(img, x, y);
      if (img.rgba[q] !== fill[0] || img.rgba[q + 1] !== fill[1] || img.rgba[q + 2] !== fill[2] || img.rgba[q + 3] !== fill[3]) { wrong++; first ??= [x, y]; }
    }
    if (wrong) p(`frame ${k} (t ${frame.t}): ${wrong} pixels inside the field's box ${JSON.stringify(box)} aren't the fill role, first at ${JSON.stringify(first)}`);
    let leaked = 0, shown = 0, outside = 0, differs = 0;
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
      const q = at(img, x, y);
      const inBox = inside([x, y], box);
      // The one-pixel band around the box holds the field's anti-aliased edge where its bounds fall between pixels; it isn't judged.
      const edge = !inBox && inside([x, y], [box[0] - 1, box[1] - 1, box[2] + 2, box[3] + 2]);
      if (isField(img, q) && !edge) leaked++;
      if (isField(plain.image, q)) { shown++; if (!inBox && !edge) outside++; }
      if (!inBox && !edge && (img.rgba[q] !== plain.image.rgba[q] || img.rgba[q + 1] !== plain.image.rgba[q + 1] || img.rgba[q + 2] !== plain.image.rgba[q + 2] || img.rgba[q + 3] !== plain.image.rgba[q + 3])) differs++;
    }
    if (leaked) p(`frame ${k} (t ${frame.t}): ${leaked} pixels of the email field show in the masked recording`);
    if (!shown) p(`frame ${k} (t ${frame.t}): the unmasked recording shows no pixel of the email field, so the run doesn't keep the field on screen`);
    if (outside) p(`frame ${k} (t ${frame.t}): ${outside} pixels of the field lie outside the masked box ${JSON.stringify(box)}: the mask isn't at the field's bounds in that frame`);
    if (differs) p(`frame ${k} (t ${frame.t}): ${differs} pixels outside the masked box differ from the unmasked recording`);
  });
  if (ys.length) {
    if (ys[0] !== o.start[1]) p(`the first frame masks at y ${ys[0]}, the field's y before the scroll is ${o.start[1]}`);
    if (ys.at(-1) !== o.end[1]) p(`the last frame masks at y ${ys.at(-1)}, the field's y after the scroll is ${o.end[1]}`);
    if (o.start[1] - o.end[1] !== o.scrollPx * o.scale) p(`the field moved ${o.start[1] - o.end[1]} device px, not ${o.scrollPx} px at ${o.scale}x`);
    const lo = Math.min(o.start[1], o.end[1]), hi = Math.max(o.start[1], o.end[1]);
    if (!ys.some((y) => y > lo && y < hi)) p('no frame was recorded mid-scroll: every masked box is at the field\'s place before or after the scroll');
  }
  return problems;
}

/** The actions list against the calls made while recording: one entry per action, each click's point in its element's box. */
export function actionProblems(actions: Obj[], expected: { kind: string; box?: Box }[]): string[] {
  const problems: string[] = [];
  if (!Array.isArray(actions)) return [`the recording has no actions list: ${JSON.stringify(actions)}`];
  if (actions.length !== expected.length) problems.push(`the actions list holds ${actions.length} entries for ${expected.length} actions`);
  expected.forEach((e, i) => {
    const a = actions[i];
    if (!a) return;
    if (a.kind !== e.kind) problems.push(`entry ${i} is a ${a.kind}, the action was a ${e.kind}`);
    if (typeof a.t !== 'number' || (i > 0 && typeof actions[i - 1]?.t === 'number' && a.t < actions[i - 1]!.t)) problems.push(`entry ${i}'s time ${a.t} isn't a time in order`);
    if (!Array.isArray(a.point) || a.point.length !== 2 || !Array.isArray(a.box) || a.box.length !== 4) { problems.push(`entry ${i} has no point and box: ${JSON.stringify(a)}`); return; }
    if (!a.locator) problems.push(`entry ${i} names no locator`);
    if (e.box) {
      if (JSON.stringify(a.box) !== JSON.stringify(e.box)) problems.push(`entry ${i}'s box ${JSON.stringify(a.box)} isn't the clicked element's bounds ${JSON.stringify(e.box)}`);
      if (!inside(a.point as [number, number], e.box)) problems.push(`click ${i}'s point ${JSON.stringify(a.point)} lies outside the clicked element's box ${JSON.stringify(e.box)}`);
    }
  });
  return problems;
}

/** A recording's frames read from the files its `record` stop names, each checked against its hash. */
export function readFrames(stop: Obj): Recording {
  expect(Array.isArray(stop.frames) && stop.frames.length > 0, `record stop lists its frames: ${JSON.stringify(stop).slice(0, 400)}`).toBe(true);
  const frames = (stop.frames as Obj[]).map((f, k) => {
    const bytes = readFileSync(f.path as string);
    expect(sha256(bytes), `frame ${k}'s file hashes to its sha256`).toBe(f.sha256);
    return { t: f.t as number, image: decodePng(bytes), masks: (f.masks ?? []) as Box[] };
  });
  return { frames, fill: stop.fill as number[] };
}

// ---------------------------------------------------------------------------------------------------
// What a replica must never touch on this Mac (README: Criterion 2): the frontmost app, the pasteboard, the audio out.

const sh = (command: string, args: string[]): string => {
  const r = spawnSync(command, args, { encoding: 'utf8', timeout: 10_000 });
  return r.status === 0 ? r.stdout.trim() : '';
};
export const frontApp = (): { asn: string; pid: number | null } => {
  const asn = sh('lsappinfo', ['front']);
  const pid = Number(/"pid"=(\d+)/.exec(sh('lsappinfo', ['info', '-only', 'pid', asn]))?.[1]);
  return { asn, pid: Number.isFinite(pid) ? pid : null };
};
export const pasteboard = (): string => sh('pbpaste', []);
/** The PIDs coreaudiod holds an audio-out assertion for right now (pmset's "Created for PID"). */
export const audioPids = (): number[] => [...sh('pmset', ['-g', 'assertions']).matchAll(/Created for PID: (\d+)\.\s*\n\s*Resources:[^\n]*audio-out/g)].map((m) => Number(m[1]));
/** `pid` and every process under it. */
export function family(pid: number): Set<number> {
  const rows = sh('ps', ['-A', '-o', 'pid=,ppid=']).split('\n').map((l) => l.trim().split(/\s+/).map(Number));
  const all = new Set([pid]);
  for (let grew = true; grew;) {
    grew = false;
    for (const [p, pp] of rows) if (p && pp && all.has(pp) && !all.has(p)) { all.add(p); grew = true; }
  }
  return all;
}
/** Is `pid` registered with LaunchServices as a foreground (Dock) app? */
export function foreground(pid: number): boolean {
  const asn = /ASN:[0-9a-fx-]+/.exec(sh('lsappinfo', ['find', `pid=${pid}`]))?.[0];
  return asn !== undefined && /"ApplicationType"="Foreground"/.test(sh('lsappinfo', ['info', '-only', 'applicationtype', `${asn}:`]));
}

export interface Watch { front: Set<string>; frontPids: Set<number>; marker: boolean; audio: Set<number>; foreground: boolean; pids: Set<number>; samples: number }
/** Samples the frontmost app, the pasteboard, the audio assertions and the replica's processes every 100 ms until stopped, plus 1.5 s after. */
export function watch(pidOf: () => number | undefined): { stop: () => Promise<Watch> } {
  const w: Watch = { front: new Set(), frontPids: new Set(), marker: false, audio: new Set(), foreground: false, pids: new Set(), samples: 0 };
  let running = true;
  const sample = () => {
    const f = frontApp();
    w.front.add(f.asn);
    if (f.pid !== null) w.frontPids.add(f.pid);
    if (pasteboard() === MARKER) w.marker = true;
    for (const p of audioPids()) w.audio.add(p);
    const pid = pidOf();
    if (pid && t26.alive(pid)) for (const p of family(pid)) { w.pids.add(p); if (foreground(p)) w.foreground = true; }
    w.samples++;
  };
  const loop = (async () => { while (running) { sample(); await sleep(100); } })();
  return {
    stop: async () => {
      const until = Date.now() + 1500;
      while (Date.now() < until) { sample(); await sleep(100); }
      running = false;
      await loop;
      return w;
    },
  };
}

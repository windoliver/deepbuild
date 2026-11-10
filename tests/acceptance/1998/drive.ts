// The replica side of #1998's tests (AC2, AC4): `deep-drive`, #124's binary that hosts one replica of the app and
// answers one JSON line per call, built once with cargo, and ⌘K and the box driven through it the way you drive them.
// Adapted from tests/acceptance/366/drive.ts (same repo, same license). Each process is stopped by its PID.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import { FIXTURES, own, REPO, sleep, tempDir, type Line } from './helpers.ts';

export const DRIVE_BIN = join(REPO, 'target', 'debug', 'deep-drive');
/** Flicks a second: the replica's clock. */
export const FLICKS = 705_600_000;

let built: string | undefined;
export function buildDrive(): void {
  if (built === undefined) {
    const r = spawnSync('cargo', ['build', '--locked', '-p', 'deep-replica', '--bin', 'deep-drive'], { cwd: REPO, encoding: 'utf8', timeout: 1_800_000, maxBuffer: 64 << 20, env: { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' } });
    built = r.status === 0 && existsSync(DRIVE_BIN) ? 'ok' : `${r.error?.message ?? ''}${(r.stderr ?? '').split('\n').filter((l) => /error/.test(l)).slice(0, 6).join('\n')}`;
  }
  if (built !== 'ok') expect.fail(`BLOCKED: deep-drive can't be built (cargo build --locked -p deep-replica --bin deep-drive): ${built}`);
}

const running = new Set<Drive>();
export class Drive {
  private buffer = '';
  private readonly waiting: ((line: Line) => void)[] = [];
  private exited = false;
  private readonly stderr: string[] = [];
  private constructor(readonly child: ChildProcess) {
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      this.buffer += d;
      for (let i = this.buffer.indexOf('\n'); i >= 0; i = this.buffer.indexOf('\n')) {
        const text = this.buffer.slice(0, i);
        this.buffer = this.buffer.slice(i + 1);
        let line: Line;
        try { line = JSON.parse(text) as Line; } catch { line = { unparsed: text }; }
        this.waiting.shift()?.(line);
      }
    });
    child.stderr!.setEncoding('utf8').on('data', (d: string) => { this.stderr.push(d); if (this.stderr.length > 100) this.stderr.shift(); });
    child.on('exit', () => { this.exited = true; for (const wake of this.waiting.splice(0)) wake({ exited: true, stderr: this.log() }); });
  }
  log(): string { return this.stderr.join('').slice(-1500); }
  /** One `deep-drive --out <dir>` with HOME `home`; waits for `{"ready": true}`. */
  static async start(home: string): Promise<Drive> {
    buildDrive();
    const out = join(tempDir('drive'), 'out');
    mkdirSync(out, { recursive: true });
    const env: Record<string, string> = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, LANG: 'en_US.UTF-8', TZ: 'UTC', ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}) };
    const drive = new Drive(spawn(DRIVE_BIN, ['--out', out], { cwd: REPO, env, stdio: ['pipe', 'pipe', 'pipe'] }));
    own(drive.child.pid);
    running.add(drive);
    const first = await drive.next(120_000);
    if (first.ready !== true) expect.fail(`BLOCKED: deep-drive didn't say {"ready": true}: ${JSON.stringify(first).slice(0, 400)}`);
    return drive;
  }
  private next(ms: number): Promise<Line> {
    if (this.exited) return Promise.resolve({ exited: true, stderr: this.log() });
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ timedOut: ms }), ms);
      this.waiting.push((line) => { clearTimeout(timer); resolve(line); });
    });
  }
  /** One call and its reply; a process that gives no JSON reply fails the test, BLOCKED. */
  async call(args: Line): Promise<Line> {
    const answer = this.next(120_000);
    this.child.stdin!.write(`${JSON.stringify(args)}\n`);
    const reply = await answer;
    if (reply.exited || reply.timedOut || reply.unparsed !== undefined) expect.fail(`BLOCKED: deep-drive gave no JSON reply to ${String(args.call)}: ${JSON.stringify(reply).slice(0, 600)}`);
    return reply;
  }
  async must(args: Line): Promise<Line> {
    const reply = await this.call(args);
    expect(reply.ok, `${String(args.call)}: ${JSON.stringify(reply).slice(0, 800)}`).toBe(true);
    return reply;
  }
  /** Stops the process by its PID. */
  async stop(): Promise<void> {
    running.delete(this);
    try { this.child.stdin!.end(); } catch { /* closed */ }
    const deadline = Date.now() + 5000;
    while (!this.exited && Date.now() < deadline) await sleep(20);
    if (!this.exited && this.child.pid) try { process.kill(this.child.pid, 'SIGKILL'); } catch { /* gone */ }
  }
}
export async function stopAll(): Promise<void> {
  for (const d of [...running]) await d.stop();
}

/** The planted twin of AC2: a view with a page named Settings (fixtures/settings-panel). */
export const TWIN_VIEW = JSON.parse(readFileSync(join(FIXTURES, 'settings-panel.view.json'), 'utf8')) as Line;
/**
 * A replica on Needs you: over the shipped fixture record, or over a copy of the record of the hub that HOME's
 * ~/.deepbuild names (`record_copy`). With `twin`, the planted Settings view's panel (a copy, since gpui-shell writes
 * files beside a script it runs) and its registration.
 */
export async function launch(d: Drive, from: 'fixture' | 'record_copy', twin = false): Promise<void> {
  const launch: Line = { from, size: [1100, 700], scale: 1, theme: 'light', clock: 'virtual' };
  if (twin) {
    const panel = join(tempDir('panel'), 'panel');
    cpSync(join(FIXTURES, 'settings-panel'), panel, { recursive: true });
    Object.assign(launch, { panel, view: TWIN_VIEW });
  }
  await d.must({ call: 'launch', launch });
}

type Node = { role: string; name: string | null; value?: unknown; id?: string | null; bounds: [number, number, number, number]; children?: Node[] };
const flatten = (n: Node, into: Node[] = []): Node[] => { into.push(n); for (const c of n.children ?? []) flatten(c, into); return into; };
const settle = (d: Drive) => d.must({ call: 'wait_for', wait_for: { state: 'settled' } });
/** ⌘K opened, any earlier query replaced by `text`, its entries read top to bottom; left open. */
export async function query(d: Drive, text: string): Promise<string[]> {
  await d.must({ call: 'act', act: { kind: 'press', keys: 'cmd-k' } });
  await d.must({ call: 'act', act: { kind: 'press', keys: 'cmd-a' } });
  if (text) await d.must({ call: 'act', act: { kind: 'type', text } });
  await settle(d);
  const seen = await d.must({ call: 'see', see: { scope: 'window', include: ['roles', 'names', 'bounds'] } });
  return flatten(seen.snapshot.tree as Node).filter((n) => n.role === 'list_box_option' && n.name)
    .sort((a, b) => a.bounds[1] - b.bounds[1] || a.bounds[0] - b.bounds[0]).map((n) => n.name!);
}
/** ⌘K's entries for `text`, then ⌘K closed. */
export async function ranked(d: Drive, text: string): Promise<string[]> {
  const entries = await query(d, text);
  await d.must({ call: 'act', act: { kind: 'press', keys: 'escape' } });
  await settle(d);
  return entries;
}
/**
 * What the node with author id `id` says: its value when it has words, else its name, else the names, values and text
 * drawn inside its bounds; null when no node has the id.
 */
async function said(d: Drive, id: string): Promise<string | null> {
  const r = await d.call({ call: 'see', see: { scope: 'locator', include: ['roles', 'names', 'values', 'bounds'] }, locator: { id } });
  if (!r.ok) return null;
  const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
  const root = r.snapshot.tree as Node;
  const own = text(root.value) ?? text(root.name);
  if (own) return own;
  const words = flatten(root).flatMap((n) => [text(n.name), text(n.value)]).filter((w): w is string => w !== null);
  return [...new Set(words)].join(' ');
}
/** The box as the window shows it now (README, Pinned 5): whether it is there, its drafted change and the current value beside it. */
export interface Box { box: boolean; draft: string | null; current: string | null }
export async function box(d: Drive): Promise<Box> {
  return { box: (await said(d, 'box')) !== null, draft: await said(d, 'box-draft'), current: await said(d, 'box-current') };
}
/** Every name drawn in the window, for a failure's message. */
export async function names(d: Drive): Promise<string[]> {
  const seen = await d.must({ call: 'see', see: { scope: 'window', include: ['roles', 'names'] } });
  return [...new Set(flatten(seen.snapshot.tree as Node).map((n) => n.name).filter((n): n is string => !!n))];
}
/** ⌘K's entry `name` for `text` clicked, and the box as it then shows. */
export async function choose(d: Drive, text: string, name: string): Promise<{ clicked: string | null; box: Box; drawn: string[] }> {
  await query(d, text);
  const click = await d.call({ call: 'act', locator: { role: 'list_box_option', name }, act: { kind: 'click' } });
  await settle(d);
  return { clicked: click.ok ? null : JSON.stringify(click.error ?? click).slice(0, 400), box: await box(d), drawn: await names(d) };
}
/** The notifications the replica posted, after 3 s more on its clock, from its trace; the replica is closed. */
export async function notifications(d: Drive): Promise<{ ask?: string; text?: string; sound: string | null }[]> {
  const now = await d.must({ call: 'wait_for', wait_for: { state: 'settled' } });
  await d.must({ call: 'wait_for', wait_for: { t: Number(now.t ?? 0) + 3 * FLICKS }, timeout: 10_000 });
  const closed = await d.must({ call: 'close' });
  const trace = JSON.parse(readFileSync(String((closed.trace as { path: string }).path), 'utf8')) as { notifications: { ask?: string; text?: string; sound: string | null }[] };
  return trace.notifications;
}

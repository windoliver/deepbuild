// The replica side of the #366 tests (AC3, AC6): `deep-drive`, #124's binary that hosts one replica of the app and
// answers one JSON line per call, built once with cargo, and ⌘K driven through it the way you drive it: ⌘K, the query
// typed, the entries read top to bottom (README, The surface under test). Each process is stopped by its PID.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import { FIXTURES, REPO, sleep, tempDir, TOOLCHAIN } from './helpers.ts';

export type Obj = { [key: string]: any };
export const DRIVE_BIN = join(REPO, 'target', 'debug', 'deep-drive');
/** The stocks view's panel and its registration, as `deep.registerView` gives them (fixtures/stocks). */
export const PANEL = join(FIXTURES, 'stocks', 'panel');
export const VIEW = JSON.parse(readFileSync(join(FIXTURES, 'stocks', 'view.json'), 'utf8')) as {
  name: string; pages: { name: string; param: string; values: string[] }[]; commands: { name: string; action: string }[];
};
/** Every name ⌘K lists for the view: each command's, and `<page>: <value>` for each page and value. */
export const NAMES = [...VIEW.commands.map((c) => c.name), ...VIEW.pages.flatMap((p) => p.values.map((v) => `${p.name}: ${v}`))];
/** Where the live app keeps ⌘K's recency list (README, The surface under test). */
export const RECENCY = (home: string) => join(home, '.deepbuild', 'app', 'recency.json');

let built: string | undefined;
export function buildDrive(): void {
  if (built === undefined) {
    const r = spawnSync('cargo', ['build', '--locked', '-p', 'deep-replica', '--bin', 'deep-drive'], { cwd: REPO, encoding: 'utf8', timeout: 1_800_000, maxBuffer: 64 << 20, env: { ...process.env, ...TOOLCHAIN } });
    built = r.status === 0 && existsSync(DRIVE_BIN) ? 'ok' : `${r.error?.message ?? ''}${(r.stderr ?? '').split('\n').filter((l) => /error/.test(l)).slice(0, 6).join('\n')}`;
  }
  if (built !== 'ok') expect.fail(`BLOCKED: deep-drive can't be built (cargo build --locked -p deep-replica --bin deep-drive): ${built}`);
}

const running = new Set<Drive>();
export class Drive {
  private buffer = '';
  private readonly waiting: ((line: Obj) => void)[] = [];
  private exited = false;
  private readonly stderr: string[] = [];
  private constructor(readonly child: ChildProcess) {
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
    child.stderr!.setEncoding('utf8').on('data', (d: string) => { this.stderr.push(d); if (this.stderr.length > 100) this.stderr.shift(); });
    child.on('exit', () => { this.exited = true; for (const wake of this.waiting.splice(0)) wake({ exited: true, stderr: this.log() }); });
  }
  log(): string { return this.stderr.join('').slice(-1500); }
  /** One `deep-drive --out <dir>` with HOME `home` and, for a wrong program, `DEEP_DRIVE_PLANT`; waits for `{"ready": true}`. */
  static async start(home: string, plant?: string): Promise<Drive> {
    buildDrive();
    const out = join(tempDir('drive'), 'out');
    mkdirSync(out, { recursive: true });
    const env: Record<string, string> = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, LANG: 'en_US.UTF-8', TZ: 'UTC', ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}), ...(plant ? { DEEP_DRIVE_PLANT: plant } : {}) };
    const drive = new Drive(spawn(DRIVE_BIN, ['--out', out], { cwd: REPO, env, stdio: ['pipe', 'pipe', 'pipe'] }));
    running.add(drive);
    const first = await drive.next(120_000);
    if (first.ready !== true) expect.fail(`BLOCKED: deep-drive didn't say {"ready": true}${plant ? ` with DEEP_DRIVE_PLANT=${plant}` : ''}: ${JSON.stringify(first).slice(0, 400)}`);
    return drive;
  }
  private next(ms: number): Promise<Obj> {
    if (this.exited) return Promise.resolve({ exited: true, stderr: this.log() });
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ timedOut: ms }), ms);
      this.waiting.push((line) => { clearTimeout(timer); resolve(line); });
    });
  }
  /** One call and its reply; a process that gives no JSON reply fails the test, BLOCKED. */
  async call(args: Obj): Promise<Obj> {
    const answer = this.next(120_000);
    this.child.stdin!.write(`${JSON.stringify(args)}\n`);
    const reply = await answer;
    if (reply.exited || reply.timedOut || reply.unparsed !== undefined) expect.fail(`BLOCKED: deep-drive gave no JSON reply to ${String(args.call)}: ${JSON.stringify(reply).slice(0, 600)}`);
    return reply;
  }
  async must(args: Obj): Promise<Obj> {
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

/**
 * A replica launched from #338's fixture with the stocks view's panel in its slot and its registration. The panel is
 * a copy: gpui-shell writes its declarations (gpui-kit.d.ts, jsconfig.json) beside a script it runs.
 */
export async function launchStocks(d: Drive): Promise<void> {
  const panel = join(tempDir('panel'), 'panel');
  cpSync(PANEL, panel, { recursive: true });
  await d.must({ call: 'launch', launch: { from: 'fixture', panel, view: VIEW, size: [1100, 700], scale: 1, theme: 'light', clock: 'virtual' } });
}
type Node = { role: string; name: string | null; bounds: [number, number, number, number]; children?: Node[] };
const flatten = (n: Node, into: Node[] = []): Node[] => { into.push(n); for (const c of n.children ?? []) flatten(c, into); return into; };
/** ⌘K opened, any earlier query selected and replaced by `query`, the entries read top to bottom; left open. */
export async function query(d: Drive, text: string): Promise<string[]> {
  await d.must({ call: 'act', act: { kind: 'press', keys: 'cmd-k' } });
  await d.must({ call: 'act', act: { kind: 'press', keys: 'cmd-a' } });
  if (text) await d.must({ call: 'act', act: { kind: 'type', text } });
  await d.must({ call: 'wait_for', wait_for: { state: 'settled' } });
  const seen = await d.must({ call: 'see', see: { scope: 'window', include: ['roles', 'names', 'bounds'] } });
  return flatten(seen.snapshot.tree as Node).filter((n) => n.role === 'list_box_option' && n.name)
    .sort((a, b) => a.bounds[1] - b.bounds[1] || a.bounds[0] - b.bounds[0]).map((n) => n.name!);
}
/** The query's entries, then ⌘K closed. */
export async function ranked(d: Drive, text: string): Promise<string[]> {
  const entries = await query(d, text);
  await d.must({ call: 'act', act: { kind: 'press', keys: 'escape' } });
  await d.must({ call: 'wait_for', wait_for: { state: 'settled' } });
  return entries;
}
/** Whether `text` is drawn in the replica now, by the replica's own assertion. */
export async function drawn(d: Drive, text: string): Promise<boolean> {
  const r = await d.must({ call: 'expect', locator: { text }, expect: { name: `drawn ${text}`, assert: 'visible' } });
  return r.assertion?.passed === true;
}

// The real `deep-app` window, from outside its process: what #1002's and #994's first-screen redrafts see. The window
// list, the accessibility tree and the menu-bar item through probe.swift, the window's pixels through `screencapture -l`
// and Vision. The shape is tests/acceptance/1172/helpers.ts's, copied so a redraft of #1172's never moves these tests.
// Nothing here stands in for the app. The plants are builds of it. The replica is never run.
//
// Safety: each suite passes the environment it starts the app in, whose HOME is a temp folder. A process is stopped only
// by the PID it was started with. Screenshots are of one window, never the display.
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { cpus, loadavg, tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const SUITE = fileURLToPath(new URL('./', import.meta.url));
/** The reference window, in points, at 2× (design: Decided). */
export const REFERENCE = { width: 1512, height: 982, scale: 2 } as const;
/** What a slow first launch of a debug build gets: under load it can take a minute. */
const LAUNCH_MS = 180_000;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
export const sha256File = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');

const exec = (cmd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> => new Promise((resolve, reject) => {
  execFile(cmd, args, { env: env ?? process.env, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) reject(Error(`${cmd} ${args.join(' ')}: ${error.message}; ${stderr.slice(-1500)}`));
    else resolve(stdout);
  });
});
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };
export const inconclusive = (why: string): never => expect.fail(`INCONCLUSIVE: ${why}; this is not a pass`);
/** The 1-minute load average is above half the cores: a late reading says nothing about the app (#1141's rule). */
export const loaded = (): boolean => loadavg()[0]! > cpus().length / 2;

// ---- Builds. Each binary is copied out of the target folder under its own name, so a plant's build never stands in for
// the app, and a plant's build is followed by the plain one, so target/debug holds the plain app afterwards.

/** Wrong programs the crate already carries (crates/deep-app/Cargo.toml). This suite adds none. */
export type Plant = 'plant-spike-window' | 'plant-posts-unchecked';
const BIN = join(tmpdir(), `da-first-screen-bin-${userInfo().uid}`);
const CARGO_ENV = { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };
const target = (name: string): string => join(process.env.CARGO_TARGET_DIR ?? join(REPO, 'target'), 'debug', name);
const built = new Map<string, Promise<string>>();
const cargo = (args: string[]): Promise<string> => exec('cargo', ['build', '--locked', '-q', ...args], CARGO_ENV)
  .catch((error: Error) => blocked(`cargo build failed: ${error.message.slice(-2000)}`));
/** The plain app, or a plant's, copied out of the target folder. */
export function appBinary(plant?: Plant): Promise<string> {
  const key = plant ?? 'plain';
  let build = built.get(key);
  if (!build) {
    build = (async () => {
      mkdirSync(BIN, { recursive: true });
      const out = join(BIN, `deep-app-${key}`);
      if (plant) await appBinary();
      await cargo(['-p', 'deep-app', '--bin', 'deep-app', ...(plant ? ['--features', plant] : [])]);
      copyFileSync(target('deep-app'), out);
      if (plant) await cargo(['-p', 'deep-app', '--bin', 'deep-app']);
      return out;
    })();
    built.set(key, build);
  }
  return build;
}

// ---- The probe: compiled once a run, from probe.swift.

let compiled: Promise<string> | undefined;
function probeBinary(): Promise<string> {
  if (process.platform !== 'darwin') return Promise.resolve(blocked(`the app draws on macOS only; this is ${process.platform}`));
  compiled ??= (async () => {
    mkdirSync(BIN, { recursive: true });
    const out = join(BIN, `probe-${sha256File(join(SUITE, 'probe.swift')).slice(0, 12)}`);
    if (!existsSync(out)) await exec('swiftc', ['-O', '-module-cache-path', join(BIN, 'swift-cache'), join(SUITE, 'probe.swift'), '-o', out]);
    const access = JSON.parse(await exec(out, ['access'])) as { ax: boolean; screen: boolean; locked: boolean };
    if (access.locked) blocked('the screen is locked, so no window draws');
    if (!access.ax) blocked('this process has no Accessibility permission, so nothing can read the real window\'s nodes or the menu bar');
    if (!access.screen) blocked('this process has no Screen Recording permission, so nothing can read the real window\'s pixels');
    return out;
  })();
  return compiled;
}
const probe = async <T>(...args: string[]): Promise<T> => JSON.parse(await exec(await probeBinary(), args)) as T;

// ---- What a person and a screen reader get.

export interface Node { role: string; name: string; frame: number[]; children: Node[] }
interface Tree { windows: { frame: number[]; tree: Node }[]; menu: string[] }
interface Win { id: number; frame: number[] }
interface Line { text: string; box: number[] }
export const nodes = (root: Node): Node[] => [root, ...root.children.flatMap(nodes)];
export const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** One reading of the window: its nodes, its pixels read as text, the menu-bar item's title. */
export interface Seen {
  /** The window's frame, in points. */
  window: number[];
  nodes: Pick<Node, 'role' | 'name' | 'frame'>[];
  /** Each line Vision read off the window's pixels. */
  lines: string[];
  menu: string[];
  /** The picture the lines came from. */
  picture: string;
}
export const named = (s: Seen): string => JSON.stringify(s.nodes.map((n) => n.name).filter(Boolean).slice(0, 40));
export const read = (s: Seen): string => JSON.stringify(s.lines).slice(0, 1500);
/** The pixels hold `text`, whatever spacing, wrapping or punctuation the reading gives it. */
export const onPixels = (s: Seen, text: string): boolean => squash(s.lines.join('')).includes(squash(text));

export interface Launch { binary: string; cwd: string; env: NodeJS.ProcessEnv; own: (pid: number | undefined) => void }

export class App {
  readonly pid: number;
  /** The window's size as the app opened it, before any test touched it: the pane a person gets. */
  opened: { width: number; height: number } = { width: 0, height: 0 };
  private shots = 0;
  private constructor(readonly child: ChildProcess, private readonly dir: string, readonly err: () => string) { this.pid = child.pid!; }

  /** Starts the app and waits for its window, at the size it opens at. */
  static async launch(o: Launch): Promise<App> {
    await probeBinary();
    const child = spawn(o.binary, [], { cwd: o.cwd, env: o.env, stdio: ['ignore', 'ignore', 'pipe'] });
    o.own(child.pid);
    let err = '';
    child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
    const app = new App(child, realpathSync(mkdtempSync(join(tmpdir(), 'da-first-screen-'))), () => err);
    const deadline = Date.now() + LAUNCH_MS;
    let list: Win[] = [];
    while (!(list = await app.windows()).length) {
      if (child.exitCode !== null || child.signalCode !== null) blocked(`deep-app exited (${child.exitCode ?? child.signalCode}) before its window: ${err.slice(-800)}`);
      if (Date.now() > deadline) blocked(`deep-app showed no window in ${LAUNCH_MS} ms: ${err.slice(-800)}`);
      await sleep(250);
    }
    app.opened = { width: list[0]!.frame[2]!, height: list[0]!.frame[3]! };
    await app.sizeTo(app.opened);
    return app;
  }

  windows(): Promise<Win[]> { return probe('windows', String(this.pid)); }
  private tree(): Promise<Tree> { return probe('tree', String(this.pid)); }
  /** The press a screen reader sends to the node named exactly `name`, of `role` when one is named. It returns when the app's action has, or the probe's 5 s wait has. */
  press(name: string, role?: string): Promise<{ found: boolean; pressed?: boolean; code?: number; role?: string }> {
    return probe('press', String(this.pid), name, role ?? '', 'exact');
  }

  /**
   * Sets the window to `size`, going through one point taller so a window already that size still resizes: the tree
   * appears after the frame that follows the first read (#1172's README), and a resize draws that frame.
   */
  async sizeTo(size: { width: number; height: number }): Promise<void> {
    await this.tree();
    const set = (h: number): Promise<number[]> => probe<number[]>('place', String(this.pid), String(size.width), String(h)).catch(() => []);
    await set(size.height + 1);
    await sleep(100);
    let frame: number[] = [];
    for (let tries = 0; tries < 40; tries++) {
      frame = await set(size.height);
      if (Math.abs((frame[2] ?? 0) - size.width) < 1 && Math.abs((frame[3] ?? 0) - size.height) < 1) break;
      await sleep(250);
    }
    if (Math.abs((frame[2] ?? 0) - size.width) >= 1 || Math.abs((frame[3] ?? 0) - size.height) >= 1) blocked(`the window didn't take ${size.width} × ${size.height}: it is ${JSON.stringify(frame)}`);
    await probe('front', String(this.pid)).catch(() => undefined);
    await sleep(500);
  }

  /** The window's pixels as the window server holds them, in sRGB, whatever covers it. */
  private async capture(): Promise<string> {
    const list = await this.windows();
    const win = [...list].sort((a, b) => b.frame[2]! * b.frame[3]! - a.frame[2]! * a.frame[3]!)[0] ?? blocked(`deep-app has no window: ${this.err().slice(-500)}`);
    const path = join(this.dir, `shot-${++this.shots}.png`);
    await exec('/usr/sbin/screencapture', ['-x', '-o', `-l${win.id}`, `${path}.raw.png`]);
    await exec('/usr/bin/sips', ['-m', '/System/Library/ColorSync/Profiles/sRGB Profile.icc', `${path}.raw.png`, '--out', path]);
    return path;
  }

  /** One reading of the window, as it stands. */
  async see(): Promise<Seen> {
    const tree = await this.tree();
    const picture = await this.capture();
    const lines = (await probe<Line[]>('ocr', picture)).map((l) => l.text);
    const main = [...tree.windows].sort((a, b) => b.frame[2]! * b.frame[3]! - a.frame[2]! * a.frame[3]!)[0];
    return { window: main?.frame ?? [], nodes: tree.windows.flatMap((w) => nodes(w.tree)), lines, menu: tree.menu, picture };
  }

  /**
   * Reads until `judge` finds nothing wrong or `ms` pass, and gives the last reading with what it found: the app draws
   * what its reader reads a moment after it opens. A reading that can't be made is tried again: at the base the Set up
   * click holds the app's main thread until setup ends, so its window answers nothing meanwhile.
   */
  async settled(judge: (s: Seen) => string[], ms = 30_000): Promise<{ seen: Seen; failures: string[] }> {
    const deadline = Date.now() + ms;
    for (;;) {
      const seen = await this.see().catch((error: Error) => {
        if (Date.now() > deadline) throw error;
        return undefined;
      });
      const failures = seen ? judge(seen) : [];
      if (seen && (!failures.length || Date.now() > deadline)) return { seen, failures };
      await sleep(300);
    }
  }

  async stop(): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    this.child.kill('SIGTERM');
    const deadline = Date.now() + 3000;
    while (this.child.exitCode === null && this.child.signalCode === null && Date.now() < deadline) await sleep(50);
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGKILL');
    while (this.child.exitCode === null && this.child.signalCode === null) await sleep(50);
  }
}

/**
 * Both windows a person's first screen is judged at: the size the app opens at, and the reference window. A criterion
 * holds only if it holds at both. Any failure names the size.
 */
export async function atBothSizes(app: App, judge: (s: Seen) => string[], ms?: number): Promise<{ seen: Seen; failures: string[] }> {
  const opened = await app.settled(judge, ms);
  await app.sizeTo(REFERENCE);
  const reference = await app.settled(judge, ms);
  const at = (size: string, failures: string[]) => failures.map((f) => `${f} (at ${size})`);
  return { seen: reference.seen, failures: [...at(`the ${app.opened.width} × ${app.opened.height} the app opens at`, opened.failures), ...at('the reference window', reference.failures)] };
}

export const pngSize = (path: string): [number, number] => {
  const bytes = readFileSync(path);
  return bytes.subarray(1, 4).toString('latin1') === 'PNG' ? [bytes.readUInt32BE(16), bytes.readUInt32BE(20)] : [0, 0];
};

// ---- The taste call (1172's shape): a person's, recorded in a suite's TASTE.json on exactly one run's pictures.

export interface Taste { issue?: number; criterion?: string; verdict?: string | null; who?: string | null; when?: string | null; files?: Record<string, string>; note?: string }
const sorted = (files: Record<string, string>): string => JSON.stringify(Object.fromEntries(Object.entries(files).sort()));
/** No call, no person or other pictures are INCONCLUSIVE, never a pass; looks_wrong fails, quoting the note. */
export function tasteCall(taste: Taste, got: Record<string, string>): void {
  if (taste.verdict === null || taste.verdict === undefined) inconclusive('no taste call is recorded for these screenshots (TASTE.json holds none)');
  if (!taste.who || !taste.when) inconclusive('the taste call names no one or no time');
  if (sorted(taste.files ?? {}) !== sorted(got)) inconclusive('the recorded taste call was made on other pictures than this run\'s');
  expect(taste.verdict, `the recorded taste call says they don't look right: ${taste.note ?? ''}`).toBe('looks_right');
}
/** A kept folder holding exactly a recorded call's pictures, from this same app, stands: a real window's pixels differ run to run. */
export function kept(taste: Taste, got: Record<string, string>, runApp: string | undefined, app: string): boolean {
  return runApp === app && Object.keys(taste.files ?? {}).length > 0 && sorted(taste.files ?? {}) === sorted(got);
}

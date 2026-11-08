// Test-side tools for #1454 (README). The real `deep-app` against a real hub on a temp home, read from outside its process
// (probe.swift, screencapture, sips), with the hub's record beside it, and the judges each criterion's failure message
// comes from. Copied from #1172's suite where this one needs the same thing: `App`, the probe, the PNG reader. The hub, the
// agent stand-in and its `deep mcp` are #26's, and the session that draws is #806's, used as they are.
//
// Safety: HOME is a temp folder under /tmp for every process started; a process is stopped only by the PID it was started
// with; no test touches the real ~/.deepbuild, ~/.claude or ~/Library/LaunchAgents; no network, no model.
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, expect } from 'vitest';
import { packageDigest } from '../../../packages/extension-host/src/index.ts';
import * as t26 from '../26/helpers.ts';
import { openFigures, type Figures } from '../806/figure.ts';
import * as t806 from '../806/helpers.ts';

export { t26, t806 };
export const { sleep, REPO, NODE } = t26;
export type Ev = t26.Ev;
export const SUITE = fileURLToPath(new URL('./', import.meta.url));
const FIXTURES = join(SUITE, 'fixtures');
/** The reference window, in points, at 2× (design: Decided). */
export const REFERENCE = { width: 1512, height: 982, scale: 2 } as const;
/** What each criterion allows a slow first launch of a debug build: on a machine under load it can take a minute. */
const LAUNCH_MS = 180_000;
export const MINUTES = 60_000;
const run = (cmd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> => new Promise((resolve, reject) => {
  execFile(cmd, args, { env: env ?? process.env, maxBuffer: 256 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) reject(Error(`${cmd} ${args.join(' ')}: ${error.message}; ${stderr.slice(0, 800)}`));
    else resolve(stdout);
  });
});

export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };
export const inconclusive = (why: string): never => expect.fail(`INCONCLUSIVE: ${why}; this is not a pass`);
/** The 1-minute load average is above half the cores: a late reading says nothing about the app (#1141's rule). */
export const loaded = (): boolean => loadavg()[0]! > cpus().length / 2;
/** Stops what the file started and removes its folders, once its tests are done. */
export const useCleanup = (): void => { afterAll(() => t806.cleanup(), 60_000); };

// ---- Builds. Each binary is copied out of the target folder under its own name, as #1172's suite does, so a plant's build
// never stands in for the app; a plant's build is followed by the plain one, so the checkout's target/debug holds the plain
// app afterwards.

/**
 * Cargo features of `deep-app` this suite builds (README, Pinned). `test-confirm` is the OS confirmation's stand-in; each
 * plant is a wrong program, built on top of it. None is in a shipped build.
 */
export type Feature = 'test-confirm' | 'plant-card-skips-confirm' | 'plant-page-drops-param' | 'plant-panel-skips-kit';
const BIN = join(tmpdir(), `da1454-bin-${userInfo().uid}`);
const CARGO_ENV = { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };
const target = (name: string): string => join(process.env.CARGO_TARGET_DIR ?? join(REPO, 'target'), 'debug', name);
const built = new Map<string, Promise<string>>();
const cargo = (args: string[]): Promise<string> => run('cargo', ['build', '--locked', '-q', ...args], CARGO_ENV);
/** The plain app, or a build with `features`, copied out of the target folder. A feature the crate doesn't have is named. */
export function appBinary(...features: Feature[]): Promise<string> {
  const key = features.join('+') || 'plain';
  let build = built.get(key);
  if (!build) {
    build = (async () => {
      mkdirSync(BIN, { recursive: true });
      const out = join(BIN, `deep-app-${key}`);
      if (features.length) await appBinary();
      await cargo(['-p', 'deep-app', '--bin', 'deep-app', ...features.flatMap((f) => ['--features', f])]).catch((error: Error) => {
        const missing = /does not contain (?:this|these) features?:? *([\w-]+)/.exec(error.message);
        throw Error(missing ? `crates/deep-app/Cargo.toml has no feature ${missing[1]} (README, Pinned), so this build can't be made` : error.message);
      });
      copyFileSync(target('deep-app'), out);
      if (features.length) await cargo(['-p', 'deep-app', '--bin', 'deep-app']);
      return out;
    })();
    built.set(key, build);
  }
  return build;
}
/** What the hub's canvas side runs and the replica: built in the checkout, where the hub looks for them. */
export function supportBinaries(): Promise<void> {
  let build = built.get('support');
  if (!build) {
    build = cargo(['-p', 'deep-show', '--bin', 'deep-show', '-p', 'deep-replica', '--bin', 'deep-replica', '-p', 'deep-hook', '--bin', 'deep-hook']).then(() => '');
    built.set('support', build);
  }
  return build.then(() => undefined);
}
export const replicaBinary = (): string => target('deep-replica');
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export const sha256File = (path: string): string => sha256(readFileSync(path));

// ---- The probe: compiled once a run, from probe.swift.

let compiled: Promise<string> | undefined;
export function probeBinary(): Promise<string> {
  if (process.platform !== 'darwin') return Promise.resolve(blocked(`the app draws on macOS only; this is ${process.platform}`));
  compiled ??= (async () => {
    mkdirSync(BIN, { recursive: true });
    const out = join(BIN, `probe-${sha256File(join(SUITE, 'probe.swift')).slice(0, 12)}`);
    if (!existsSync(out)) await run('swiftc', ['-O', '-module-cache-path', join(BIN, 'swift-cache'), join(SUITE, 'probe.swift'), '-o', out]);
    const access = JSON.parse(await run(out, ['access'])) as { ax: boolean; screen: boolean; screens: number[][] };
    if (!access.ax) blocked('this process has no Accessibility permission, so nothing can read the real window\'s nodes or the menu bar; grant it to the app the tests run under');
    if (!access.screen) blocked('this process has no Screen Recording permission, so nothing can read the real window\'s pixels; grant it to the app the tests run under');
    return out;
  })();
  return compiled;
}
const probe = async <T>(...args: string[]): Promise<T> => JSON.parse(await run(await probeBinary(), args)) as T;

// ---- The real app, from outside.

export interface Node { role: string; name: string; frame: number[]; children: Node[] }
export interface Win { id: number; frame: number[] }
export interface Tree { t0: number; t1: number; windows: { frame: number[]; tree: Node }[]; menu: string[]; menuFrames: number[][] }
export interface Line { text: string; box: number[] }
export const nodes = (root: Node): Node[] => [root, ...root.children.flatMap(nodes)];
export const named = (tree: Tree): Node[] => tree.windows.flatMap((w) => nodes(w.tree)).filter((n) => n.name);
const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
/** The pixels read as text hold `text`, whatever spacing or punctuation the reading gives it. */
export const reads = (lines: readonly Line[], text: string): boolean => lines.some((l) => squash(l.text).includes(squash(text)));
export const lineOf = (lines: readonly Line[], text: string): Line | undefined => lines.find((l) => squash(l.text).includes(squash(text)));
export const sees = (lines: readonly Line[]): string => JSON.stringify(lines.map((l) => l.text)).slice(0, 1500);

/** ⌘K's key on a Mac keyboard, kVK_ANSI_K. */
const KEY_K = 40;
export interface Launch { home: string; binary: string; args?: string[]; env?: Record<string, string> }
export class App {
  readonly err: () => string;
  private constructor(readonly child: ChildProcess, readonly pid: number, private readonly dir: string, err: () => string) { this.err = err; }

  /** Starts the app, waits for its window, and sets that window to the reference window. */
  static async launch(o: Launch): Promise<App> {
    await probeBinary();
    const child = spawn(o.binary, o.args ?? [], { cwd: REPO, env: t26.childEnv(o.home, { ...o.env }), stdio: ['ignore', 'ignore', 'pipe'] });
    t806.own(child.pid);
    let err = '';
    child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
    const app = new App(child, child.pid!, t806.tempDir(), () => err);
    const deadline = Date.now() + LAUNCH_MS;
    while (!(await app.windows()).length) {
      if (child.exitCode !== null || child.signalCode !== null) blocked(`deep-app exited (${child.exitCode ?? child.signalCode}) before its window: ${err.slice(-800)}`);
      if (Date.now() > deadline) blocked(`deep-app showed no window in ${LAUNCH_MS} ms: ${err.slice(-800)}`);
      await sleep(250);
    }
    await app.place();
    return app;
  }

  windows(): Promise<Win[]> { return probe(`windows`, String(this.pid)); }
  tree(): Promise<Tree> { return probe('tree', String(this.pid)); }
  /** The press a screen reader sends: to the first node whose name holds `text`, of `role` when one is named. */
  press(text: string, role?: string): Promise<{ found: boolean; pressed?: boolean; code?: number; role?: string }> { return probe('press', String(this.pid), text, ...(role ? [role] : [])); }
  /** Brings the app forward. Another session's window on this Mac can take it back, so a chord is sent right after. */
  front(): Promise<void> { return probe<boolean>('front', String(this.pid)).then(() => undefined, () => undefined); }
  /** ⌘K, posted to this process alone (probe.swift), never at the keyboard you are using. */
  async commandK(): Promise<void> {
    await this.front();
    await sleep(200);
    await probe('key', String(this.pid), String(KEY_K), 'cmd');
  }

  /** Asks for the tree, which starts the app's accessibility, then resizes the window, which draws a frame of it. */
  async place(): Promise<void> {
    await this.tree();
    let frame: number[] = [];
    for (let tries = 0; tries < 40; tries++) {
      frame = await probe<number[]>('place', String(this.pid), String(REFERENCE.width), String(REFERENCE.height)).catch(() => []);
      if (Math.abs((frame[2] ?? 0) - REFERENCE.width) < 1 && Math.abs((frame[3] ?? 0) - REFERENCE.height) < 1) break;
      await sleep(250);
    }
    await this.front();
    await sleep(500);
  }

  /** The window's pixels as the window server holds them, in sRGB, whatever covers it. */
  async capture(name: string, window?: Win): Promise<Picture> {
    const win = window ?? (await this.mainWindow());
    return captureWindow(win.id, join(this.dir, `${name}.png`));
  }
  /** The largest window: the main one until a test says which holds what. */
  async mainWindow(): Promise<Win> {
    const list = await this.windows();
    const win = [...list].sort((a, b) => b.frame[2]! * b.frame[3]! - a.frame[2]! * a.frame[3]!)[0];
    return win ?? blocked(`deep-app has no window: ${this.err().slice(-500)}`);
  }
  async stop(): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    this.child.kill('SIGTERM');
    const deadline = Date.now() + 3000;
    while (this.child.exitCode === null && this.child.signalCode === null && Date.now() < deadline) await sleep(50);
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGKILL');
  }
}

export async function captureWindow(id: number, path: string): Promise<Picture> {
  const raw = `${path}.raw.png`;
  await run('/usr/sbin/screencapture', ['-x', '-o', `-l${id}`, raw]);
  await run('/usr/bin/sips', ['-m', '/System/Library/ColorSync/Profiles/sRGB Profile.icc', raw, '--out', path]);
  return readPng(path);
}
export const ocr = async (picture: Picture): Promise<Line[]> => probe('ocr', picture.path);

/** The window's frames, one after another, until stopped: a capture of that window, never of the display. */
export class Recorder {
  private frames: string[] = [];
  private on = true;
  private readonly done: Promise<void>;
  constructor(private readonly id: number, private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
    this.done = this.loop();
  }
  private async loop(): Promise<void> {
    while (this.on) {
      const path = join(this.dir, `frame-${String(this.frames.length).padStart(4, '0')}.png`);
      await run('/usr/sbin/screencapture', ['-x', '-o', `-l${this.id}`, path]);
      this.frames.push(path);
    }
  }
  /** The frames as a GIF at `out`, each shown for as long as a frame took here; what it holds. */
  async stop(out: string): Promise<{ frames: number; distinct: number; paths: string[] }> {
    this.on = false;
    await this.done;
    await probe('gif', out, '300', '1008', ...this.frames);
    return { frames: this.frames.length, distinct: new Set(this.frames.map(sha256File)).size, paths: this.frames };
  }
}

// ---- Pictures.

export interface Picture { path: string; width: number; height: number; at(x: number, y: number): [number, number, number] }
/** Decodes an 8- or 16-bit RGB or RGBA PNG, not interlaced, as sips writes one. */
export function readPng(path: string): Picture {
  const file = readFileSync(path);
  let at = 8;
  const idat: Buffer[] = [];
  let width = 0; let height = 0; let depth = 0; let type = 0;
  while (at < file.length) {
    const size = file.readUInt32BE(at);
    const name = file.toString('latin1', at + 4, at + 8);
    const body = file.subarray(at + 8, at + 8 + size);
    if (name === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; type = body[9]!; }
    if (name === 'IDAT') idat.push(body);
    at += 12 + size;
  }
  const channels = type === 6 ? 4 : type === 2 ? 3 : blocked(`${path} is PNG color type ${type}`);
  const bytes = channels * (depth / 8);
  const stride = width * bytes;
  const raw = inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const from = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const a = x >= bytes ? pixels[y * stride + x - bytes]! : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + x]! : 0;
      const c = x >= bytes && y > 0 ? pixels[(y - 1) * stride + x - bytes]! : 0;
      let value = raw[from + x]!;
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      pixels[y * stride + x] = value & 255;
    }
  }
  const step = depth === 16 ? 2 : 1;
  return {
    path, width, height,
    at: (x, y) => {
      const i = Math.round(y) * stride + Math.round(x) * bytes;
      return [pixels[i]!, pixels[i + step]!, pixels[i + 2 * step]!];
    },
  };
}
export type Rgb = readonly [number, number, number];
export const hex = (c: Rgb): string => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
export const near = (a: Rgb, b: Rgb, tolerance: number): boolean => a.every((v, i) => Math.abs(v - b[i]!) <= tolerance);

// ---- Repeated reads.

/** Repeats `judge` until it finds nothing wrong or `ms` pass: the app draws what its reader reads a moment after it opens. */
export async function settled(judge: () => Promise<string[]>, ms = 12_000): Promise<string[]> {
  const deadline = Date.now() + ms;
  for (;;) {
    const failures = await judge();
    if (!failures.length || Date.now() > deadline) return failures;
    await sleep(300);
  }
}

// ---- Worlds.

/** `deep` commands in this home offer no setup, and the window opens on the shell, as #1172's fixture has it. */
function setupFinished(home: string): void {
  const version = (JSON.parse(readFileSync(join(REPO, 'packages/cli/package.json'), 'utf8')) as { version: string }).version;
  writeFileSync(join(t26.rootOf(home), 'setup-finished.json'), JSON.stringify({ version }));
}

/** A live fixture session: an agent stand-in with its hooks and its own `deep mcp`, on a real hub in a temp home. */
export async function sessionWorld(): Promise<t26.World> {
  const [world] = await Promise.all([t26.agentWorld(), supportBinaries(), probeBinary()]);
  setupFinished(world.home);
  return world;
}

/** The session that draws, #806's: two stand-ins and a hub with its world file, and no replica: the real app reads this hub. */
export async function figureWorld(): Promise<Figures> {
  const [made] = await Promise.all([openFigures({ app: false }), supportBinaries(), probeBinary()]);
  setupFinished(made.home);
  return made;
}

export interface Asked { handle: string; question: string; pick: { id: string; label: string }; other: { id: string; label: string }; wait: () => Promise<string | undefined> }
/**
 * The session asks through its own `deep mcp`, as an agent does. A taste call goes on with its recommended option as
 * `provisional`, so `deep_ask` may come back at once, and a provisional `blue` is no answer: `pick` is the other option. `wait`
 * gives what reached the session as answered, from `deep_ask` or, after it, `deep_wait`; undefined when nothing did.
 */
export async function raise(world: t26.World, question: string): Promise<Asked> {
  const [pick, other] = [{ id: 'green', label: 'Green header' }, { id: 'blue', label: 'Blue header' }];
  const asked = t26.pending(t26.callTool(world.agent, 'deep_ask', { kind: 'taste', question, options: [pick, other], recommended: other.id }));
  const created = await t26.eventMatching(world.hub, (e) => e.kind === 'ask.created' && e.data?.question === question, 20_000);
  if (!created) return blocked(`deep_ask "${question}" filed nothing in 20 s: ${JSON.stringify(await Promise.race([asked, sleep(1000)]))?.slice(0, 800)}`);
  const handle = `ask:${created.id}`;
  const value = (done: Awaited<typeof asked>): { status?: string; answer?: string } | undefined => (done.returned ? t26.valueOf(done.returned, `deep_ask for ${handle}`) : undefined);
  const wait = async (): Promise<string | undefined> => {
    for (let reply = value(await asked); ;) {
      if (reply?.status === 'answered') return reply.answer;
      if (!reply) return undefined;
      reply = value(await t26.pending(t26.callTool(world.agent, 'deep_wait', { ask: handle })));
    }
  };
  return { handle, question, pick, other, wait };
}
export const answersOf = (all: readonly Ev[], handle: string): Ev[] => all.filter((e) => e.kind === 'ask.answered' && e.subject === handle);

/** What's wrong with an answer that should have reached its session once, naming the ask. */
export function answerFailures(ask: Pick<Asked, 'handle' | 'pick'>, all: readonly Ev[], reached: string | undefined): string[] {
  const out: string[] = [];
  const answers = answersOf(all, ask.handle);
  if (answers.length !== 1) out.push(`the record shows ${answers.length} answers to ${ask.handle}, not one`);
  for (const a of answers) {
    if (a.data?.answer !== ask.pick.id) out.push(`the record shows ${ask.handle} answered ${String(a.data?.answer)}, not ${ask.pick.id}`);
    if (a.data?.via !== 'card') out.push(`${ask.handle}'s answer came ${String(a.data?.via)}, not from the card`);
  }
  if (reached !== ask.pick.id) out.push(`the session didn't get ${ask.handle}'s answer: deep_ask and deep_wait gave ${String(reached)}`);
  return out;
}

/** What's wrong after the OS said no: an answer counted, so a press from no hardware passed for you. */
export const unconfirmedFailures = (ask: Pick<Asked, 'handle'>, all: readonly Ev[]): string[] =>
  answersOf(all, ask.handle).map((a) => `${ask.handle} was answered ${String(a.data?.answer)} though the OS didn't confirm you`);

/**
 * Presses `question`'s row, waits past the card's arming, and presses the option: an accessibility press, which no card
 * takes as hardware (design: Clicks on the question card), so it counts only if the OS confirms you.
 */
export async function pressOption(app: App, ask: Pick<Asked, 'question' | 'pick' | 'other'>): Promise<string[]> {
  const row = await settled(async () => ((await app.press(ask.question)).pressed ? [] : [`Needs you has no row for "${ask.question}" that takes a press; the window's names are ${JSON.stringify(named(await app.tree()).map((n) => n.name).slice(0, 30))}`]), 30_000);
  if (row.length) return row;
  const card = await settled(async () => {
    const shown = named(await app.tree());
    return [ask.pick.label, ask.other.label].filter((l) => !shown.some((n) => n.role === 'AXButton' && n.name.includes(l))).map((l) => `the card shows no option "${l}"`);
  });
  if (card.length) return card;
  await sleep(1500); // arm_after is 500 ms from the frame that showed it, on the app's own clock.
  const press = await app.press(ask.pick.label, 'AXButton');
  return press.pressed ? [] : [`the card's option "${ask.pick.label}" took no press: ${JSON.stringify(press)}`];
}

/** The fixture package `name`, copied to a temp folder, each `*.fixture` renamed without the suffix, its digest set. */
export function packageDir(name: string): string {
  const dir = join(t806.tempDir(), name);
  cpSync(join(FIXTURES, name), dir, { recursive: true });
  const walk = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const path = join(d, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.fixture')) renameSync(path, path.slice(0, -'.fixture'.length));
    }
  };
  walk(dir);
  const file = join(dir, 'deepbuild.json');
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  manifest.digest = packageDigest(dir);
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}
/**
 * `deep install <the fixture package>`, as you would run it. The hub's OS confirmation says yes here. A package whose process
 * dies before it connects says nothing about the app or its kits: that Mac can't run sandboxed packages (README, How to run).
 */
export async function install(home: string, name: string): Promise<t26.Ran> {
  const ran = await t26.deep(home, ['install', packageDir(name)]);
  if (/platform sandbox: it exited \(SIG/.test(ran.stderr)) blocked(`this Mac can't run a sandboxed package, so nothing installed can load: ${ran.stderr.trim().slice(-200)} (README, How to run: Node)`);
  return ran;
}

// ---- What each path must show.

export const PANEL_TEXT = 'Installed board panel';
export const REFUSED_TEXT = 'Refused overlay panel';
export const PAGE_ENTRY = 'Board: alpha';
export const COMMAND_ENTRY = 'Refresh board';
export const PAGE_TEXT = 'Board page: alpha';
/** A page fills the page, right of the list. Sidebar text starts inside 260 of 1512 points. */
export const onThePage = (line: Line, picture: Picture): boolean => line.box[0]! > 0.18 * picture.width;

/** What's wrong with ⌘K as it shows, on the tree and on the pixels. */
export async function commandFailures(app: App): Promise<string[]> {
  const shown = named(await app.tree());
  const lines = await ocr(await app.capture('commands'));
  return [PAGE_ENTRY, COMMAND_ENTRY].flatMap((entry) => [
    ...(shown.some((n) => n.name === entry) ? [] : [`⌘K lists no entry named "${entry}" on the window's tree; its names are ${JSON.stringify(shown.map((n) => n.name).slice(0, 30))}`]),
    ...(reads(lines, entry) ? [] : [`⌘K's entry "${entry}" isn't on the window's pixels: they read ${sees(lines)}`]),
  ]);
}

/** ⌘K, sent again until it shows: another session's window may hold the keyboard for a moment. */
export async function openCommands(app: App): Promise<string[]> {
  await app.commandK();
  let tries = 0;
  return settled(async () => {
    const failures = await commandFailures(app);
    if (failures.length && ++tries % 4 === 0) await app.commandK();
    return failures;
  }, 15_000);
}

/** What's wrong with the window once a page was opened from ⌘K. */
export async function pageFailures(app: App, text = PAGE_TEXT): Promise<string[]> {
  const picture = await app.capture('page');
  const lines = await ocr(picture);
  const line = lineOf(lines, text);
  const failures: string[] = [];
  if (!line) failures.push(`opening "${PAGE_ENTRY}" didn't fill the page: the window's pixels lack "${text}" and read ${sees(lines)}`);
  else if (!onThePage(line, picture)) failures.push(`"${PAGE_ENTRY}" drew at ${line.box[0]} px of ${picture.width}: in the list, not the page`);
  const left = named(await app.tree()).filter((n) => n.name === PAGE_ENTRY);
  if (left.length) failures.push('⌘K stayed open over the page it opened');
  return failures;
}

/** What's wrong with the window holding the installed panel and not the refused one. */
export function panelFailures(lines: readonly Line[], o: { refused: boolean }): string[] {
  const out: string[] = [];
  if (!reads(lines, PANEL_TEXT)) out.push(`the panel \`deep install\` installed isn't in the window with no flag: its pixels lack "${PANEL_TEXT}" and read ${sees(lines)}`);
  if (o.refused && reads(lines, REFUSED_TEXT)) out.push(`the panel that failed panel@1 was loaded anyway: the window draws "${REFUSED_TEXT}"`);
  return out;
}

/** Horizontal runs of `color` at least `least` px long, one per bar, top to bottom. */
export function runsOf(p: Picture, color: Rgb, least: number, tolerance = 8): { x: number; y: number; w: number; h: number }[] {
  const seen: { x: number; y: number; w: number; h: number }[] = [];
  for (let y = 0; y < p.height; y++) {
    for (let x = 0; x < p.width;) {
      if (!near(p.at(x, y), color, tolerance)) { x++; continue; }
      let end = x;
      while (end < p.width && near(p.at(end, y), color, tolerance)) end++;
      const w = end - x;
      if (w >= least) {
        const run = seen.find((r) => Math.abs(r.x - x) <= 2 && Math.abs(r.w - w) <= 2 && r.y + r.h >= y - 1);
        if (run) run.h = y - run.y + 1;
        else seen.push({ x, y, w, h: 1 });
      }
      x = end;
    }
  }
  return seen.filter((r) => r.h >= 4);
}

/**
 * Whether the window's pixels hold the figure's three bars: 240, 180 and 120 wide in the document, one above the other, from
 * one left edge, each 30 apart, at whatever scale the panel draws. A picture is the only thing that can draw them, so words
 * written with the app's own text fail here though they read the same.
 */
export function figureFailures(p: Picture, bar: Rgb, lines: readonly Line[], title: string, caption: string): string[] {
  const out: string[] = [];
  for (const text of [title, caption]) if (!reads(lines, text)) out.push(`the session's canvas isn't in the window: its pixels lack the figure's "${text}" and read ${sees(lines)}`);
  const runs = runsOf(p, bar, 60);
  const fits = runs.flatMap((a, i) => runs.slice(i + 1).flatMap((b) => runs.filter((c) => c.y > b.y && b.y > a.y).map((c) => [a, b, c] as const)));
  const near3 = (x: number, y: number): boolean => Math.abs(x - y) <= Math.max(3, 0.03 * y);
  const found = fits.some(([a, b, c]) => near3(a.x, b.x) && near3(a.x, c.x) && near3(b.w, a.w * 0.75) && near3(c.w, a.w * 0.5) && near3(c.y - b.y, b.y - a.y));
  if (!found) out.push(`the session's canvas isn't in the window: its pixels hold no three bars of ${hex(bar)} in the figure's 4:3:2 (runs of it: ${JSON.stringify(runs.slice(0, 8))})`);
  return out;
}

/** The window, its session's page open, judged against the figure the hub rendered: the bars' color is the snapshot's own pixel. */
export async function canvasFailures(app: App, home: string, sha: string, session: string): Promise<string[]> {
  const png = t806.t393.decodePng(await t806.readEvidence(home, sha));
  const at = (136 + 68 * png.width) * 4; // The first bar's middle: column 136 and row 68 of the figure's 320 × 200.
  const bar: Rgb = [png.rgba[at]!, png.rgba[at + 1]!, png.rgba[at + 2]!];
  return settled(async () => {
    // The session's row opens its page, where its canvas is; a window that shows it at once is as good.
    await app.press(`Session ${session.slice(0, 8)}`, 'AXButton');
    const picture = await app.capture('canvas');
    return figureFailures(picture, bar, await ocr(picture), 'Release readiness', 'Ready for review');
  }, 20_000);
}

// ---- The lint (AC5): scripts/render-lint.mjs, run on copies of the app's source (README, Pinned).

export const LINT = 'scripts/render-lint.mjs';

// ---- The taste call (AC7).

export interface Taste { issue?: number; criterion?: string; verdict?: string | null; who?: string | null; when?: string | null; files?: Record<string, string>; note?: string }
const sorted = (files: Record<string, string>): string => JSON.stringify(Object.fromEntries(Object.entries(files).sort()));
/** What a run reads of TASTE.json: `null` only when a person called exactly this run's files `looks_right`. */
export function tasteFailure(taste: Taste, got: Record<string, string>): { inconclusive?: string; fails?: string } | null {
  if (taste.verdict === null || taste.verdict === undefined) return { inconclusive: 'AC7: no taste call is recorded for these screenshots (TASTE.json holds none)' };
  if (!taste.who || !taste.when) return { inconclusive: 'AC7: the taste call names no one or no time' };
  if (sorted(taste.files ?? {}) !== sorted(got)) return { inconclusive: 'AC7: the recorded taste call was made on other pictures than this run\'s' };
  if (taste.verdict !== 'looks_right') return { fails: `the recorded taste call says they don't look right: ${taste.note ?? ''}` };
  return null;
}
export const childProcess = (command: string, args: string[], home: string): Promise<string> => run(command, args, t26.childEnv(home, {}));
export const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

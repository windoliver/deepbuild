// Shared test-side tools for issue #1556 (README): temp homes with a planted `deep` first on PATH; the Set up click
// through the replica (`deep-replica --first-screen --click "Set up"`, pinned here) and the frames it reports; the
// judges of those frames; a scratch copy of the checkout with a planted `Command::output` in deep-app's UI code; the
// lint lane's commands run over it; and the judge of their output. Patterns adapted from
// tests/acceptance/1002/helpers.ts (same repo, same license). Nothing here stands in for DeepBuild: every tagged test
// reaches it through the replica binary or the lint lane's own commands. The planted wrong programs in twins/ stand in
// for those only in twins.test.ts.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
/** The replica as `cargo build -p deep-replica --bin deep-replica` builds it from the checkout. */
export const REPLICA = join(REPO, 'target/debug/deep-replica');
export const TWINS = fileURLToPath(new URL('./twins/', import.meta.url));
export const NODE = process.execPath;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The window and its replica draw on macOS only; elsewhere these tests can't run, which is BLOCKED, never a pass. */
export function onMac(): void {
  if (process.platform !== 'darwin') throw Error(`BLOCKED: the app's window and its replica draw on macOS only; this is ${process.platform}`);
}

// ---- Temp folders, under /tmp/da1556-*.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/da1556-'));
  made.push(dir);
  return dir;
}

// ---- Processes this suite started. Stopped by PID only, never by name or port.
const owned = new Set<number>();
export function own(pid: number | undefined | null): void {
  if (pid) owned.add(pid);
}
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
/** Stops every process this suite started (SIGTERM, then SIGKILL after 3 s) and removes the temp folders. */
export async function cleanup(): Promise<void> {
  for (const pid of owned) {
    try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  }
  const deadline = Date.now() + 3000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) {
    if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  }
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; timedOut: boolean }
export function run(command: string, args: readonly string[], o: { env: NodeJS.ProcessEnv; cwd: string; timeoutMs?: number }): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: o.cwd, env: o.env, stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs ?? 180_000);
    child.on('error', (error) => { stderr += `\n[spawn failed: ${error.message}]`; });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, timedOut }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end('');
  });
}
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''}, stdout ${JSON.stringify(r.stdout.slice(-1500))}, stderr ${JSON.stringify(r.stderr.slice(-1500))}`;

// ---- Homes with a planted `deep` (README: The planted deep).
/** The planted `deep setup` that sleeps 3 s, then exits 0 saying nothing. */
export const SLOW_SECONDS = 3;
/** The one line the planted failing `deep setup` writes on stderr before it exits 1. */
export const PLANTED_ERROR = 'deep setup: the planted failure of #1556, on purpose';
export type Planted = 'slow' | 'failing';
export interface Home { tmp: string; home: string; bin: string; log: string }
/**
 * A fresh home: `<tmp>/h` is HOME, with nothing of DeepBuild in it, so the first screen offers Set up. `<tmp>/bin` is
 * first on PATH and holds the planted `deep`, which logs `start <args>` and `end <code>` to `<tmp>/deep.log`:
 * - `slow`: `deep setup` sleeps 3 s, then exits 0;
 * - `failing`: `deep setup` sleeps 0.5 s, writes PLANTED_ERROR as its one stderr line and exits 1.
 */
export function makeHome(planted: Planted): Home {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const bin = join(tmp, 'bin');
  const log = join(tmp, 'deep.log');
  mkdirSync(home, { recursive: true });
  mkdirSync(bin);
  const body = planted === 'slow'
    ? [`sleep ${SLOW_SECONDS}`, `echo 'end 0' >> '${log}'`, 'exit 0']
    : ['sleep 0.5', `echo '${PLANTED_ERROR}' >&2`, `echo 'end 1' >> '${log}'`, 'exit 1'];
  writeFileSync(join(bin, 'deep'), ['#!/bin/sh', `echo "start $*" >> '${log}'`, ...body, ''].join('\n'));
  chmodSync(join(bin, 'deep'), 0o755);
  return { tmp, home, bin, log };
}
const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
/** The environment a child of a click gets: HOME the test's home, the planted `deep` first on PATH, none of this process's DEEP_, CLAUDE*, CODEX*, GIT_, XDG_ or billing variables. */
export function childEnv(h: Home): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|CLAUDE|CODEX|GIT_)/.test(key) || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  env.HOME = h.home;
  env.XDG_CONFIG_HOME = join(h.home, '.config');
  env.XDG_CACHE_HOME = join(h.home, '.cache');
  env.PATH = `${h.bin}:/usr/bin:/bin:/usr/sbin:/sbin`;
  env.LC_ALL = 'C';
  return env;
}

// ---- Builds.
const builds = new Map<string, Promise<void>>();
function cargoBuild(...args: string[]): Promise<void> {
  const key = args.join(' ');
  let build = builds.get(key);
  if (!build) {
    build = run('cargo', ['build', '--locked', '-q', ...args], { cwd: REPO, env: process.env, timeoutMs: 1_800_000 }).then((r) => {
      if (r.code !== 0) throw Error(`BLOCKED: cargo build ${key} failed: ${r.stderr.slice(-3000)}`);
    });
    builds.set(key, build);
  }
  return build;
}

// ---- The click (README: Pinned here, 1).
export interface Frame { ms: number; nodes: Line[]; texts: string[] }
export interface Click { frames: Frame[]; ran: Ran; deepLog: string[] }
/**
 * One click on Set up: `deep-replica --first-screen --click "Set up" --out <out> --appearance light`, HOME the test's
 * home, in the temp folder. It writes `<out>/frames.jsonl`, one `{"ms", "tree"}` line per frame drawn after the click.
 * `twin` names a planted wrong program, `twins/click.mjs <mode>`, run in the replica's place with the same arguments.
 */
export async function clickSetUp(h: Home, o: { twin?: string } = {}): Promise<Click> {
  const out = join(h.tmp, 'out');
  const args = ['--first-screen', '--click', 'Set up', '--out', out, '--appearance', 'light'];
  let ran: Ran;
  if (o.twin) {
    ran = await run(NODE, [join(TWINS, 'click.mjs'), o.twin, ...args], { env: childEnv(h), cwd: h.tmp, timeoutMs: 60_000 });
  } else {
    onMac();
    await cargoBuild('-p', 'deep-replica', '--bin', 'deep-replica');
    ran = await run(REPLICA, args, { env: childEnv(h), cwd: h.tmp, timeoutMs: 120_000 });
  }
  const file = join(out, 'frames.jsonl');
  if (!existsSync(file)) expect.fail(`#1556 the Set up click through the replica (deep-replica --first-screen --click "Set up") must write ${file}, one line per frame drawn after the click: it wrote none (${shown(ran)})`);
  const frames: Frame[] = [];
  for (const [i, raw] of readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).entries()) {
    let line: Line;
    try { line = JSON.parse(raw) as Line; } catch { expect.fail(`#1556 ${file} line ${i + 1} is not JSON: ${JSON.stringify(raw.slice(0, 200))}`); }
    if (typeof line.ms !== 'number' || typeof line.tree !== 'object' || line.tree === null) expect.fail(`#1556 ${file} line ${i + 1} must be {"ms": <number>, "tree": <node>}: ${JSON.stringify(raw.slice(0, 200))}`);
    const nodes: Line[] = [];
    const walk = (n: Line) => { nodes.push(n); for (const c of Array.isArray(n.children) ? n.children : []) walk(c as Line); };
    walk(line.tree as Line);
    const texts = nodes.flatMap((n) => [n.name, n.value]).filter((v): v is string => typeof v === 'string' && v !== '');
    frames.push({ ms: line.ms as number, nodes, texts });
  }
  for (let i = 1; i < frames.length; i++) if (frames[i]!.ms < frames[i - 1]!.ms) expect.fail(`#1556 ${file}'s frames must be in the order drawn: frame ${i + 1} at ${frames[i]!.ms} ms comes after one at ${frames[i - 1]!.ms} ms`);
  const deepLog = existsSync(h.log) ? readFileSync(h.log, 'utf8').split('\n').filter(Boolean) : [];
  return { frames, ran, deepLog };
}

/** "Shows it's working" (README: Pinned here, 2): some node's name or value says setup is under way. */
export const WORKING = /setting up|working/i;
export const working = (f: Frame) => f.texts.some((t) => WORKING.test(t));
/** The one line (#326's, deep-app's `SET_UP_LINE`): it names the hooks, watch-only, the hub and `deep setup --undo`. */
export const isSetUpLine = (t: string) => /hook/i.test(t) && /watch[- ]only/i.test(t) && /\bhub\b/i.test(t) && t.includes('deep setup --undo');
const saysSetUp = (f: Frame) => f.texts.some(isSetUpLine);
const saysError = (f: Frame) => f.texts.some((t) => t.includes(PLANTED_ERROR));
/** The longest wait between two frames drawn before setup's outcome that a free UI thread may take (README: Pinned here, 1). */
export const MAX_GAP_MS = 500;
const brief = (f: Frame | undefined) => (f ? `${f.ms} ms: ${JSON.stringify(f.texts.slice(0, 20))}` : 'none');

/** The frames before the outcome all show it's working, start within 100 ms of the click, and never stop for long. */
function workingUntil(c: Click, outcome: number, who: string): void {
  const first = c.frames[0];
  if (!first || first.ms > 100) expect.fail(`#1556 ${who}: the window must draw a frame within 100 ms of the click; its first frame after the click came at ${first ? `${first.ms} ms` : 'no time (it drew none)'} (frames: ${c.frames.length}, ${shown(c.ran)})`);
  const early = c.frames.filter((f) => f.ms <= 100);
  if (!early.some(working)) expect.fail(`#1556 ${who}: the frame drawn within 100 ms of the click must show it's working (a node reading ${WORKING}); the frames by 100 ms read ${early.map(brief).join('; ')}`);
  const before = c.frames.slice(0, outcome);
  const idle = before.find((f) => !working(f));
  if (idle) expect.fail(`#1556 ${who}: until setup's outcome shows, every frame must show it's working; the frame at ${brief(idle)} doesn't`);
  for (let i = 1; i < Math.min(outcome + 1, c.frames.length); i++) {
    const gap = c.frames[i]!.ms - c.frames[i - 1]!.ms;
    if (gap > MAX_GAP_MS) expect.fail(`#1556 ${who}: the window drew no frame from ${c.frames[i - 1]!.ms} ms to ${c.frames[i]!.ms} ms after the click while setup ran; the UI thread must stay free (a gap over ${MAX_GAP_MS} ms)`);
  }
}

/**
 * Criterion 1's judge: with the planted `deep` that sleeps 3 s, a frame within 100 ms of the click shows it's working,
 * frames keep coming and keep showing it until setup ends, then the one line shows, no sooner than the planted setup
 * could end.
 */
export function judgeSlow(c: Click): void {
  const who = 'with a planted deep that sleeps 3 s, the Set up click';
  const outcome = c.frames.findIndex(saysSetUp);
  workingUntil(c, outcome === -1 ? c.frames.length : outcome, who);
  if (outcome === -1) expect.fail(`#1556 ${who}: once setup ends the window must show the one line; no frame does. The last: ${brief(c.frames.at(-1))} (${shown(c.ran)})`);
  if (!c.deepLog.some((l) => /^start setup\b/.test(l)) || !c.deepLog.includes('end 0')) expect.fail(`#1556 ${who}: the click must run deep setup to its end; the planted deep logged ${JSON.stringify(c.deepLog)}`);
  const at = c.frames[outcome]!.ms;
  if (at < SLOW_SECONDS * 1000 - 100) expect.fail(`#1556 ${who}: it showed the one line ${at} ms after the click, before the planted deep setup (${SLOW_SECONDS} s) could have ended`);
  if (c.ran.code !== 0) expect.fail(`#1556 ${who}: the replica must exit 0 once a frame shows what Set up said: ${shown(c.ran)}`);
}

/** Criterion 2's judge: with a planted failing `deep`, the window shows its one-line error, in one line, and never the one line that setup finished. */
export function judgeFailing(c: Click): void {
  const who = 'with a planted failing deep, the Set up click';
  if (c.frames.some(saysSetUp)) expect.fail(`#1556 ${who} must not say DeepBuild was set up: ${brief(c.frames.find(saysSetUp))}`);
  const outcome = c.frames.findIndex(saysError);
  if (outcome === -1) expect.fail(`#1556 ${who} must still show its one-line error, ${JSON.stringify(PLANTED_ERROR)}; no frame does. The last: ${brief(c.frames.at(-1))} (${shown(c.ran)})`);
  const node = c.frames[outcome]!.texts.find((t) => t.includes(PLANTED_ERROR))!;
  if (/[\r\n]/.test(node.trim())) expect.fail(`#1556 ${who} must show its error in one line: it reads ${JSON.stringify(node)}`);
  if (!c.deepLog.includes('end 1')) expect.fail(`#1556 ${who}: the click must run the planted deep setup to its end; it logged ${JSON.stringify(c.deepLog)}`);
  if (c.ran.code !== 0) expect.fail(`#1556 ${who}: the replica must exit 0 once a frame shows what Set up said: ${shown(c.ran)}`);
}

// ---- The lint lane over a planted Command::output (README: Pinned here, 3).
export const PLANT_FILE = 'crates/deep-app/src/views.rs';
const PLANT_CALL = '    std::process::Command::new("deep").output().is_ok()';
/** The planted function, fmt- and clippy-clean but for the blocking call. */
const PLANT = [
  '/// Planted by tests/acceptance/1556 in a scratch copy, never in the repo: a blocking process call in UI code.',
  'pub fn planted_blocking_call_1556() -> bool {',
  PLANT_CALL,
  '}',
  '',
];
/**
 * A scratch copy of the checkout as it stands (tracked files and untracked ones git doesn't ignore, read from the
 * working tree), made a git repo of its own with one commit, under `/tmp/da1556-*`. The repo's node_modules is linked in.
 */
export function scratchCopy(): string {
  const tmp = tempDir();
  const dest = join(tmp, 'repo');
  mkdirSync(dest);
  const listed = execFileSync('git', ['ls-files', '-z', '-co', '--exclude-standard'], { cwd: REPO, maxBuffer: 1 << 28 }).toString('utf8').split('\0').filter(Boolean);
  const files = [...new Set(listed)].filter((f) => existsSync(join(REPO, f)));
  writeFileSync(join(tmp, 'files'), files.join('\0'));
  const tar = spawnSync('sh', ['-c', `tar --null -T '${join(tmp, 'files')}' -cf - | tar -xf - -C '${dest}'`], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 26 });
  if (tar.status !== 0) throw Error(`BLOCKED: the scratch copy of the checkout failed: ${tar.stderr.slice(-2000)}`);
  if (existsSync(join(REPO, 'node_modules'))) symlinkSync(join(REPO, 'node_modules'), join(dest, 'node_modules'));
  // The workspaces' builds, which conformance-lint and slots-check read, when the checkout has them.
  for (const pkg of readdirSync(join(REPO, 'packages'))) {
    const dist = join(REPO, 'packages', pkg, 'dist');
    if (existsSync(dist) && existsSync(join(dest, 'packages', pkg))) symlinkSync(dist, join(dest, 'packages', pkg, 'dist'));
  }
  gitCommit(dest, 'the checkout', true);
  return dest;
}
function gitCommit(dir: string, message: string, init = false): void {
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))), GIT_AUTHOR_NAME: 'da1556', GIT_AUTHOR_EMAIL: 'da1556@example.invalid', GIT_COMMITTER_NAME: 'da1556', GIT_COMMITTER_EMAIL: 'da1556@example.invalid' };
  const steps = [...(init ? [['init', '-q', '-b', 'main']] : []), ['add', '-A'], ['-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', message]];
  for (const step of steps) {
    const r = spawnSync('git', step, { cwd: dir, env, encoding: 'utf8', maxBuffer: 1 << 26 });
    if (r.status !== 0) throw Error(`BLOCKED: git ${step.join(' ')} in the scratch copy failed: ${r.stderr.slice(-1000)}`);
  }
}
/**
 * Plants the blocking call in `crates/deep-app/src/views.rs` of the scratch copy, before its test module (or at its
 * end), commits it, and returns the 1-based line of `Command::new(...).output()`.
 */
export function plant(dest: string): number {
  const file = join(dest, PLANT_FILE);
  const lines = readFileSync(file, 'utf8').split('\n');
  let at = lines.findIndex((l, i) => l.trim() === '#[cfg(test)]' && /^mod tests\b/.test(lines[i + 1]?.trim() ?? ''));
  if (at === -1) at = lines.at(-1) === '' ? lines.length - 1 : lines.length;
  lines.splice(at, 0, ...PLANT);
  writeFileSync(file, lines.join('\n'));
  const line = at + 1 + PLANT.indexOf(PLANT_CALL);
  if (lines[line - 1] !== PLANT_CALL) throw Error('INVALID: the planted line is not where it was put');
  gitCommit(dest, 'plant a blocking Command::output in deep-app UI code');
  return line;
}
/** The plant must be rustfmt-clean, so a format check can't name its line; else the run is INVALID. */
export function plantIsFormatted(dest: string): void {
  const r = spawnSync('rustfmt', ['--check', '--edition', '2021', join(dest, PLANT_FILE)], { cwd: dest, encoding: 'utf8', env: cargoEnv(dest) });
  if (r.status !== 0) throw Error(`INVALID: the planted views.rs isn't rustfmt-clean, so the test plants the wrong thing: ${(r.stdout + r.stderr).slice(0, 1500)}`);
}

/** The lint lane's commands, as the scratch copy's `scripts/lanes.mjs` lists them (its `checks`, name `lint`). */
export function lintCommands(dest: string): string[][] {
  const r = spawnSync(NODE, ['--input-type=module', '-e', `const m = await import(${JSON.stringify(join(dest, 'scripts/lanes.mjs'))}); console.log(JSON.stringify(m.checks.find((c) => c.name === 'lint')?.commands ?? null));`], { cwd: dest, encoding: 'utf8', env: cargoEnv(dest) });
  const commands = r.status === 0 ? JSON.parse(r.stdout.trim().split('\n').at(-1)!) as string[][] | null : null;
  if (!commands?.length) throw Error(`BLOCKED: scripts/lanes.mjs lists no lint lane: ${r.stderr.slice(-1500)}`);
  return commands;
}
/**
 * The lane's commands as this suite runs them (README: How the lint lane runs): every command as listed, except that
 * `cargo clippy --workspace` is narrowed to `-p deep-app --no-deps`, the only crate the plant changes, so a lint error
 * main has in another crate (deep-canvas at the base) can't stop clippy before it reaches deep-app.
 */
export function narrowed(commands: string[][]): string[][] {
  return commands.map((c) => {
    if (c[0] !== 'cargo' || c[1] !== 'clippy') return c;
    const rest = c.slice(2).filter((a) => a !== '--workspace');
    return ['cargo', 'clippy', '-p', 'deep-app', '--no-deps', ...rest];
  });
}
/** Cargo and rustup at their real homes (the toolchain), HOME a temp one, the shared build cache the checkout's target/. */
function cargoEnv(dest: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!/^(DEEP_|GIT_|CLAUDE|CODEX)/.test(key) && !BILLING.includes(key)) env[key] = value;
  env.CARGO_HOME = process.env.CARGO_HOME ?? join(homedir(), '.cargo');
  env.RUSTUP_HOME = process.env.RUSTUP_HOME ?? join(homedir(), '.rustup');
  env.CARGO_TARGET_DIR = join(REPO, 'target');
  env.HOME = join(dirname(dest), 'h');
  mkdirSync(env.HOME, { recursive: true });
  env.DEEP_OPEN_ISSUES = join(dirname(dest), 'open-issues.json');
  return env;
}
export interface LintRun { command: string[]; code: number | null; output: string }
/** Runs the commands in the scratch copy, one by one, stopping after the first that fails naming `file:line`. */
export async function runLint(dest: string, commands: string[][], file: string, line: number): Promise<LintRun[]> {
  const runs: LintRun[] = [];
  for (const command of commands) {
    const r = await run(command[0]!, command.slice(1), { cwd: dest, env: cargoEnv(dest), timeoutMs: 3_600_000 });
    runs.push({ command, code: r.timedOut ? null : r.code, output: `${r.stdout}\n${r.stderr}` });
    if (r.code !== 0 && names(runs.at(-1)!.output, file, line)) break;
  }
  return runs;
}
const names = (output: string, file: string, line: number) => new RegExp(`(^|[\\s/'"(])${file.replace(/[.]/g, '\\.')}:${line}(?!\\d)`, 'm').test(output);
const isFormat = (c: string[]) => c[0] === 'cargo' && c[1] === 'fmt';
/**
 * Criterion 3's judge: some command of the lint lane other than the format check fails (exits non-zero) and its output
 * names `<file>:<line>` of the planted call. A planted call that didn't compile makes the run INVALID, never a pass.
 */
export function judgeLint(runs: LintRun[], file: string, line: number): void {
  for (const r of runs) {
    if (!isFormat(r.command) && names(r.output, file, line) && /^error\[E\d{4}\]/m.test(r.output)) throw Error(`INVALID: the planted call at ${file}:${line} doesn't compile, so ${r.command.join(' ')} names it for that: ${r.output.slice(-1500)}`);
  }
  const hit = runs.find((r) => !isFormat(r.command) && r.code !== 0 && names(r.output, file, line));
  if (hit) return;
  const said = runs.map((r) => `${r.command.slice(0, 3).join(' ')}: exit ${r.code}${names(r.output, file, line) ? ' (names the line)' : ''}`).join('; ');
  const near = runs.flatMap((r) => r.output.split('\n').filter((l) => l.includes(file.split('/').at(-1)!))).slice(0, 8);
  expect.fail(`#1556 a planted Command::output in deep-app's UI code must fail the lint lane, naming the line ${file}:${line}; no lint command fails naming it (${said})${near.length ? `; lines naming the file: ${JSON.stringify(near)}` : ''}`);
}

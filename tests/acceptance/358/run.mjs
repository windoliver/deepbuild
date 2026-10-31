// Runs the #358 spike for the live tests: builds its release binaries through the command the record names, reads
// what cargo says it built, and drives the app's headless check, the host and the benchmark as subprocesses.
// DEEP_358_KEEP=<dir> also writes what a run found there, which is how the record's tracked copy (record.out) is made.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { artifactFor, releaseProblems, root, ROWS, COLUMNS } from './validate.mjs';

const env = () => { const copy = { ...process.env }; delete copy.DISPLAY; delete copy.WAYLAND_DISPLAY; delete copy.CI; return copy; };
export const blocked = (why) => assert.fail(`BLOCKED: ${why}`);

let built;
/** Builds record.build with cargo's JSON messages: the only source of which files are the host and the app. */
export function binaries(record) {
  if (process.platform !== 'darwin') blocked(`the spike's signing and render run on macOS, not ${process.platform}`);
  if (built) return built;
  const result = spawnSync(record.build[0], [...record.build.slice(1), '--message-format=json'], { cwd: root, env: env(), encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 });
  if (result.error || result.status !== 0) blocked(`${record.build.join(' ')} failed: ${result.error?.message ?? result.stderr.slice(-2000)}`);
  const messages = result.stdout.split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line));
  const host = artifactFor(messages, record.host.bin), app = artifactFor(messages, record.app.bin);
  built = { host: host?.executable, app: app?.executable, problems: [...releaseProblems(record.host.bin, host), ...releaseProblems(record.app.bin, app)] };
  return built;
}

const expand = (command, bins) => command.map((part) => part.replace('{app}', bins.app).replace('{host}', bins.host));

/** Runs a command, and reads the JSON it was told to write. */
export function run(argv, { out, envs = {} } = {}) {
  return new Promise((resolve) => {
    const started = performance.now();
    const child = spawn(argv[0], argv.slice(1), { cwd: root, env: { ...env(), ...envs }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stdout.resume();
    child.stderr.on('data', (data) => { stderr += data; });
    child.on('error', (error) => resolve({ status: null, error, stderr, wallMs: performance.now() - started }));
    child.on('close', (status, signal) => {
      let output;
      if (out && existsSync(out)) { try { output = JSON.parse(readFileSync(out, 'utf8')); } catch { output = undefined; } }
      resolve({ status: status ?? signal, output, stderr, wallMs: performance.now() - started });
    });
  });
}

const rect = (value) => value.join(',');
const windowFlags = ['--window', '1512x982', '--scale', '2'];

export function checkArgv(record, bins, panel, { area, card, question, updates = 3, out, png }) {
  return [
    ...expand(record.check, bins), '--host', bins.host, '--panel', panel, '--origin', 'agent_built', ...windowFlags,
    '--panel-area', rect(area), ...(card ? ['--card', rect(card), '--question', question] : []), '--updates', String(updates), '--out', out, ...(png ? ['--png', png] : []),
  ];
}
export const check = (record, bins, panel, options) => run(checkArgv(record, bins, panel, options), { out: options.out });

/** One host run alone, no app: {pid, jit, renderNs, tree}. */
export const hostRun = (record, bins, panel, { renders, out }) => run([...expand(record.run, bins), '--panel', panel, '--renders', String(renders), '--out', out], { out });

export const bench = (record, bins, panel, { runs, updates, out }) => run([...expand(record.bench, bins), '--host', bins.host, '--panel', panel, '--origin', 'agent_built', '--runs', String(runs), '--updates', String(updates), '--out', out], { out });

export const jitControl = (record, panel, out) => run(record.jit.control, { out, envs: { DEEP_358_PANEL: panel, DEEP_358_RENDERS: '1000', DEEP_358_OUT: out } });

/** The check held open: JSON lines on stdin and stdout, the first being {ready, appPid, hostPid}. */
export function serve(record, bins, panel, options) {
  const child = spawn(...(([head, ...rest]) => [head, [...rest, '--serve']])(checkArgv(record, bins, panel, options)), { cwd: root, env: env(), stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = createInterface({ input: child.stdout });
  const waiting = [], early = [];
  const exited = new Promise((resolve) => child.on('close', (status, signal) => { resolve(status ?? signal); for (const each of waiting.splice(0)) each(null); }));
  lines.on('line', (line) => {
    let value;
    try { value = JSON.parse(line); } catch { return; }
    if (waiting.length) waiting.shift()(value); else early.push(value);
  });
  const next = (ms = 15_000) => new Promise((resolve) => {
    if (early.length) { resolve(early.shift()); return; }
    const timer = setTimeout(() => { waiting.splice(waiting.indexOf(deliver), 1); resolve(null); }, ms);
    const deliver = (value) => { clearTimeout(timer); resolve(value); };
    waiting.push(deliver);
  });
  return {
    child, next, exited,
    send: (command, ms) => { child.stdin.write(`${JSON.stringify(command)}\n`); return next(ms); },
    close: () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); return exited; },
  };
}

// CPU seconds a process has used, as ps counts them.
export function cpuSeconds(pid) {
  const out = spawnSync('/bin/ps', ['-o', 'cputime=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim();
  const match = out.match(/^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/);
  return match ? Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null;
}
export function processInfo(pid) {
  const out = spawnSync('/bin/ps', ['-o', 'ppid=,comm=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim();
  const match = out.match(/^(\d+)\s+(.+)$/);
  return match ? { ppid: Number(match[1]), comm: match[2] } : null;
}

// gpui-shell's own benchmark sources, from the commit Cargo.lock pins: the test passes these, not the record's copy.
export function upstreamSources() {
  const metadata = spawnSync('cargo', ['metadata', '--format-version', '1', '--locked'], { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 });
  if (metadata.status !== 0) blocked(`cargo metadata failed: ${metadata.stderr.slice(-500)}`);
  const shell = JSON.parse(metadata.stdout).packages.find((each) => each.name === 'gpui-shell');
  if (!shell) blocked('gpui-shell is no dependency of this workspace');
  const text = readFileSync(join(dirname(shell.manifest_path), 'src/tests/benchmark.rs'), 'utf8');
  const raw = (name) => text.match(new RegExp(`const ${name}: &str = r#"([\\s\\S]*?)"#;`))?.[1] ?? blocked(`gpui-shell's benchmark has no ${name}`);
  return { panel: raw('TEMPLATE').replace('__ROWS__', String(ROWS)).replace('__COLUMNS__', String(COLUMNS)), compute: raw('COMPUTE_TEMPLATE') };
}

export function keep(name, value) {
  const dir = process.env.DEEP_358_KEEP;
  if (!dir) return;
  const path = join(dir, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 1));
}
export const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

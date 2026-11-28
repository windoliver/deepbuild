import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = fileURLToPath(new URL('.', import.meta.url));
export const CHANGE = resolve(HERE, '../../..');

export const FILES = ['budget_recheck', 'entry_digest', 'migrates_from', 'duplicate_check_kind', 'recipe_channels', 'check_reads', 'module_of_check'];
export const targetOf = (file) => `acceptance_2130_${file}`;

const SUITE = join(HERE, 'suite');
const FOLDER = relative(CHANGE, HERE).split(sep).join('/');
export const TARGET_DIR = 'target/acceptance-2130';
export const COPY = `${TARGET_DIR}/suite`;
export const MANIFEST = `${COPY}/Cargo.toml`;
export const cargoArgs = (target) => ['test', '--no-fail-fast', '--manifest-path', MANIFEST, '--target-dir', TARGET_DIR, '--test', target];

const CARGO_DEADLINE = 18 * 60_000;

const tail = (text, n = 3000) => String(text ?? '').slice(-n);
function tidy(text) {
  let out = String(text ?? '');
  const roots = [CHANGE];
  try {
    roots.push(realpathSync(CHANGE));
  } catch {
  }
  for (const root of roots) out = out.split(root).join('<checkout>');
  const home = homedir();
  return home && home !== '/' ? out.split(home).join('~') : out;
}

function laySuite() {
  const put = (path, text) => {
    const to = join(CHANGE, COPY, path);
    mkdirSync(dirname(to), { recursive: true });
    if (!existsSync(to) || readFileSync(to, 'utf8') !== text) writeFileSync(to, text);
  };
  const manifest = readFileSync(join(SUITE, 'Cargo.toml'), 'utf8');
  const core = 'path = "../../../../crates/deep-canvas"';
  if (!manifest.includes(core)) return `BLOCKED: suite/Cargo.toml no longer names the canvas core as ${core}`;
  let laid = manifest.replace(core, 'path = "../../../crates/deep-canvas"');
  for (const file of FILES) {
    const here = `path = "../${file}.rs"`;
    if (!laid.includes(here)) return `BLOCKED: suite/Cargo.toml no longer names ${file}.rs as ${here}`;
    laid = laid.replace(here, `path = "../../../${FOLDER}/${file}.rs"`);
  }
  put('Cargo.toml', laid);
  put('src/lib.rs', readFileSync(join(SUITE, 'src/lib.rs'), 'utf8'));
  const root = join(CHANGE, 'Cargo.lock');
  if (!existsSync(root)) return 'BLOCKED: <checkout>/Cargo.lock is missing, so the suite has no pins to build at';
  const lock = readFileSync(root, 'utf8');
  const from = createHash('sha256').update(lock).digest('hex');
  const mark = join(CHANGE, COPY, 'Cargo.lock.from');
  if (!existsSync(join(CHANGE, COPY, 'Cargo.lock')) || !existsSync(mark) || readFileSync(mark, 'utf8') !== from) {
    writeFileSync(join(CHANGE, COPY, 'Cargo.lock'), lock);
    writeFileSync(mark, from);
  }
  return null;
}

export function readLibtest(output) {
  const results = new Map(), blocks = new Map();
  let open = null;
  for (const line of String(output ?? '').split(/\r?\n/)) {
    const header = line.match(/^---- (\S+) stdout ----$/);
    if (header) {
      open = header[1];
      blocks.set(open, []);
      continue;
    }
    if (/^failures:$/.test(line) || /^test result: /.test(line)) open = null;
    if (open) {
      blocks.get(open).push(line);
      continue;
    }
    const said = line.match(/^test (\S+) \.\.\. (\S+)/);
    if (said) results.set(said[1], [...results.get(said[1]) ?? [], said[2]]);
  }
  return { results, blocks: new Map([...blocks].map(([name, lines]) => [name, lines.join('\n')])) };
}

export function panicOf(block) {
  const lines = String(block ?? '').split('\n');
  const at = lines.findIndex((line) => /^thread '.*'(?: \(\d+\))? panicked at .*:$/.test(line));
  const location = at < 0 ? null : lines[at].replace(/^thread '.*'(?: \(\d+\))? panicked at /, '').replace(/:$/, '');
  const message = lines.slice(at + 1).filter((line) => !/^note: run with `RUST_BACKTRACE/.test(line)).join('\n').trim();
  return message ? { location, message } : null;
}

export function outcome(ran, target, name) {
  const shown = `cargo ${cargoArgs(target).join(' ')}`;
  if (ran.error?.code === 'ENOENT') return { blocked: `BLOCKED: cargo is not on PATH, so ${shown} did not run` };
  if (ran.error?.code === 'ETIMEDOUT') return { blocked: `BLOCKED: ${shown} was stopped after ${CARGO_DEADLINE / 60_000} minutes` };
  if (ran.error) return { blocked: `BLOCKED: ${shown} did not run: ${tidy(ran.error.message)}` };
  if (ran.status === null) return { blocked: `BLOCKED: ${shown} was killed${ran.signal ? ` by ${ran.signal}` : ''}, so its tests' results can't be read` };
  const { results, blocks } = readLibtest(ran.stdout);
  const said = results.get(name);
  if (!said) {
    const named = [...results.keys()];
    if (ran.status !== 0 && !named.length) return { blocked: `BLOCKED: the suite's target ${target} does not build or run against this checkout's canvas core (${shown} exited ${ran.status}), so the test ${name} did not run:\n${tidy(tail(ran.stderr) || tail(ran.stdout))}` };
    return { blocked: `BLOCKED: libtest's output does not name the test ${name} (${shown} exited ${ran.status}); it names ${named.length ? named.join(', ') : 'no test'}` };
  }
  if (said.length > 1) return { blocked: `BLOCKED: libtest's output names the test ${name} ${said.length} times (${said.join(', ')}), so its result can't be read (${shown})` };
  if (said[0] === 'ok') return { result: 'ok' };
  if (said[0] !== 'FAILED') return { blocked: `BLOCKED: libtest printed "test ${name} ... ${said[0]}", so the test did not run to a result (${shown})` };
  const panic = panicOf(blocks.get(name));
  if (!panic) return { blocked: `BLOCKED: libtest printed "test ${name} ... FAILED" with no message of its own in a stdout block, so why it failed can't be read (${shown})` };
  return { result: 'FAILED', failure: `${tidy(panic.message)}\n(libtest: test ${name} ... FAILED${panic.location ? `, panicked at ${tidy(panic.location)}` : ''}; ${shown})` };
}

const runs = new Map();
function run(target) {
  if (runs.has(target)) return runs.get(target);
  let laid;
  try {
    laid = laySuite();
  } catch (error) {
    laid = `BLOCKED: the suite could not be laid under ${COPY}: ${tidy(error.message)}`;
  }
  const env = { ...process.env, CARGO_TERM_COLOR: 'never', NO_COLOR: '1', RUST_BACKTRACE: '0' };
  // deadline: a cargo that hangs is stopped by spawnSync's own bound, which signals only this child; its tests read BLOCKED
  const ran = laid ? { laid } : spawnSync('cargo', cargoArgs(target), { cwd: CHANGE, env, encoding: 'utf8', timeout: CARGO_DEADLINE, maxBuffer: 1 << 26 });
  runs.set(target, ran);
  return ran;
}

export function rustTest(target, name) {
  if (!FILES.map(targetOf).includes(target)) throw new Error(`BLOCKED: ${target} is no target of suite/Cargo.toml`);
  const ran = run(target);
  const read = ran.laid ? { blocked: ran.laid } : outcome(ran, target, name);
  if (read.blocked) throw new Error(read.blocked);
  return read;
}

// #1426 AC2's judge: "Each row's test fails with that row's change reverted, for the sRGB layer tag, the exact
// gradient mode, the BGRA surface and the surface reports". It reads the carried-patch table, finds the row of each of
// the four behaviors, and runs that row's test on a private copy of the tree twice: as it stands, where it must pass,
// and with the behavior reverted in the files the row lists, where it must fail. Each revert is an edit of the
// carried code that keeps the tree building, so the test fails on the behavior, not on a build (README.md, How each
// criterion is read). Whatever can't run here reads INCONCLUSIVE, naming what's missing; nothing unrun passes.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { cargoResults, reportResults, reporting } from '../../../../scripts/lanes.mjs';
import { COLUMNS, README, TABLE_HEADING, carriedRows, remove, rowTest, tempRoot } from './common.mjs';

/** Where `(` or `{` at `open` closes, or -1. */
function closing(text, open) {
  const [left, right] = text[open] === '(' ? ['(', ')'] : ['{', '}'];
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === left) depth += 1;
    else if (text[index] === right && (depth -= 1) === 0) return index;
  }
  return -1;
}

/** The sRGB layer tag reverted: each `.setColorspace(…)` call given `None`, the untagged layer GPUI alone leaves. */
export function untag(text) {
  let out = '', at = 0, edits = 0;
  for (const match of text.matchAll(/\.setColorspace\s*\(/g)) {
    const open = match.index + match[0].length - 1, close = closing(text, open);
    if (match.index < at || close < 0 || text.slice(open + 1, close).trim() === 'None') continue;
    out += `${text.slice(at, open + 1)}None`;
    at = close;
    edits += 1;
  }
  return edits ? out + text.slice(at) : null;
}

/**
 * The exact gradient mode reverted: the shader's exact branches (color space 2) made unreachable, and 2 drawn by
 * Oklab's branches instead, as the release draws the nearest mode it has.
 */
export function foldExact(text) {
  let edits = 0;
  let out = text.replace(/\bcolor_space\s*==\s*2\b/g, () => { edits += 1; return 'color_space == 1002'; });
  out = out.replace(/((?:\b[A-Za-z_]\w*\s*(?:\.|->)\s*)*)\bcolor_space\s*==\s*1\b/g, (_, on) => `(${on}color_space == 1 || ${on}color_space == 2)`);
  let result = '', at = 0;
  for (const match of out.matchAll(/\bswitch\s*\([^)]*\bcolor_space\b[^)]*\)\s*\{/g)) {
    const open = match.index + match[0].length - 1, close = closing(out, open);
    if (match.index < at || close < 0) continue;
    const block = out.slice(open, close + 1)
      .replace(/\bcase\s+2\s*:/g, () => { edits += 1; return 'case 1002:'; })
      .replace(/\bcase\s+1\s*:/g, 'case 1: case 2:');
    result += out.slice(at, open) + block;
    at = close + 1;
  }
  return edits ? result + out.slice(at) : null;
}

/** The BGRA surface reverted: the kCVPixelFormatType_32BGRA branch turned off, so a BGRA surface takes the 4:2:0 path. */
export function offBgra(text) {
  let edits = 0;
  const out = text
    .replace(/\bif\s+(?!let\b|false && )([^{};]*?\bkCVPixelFormatType_32BGRA\b[^{};]*?)\s*\{/g, (_, condition) => { edits += 1; return `if false && (${condition.trim()}) {`; })
    .replace(/\bkCVPixelFormatType_32BGRA\s*=>/g, () => { edits += 1; return 'kCVPixelFormatType_32BGRA if false =>'; });
  return edits ? out : null;
}

/** The surface reports reverted: each `sampled_surfaces.push(…)` made `()`, so no frame has a surface to report. */
export function unreport(text) {
  let out = '', at = 0, edits = 0;
  for (const match of text.matchAll(/(?:\b[A-Za-z_]\w*\s*\.\s*)*\bsampled_surfaces\s*\.\s*push\s*\(/g)) {
    const open = match.index + match[0].length - 1, close = closing(text, open);
    if (match.index < at || close < 0) continue;
    out += `${text.slice(at, match.index)}()`;
    at = close + 1;
    edits += 1;
  }
  return edits ? out + text.slice(at) : null;
}

/** The four behaviors AC2 names: how a row's Behavior cell names each, and its revert, by the files it edits. */
export const BEHAVIORS = [
  { name: 'the sRGB layer tag', pattern: '/sRGB/ and /layer|tag/', row: (cell) => /sRGB/i.test(cell) && /layer|tag/i.test(cell), ext: '.rs', revert: untag, what: 'each `.setColorspace(…)` given `None`' },
  { name: 'the exact gradient mode', pattern: '/exact gradient|OklabExact/', row: (cell) => /exact gradient|OklabExact/i.test(cell), ext: '.metal', revert: foldExact, what: "the shader's color space 2 branches folded into Oklab's" },
  { name: 'the BGRA surface', pattern: '/BGRA/', row: (cell) => /BGRA/i.test(cell), ext: '.rs', revert: offBgra, what: 'the kCVPixelFormatType_32BGRA branch off' },
  { name: 'the surface reports', pattern: '/surface/ and /report/', row: (cell) => /surface/i.test(cell) && /report/i.test(cell), ext: '.rs', revert: unreport, what: 'each `sampled_surfaces.push(…)` dropped' },
];

// What a run's output says this machine lacks. A run that shows one of these is INCONCLUSIVE, never a verdict.
const MISSING = [
  [/unable to find utility "metal"|metal shader compilation failed|metallib compilation failed/, "no Metal shader compiler (`xcrun metal`, which full Xcode has): this build compiles gpui-pre-apple's shaders ahead of time"],
  [/Could not resolve host|failed to download|spurious network error|failed to fetch|failed to get `[^`]+` as a dependency/i, 'no network for cargo to fetch a crate the lockfile names'],
  [/spawn cargo ENOENT|cargo could not run|cargo: (?:command )?not found/, 'no cargo on PATH'],
  [/ERR_MODULE_NOT_FOUND|Cannot find (?:package|module) /, 'a node module or a built workspace package is missing: run npm ci and npm run build --workspaces'],
];
const missing = (output) => MISSING.find(([pattern]) => pattern.test(output))?.[1];
const BUILD = /error\[E\d{4}\]|could not compile|error: aborting due to/;
const CAP = 8 * 1024 * 1024;
const clip = (text) => (text.trim() ? text.trim().slice(-1500) : '(no output)');
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** This environment for a child run, less what a parent test runner or lane set. */
export function childEnv(extra = {}) {
  const env = { ...process.env };
  for (const name of ['NODE_TEST_CONTEXT', 'CARGO_TARGET_DIR', 'DEEP_PROOF_VITEST_REPORT', 'VITEST', 'VITEST_MODE', 'VITEST_POOL_ID', 'VITEST_WORKER_ID']) delete env[name];
  return { ...env, ...extra };
}

/** Runs a command in its own process group, so a timeout kills only what it started, by that group's PID. */
function runGroup([command, ...args], { cwd, env, timeout }) {
  return new Promise((resolve) => {
    let output = '', timedOut = false, done = false;
    const finish = (result) => { if (!done) { done = true; clearTimeout(timer); resolve({ ...result, output, timedOut }); } };
    const child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const keep = (chunk) => { output += chunk; if (output.length > CAP) output = output.slice(-CAP); };
    child.stdout.setEncoding('utf8').on('data', keep);
    child.stderr.setEncoding('utf8').on('data', keep);
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, timeout);
    child.on('error', (error) => finish({ error: error.message }));
    child.on('close', (status, signal) => finish({ status, signal }));
  });
}

/** The package whose test a Rust file holds: the nearest Cargo.toml above it with a [package] name. */
function crateOf(root, path) {
  for (let dir = dirname(join(root, path)); dir.startsWith(root); dir = dirname(dir)) {
    const manifest = join(dir, 'Cargo.toml');
    if (!existsSync(manifest)) continue;
    const name = /^\[package\][^[]*?^name\s*=\s*"([^"]+)"/ms.exec(readFileSync(manifest, 'utf8'))?.[1];
    if (name) return name;
    if (dir === root) break;
  }
  return null;
}

/** Whether a result's ID is the test a Test cell names: its full name, its last part, or a suite holding it. */
function isNamed(id, { path, name }) {
  if (id.startsWith('cargo ')) {
    const test = id.split(' › ').at(-1);
    return test === name || test.endsWith(`::${name}`);
  }
  if (!id.startsWith(`${path} › `)) return false;
  const full = id.slice(path.length + 3);
  return full === name || full.endsWith(` › ${name}`) || full.startsWith(`${name} › `);
}

/**
 * Runs the test a Test cell names in `root`, by its runner: `.test.mjs` under node --test, `.test.ts` under the tree's
 * vitest, `.rs` under `cargo test --locked -p <its crate>`, each reading results from the repo's own reporters
 * (scripts/lanes.mjs). Answers `{ state, why }`, state one of pass, fail, build (failed in a build), none (ran no test
 * by that name) and inconclusive (couldn't run here).
 */
export async function runTest(root, test, { timeout = 6 * 60 * 60 * 1000, env = {} } = {}) {
  const { path, name } = test;
  if (!existsSync(join(root, path))) return { state: 'none', why: `${path} isn't there` };
  const last = name.split(' › ').at(-1);
  const dir = tempRoot('report');
  const report = join(dir, 'report.jsonl');
  const readReport = () => (existsSync(report) ? readFileSync(report, 'utf8') : '');
  try {
    let command, extra = {}, read;
    if (/\.test\.[cm]?js$/.test(path)) {
      ({ command } = reporting([process.execPath, '--test', `--test-name-pattern=${escape(last)}`, path], report));
      read = () => reportResults(root, readReport());
    } else if (/\.test\.[cm]?ts$/.test(path)) {
      const vitest = join(root, 'node_modules', 'vitest', 'vitest.mjs');
      if (!existsSync(vitest)) return { state: 'inconclusive', why: 'no node_modules/vitest in the tree: run npm ci and npm run build --workspaces' };
      ({ command, env: extra } = reporting([process.execPath, vitest, 'run', path, '-t', escape(last)], report));
      read = () => reportResults(root, readReport(), 'vitest');
    } else if (path.endsWith('.rs')) {
      const crate = crateOf(root, path);
      if (!crate) return { state: 'none', why: `no Cargo.toml with a [package] name holds ${path}` };
      command = ['cargo', 'test', '--locked', '-p', crate, '--', name];
      read = (output, status) => cargoResults(output, status, []);
    } else return { state: 'none', why: `${path} is no test this judge runs (.test.mjs, .test.ts or .rs)` };
    const run = await runGroup(command, { cwd: root, env: childEnv({ ...extra, ...env }), timeout });
    const shown = `${command.join(' ')}`;
    if (run.error) return { state: 'inconclusive', why: `${shown} couldn't start: ${run.error}${missing(run.error) ? ` (${missing(run.error)})` : ''}` };
    if (run.timedOut) return { state: 'inconclusive', why: `${shown} ran past ${Math.round(timeout / 60000)} minutes and was stopped: ${clip(run.output)}` };
    const results = read(run.output, run.status) ?? { failures: [], passed: [] };
    const failures = results.failures.filter((failure) => isNamed(failure.id, test));
    const skips = (results.skips ?? []).filter((skip) => isNamed(skip.id, test));
    const passed = results.passed.filter((id) => isNamed(id, test));
    const lacking = missing(run.output);
    const said = failures.map((failure) => `${failure.id}: ${failure.message}`).join('; ');
    if (failures.some((failure) => failure.state !== 'FAIL')) return { state: 'inconclusive', why: said };
    if (failures.length) {
      if (lacking) return { state: 'inconclusive', why: `${lacking}: ${said}` };
      return { state: BUILD.test(`${run.output}\n${said}`) ? 'build' : 'fail', why: `${said} ${clip(run.output)}` };
    }
    if (skips.length) return { state: 'inconclusive', why: `skipped: ${skips.map((skip) => `${skip.id} (${skip.note || 'no note'})`).join('; ')}` };
    if (passed.length) return { state: 'pass', why: passed.join('; ') };
    if (lacking) return { state: 'inconclusive', why: `${lacking}: ${clip(run.output)}` };
    if (BUILD.test(run.output)) return { state: 'build', why: clip(run.output) };
    const other = results.failures.map((failure) => `${failure.id}: ${failure.message}`).join('; ');
    return { state: 'none', why: `${shown} ran no test named "${name}" (exit ${run.status})${other ? `; ${other}` : ''}: ${clip(run.output)}` };
  } finally {
    remove(dir);
  }
}

/**
 * A private copy of `source`'s working tree, with its own git repository and no build folder: what a test builds
 * there lands in the copy's own target/. Each node_modules is linked, not copied; nothing of `source` is written.
 */
export function privateCopy(source) {
  const dir = tempRoot('copy');
  const root = join(dir, 'tree');
  const links = [];
  cpSync(source, root, {
    recursive: true, verbatimSymlinks: true,
    filter: (from) => {
      const path = relative(source, from);
      if (path === '.git' || path === 'target') return false;
      if (path.split(sep).at(-1) === 'node_modules') { links.push(path); return false; }
      return true;
    },
  });
  for (const path of links) symlinkSync(realpathSync(join(source, path)), join(root, path));
  const git = (...args) => spawnSync('git', ['-c', 'user.name=Copy', '-c', 'user.email=copy@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'A private copy of the tree for #1426 AC2');
  return { root, remove: () => remove(dir) };
}

const isFile = (path) => existsSync(path) && statSync(path).isFile();

/** Which rows stand for `behavior`: those naming it, less any naming another behavior too when one names it alone. */
function rowsFor(behavior, rows) {
  const named = rows.filter((row) => behavior.row(row.behavior));
  const alone = named.filter((row) => BEHAVIORS.filter((other) => other.row(row.behavior)).length === 1);
  return alone.length ? alone : named;
}

/** What this machine lacks for the runs: the four behaviors are gpui-pre-apple's Metal renderer, on macOS alone. */
export const macOnly = () => (process.platform === 'darwin' ? null : `the four behaviors are gpui-pre-apple's Metal renderer, which runs on macOS only; this is ${process.platform}`);

/**
 * AC2 on the tree at `source`: answers its failure lines, INCONCLUSIVE ones starting so; none is a pass. The table is
 * read on any machine; the runs need what `machine` doesn't name as missing. `log` gets a line for each run.
 */
export async function judgeReverts(source, { timeout, env, machine = macOnly, log = () => {} } = {}) {
  const readme = join(source, README);
  const rows = isFile(readme) ? carriedRows(readFileSync(readme, 'utf8')) : null;
  if (!rows) return [`${README} has no carried-patch table under "${TABLE_HEADING}" with the columns ${COLUMNS.join(' | ')}`];
  const lines = [], plans = [];
  for (const behavior of BEHAVIORS) {
    const matching = rowsFor(behavior, rows);
    if (!matching.length) lines.push(`no row of the carried-patch table is ${behavior.name}: no Behavior cell matches ${behavior.pattern}`);
    for (const row of matching) {
      const label = `the row "${row.behavior}" (${behavior.name})`;
      const test = rowTest(row.test);
      if (!test) { lines.push(`${label} names no test: "${row.test}"`); continue; }
      if (!isFile(join(source, test.path))) { lines.push(`${label} names a test file that isn't there: ${test.path}`); continue; }
      const edits = new Map();
      for (const file of row.files.filter((path) => path.endsWith(behavior.ext) && isFile(join(source, path)))) {
        const reverted = behavior.revert(readFileSync(join(source, file), 'utf8'));
        if (reverted !== null) edits.set(file, reverted);
      }
      if (!edits.size) { lines.push(`INCONCLUSIVE: the revert of ${behavior.name} (${behavior.what}) matches nothing in the ${behavior.ext} files ${label} lists: ${row.files.join(', ') || '(none)'}`); continue; }
      plans.push({ behavior, label, test, edits });
    }
  }
  if (!plans.length) return lines;
  const lacking = machine();
  if (lacking) return [...lines, `INCONCLUSIVE: ${lacking}`];
  const copy = privateCopy(source);
  try {
    const asIs = new Map();
    for (const { behavior, label, test, edits } of plans) {
      const key = `${test.path} › ${test.name}`;
      if (!asIs.has(key)) {
        asIs.set(key, await runTest(copy.root, test, { timeout, env }));
        log(`as it stands: ${key}: ${asIs.get(key).state}`);
      }
      const before = asIs.get(key);
      if (before.state === 'inconclusive') { lines.push(`INCONCLUSIVE: ${label}: its test ${key} can't run here as the tree stands: ${before.why}`); continue; }
      if (before.state !== 'pass') { lines.push(`${label}: its test ${key} doesn't pass as the tree stands (${before.state}), before any revert: ${before.why}`); continue; }
      const originals = [...edits.keys()].map((file) => [file, readFileSync(join(copy.root, file), 'utf8')]);
      let after;
      try {
        for (const [file, text] of edits) writeFileSync(join(copy.root, file), text);
        after = await runTest(copy.root, test, { timeout, env });
      } finally {
        for (const [file, text] of originals) writeFileSync(join(copy.root, file), text);
      }
      const where = `${behavior.what}, in ${[...edits.keys()].join(', ')}`;
      log(`with ${behavior.name} reverted (${where}): ${key}: ${after.state}`);
      if (after.state === 'pass') lines.push(`${label}: its test ${key} still passes with ${behavior.name} reverted (${where})`);
      else if (after.state === 'build') lines.push(`INCONCLUSIVE: ${label}: the revert of ${behavior.name} (${where}) doesn't build, so its test's failure proves nothing: ${after.why}`);
      else if (after.state === 'none') lines.push(`INCONCLUSIVE: ${label}: with ${behavior.name} reverted (${where}), ${after.why}`);
      else if (after.state === 'inconclusive') lines.push(`INCONCLUSIVE: ${label}: its test ${key} can't run here with ${behavior.name} reverted: ${after.why}`);
    }
  } finally {
    copy.remove();
  }
  return lines;
}

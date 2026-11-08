// #1426 a17e5e56, the real-tree half: the carried-patch table in vendor/gpui-pre-apple/upstream/README.md, read on a
// tree (the checkout, or a plant). Each row must give a removal condition and name its test by a full repo path to a
// file that exists, and that test must be in its suite's own list as the suite's runner gives it: node --test's report
// of the file, `vitest list`, or `cargo test -- --list`. Text in the file proves nothing; it can only disprove.
// Nothing here builds gpui: a Rust suite that needs gpui reads INCONCLUSIVE, and every run gets a PATH whose cargo,
// rustc, xcrun and swift refuse. A run that can't list a suite reads INCONCLUSIVE, naming what it lacks; never PASS.
// The surface is the earlier drafts' (README.md here): six columns, the Test cell `<path> › <name>`, Removal's rules.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, normalize, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
/** `#1426.` and the first 8 hex of SHA-256 of the criterion's text (scripts/proof-change.mjs, criterionId). */
export const ID = '#1426.a17e5e56';
export const README = 'vendor/gpui-pre-apple/upstream/README.md';
export const TABLE_HEADING = '## Carried patches';
export const COLUMNS = ['Behavior', 'Issue', 'Files', 'Test', 'Budget', 'Removal'];
/** Tools a run here may not use: each is a build of Rust or Metal. */
const REFUSED = ['cargo', 'rustc', 'rustup', 'xcrun', 'xcodebuild', 'swift', 'swiftc'];

export const tempRoot = (what) => mkdtempSync(join(existsSync('/tmp') ? '/tmp' : tmpdir(), `da1426-real-${what}-`));
export const remove = (dir) => rmSync(dir, { recursive: true, force: true });
const firstLine = (text) => (text ?? '').split('\n').map((line) => line.trim()).find((line) => line && !/^[⎯-]+$/.test(line)) ?? '(no output)';
const errorLine = (text) => (text ?? '').split('\n').map((line) => line.trim()).find((line) => /^(error|Error)\b|failed/i.test(line)) ?? firstLine(text);
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------------------------------------------------------------------------------------------------------
// The table.

/** The table's rows as objects keyed by COLUMNS, `[]` for a header with no rows, or null when there's no table in the shape. */
export function readTable(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.trim() === TABLE_HEADING);
  if (start < 0) return null;
  const block = [];
  for (let at = start + 1; at < lines.length && !/^#{1,6} /.test(lines[at]); at += 1) {
    if (lines[at].trim().startsWith('|')) block.push(lines[at].trim());
    else if (block.length) break;
  }
  const cells = (line) => line.replace(/\\\|/g, '\u0000').replace(/^\||\|$/g, '').split('|').map((cell) => cell.replace(/\u0000/g, '|').trim());
  if (block.length < 2 || cells(block[0]).join('|') !== COLUMNS.join('|')) return null;
  return block.slice(2).map(cells).map((row) => Object.fromEntries(COLUMNS.map((column, index) => [column, row[index] ?? ''])));
}

/** Why a Removal cell gives no removal condition, or null when it gives one. */
export function removalProblem(cell) {
  const text = (cell ?? '').trim();
  if (!text || /^[—–-]+$/.test(text)) return 'gives no removal condition';
  if (/^none\W*$/i.test(text)) return `says "${text}" with no reason`;
  return null;
}

/** A Test cell as `{ path, name }`, or null when it isn't `` `<path> › <name>` ``. */
export function testCell(cell) {
  const [, path, name] = /^`([^`]+?) › ([^`]+)`$/.exec((cell ?? '').trim()) ?? [];
  return path && name.trim() ? { path: path.trim(), name: name.trim() } : null;
}

/** Why `path` isn't a full repo path to a file in `root`, or null. */
export function pathProblem(root, path) {
  if (isAbsolute(path) || path.startsWith('./') || normalize(path) !== path || path.split('/').includes('..')) return `${path} isn't a full path from the repo root`;
  const file = join(root, path);
  if (!existsSync(file) || !statSync(file).isFile()) return `${path} doesn't exist`;
  return null;
}

/** The runner that lists a test file's tests, by its name (the first draft's surface, widened as the added draft has it). */
export function runnerOf(path) {
  if (/\.test\.(?:mjs|cjs|js)$/.test(path)) return 'node';
  if (/\.(?:test|spec)\.(?:ts|tsx|mts|cts)$/.test(path)) return 'vitest';
  if (path.endsWith('.rs')) return 'cargo';
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// The runners' lists. Each answers { listed: true } | { listed: false, why } | { inconclusive }.

/** A folder of refusing tools, put first on every run's PATH, and a scratch folder. */
function workspace(env) {
  const dir = tempRoot('run');
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  for (const tool of REFUSED) {
    writeFileSync(join(bin, tool), `#!/bin/sh\necho "da1426: ${tool} refused; #1426's real-tree test builds nothing" >&2\nexit 97\n`);
    chmodSync(join(bin, tool), 0o755);
  }
  const base = { ...process.env, ...env };
  for (const name of ['NODE_TEST_CONTEXT', 'NODE_OPTIONS', 'CARGO', 'RUSTC', 'RUSTC_WRAPPER', 'CARGO_TARGET_DIR', 'DEEP_PREFLIGHT']) delete base[name];
  return { dir, base, sealed: { ...base, PATH: `${bin}:${base.PATH ?? ''}`, HOME: dir }, cache: new Map(), runs: 0 };
}

const NODE_REPORTER = `export default async function* (source) {
  for await (const event of source) {
    if (!['test:start', 'test:pass', 'test:fail'].includes(event.type)) continue;
    const { name, nesting, details } = event.data;
    const error = details?.error?.cause?.message ?? details?.error?.message;
    yield JSON.stringify({ type: event.type.slice(5), name, nesting, suite: details?.type === 'suite', error }) + '\\n';
  }
}
`;

/** node --test's own report of `path`, run for the named test's segments only, with no build tool. */
function nodeList(root, path, name, run) {
  const reporter = join(run.dir, 'reporter.mjs');
  if (!existsSync(reporter)) writeFileSync(reporter, NODE_REPORTER);
  run.runs += 1;
  const out = join(run.dir, `node-${run.runs}.jsonl`);
  const pattern = `^(?:${name.split(' › ').map(escape).join('|')})$`;
  const result = spawnSync(process.execPath, ['--test', '--test-isolation=none', `--test-reporter=${pathToFileURL(reporter).href}`, `--test-reporter-destination=${out}`, `--test-name-pattern=${pattern}`, path], {
    cwd: root, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024, env: run.sealed,
  });
  const rows = existsSync(out) ? readFileSync(out, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
  const stack = [];
  const names = new Set();
  let fileError = null;
  for (const row of rows) {
    if (row.nesting === 0 && row.name === path) { if (row.type === 'fail') fileError = firstLine(row.error); continue; }
    if (row.type === 'start') { stack[row.nesting] = row.name; stack.length = row.nesting + 1; continue; }
    if (!row.suite) names.add([...stack.slice(0, row.nesting), row.name].join(' › '));
  }
  if (names.has(name)) return { listed: true };
  if (result.error || result.signal) return { inconclusive: `node --test couldn't finish listing ${path} (${result.error?.code ?? result.signal})` };
  if (fileError && !names.size) return { inconclusive: `node --test couldn't load ${path}, so its list is unread: ${fileError}` };
  return { listed: false, why: `node --test registers no test named "${name}" in ${path}` };
}

/** `vitest list` of `path`, from the tree's root with its own config and node_modules. */
function vitestList(root, path, name, run) {
  const vitest = join(root, 'node_modules/vitest/vitest.mjs');
  if (!existsSync(vitest)) return { inconclusive: `vitest isn't installed in the tree's node_modules (run npm ci), so ${path}'s list is unread` };
  const key = `vitest ${path}`;
  if (!run.cache.has(key)) {
    const result = spawnSync(process.execPath, [vitest, 'list', path, '--json'], { cwd: root, encoding: 'utf8', timeout: 300_000, maxBuffer: 64 * 1024 * 1024, env: run.sealed });
    let listed = null;
    try { listed = JSON.parse(result.stdout); } catch {}
    if (result.status !== 0 || !Array.isArray(listed)) {
      run.cache.set(key, { inconclusive: `vitest couldn't list ${path}: ${errorLine(`${result.stdout}${result.stderr}`)}` });
    } else {
      const file = realpathSync(join(root, path));
      run.cache.set(key, { names: new Set(listed.filter((test) => existsSync(test.file) && realpathSync(test.file) === file).map((test) => test.name.split(' > ').join(' › '))) });
    }
  }
  const answer = run.cache.get(key);
  if (answer.inconclusive) return answer;
  return answer.names.has(name) ? { listed: true } : { listed: false, why: `vitest list has no test named "${name}" in ${path}` };
}

const packageName = (manifest) => /^\[package\][^[]*?^name\s*=\s*"([^"]+)"/m.exec(manifest)?.[1];
const needsGpui = (name) => /^gpui/.test(name ?? '');

/** `cargo test -- --list` of the target `path` belongs to, in the crate holding it, unless that crate needs gpui. */
function cargoList(root, path, name, run) {
  let crate = dirname(join(root, path));
  while (!existsSync(join(crate, 'Cargo.toml')) && relative(root, crate) && !relative(root, crate).startsWith('..')) crate = dirname(crate);
  if (!existsSync(join(crate, 'Cargo.toml'))) return { listed: false, why: `no crate holds ${path}, so no cargo suite lists it` };
  const leaf = name.split('::').at(-1);
  if (!new RegExp(`\\bfn\\s+${escape(leaf)}\\b`).test(readFileSync(join(root, path), 'utf8'))) return { listed: false, why: `${path} defines no fn ${leaf}, so "${name}" isn't one of its tests` };
  const own = packageName(readFileSync(join(crate, 'Cargo.toml'), 'utf8'));
  const crateRel = relative(root, crate) || '.';
  if (needsGpui(own)) return { inconclusive: `listing ${crateRel}'s tests (${own}) needs a gpui build, which this test doesn't run, so "${name}" is unconfirmed` };
  const cargo = spawnSync('cargo', ['--version'], { encoding: 'utf8', env: run.base });
  if (cargo.error || cargo.status !== 0) return { inconclusive: `cargo isn't on PATH, so ${crateRel}'s test list is unread` };
  let lockDir = crate;
  while (!existsSync(join(lockDir, 'Cargo.lock')) && relative(root, lockDir)) lockDir = dirname(lockDir);
  if (!existsSync(join(lockDir, 'Cargo.lock'))) return { inconclusive: `no Cargo.lock holds ${crateRel}, so cargo can't list it --locked` };
  const manifest = join(crate, 'Cargo.toml');
  const metadataKey = `metadata ${manifest}`;
  if (!run.cache.has(metadataKey)) {
    const result = spawnSync('cargo', ['metadata', '--format-version', '1', '--locked', '--offline', '--manifest-path', manifest], { cwd: crate, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 300_000, env: run.base });
    let answer;
    try {
      const metadata = JSON.parse(result.stdout);
      const real = realpathSync(manifest);
      const top = metadata.packages.find((pkg) => existsSync(pkg.manifest_path) && realpathSync(pkg.manifest_path) === real);
      const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
      const names = new Map(metadata.packages.map((pkg) => [pkg.id, pkg.name]));
      const seen = new Set();
      const queue = [top.id];
      let gpui = null;
      while (queue.length && !gpui) {
        const id = queue.shift();
        if (seen.has(id)) continue;
        seen.add(id);
        if (id !== top.id && needsGpui(names.get(id))) gpui = names.get(id);
        for (const dep of nodes.get(id)?.deps ?? []) queue.push(dep.pkg);
      }
      answer = { gpui };
    } catch {
      answer = { inconclusive: `cargo metadata couldn't read ${crateRel} offline: ${errorLine(result.stderr)}` };
    }
    run.cache.set(metadataKey, answer);
  }
  const metadata = run.cache.get(metadataKey);
  if (metadata.inconclusive) return metadata;
  if (metadata.gpui) return { inconclusive: `listing ${crateRel}'s tests needs a gpui build (through ${metadata.gpui}), which this test doesn't run, so "${name}" is unconfirmed` };
  const inner = relative(crate, join(root, path)).split(sep).join('/');
  const target = /^tests\/[^/]+\.rs$/.test(inner) ? ['--test', inner.slice(6, -3)]
    : /^tests\/([^/]+)\/main\.rs$/.test(inner) ? ['--test', inner.split('/')[1]]
      : inner === 'src/main.rs' || inner.startsWith('src/bin/') ? ['--bins']
        : inner.startsWith('src/') ? ['--lib'] : [];
  const listKey = `list ${manifest} ${target.join(' ')}`;
  if (!run.cache.has(listKey)) {
    const result = spawnSync('cargo', ['test', '--locked', '--offline', '--manifest-path', manifest, ...target, '--', '--list'], {
      cwd: crate, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 1_800_000, env: { ...run.base, CARGO_TARGET_DIR: join(run.dir, 'target') },
    });
    run.cache.set(listKey, result.status === 0
      ? { names: new Set(result.stdout.split('\n').filter((line) => line.endsWith(': test')).map((line) => line.slice(0, -': test'.length))) }
      : { inconclusive: `cargo couldn't list ${crateRel}'s tests${result.error ? ` (${result.error.code})` : ''}: ${errorLine(result.stderr)}` });
  }
  const list = run.cache.get(listKey);
  if (list.inconclusive) return list;
  return list.names.has(name) ? { listed: true } : { listed: false, why: `cargo test -- --list in ${crateRel} has no test named "${name}"` };
}

const LISTS = { node: nodeList, vitest: vitestList, cargo: cargoList };

// ---------------------------------------------------------------------------------------------------------
// The judge.

/**
 * Judges the table in `root`. Answers `{ state, lines }`: state is PASS, FAIL or INCONCLUSIVE (FAIL stands over
 * INCONCLUSIVE), and lines start with that word, then `row <Behavior>:` or `table:`. `env` overrides the environment
 * the runners get, as a test of the tests withholds cargo.
 */
export function judgeTable(root, { env = {} } = {}) {
  const lines = [];
  const file = join(root, README);
  const rows = existsSync(file) ? readTable(readFileSync(file, 'utf8')) : null;
  if (!rows) lines.push(`FAIL table: ${README} has no "${TABLE_HEADING}" table with the columns ${COLUMNS.join(' | ')}`);
  else if (!rows.length) lines.push(`FAIL table: the "${TABLE_HEADING}" table in ${README} has no rows`);
  const run = rows?.length ? workspace(env) : null;
  try {
    for (const row of rows ?? []) {
      const label = `row ${row.Behavior || '(no behavior)'}`;
      const removal = removalProblem(row.Removal);
      if (removal) lines.push(`FAIL ${label}: Removal ${removal}`);
      const test = testCell(row.Test);
      if (!test) { lines.push(`FAIL ${label}: Test "${row.Test}" doesn't name a test as \`<path> › <name>\``); continue; }
      const where = pathProblem(root, test.path);
      if (where) { lines.push(`FAIL ${label}: Test ${test.path} › ${test.name}: ${where}`); continue; }
      const runner = runnerOf(test.path);
      if (!runner) { lines.push(`FAIL ${label}: Test ${test.path} › ${test.name}: no runner here lists ${test.path} (node --test, vitest or cargo test)`); continue; }
      const answer = LISTS[runner](root, test.path, test.name, run);
      if (answer.inconclusive) lines.push(`INCONCLUSIVE ${label}: Test ${test.path} › ${test.name}: ${answer.inconclusive}`);
      else if (!answer.listed) lines.push(`FAIL ${label}: Test ${test.path} › ${test.name} isn't in its suite's list: ${answer.why}`);
      else if (!removal) lines.push(`PASS ${label}: ${test.path} › ${test.name} is in ${runner}'s list; removal: ${row.Removal}`);
    }
  } finally {
    if (run) remove(run.dir);
  }
  const state = lines.some((line) => line.startsWith('FAIL')) ? 'FAIL' : lines.some((line) => line.startsWith('INCONCLUSIVE')) ? 'INCONCLUSIVE' : 'PASS';
  return { state, lines };
}

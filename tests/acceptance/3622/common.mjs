// #3622's acceptance suite: what every judge shares (README.md, The surface). The pristine releases are fetched from
// static.crates.io into the test's own temporary folder, once a process. A planted copy holds scripts/, the three
// vendored gpui-fast trees, the carried-patch table and the tests its rows name, in a scratch git repository of its
// own. Nothing here writes to the repo's files.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
/** The base commit this folder was written against. */
export const BASE = '4471593f';
/** `#3622.` and the first 8 hex of SHA-256 of each criterion's text (scripts/proof-change.mjs, criterionId). */
export const AC = { 1: '#3622.fb741481', 2: '#3622.f8db2d26', 3: '#3622.f04efb4a', 4: '#3622.0face0d7' };
export const VERSION = '0.1.19';
export const CRATES = ['gpui-fast', 'gpui-fast-apple', 'gpui-fast-macos'];
export const README = 'vendor/gpui-pre-apple/upstream/README.md';
export const SCRIPT = 'scripts/vendor-rebase.mjs';
const MARK = /DeepBuild patch \(windoliver\/deepbuild#(\d+)\)/;
export const markLine = (issue) => `// DeepBuild patch (windoliver/deepbuild#${issue})`;
/** The issues of the base table's rows that list a file of vendor/gpui-pre, gpui-pre-apple or gpui-pre-macos. */
export const BASE_GPUI_ISSUES = ['#140', '#391', '#390', '#1480', '#1546', '#1482', '#124', '#1427', '#1550', '#377', '#1434', '#2471', '#177', '#1551', '#3232', '#1843', '#542', '#1431', '#1489', '#499'];
const isFast = (path) => /^vendor\/gpui-fast(?:-apple|-macos)?\//.test(path);

const made = [];
process.on('exit', () => { for (const dir of made) rmSync(dir, { recursive: true, force: true }); });
export function scratch(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}
/** The environment with git's own variables gone, so no scratch git reaches a worktree's repository. */
export const cleanEnv = (extra = {}) => ({ ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), ...extra });
const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8', env: cleanEnv({ GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CEILING_DIRECTORIES: dirname(cwd), GIT_AUTHOR_NAME: 'plant', GIT_AUTHOR_EMAIL: 'plant@example.invalid', GIT_COMMITTER_NAME: 'plant', GIT_COMMITTER_EMAIL: 'plant@example.invalid' }) });
export const read = (root, path) => readFileSync(join(root, path), 'utf8');
export const redact = (text) => text.split(realpathSync(tmpdir())).join('<tmp>').split(tmpdir()).join('<tmp>');

let fetched = null;
/** A folder of `<crate>-0.1.19/`, each an unpacked .crate from static.crates.io. */
export async function releases() {
  if (fetched) return fetched;
  const dir = scratch('da3622-releases-');
  for (const crate of CRATES) {
    const url = `https://static.crates.io/crates/${crate}/${crate}-${VERSION}.crate`;
    const response = await fetch(url).catch((error) => ({ ok: false, status: error.message }));
    if (!response.ok) throw Error(`INCONCLUSIVE: can't fetch the pristine release ${url}: ${response.status}`);
    const file = join(dir, `${crate}.crate`), out = join(dir, `${crate}-${VERSION}`);
    writeFileSync(file, Buffer.from(await response.arrayBuffer()));
    mkdirSync(out);
    if (spawnSync('tar', ['xzf', file, '--strip-components=1', '-C', out]).status !== 0) throw Error(`INCONCLUSIVE: can't unpack ${url}`);
    rmSync(file);
  }
  return (fetched = dir);
}

/** Every file under `dir`, posix and relative, without a crate's `target/` and `upstream/` or any `.git`. */
export function walk(dir, at = '') {
  return readdirSync(join(dir, at), { withFileTypes: true }).flatMap((entry) => {
    const inner = at ? `${at}/${entry.name}` : entry.name;
    if (inner === 'target' || inner === 'upstream' || entry.name === '.git') return [];
    return entry.isDirectory() ? walk(dir, inner) : entry.isFile() ? [inner] : [];
  });
}

/** Each file of `vendor/<crate>`: whether its release holds it and whether it differs. A vendored LICENSE isn't a change. */
export function filesOf(root, rel, crate) {
  const dir = join(root, 'vendor', crate), release = join(rel, `${crate}-${VERSION}`);
  if (!existsSync(dir)) return [];
  return walk(dir).flatMap((inner) => {
    const path = `vendor/${crate}/${inner}`, from = join(release, inner), inRelease = existsSync(from);
    if (!inRelease && /^LICENSE/.test(inner)) return [];
    const changed = !inRelease || !readFileSync(from).equals(readFileSync(join(dir, inner)));
    return [{ crate, inner, path, from, inRelease, changed }];
  });
}

/** `git diff -U0`'s hunks of `to` against `from`, as new-file line ranges. */
export function hunks(from, to) {
  const out = spawnSync('git', ['diff', '--no-index', '--no-color', '-U0', from, to], { encoding: 'utf8', maxBuffer: 1 << 28, env: cleanEnv() }).stdout;
  return [...out.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)].map(([, at, count = '1']) => ({ at: Number(at), count: Number(count) }));
}

const cellsOf = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
const separator = (line) => /^\|[\s|:-]+\|?\s*$/.test(line ?? '') && line.includes('-');
/** The README's rows retired for 0.1.19: the body rows of the table under a heading naming "retired" and 0.1.19. */
export function retiredRows(text) {
  const lines = text.split('\n'), found = [];
  let inside = false;
  lines.forEach((line, index) => {
    if (/^#{1,6}\s/.test(line)) inside = /\bretired\b/i.test(line) && /0\.1\.19/.test(line);
    else if (inside && line.startsWith('|') && !separator(line) && !separator(lines[index + 1])) found.push({ line: index + 1, raw: line });
  });
  return found;
}
/** Every body row of every Markdown table, outside the retired section, by its header's cell names. */
export function tableRows(text) {
  const lines = text.split('\n'), retired = new Set(retiredRows(text).map(({ line }) => line)), rows = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].startsWith('|') || !separator(lines[i + 1])) continue;
    const head = cellsOf(lines[i]);
    let j = i + 2;
    for (; j < lines.length && lines[j].startsWith('|'); j += 1) {
      if (retired.has(j + 1)) continue;
      const cell = Object.fromEntries(cellsOf(lines[j]).map((value, k) => [head[k], value]));
      rows.push({ line: j + 1, raw: lines[j], cell, issue: cell.Issue ?? '', files: [...(cell.Files ?? '').matchAll(/`([^`]+)`/g)].map(([, file]) => file) });
    }
    i = j - 1;
  }
  return rows;
}

/** A copy of what `check` reads, a git repository with it committed. */
export function plantedCopy(root) {
  const dir = scratch('da3622-copy-');
  cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true });
  for (const crate of CRATES) {
    const from = join(root, 'vendor', crate);
    if (existsSync(from)) cpSync(from, join(dir, 'vendor', crate), { recursive: true, filter: (path) => !/^(?:target|\.git)(?:\/|$)/.test(relative(from, path)) });
  }
  mkdirSync(join(dir, dirname(README)), { recursive: true });
  cpSync(join(root, README), join(dir, README));
  if (existsSync(join(root, 'package.json'))) cpSync(join(root, 'package.json'), join(dir, 'package.json'));
  for (const row of tableRows(read(root, README))) {
    const [, test] = /`([^`]+?) › /.exec(row.cell.Test ?? '') ?? [];
    if (test && !isAbsolute(test) && existsSync(join(root, test)) && !existsSync(join(dir, test))) {
      mkdirSync(dirname(join(dir, test)), { recursive: true });
      cpSync(join(root, test), join(dir, test));
    }
  }
  for (const args of [['init', '-q'], ['add', '-A'], ['commit', '-q', '--no-verify', '-m', 'base']]) {
    const run = git(dir, args);
    if (run.status !== 0) throw Error(`scratch git ${args[0]} failed: ${run.stderr}`);
  }
  return dir;
}

/** `node scripts/vendor-rebase.mjs check` in `cwd`, with the stub releases when given. */
export function runCheck(cwd, rel) {
  const run = spawnSync(process.execPath, [join(cwd, SCRIPT), 'check'], { cwd, encoding: 'utf8', maxBuffer: 1 << 28, timeout: 30 * 60_000, env: cleanEnv(rel ? { DEEP_VENDOR_RELEASES: rel } : {}) });
  return { status: run.status, out: `${run.stdout ?? ''}${run.stderr ?? ''}${run.error ? `\n${run.error.message}` : ''}` };
}
const fails = (out) => out.split('\n').filter((line) => /^FAIL\b/.test(line));
/** A FAIL line naming `path` and `line`: `<path>:<line>` or the path and `line <line>`. */
export function failsAt(out, path, line) {
  return fails(out).some((each) => new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:${line}(?!\\d)`).test(each) || (each.includes(path) && new RegExp(`\\bline ${line}(?!\\d)`).test(each)));
}
const tail = (out) => redact(out.split('\n').filter((line) => !/^ROW\b/.test(line)).slice(-12).join('\n'));

/** The first line L, at least 6 in, whose three neighbours each way hold no change of ours and no mark. */
function isolated(file) {
  const lines = readFileSync(file.at, 'utf8').split('\n');
  const touched = new Set();
  if (file.changed) for (const { at, count } of hunks(file.from, file.at)) for (let k = at - 1; k <= at + Math.max(count, 1); k += 1) touched.add(k);
  for (let line = 6; line < lines.length - 6; line += 1) {
    let clear = true;
    for (let k = line - 3; k <= line + 3 && clear; k += 1) clear = !touched.has(k) && !MARK.test(lines[k - 1]);
    if (clear) return line;
  }
  return null;
}
const byCrate = (order, files) => order.flatMap((crate) => files.filter((file) => file.crate === crate));

/**
 * AC2's three plants in copies of `root`, each run against the stub releases `rel`. Each must exit non-zero with a
 * FAIL line naming the planted file and line, which the unplanted copy's run doesn't print. Returns what failed.
 */
export function judgePlants(root, rel) {
  const missing = CRATES.filter((crate) => !existsSync(join(root, 'vendor', crate, 'Cargo.toml')));
  if (missing.length) return [`no vendored tree at ${missing.map((crate) => `vendor/${crate}`).join(', ')}`];
  const rows = tableRows(read(root, README));
  const listed = (path) => rows.filter(({ files }) => files.includes(path));
  const raised = (row) => /^\d+\s*over\b/.test(row.cell.Budget ?? '');
  const files = CRATES.flatMap((crate) => filesOf(root, rel, crate)).filter(({ inner }) => inner.endsWith('.rs')).map((file) => ({ ...file, at: join(root, file.path) }));
  const budgeted = (file) => listed(file.path).find((row) => /^#\d+$/.test(row.issue) && listed(file.path).filter(({ issue }) => issue === row.issue).every((each) => !raised(each)));
  const plants = [
    { name: 'an unmarked hunk in a vendored gpui-fast file with a row', files: files.filter((file) => file.crate === 'gpui-fast' && file.changed && file.inRelease && listed(file.path).length), lines: () => ['// a planted line with no mark (#3622 AC2)'] },
    { name: 'a changed file with no row', files: byCrate(['gpui-fast-macos', 'gpui-fast-apple', 'gpui-fast'], files.filter((file) => !file.changed && !listed(file.path).length)), lines: () => [markLine(3622)] },
    { name: 'a marked 9-line hunk over budget', files: byCrate(['gpui-fast-apple', 'gpui-fast', 'gpui-fast-macos'], files.filter((file) => file.changed && file.inRelease && budgeted(file))), lines: (file) => [markLine(budgeted(file).issue.slice(1)), ...Array.from({ length: 8 }, (_, k) => `// planted line ${k + 2} of 9 (#3622 AC2)`)] },
  ];
  const control = runCheck(plantedCopy(root), rel);
  const problems = [];
  for (const plant of plants) {
    const file = plant.files.find((each) => isolated(each));
    if (!file) {
      problems.push(`${plant.name}: no vendored file to plant it in (${plant.files.length} candidates)`);
      continue;
    }
    const line = isolated(file), copy = plantedCopy(root), target = join(copy, file.path);
    const text = readFileSync(target, 'utf8').split('\n');
    text.splice(line - 1, 0, ...plant.lines(file));
    writeFileSync(target, text.join('\n'));
    const run = runCheck(copy, rel);
    console.log(`# plant: ${plant.name} at ${file.path}:${line}; check exit ${run.status}`);
    if (failsAt(control.out, file.path, line)) problems.push(`${plant.name}: the unplanted copy already fails naming ${file.path}:${line}`);
    else if (run.status === 0 || !failsAt(run.out, file.path, line)) problems.push(`${plant.name} at ${file.path}:${line}: check exit ${run.status}, no FAIL line naming ${file.path}:${line}\n${tail(run.out)}`);
  }
  return problems;
}

/**
 * AC4's plant: a row carried onto a vendored gpui-fast tree, the only row of its issue listing one of its files, which
 * holds that issue's mark, taken out of the table. Check must then exit non-zero with a FAIL line naming that file
 * that the unplanted copy doesn't print.
 */
export function judgeRowRemoval(root, rel) {
  const text = read(root, README), rows = tableRows(text);
  const changed = new Set(CRATES.flatMap((crate) => filesOf(root, rel, crate)).filter((file) => file.changed).map(({ path }) => path));
  const pick = rows.flatMap((row) => (/^#\d+$/.test(row.issue) ? row.files.map((file) => ({ row, file })) : []))
    .find(({ row, file }) => isFast(file) && changed.has(file) && readFileSync(join(root, file), 'utf8').includes(markLine(row.issue.slice(1)).slice(3))
      && !rows.some((other) => other !== row && other.issue === row.issue && other.files.includes(file)));
  if (!pick) return [`no row of the table is carried onto a vendored gpui-fast file it alone holds for its issue, so there is no row to remove`];
  const control = runCheck(plantedCopy(root), rel), copy = plantedCopy(root);
  writeFileSync(join(copy, README), text.split('\n').filter((_, index) => index !== pick.row.line - 1).join('\n'));
  const run = runCheck(copy, rel);
  console.log(`# plant: row ${pick.row.issue} at ${README}:${pick.row.line} removed, carried in ${pick.file}; check exit ${run.status}`);
  const before = new Set(fails(control.out));
  if (run.status === 0 || !fails(run.out).some((line) => line.includes(pick.file) && !before.has(line))) return [`row ${pick.row.issue} (${pick.row.cell.Behavior?.slice(0, 60)}) removed while ${pick.file} still carries it: check exit ${run.status}, no new FAIL line naming ${pick.file}\n${tail(run.out)}`];
  return [];
}

/** AC1: the three manifests' [package] name and version. */
export function judgePins(root) {
  return CRATES.flatMap((crate) => {
    const manifest = join(root, 'vendor', crate, 'Cargo.toml');
    if (!existsSync(manifest)) return [`vendor/${crate}/Cargo.toml isn't there`];
    const pkg = /^\[package\]([^[]*)/m.exec(readFileSync(manifest, 'utf8'))?.[1] ?? '';
    const [name, version] = ['name', 'version'].map((key) => new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, 'm').exec(pkg)?.[1]);
    return name === crate && version === VERSION ? [] : [`vendor/${crate}/Cargo.toml: [package] is ${name} ${version}, not ${crate} ${VERSION}`];
  });
}

/** AC1: each file that differs from its release has a row with an issue, a named test and a removal condition. */
export function judgeRows(root, rel) {
  const rows = tableRows(read(root, README)), problems = [];
  const named = (value) => value && !/^(?:[—–-]|none:?)$/i.test(value.trim());
  const whole = (row) => /^#\d+$/.test(row.issue) && /`[^`]+ › [^`]+`/.test(row.cell.Test ?? '') && named(row.cell.Removal);
  let changed = 0;
  for (const crate of CRATES) {
    if (!existsSync(join(root, 'vendor', crate))) {
      problems.push(`vendor/${crate} isn't there`);
      continue;
    }
    for (const file of filesOf(root, rel, crate).filter((each) => each.changed)) {
      changed += 1;
      const listed = rows.filter(({ files }) => files.includes(file.path));
      if (!listed.length) problems.push(`${file.path}: differs from ${crate} ${VERSION} and has no row`);
      else if (!listed.some(whole)) problems.push(`${file.path}: its rows (${listed.map(({ issue }) => issue || 'no issue').join(', ')}) don't name an issue, a test and a removal condition`);
    }
  }
  if (!changed && !problems.length) problems.push(`no vendored file differs from its ${VERSION} release: nothing is carried`);
  return problems;
}

/** AC1: two folders hold the same files, byte for byte. */
export function sameTree(a, b) {
  const [left, right] = [walk(a), walk(b)].map((list) => list.filter((inner) => !inner.startsWith('target/')).sort());
  const problems = [...left.filter((inner) => !right.includes(inner)).map((inner) => `only in the fresh release: ${inner}`), ...right.filter((inner) => !left.includes(inner)).map((inner) => `only in check's copy: ${inner}`)];
  for (const inner of left.filter((each) => right.includes(each))) if (!readFileSync(join(a, inner)).equals(readFileSync(join(b, inner)))) problems.push(`differs from the fresh release: ${inner}`);
  return problems;
}

/** AC3: metal-rs named in vendor/gpui-fast-apple's sources or manifest. */
export function judgeMetalRs(root) {
  const dir = join(root, 'vendor/gpui-fast-apple');
  if (!existsSync(dir)) return ['vendor/gpui-fast-apple isn\'t there'];
  const problems = [];
  for (const inner of walk(dir).filter((each) => each.endsWith('.rs'))) {
    const text = readFileSync(join(dir, inner), 'utf8'), aliased = /\buse\s+objc2_metal\s+as\s+metal\b/.test(text);
    text.split('\n').forEach((line, index) => {
      const code = line.replace(/\/\/.*$/, '');
      if (/\buse\s+metal\b|\bextern\s+crate\s+metal\b/.test(code) || (!aliased && /\bmetal::/.test(code))) problems.push(`vendor/gpui-fast-apple/${inner}:${index + 1}: ${line.trim()}`);
    });
  }
  let section = '';
  readFileSync(join(dir, 'Cargo.toml'), 'utf8').split('\n').forEach((line, index) => {
    if (/^\s*\[/.test(line)) section = line.trim();
    if (/dependencies\.metal\]$/.test(section) && /^\s*\[/.test(line)) problems.push(`vendor/gpui-fast-apple/Cargo.toml:${index + 1}: ${line.trim()}`);
    else if (/dependencies\]$/.test(section) && (/^\s*metal\s*=/.test(line) || /package\s*=\s*"metal"/.test(line))) problems.push(`vendor/gpui-fast-apple/Cargo.toml:${index + 1}: ${line.trim()}`);
  });
  return problems;
}

/** AC3: vendor/gpui-fast-apple's carried Rust files that name objc2-metal, outside test files. */
export function portedFiles(root, rel) {
  return filesOf(root, rel, 'gpui-fast-apple').filter((file) => file.changed && file.inner.endsWith('.rs') && !/(?:^|\/)tests?(?:\.rs|\/)/.test(file.inner)
    && /\bobjc2_metal\b/.test(readFileSync(join(root, file.path), 'utf8'))).map(({ inner }) => inner);
}

/**
 * AC3: cargo check's JSON messages read for gpui-fast-apple, whose manifest is `apple`. An error in a carried file, in
 * gpui-fast (so the carried files were never compiled) or in a gpui-fast-apple file outside the carried files and
 * src/fast/ (#3625's sites) fails; a failed build with no compiler error at all is INCONCLUSIVE.
 */
export function judgeMessages(messages, apple, carried) {
  const problems = [], errors = messages.filter((m) => m.reason === 'compiler-message' && m.message?.level === 'error' && m.message.spans?.length);
  for (const m of errors) {
    const span = m.message.spans.find(({ is_primary }) => is_primary) ?? m.message.spans[0];
    const file = isAbsolute(span.file_name) ? relative(dirname(m.manifest_path), span.file_name) : span.file_name;
    const at = `${file}:${span.line_start}: ${m.message.code?.code ?? 'error'} ${m.message.message}`;
    if (m.manifest_path !== apple) problems.push(`${basename(dirname(m.manifest_path))} fails to compile, so gpui-fast-apple's carried files weren't compiled: ${at}`);
    else if (carried.includes(file)) problems.push(`carried file vendor/gpui-fast-apple/${at}`);
    else if (!file.startsWith('src/fast/')) problems.push(`vendor/gpui-fast-apple/${at}: an error outside the carried files and #3625's src/fast/ sites`);
  }
  if (!errors.length && !messages.find(({ reason }) => reason === 'build-finished')?.success) problems.push('INCONCLUSIVE: cargo check failed before any compiler error (a build script, the network or no grant)');
  return problems;
}

/** AC3: `cargo check --lib` of vendor/gpui-fast-apple against vendor/gpui-fast in a scratch folder, under the lease. */
export function compileApple(root, rel) {
  const work = realpathSync(scratch('da3622-build-')); // cargo and rustc name files by their real path
  for (const crate of ['gpui-fast', 'gpui-fast-apple']) cpSync(join(root, 'vendor', crate), join(work, crate), { recursive: true, filter: (path) => !/^target(?:\/|$)/.test(relative(join(root, 'vendor', crate), path)) });
  const metal = spawnSync('xcrun', ['--find', 'metal'], { encoding: 'utf8' }).status === 0;
  const args = ['check', '--lib', '--message-format=json', '--config', `patch.crates-io.gpui-fast.path=${JSON.stringify(join(work, 'gpui-fast'))}`, ...(metal ? [] : ['--features', 'runtime_shaders'])];
  console.log(`# cargo ${args.join(' ').split(work).join('<tmp>')} (${metal ? 'with' : 'no'} Metal compiler)`);
  // Homebrew's rustup, as AGENTS' commands put it first, then rustup's own folder, when cargo isn't on PATH already.
  const path = [process.env.PATH, '/opt/homebrew/opt/rustup/bin', join(homedir(), '.cargo/bin')].filter(Boolean).join(':');
  if (spawnSync('cargo', ['--version'], { env: { ...process.env, PATH: path } }).status !== 0) return ['INCONCLUSIVE: no cargo on PATH, in /opt/homebrew/opt/rustup/bin or in ~/.cargo/bin'];
  const run = spawnSync('sh', [join(repoRoot, 'scripts/lease'), 'cargo', ...args], { cwd: join(work, 'gpui-fast-apple'), encoding: 'utf8', maxBuffer: 1 << 30, timeout: 55 * 60_000, env: cleanEnv({ PATH: path, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0', CARGO_TARGET_DIR: join(work, 'target'), DEEP_LEASE_WAIT: '20' }) });
  const messages = (run.stdout ?? '').split('\n').flatMap((line) => { try { return line.startsWith('{') ? [JSON.parse(line)] : []; } catch { return []; } });
  const apple = join(work, 'gpui-fast-apple', 'Cargo.toml'), carried = portedFiles(root, rel);
  const problems = judgeMessages(messages, apple, filesOf(root, rel, 'gpui-fast-apple').filter((file) => file.changed).map(({ inner }) => inner));
  if (problems.some((line) => line.startsWith('INCONCLUSIVE'))) problems.push(redact(`${(run.stdout ?? '').split('\n').filter((line) => !line.startsWith('{')).slice(-8).join('\n')}\n${(run.stderr ?? '').split('\n').slice(-15).join('\n')}`).split(homedir()).join('~'));
  // rustc's dep-info names every source file the lib compiled: a ported file no `mod` reaches compiled nothing.
  const deps = join(work, 'target', 'debug', 'deps');
  const info = existsSync(deps) ? readdirSync(deps).filter((name) => /^gpui_apple-.*\.d$/.test(name)) : [];
  if (!problems.length && info.length) {
    const sources = new Set(info.flatMap((name) => readFileSync(join(deps, name), 'utf8').split(/(?<!\\)\s+/)).map((path) => relative(join(work, 'gpui-fast-apple'), path.replace(/:$/, '').replace(/\\ /g, ' '))));
    for (const inner of carried) if (!sources.has(inner)) problems.push(`vendor/gpui-fast-apple/${inner}: ported to objc2-metal but no module of the lib reaches it, so it compiled nothing`);
  }
  return problems;
}

/** AC4: a reference to an upstream change: owner/repo#n, a pull or commit URL, or a commit hash; never this repo's. */
export function upstreamChange(text) {
  const refs = [...text.matchAll(/([\w.-]+\/[\w.-]+)#\d+/g)].filter(([, repo]) => repo !== 'windoliver/deepbuild');
  const urls = [...text.matchAll(/https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(?:pull|commit)\/\w+/g)].filter(([, repo]) => repo !== 'windoliver/deepbuild');
  return refs.length > 0 || urls.length > 0 || /\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b/.test(text);
}
const hasIssue = (text, issue) => new RegExp(`${issue}(?!\\d)`).test(text);

/**
 * AC4: each row retired for 0.1.19 names its issue and an upstream change, and each issue the base carried on
 * gpui-pre is carried onto a vendored gpui-fast tree, retired, or named on a line with its follow-up (#3623-#3631).
 */
export function judgeRetired(root) {
  const text = read(root, README), retired = retiredRows(text), rows = tableRows(text), problems = [];
  for (const row of retired) {
    if (!/#\d+/.test(row.raw)) problems.push(`${README}:${row.line}: a row retired for ${VERSION} names no issue`);
    if (!upstreamChange(row.raw)) problems.push(`${README}:${row.line}: a row retired for ${VERSION} names no upstream change: ${row.raw.slice(0, 120)}`);
  }
  for (const issue of BASE_GPUI_ISSUES) {
    const carried = rows.some((row) => row.issue === issue && row.files.some(isFast));
    const gone = retired.some(({ raw }) => hasIssue(raw, issue));
    const left = text.split('\n').some((line) => hasIssue(line, issue) && /#36(?:2[3-9]|3[01])(?!\d)/.test(line));
    if (!carried && !gone && !left) problems.push(`${issue}: carried on gpui-pre, but no row of it lists a vendored gpui-fast file, none is retired for ${VERSION} and no line leaves it to a follow-up (#3623-#3631)`);
  }
  return problems;
}

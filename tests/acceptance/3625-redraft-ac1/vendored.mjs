import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
export const AC1 = '#3625.a44f8c65';
export const VERSION = '0.1.19';
export const CRATES = ['gpui-fast', 'gpui-fast-apple', 'gpui-fast-macos'];
export const TABLE = 'vendor/gpui-pre-apple/upstream/README.md';

const made = [];
process.on('exit', () => { for (const dir of made) rmSync(dir, { recursive: true, force: true }); });
export function scratch(prefix) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  made.push(dir);
  return dir;
}
export const cleanEnv = (extra = {}) => ({ ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), ...extra });
export const redact = (text) => [realpathSync(tmpdir()), tmpdir(), homedir()].reduce((out, dir, k) => out.split(dir).join(k < 2 ? '<tmp>' : '~'), text);

let fetched = null;
export async function pristineReleases() {
  if (fetched) return fetched;
  const dir = scratch('da3625-releases-');
  for (const crate of CRATES) {
    const url = `https://static.crates.io/crates/${crate}/${crate}-${VERSION}.crate`;
    const response = await fetch(url).catch((error) => ({ ok: false, status: error.message }));
    if (!response.ok) throw Error(`INCONCLUSIVE: can't fetch the pristine release ${url}: ${response.status}`);
    const file = join(dir, `${crate}.crate`), out = join(dir, crate);
    writeFileSync(file, Buffer.from(await response.arrayBuffer()));
    mkdirSync(out);
    if (spawnSync('tar', ['xzf', file, '--strip-components=1', '-C', out]).status !== 0) throw Error(`INCONCLUSIVE: can't unpack ${url}`);
  }
  return (fetched = dir);
}

function filesUnder(dir, at = '') {
  return readdirSync(join(dir, at), { withFileTypes: true }).flatMap((entry) => {
    const inner = at ? `${at}/${entry.name}` : entry.name;
    return entry.isDirectory() ? filesUnder(dir, inner) : entry.isFile() ? [inner] : [];
  });
}

export function touchedFastFiles(root, releases) {
  return CRATES.flatMap((crate) => {
    const fast = join(root, 'vendor', crate, 'src/fast');
    if (!existsSync(fast)) return [];
    return filesUnder(fast).flatMap((inner) => {
      const ours = join(fast, inner), theirs = join(releases, crate, 'src/fast', inner);
      return existsSync(theirs) && readFileSync(theirs).equals(readFileSync(ours)) ? [] : [`vendor/${crate}/src/fast/${inner}`];
    });
  });
}

export function carriedRows(text) {
  const lines = text.split('\n'), start = lines.indexOf('## Carried patches'), rows = [];
  const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
  const head = start < 0 ? -1 : lines.findIndex((line, at) => at > start && line.startsWith('|'));
  for (let at = head + 2; head >= 0 && at < lines.length && lines[at].startsWith('|'); at += 1) {
    const [behavior, issue, files] = cells(lines[at]);
    rows.push({ name: `${issue} ${behavior}`, files: [...(files ?? '').matchAll(/`([^`]+)`/g)].map(([, file]) => file) });
  }
  return rows;
}

const names = (line, path) => new RegExp(`(?:^|[\\s\`(])${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w./-])`).test(line);

export function judgeVendorCheck(out, touched, rows) {
  if (!touched.length) return ['no src/fast/ file of the three trees differs from its 0.1.19 release, so check judged nothing touched there'];
  const problems = [], lines = out.split('\n');
  const owning = rows.filter((row) => row.files.some((file) => touched.includes(file)));
  for (const crate of CRATES) {
    const blocked = lines.find((line) => line.startsWith(`BLOCKED ${crate} `));
    if (blocked) problems.push(`check never compared vendor/${crate} with its release: ${blocked}`);
  }
  for (const line of lines.filter((each) => /^(?:FAIL|BLOCKED|INVALID|INCONCLUSIVE)\b/.test(each))) {
    const file = touched.find((path) => names(line, path));
    const row = owning.find((each) => line.startsWith(`FAIL row ${each.name}: `));
    if (row && !file && line.endsWith('its suite gave no list')) problems.push(`INCONCLUSIVE: check couldn't list the test of a row carrying ${row.files.filter((each) => touched.includes(each)).join(', ')} (no node_modules/vitest, or its suite didn't load): ${line}`);
    else if (file) problems.push(`check fails on ${file}: ${line}`);
    else if (row) problems.push(`check fails on the row carrying ${row.files.filter((each) => touched.includes(each)).join(', ')}: ${line}`);
  }
  for (const row of owning) if (!lines.some((line) => line.startsWith(`ROW ${row.name}: `))) problems.push(`check never judged the row carrying ${row.files.filter((each) => touched.includes(each)).join(', ')}: no ROW line for ${row.name.slice(0, 80)}`);
  return problems;
}

export function runVendorCheck(root) {
  const run = spawnSync(process.execPath, [join(root, 'scripts/vendor-rebase.mjs'), 'check'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28, timeout: 30 * 60_000, env: cleanEnv() });
  return { status: run.status, out: `${run.stdout ?? ''}${run.stderr ?? ''}${run.error ? `\n${run.error.message}` : ''}` };
}

export function scratchWorkspace(root) {
  const work = scratch('da3625-build-');
  for (const crate of CRATES) cpSync(join(root, 'vendor', crate), join(work, crate), { recursive: true, filter: (path) => !/^(?:target|\.git)(?:\/|$)/.test(relative(join(root, 'vendor', crate), path)) });
  const manifest = join(work, 'gpui-fast', 'Cargo.toml');
  writeFileSync(manifest, readFileSync(manifest, 'utf8').replace(/^\[workspace\]\n(?:(?!\[)[^\n]*\n?)*/m, ''));
  cpSync(join(work, 'gpui-fast-macos', 'Cargo.lock'), join(work, 'Cargo.lock'));
  writeFileSync(join(work, 'Cargo.toml'), [
    '[workspace]',
    'resolver = "2"',
    `members = [${CRATES.map((crate) => JSON.stringify(crate)).join(', ')}]`,
    '',
    '[patch.crates-io]',
    ...CRATES.slice(0, 2).map((crate) => `${crate} = { path = ${JSON.stringify(crate)} }`),
    '',
  ].join('\n'));
  return work;
}

export const metalCompiler = () => spawnSync('xcrun', ['--find', 'metal'], { encoding: 'utf8' }).status === 0;

export function cargoCheckArgs() {
  const features = [...CRATES.map((crate) => `${crate}/test-support`), ...(metalCompiler() ? [] : ['gpui-fast-apple/runtime_shaders'])];
  return ['check', ...CRATES.flatMap((crate) => ['-p', crate]), '--all-targets', '--keep-going', '--message-format=json', '--features', features.join(',')];
}

export function cargoCheck(work) {
  const path = [process.env.PATH, '/opt/homebrew/opt/rustup/bin', join(homedir(), '.cargo/bin')].filter(Boolean).join(':');
  if (spawnSync('cargo', ['--version'], { env: { ...process.env, PATH: path } }).status !== 0) return { messages: [], tail: 'INCONCLUSIVE: no cargo on PATH, in /opt/homebrew/opt/rustup/bin or in ~/.cargo/bin' };
  const args = cargoCheckArgs();
  const run = spawnSync('sh', [join(repoRoot, 'scripts/lease'), 'cargo', ...args], { cwd: work, encoding: 'utf8', maxBuffer: 1 << 30, timeout: 55 * 60_000, env: cleanEnv({ PATH: path, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0', CARGO_TARGET_DIR: join(work, 'target'), DEEP_LEASE_WAIT: '25' }) });
  const messages = (run.stdout ?? '').split('\n').flatMap((line) => { try { return line.startsWith('{') ? [JSON.parse(line)] : []; } catch { return []; } });
  const tail = redact([`cargo ${args.join(' ')} exit ${run.status}${run.error ? ` (${run.error.message})` : ''}`, ...(run.stdout ?? '').split('\n').filter((line) => line && !line.startsWith('{')).slice(-6), ...(run.stderr ?? '').split('\n').slice(-12)].join('\n'));
  return { messages, tail };
}

export function judgeRun({ messages, tail }, work) {
  const problems = judgeBuild(messages, work);
  return problems.some((line) => line.startsWith('INCONCLUSIVE')) ? [...problems, tail] : problems.slice(0, 60);
}

export function judgeBuild(messages, work) {
  const problems = [];
  const vendored = (file) => { const inner = isAbsolute(file) ? relative(work, file) : file; return inner.startsWith('..') ? file : `vendor/${inner}`; };
  for (const m of messages.filter((each) => each.reason === 'compiler-message' && each.message?.level === 'error')) {
    const span = m.message.spans?.find(({ is_primary }) => is_primary) ?? m.message.spans?.[0];
    problems.push(`${span ? `${vendored(span.file_name)}:${span.line_start}: ` : ''}error${m.message.code?.code ? `[${m.message.code.code}]` : ''}: ${m.message.message}`);
  }
  const finished = messages.find(({ reason }) => reason === 'build-finished');
  if (!problems.length && !finished?.success) return ['INCONCLUSIVE: cargo check failed with no compiler error (no build grant, the network or a build script)'];
  if (problems.length) return problems;
  for (const crate of CRATES) {
    const manifest = join(work, crate, 'Cargo.toml');
    const libs = messages.filter((m) => m.reason === 'compiler-artifact' && m.manifest_path === manifest && m.target?.kind?.includes('lib'));
    if (!libs.some((m) => !m.profile?.test)) problems.push(`cargo check never checked ${crate}'s library`);
    if (!libs.some((m) => m.profile?.test)) problems.push(`cargo check never checked ${crate}'s library tests, as --all-targets does`);
  }
  return problems;
}

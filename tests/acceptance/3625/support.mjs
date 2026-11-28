import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
export const here = fileURLToPath(new URL('./', import.meta.url));
export const AC = { 1: '#3625.a44f8c65', 2: '#3625.ef5828e4', 3: '#3625.406aa15e' };
export const VERSION = '0.1.19';
export const CRATES = ['gpui-fast', 'gpui-fast-apple', 'gpui-fast-macos'];
export const README = 'vendor/gpui-pre-apple/upstream/README.md';
export const TARGET = join(tmpdir(), 'da3625-target');
export const CARRIED_ENUMS = ['PrimitiveBatch', 'Primitive', 'PaintOperation', 'ColorSpace', 'AtlasKey'];
export const PLANTED_VARIANT = 'Planted3625';
const FAST_FILE = /vendor\/gpui-fast(?:-apple|-macos)?\/src\/fast\/[^\s:`]+/;

const made = [];
process.on('exit', () => { for (const dir of made) rmSync(dir, { recursive: true, force: true }); });
export function scratch(prefix) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  made.push(dir);
  return dir;
}

export const cleanEnv = (extra = {}) => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_') && key !== 'GPUI_VIEW_RETENTION')),
  ...extra,
});

export function redact(text) {
  return String(text)
    .split(realpathSync(tmpdir())).join('<tmp>')
    .split(tmpdir()).join('<tmp>')
    .split(homedir()).join('~')
    .replace(/\/(?:private\/)?var\/folders\/[^\s/]+\/[^\s/]+\/T/g, '<tmp>')
    .replace(/-Users-[^-/\s]+-/g, '-Users-<name>-');
}

let fetched = null;
export async function releases() {
  if (fetched) return fetched;
  const dir = scratch('da3625-releases-');
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

const notBuilt = (from) => (path) => !/^(?:target|\.git)(?:\/|$)/.test(relative(from, path));

export function copyTrees(root = repoRoot) {
  const dir = scratch('da3625-trees-');
  for (const crate of CRATES) {
    const from = join(root, 'vendor', crate);
    if (!existsSync(join(from, 'Cargo.toml'))) throw Error(`vendor/${crate} isn't there`);
    cpSync(from, join(dir, 'vendor', crate), { recursive: true, filter: notBuilt(from) });
  }
  cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true });
  mkdirSync(join(dir, dirname(README)), { recursive: true });
  cpSync(join(root, README), join(dir, README));
  if (existsSync(join(root, 'package.json'))) cpSync(join(root, 'package.json'), join(dir, 'package.json'));
  return dir;
}

export function walkRust(dir, at = '') {
  if (!existsSync(join(dir, at))) return [];
  return readdirSync(join(dir, at), { withFileTypes: true }).flatMap((entry) => {
    const inner = at ? `${at}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return entry.name === 'target' ? [] : walkRust(dir, inner);
    return inner.endsWith('.rs') ? [inner] : [];
  });
}

const withoutOwnWorkspace = (manifest) => manifest.replace(/^\[workspace\][^\n]*\n(?:(?!\[)[^\n]*\n?)*/m, '');

export function cargoWorkspace(trees) {
  const dir = scratch('da3625-cargo-');
  for (const crate of CRATES) {
    const from = join(trees, 'vendor', crate);
    cpSync(from, join(dir, 'vendor', crate), { recursive: true, filter: notBuilt(from) });
    const manifest = join(dir, 'vendor', crate, 'Cargo.toml');
    writeFileSync(manifest, withoutOwnWorkspace(readFileSync(manifest, 'utf8')));
  }
  writeFileSync(join(dir, 'Cargo.toml'), [
    '[workspace]',
    `members = [${CRATES.map((crate) => JSON.stringify(`vendor/${crate}`)).join(', ')}]`,
    'resolver = "2"',
    '',
    '[patch.crates-io]',
    ...CRATES.map((crate) => `${crate} = { path = ${JSON.stringify(`vendor/${crate}`)} }`),
    '',
  ].join('\n'));
  const lock = join(dir, 'vendor', 'gpui-fast-macos', 'Cargo.lock');
  if (existsSync(lock)) cpSync(lock, join(dir, 'Cargo.lock'));
  return dir;
}

export const hasMetalCompiler = () => spawnSync('xcrun', ['--find', 'metal'], { encoding: 'utf8' }).status === 0;
export const shaderFeatures = () => (hasMetalCompiler() ? [] : ['gpui-fast-apple/runtime_shaders']);

const cargoPath = () => [process.env.PATH, '/opt/homebrew/opt/rustup/bin', join(homedir(), '.cargo/bin')].filter(Boolean).join(':');

export function runCargo(cwd, args, { timeoutMinutes = 55 } = {}) {
  const env = cleanEnv({ PATH: cargoPath(), CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0', CARGO_TERM_COLOR: 'never', CARGO_TARGET_DIR: TARGET, DEEP_LEASE_WAIT: '30' });
  if (spawnSync('cargo', ['--version'], { env }).status !== 0) return { status: null, stdout: '', stderr: 'no cargo on PATH, in /opt/homebrew/opt/rustup/bin or in ~/.cargo/bin', messages: [], noCargo: true };
  const started = Date.now();
  const run = spawnSync('sh', [join(repoRoot, 'scripts/lease'), 'cargo', ...args], { cwd, encoding: 'utf8', maxBuffer: 1 << 30, timeout: timeoutMinutes * 60_000, env });
  const messages = (run.stdout ?? '').split('\n').flatMap((line) => { try { return line.startsWith('{') ? [JSON.parse(line)] : []; } catch { return []; } });
  console.log(redact(`# cargo ${args.join(' ')} in ${cwd}: exit ${run.status}${run.signal ? ` (${run.signal})` : ''} after ${Math.round((Date.now() - started) / 1000)} s`));
  return { status: run.status, stdout: run.stdout ?? '', stderr: `${run.stderr ?? ''}${run.error ? `\n${run.error.message}` : ''}`, messages };
}

const primary = (message) => message.spans?.find(({ is_primary }) => is_primary) ?? message.spans?.[0];

const fromWorkspace = (crateDir, file) => {
  for (let at = dirname(crateDir); at !== dirname(at); at = dirname(at)) if (existsSync(join(at, file))) return join(at, file);
  return join(dirname(crateDir), file);
};

export function compileErrors(messages) {
  return messages.filter((m) => m.reason === 'compiler-message' && m.message?.level === 'error' && primary(m.message)).map((m) => {
    const span = primary(m.message), crateDir = dirname(m.manifest_path);
    const file = relative(crateDir, isAbsolute(span.file_name) ? span.file_name : fromWorkspace(crateDir, span.file_name));
    return { crate: basename(crateDir), file, line: span.line_start, code: m.message.code?.code ?? 'error', text: m.message.message, message: m.message, manifest: m.manifest_path };
  });
}

const tailOf = (run) => redact(`${run.stdout.split('\n').filter((line) => !line.startsWith('{')).slice(-6).join('\n')}\n${run.stderr.split('\n').slice(-14).join('\n')}`.trim());

export function judgeBuild(run) {
  if (run.noCargo) return [`INCONCLUSIVE: ${run.stderr}`];
  const errors = compileErrors(run.messages);
  if (errors.length) return errors.map((error) => `vendor/${error.crate}/${error.file}:${error.line}: ${error.code} ${error.text}`);
  if (!run.messages.find(({ reason }) => reason === 'build-finished')?.success) return [`INCONCLUSIVE: cargo failed before any compiler error (a build script, the network or no grant)\n${tailOf(run)}`];
  return [];
}

export const TEST_SUPPORT = CRATES.map((crate) => `${crate}/test-support`);

export function checkVendoredTrees(trees, featureSets = [[], TEST_SUPPORT]) {
  const workspace = cargoWorkspace(trees);
  return featureSets.flatMap((features) => {
    const all = [...features, ...shaderFeatures()];
    const args = ['check', '-p', 'gpui-fast', '-p', 'gpui-fast-apple', '-p', 'gpui-fast-macos', '--all-targets', '--keep-going', '--message-format=json', ...(all.length ? ['--features', all.join(',')] : [])];
    const label = features.length ? 'test-support' : 'default features';
    return judgeBuild(runCargo(workspace, args)).map((problem) => `${label}: ${problem}`);
  });
}

export function runCheck(trees, rel) {
  const run = spawnSync(process.execPath, [join(trees, 'scripts/vendor-rebase.mjs'), 'check'], { cwd: trees, encoding: 'utf8', maxBuffer: 1 << 28, timeout: 30 * 60_000, env: cleanEnv({ DEEP_VENDOR_RELEASES: rel }) });
  return { status: run.status, out: `${run.stdout ?? ''}${run.stderr ?? ''}${run.error ? `\n${run.error.message}` : ''}` };
}

export function judgeCheck(out) {
  const lines = out.split('\n');
  const blocked = lines.filter((line) => /^BLOCKED\b/.test(line) && /gpui-fast/.test(line));
  const fails = lines.filter((line) => /^FAIL\b/.test(line) && FAST_FILE.test(line));
  return [...blocked.map((line) => `INCONCLUSIVE: ${redact(line)}`), ...fails.map(redact)];
}

export function addedLines(from, to) {
  if (!existsSync(from)) return new Set(readFileSync(to, 'utf8').split('\n').map((_, index) => index + 1));
  const out = spawnSync('git', ['diff', '--no-index', '--no-color', '-U0', from, to], { encoding: 'utf8', maxBuffer: 1 << 28, env: cleanEnv() }).stdout;
  const added = new Set();
  for (const [, at, count = '1'] of out.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) for (let line = Number(at); line < Number(at) + Number(count); line += 1) added.add(line);
  return added;
}

function codeOnly(text) {
  let out = '', i = 0;
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  while (i < text.length) {
    const rest = text.slice(i, i + 8);
    if (rest.startsWith('//')) { const end = text.indexOf('\n', i); const stop = end < 0 ? text.length : end; out += blank(text.slice(i, stop)); i = stop; continue; }
    if (rest.startsWith('/*')) { const end = text.indexOf('*/', i + 2); const stop = end < 0 ? text.length : end + 2; out += blank(text.slice(i, stop)); i = stop; continue; }
    const raw = /^r(#*)"/.exec(text.slice(i, i + 12));
    if (raw) { const close = `"${raw[1]}`; const end = text.indexOf(close, i + raw[0].length); const stop = end < 0 ? text.length : end + close.length; out += `"${blank(text.slice(i + 1, stop - 1))}"`; i = stop; continue; }
    if (text[i] === '"') { let j = i + 1; while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1; out += `"${blank(text.slice(i + 1, j))}"`; i = j + 1; continue; }
    const char = /^'(?:\\(?:x[0-9a-fA-F]{2}|u\{[0-9a-fA-F]+\}|.)|[^\\'\n])'/.exec(text.slice(i, i + 12));
    if (char) { out += blank(char[0]); i += char[0].length; continue; }
    out += text[i];
    i += 1;
  }
  return out;
}

const OPEN = '{([', CLOSE = '})]';
function armEnd(body, from) {
  let r = from;
  while (/\s/.test(body[r] ?? '')) r += 1;
  if (body[r] === '{') {
    for (let depth = 0; r < body.length; r += 1) { if (body[r] === '{') depth += 1; else if (body[r] === '}' && --depth === 0) { r += 1; break; } }
  } else {
    for (let depth = 0; r < body.length; r += 1) { const c = body[r]; if (OPEN.includes(c)) depth += 1; else if (CLOSE.includes(c)) { if (--depth < 0) break; } else if (depth === 0 && c === ',') break; }
  }
  while (r < body.length && /[\s,]/.test(body[r])) r += 1;
  return r;
}

export function matchesOver(text, enums = CARRIED_ENUMS) {
  const code = codeOnly(text), named = new RegExp(`\\b(${enums.join('|')})::\\w+`, 'g'), found = [];
  const lineOf = (offset) => code.slice(0, offset).split('\n').length;
  for (const { index } of code.matchAll(/\bmatch\b/g)) {
    let open = index + 5;
    for (let depth = 0; open < code.length; open += 1) { const c = code[open]; if (c === '{' && depth === 0) break; if (OPEN.includes(c)) depth += 1; else if (CLOSE.includes(c)) depth -= 1; if (c === ';') { open = -1; break; } }
    if (open < 0 || open >= code.length) continue;
    let close = open;
    for (let depth = 0; close < code.length; close += 1) { if (code[close] === '{') depth += 1; else if (code[close] === '}' && --depth === 0) break; }
    const body = code.slice(open + 1, close), arms = [];
    for (let k = 0; k < body.length;) {
      let q = k;
      for (let depth = 0; q < body.length; q += 1) { const c = body[q]; if (OPEN.includes(c)) depth += 1; else if (CLOSE.includes(c)) depth -= 1; else if (depth === 0 && c === '=' && body[q + 1] === '>') break; }
      if (q >= body.length) break;
      const raw = body.slice(k, q), pattern = raw.trim();
      arms.push({ pattern, line: lineOf(open + 1 + k + (raw.length - raw.trimStart().length)) });
      k = armEnd(body, q + 2);
    }
    const over = [...new Set(arms.flatMap(({ pattern }) => [...pattern.matchAll(named)].map(([, name]) => name)))];
    if (over.length) found.push({ line: lineOf(index), over, arms, catchAll: arms.filter(({ pattern }) => /^(?:_|[a-z_][a-z0-9_]*)(?:\s+if\b[\s\S]*)?$/.test(pattern) && pattern !== 'None') });
  }
  return found;
}

export function judgeCatchAlls(trees, rel) {
  const problems = [];
  let sites = 0;
  for (const crate of CRATES) {
    const dir = join(trees, 'vendor', crate), release = join(rel, `${crate}-${VERSION}`);
    for (const inner of walkRust(dir, 'src/fast')) {
      const path = join(dir, inner), from = join(release, inner);
      if (existsSync(from) && readFileSync(from).equals(readFileSync(path))) continue;
      const added = addedLines(from, path);
      for (const site of matchesOver(readFileSync(path, 'utf8'))) {
        if (site.arms.some(({ line }) => added.has(line))) sites += 1;
        for (const arm of site.catchAll.filter(({ line }) => added.has(line))) problems.push(`vendor/${crate}/${inner}:${arm.line}: a catch-all arm \`${arm.pattern.split('\n')[0]} =>\` added to the match over ${site.over.join(', ')} at line ${site.line}`);
      }
    }
  }
  console.log(`# carried src/fast/ match sites over ${CARRIED_ENUMS.join(', ')}: ${sites}`);
  return problems;
}

export function plantVariant(workspace) {
  const path = join(workspace, 'vendor', 'gpui-fast', 'src', 'scene.rs'), text = readFileSync(path, 'utf8');
  const head = /pub enum PrimitiveBatch\b[^{]*\{/.exec(text);
  if (!head) throw Error('INCONCLUSIVE: vendor/gpui-fast/src/scene.rs declares no `pub enum PrimitiveBatch`, so no variant can be planted in it');
  const at = head.index + head[0].length;
  writeFileSync(path, `${text.slice(0, at)}\n    ${PLANTED_VARIANT},${text.slice(at)}`);
}

function applySuggestions(workspace, errors) {
  const edits = new Map();
  for (const error of errors) {
    for (const child of error.message.children ?? []) {
      for (const span of child.spans ?? []) {
        if (span.suggested_replacement == null) continue;
        const file = isAbsolute(span.file_name) ? span.file_name : join(workspace, span.file_name);
        if (!edits.has(file)) edits.set(file, []);
        edits.get(file).push(span);
      }
    }
  }
  for (const [file, spans] of edits) {
    let bytes = readFileSync(file);
    const seen = new Set();
    for (const span of spans.sort((a, b) => b.byte_start - a.byte_start)) {
      if (seen.has(span.byte_start)) continue;
      seen.add(span.byte_start);
      bytes = Buffer.concat([bytes.subarray(0, span.byte_start), Buffer.from(span.suggested_replacement), bytes.subarray(span.byte_end)]);
    }
    writeFileSync(file, bytes);
  }
  return edits.size;
}

export function compileWithPlantedVariant(trees) {
  const workspace = cargoWorkspace(trees);
  plantVariant(workspace);
  const features = shaderFeatures();
  const args = ['check', '-p', 'gpui-fast-apple', '--lib', '--message-format=json', ...(features.length ? ['--features', features.join(',')] : [])];
  for (let round = 1; round <= 6; round += 1) {
    const run = runCargo(workspace, args);
    if (run.noCargo) return [`INCONCLUSIVE: ${run.stderr}`];
    const errors = compileErrors(run.messages);
    const inCore = errors.filter(({ crate }) => crate === 'gpui-fast');
    if (inCore.length) {
      const fixable = inCore.filter(({ code, text }) => code === 'E0004' && text.includes(PLANTED_VARIANT));
      if (fixable.length < inCore.length || !applySuggestions(workspace, fixable)) return [`gpui-fast itself fails to compile with the planted variant, so gpui-fast-apple's src/fast/frame.rs is never reached: ${inCore.filter((error) => !fixable.includes(error)).concat(fixable).slice(0, 5).map((error) => `vendor/gpui-fast/${error.file}:${error.line}: ${error.code} ${error.text}`).join('; ')}`];
      console.log(`# round ${round}: gave ${fixable.length} of gpui-fast's own matches an arm for the planted variant, as rustc suggests`);
      continue;
    }
    const problems = judgePlantedVariant(run.messages);
    if (problems.some((problem) => problem.startsWith('INCONCLUSIVE'))) problems.push(tailOf(run));
    return problems;
  }
  return ['gpui-fast still fails to compile with the planted variant after six rounds of rustc\'s suggested arms'];
}

export function judgePlantedVariant(messages) {
  const errors = compileErrors(messages);
  const inFrame = errors.filter(({ crate, file, text }) => crate === 'gpui-fast-apple' && file === 'src/fast/frame.rs' && text.includes(PLANTED_VARIANT));
  if (inFrame.length) {
    console.log(`# the planted variant fails to compile at ${inFrame.map(({ file, line, code }) => `vendor/gpui-fast-apple/${file}:${line} (${code})`).join(', ')}`);
    return [];
  }
  if (!errors.length && !messages.find(({ reason }) => reason === 'build-finished')?.success) return ['INCONCLUSIVE: cargo failed before any compiler error (a build script, the network or no grant)'];
  const elsewhere = errors.map((error) => `vendor/${error.crate}/${error.file}:${error.line}: ${error.code} ${error.text}`);
  if (!elsewhere.length) return [`a planted \`PrimitiveBatch::${PLANTED_VARIANT}\` compiles in vendor/gpui-fast-apple/src/fast/frame.rs, and gpui-fast-apple builds with it`];
  return [`no error in vendor/gpui-fast-apple/src/fast/frame.rs names a planted \`PrimitiveBatch::${PLANTED_VARIANT}\`; gpui-fast-apple stops at: ${elsewhere.slice(0, 6).join('; ')}`];
}

const REPLAYED_HITBOXES = /(\brendered_frame\s*\.\s*hitboxes\s*\[[^\]]*\]\s*\.\s*iter\(\)\s*)\.\s*cloned\(\)/g;
export function plantReplayDroppingElement(crateDir) {
  const changed = [];
  for (const inner of walkRust(crateDir, 'src')) {
    const path = join(crateDir, inner), text = readFileSync(path, 'utf8');
    const planted = text.replace(REPLAYED_HITBOXES, (_, head) => `${head}.map(|hitbox| crate::window::Hitbox { element: Default::default(), ..hitbox.clone() })`);
    if (planted !== text) {
      writeFileSync(path, planted);
      changed.push(inner);
    }
  }
  return changed;
}

export function retainedHitsCrate() {
  const dir = scratch('da3625-hits-'), crate = join(dir, 'gpui-fast'), from = join(repoRoot, 'vendor', 'gpui-fast');
  cpSync(from, crate, { recursive: true, filter: notBuilt(from) });
  mkdirSync(join(crate, 'tests'), { recursive: true });
  cpSync(join(here, 'retained_hits.rs'), join(crate, 'tests', 'retained_hits.rs'));
  const manifest = join(crate, 'Cargo.toml');
  writeFileSync(manifest, `${readFileSync(manifest, 'utf8').trimEnd()}\n\n[[test]]\nname = "retained_hits"\npath = "tests/retained_hits.rs"\nrequired-features = ["test-support"]\n`);
  return crate;
}

export function runRetainedHits(crate) {
  const run = runCargo(crate, ['test', '--features', 'test-support', '--test', 'retained_hits', '--', '--test-threads=1']);
  const out = `${run.stdout}\n${run.stderr}`;
  const result = /test result: (ok|FAILED)\. (\d+) passed; (\d+) failed/.exec(out);
  const compile = out.split('\n').filter((line) => /^error(?:\[E\d+\])?:/.test(line) && !/could not compile|aborting due to|test failed, to rerun/.test(line));
  const panic = /panicked at [^\n]*\n([\s\S]*?)(?:\nnote: |\n\nfailures:|\n---- |$)/.exec(out)?.[1]?.trim() ?? '';
  return { run, out: redact(out), result: result?.[1] ?? null, passed: Number(result?.[2] ?? 0), compile: compile.map(redact), panic: redact(panic), tail: tailOf(run) };
}

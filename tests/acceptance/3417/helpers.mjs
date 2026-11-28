import { spawn, spawnSync } from 'node:child_process';
import { constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const CANVAS = 'docs/canvas-primitives.md';
export const CEILINGS = 'scripts/doc-ceilings.json';
export const HEADING = 'One word per idea';
export const ANCHOR = 'one-word-per-idea';
export const KEY = `${CANVAS}#${ANCHOR}`;
export const LIMIT = 16_384;
export const NAME = 'pack';
export const FIXTURE = 'zorvanthic ledger';
const COMMAND_TIMEOUT = 900_000;
const AT_ONCE = 4;

export function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  return { ...env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', ...extra };
}
const IDENTITY = { GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
export function git(cwd, args, { allowFail = false } = {}) {
  const r = spawnSync('git', args, { cwd, env: cleanEnv(IDENTITY), encoding: 'utf8', maxBuffer: 1 << 30 });
  if (r.status !== 0 && !allowFail) throw new Error(`git ${args[0]} failed in ${cwd === CHECKOUT ? 'the checkout' : 'a scratch copy'}: ${String(r.stderr).trim()}`);
  return r;
}

export function makeCopy(t, { plant } = {}) {
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3417-')));
  t.after(() => rmSync(sandbox, { recursive: true, force: true }));
  const repo = join(sandbox, 'repo');
  const files = git(CHECKOUT, ['ls-files', '-z', '-co', '--exclude-standard']).stdout.split('\0').filter(Boolean);
  for (const file of files) {
    const from = join(CHECKOUT, file);
    if (!existsSync(from) || !statSync(from).isFile()) continue;
    mkdirSync(dirname(join(repo, file)), { recursive: true });
    copyFileSync(from, join(repo, file), constants.COPYFILE_FICLONE);
  }
  const origin = git(CHECKOUT, ['remote', 'get-url', 'origin'], { allowFail: true }).stdout?.trim();
  git(repo, ['init', '-q', '-b', 'change']);
  git(repo, ['remote', 'add', 'origin', origin || 'https://github.com/windoliver/deepbuild.git']);
  for (const dir of ['home', 'tmp', 'cache', 'config']) mkdirSync(join(sandbox, dir));
  if (plant) plant(repo);
  commit(repo, 'base');
  git(repo, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  return { sandbox, repo };
}

export function commit(repo, message) {
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '--allow-empty', '--no-verify', '--no-gpg-sign', '-m', message]);
}

export const read = (root, path) => readFileSync(join(root, path), 'utf8');
export const write = (root, path, text) => writeFileSync(join(root, path), text);

const cells = (line) => line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());
const plainName = (cell) => cell.replace(/[`*_]/g, '').trim().toLowerCase();
const isSeparator = (line) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);

export function section(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^##\\s+${HEADING}\\s*$`).test(l));
  if (start < 0) return { lines, start, end: start, headings: [], rows: [] };
  let end = lines.length;
  let fence;
  const headings = [{ line: start, text: HEADING }];
  for (let i = start + 1; i < lines.length; i++) {
    const mark = lines[i].match(/^ {0,3}(`{3,}|~{3,})/);
    if (mark) fence = fence ? undefined : mark[1];
    if (fence) continue;
    const h = lines[i].match(/^ {0,3}(#{1,6})\s+(.*?)\s*$/);
    if (!h) continue;
    if (h[1].length <= 2) { end = i; break; }
    headings.push({ line: i, text: h[2] });
  }
  const rows = [];
  let header = null;
  for (let i = start + 1; i < end; i++) {
    const line = lines[i];
    if (!line.trim().startsWith('|')) { header = null; continue; }
    if (isSeparator(line)) continue;
    if (isSeparator(lines[i + 1] ?? '')) { header = cells(line).map((c) => c.toLowerCase()); continue; }
    if (!header) continue;
    const c = cells(line);
    const at = (col) => { const k = header.indexOf(col); return k < 0 ? undefined : c[k]; };
    const heading = [...headings].reverse().find((h) => h.line < i);
    rows.push({ line: i, name: plainName(c[0] ?? ''), means: at('means'), never: at('never call it'), why: at('why'), width: header.length, heading });
  }
  return { lines, start, end, headings, rows };
}

export const packRows = (text) => section(text).rows.filter((r) => r.name === NAME);

export function headingSizes(repo) {
  const program = `const { DOCS, outline } = await import(${JSON.stringify(pathToFileURL(join(repo, 'scripts', 'doc-links.mjs')).href)});
const { statSync } = await import('node:fs');
const out = {};
for (const doc of DOCS) { const { headings } = outline(doc); const end = statSync(doc).size; headings.forEach(({ id, offset }, i) => { out[doc + '#' + id] = (headings[i + 1]?.offset ?? end) - offset; }); }
console.log(JSON.stringify(out));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', program], { cwd: repo, env: cleanEnv(), encoding: 'utf8', timeout: 300_000 });
  try { return JSON.parse(r.stdout.trim().split('\n').at(-1)); } catch { throw new Error(`could not read heading sizes through the copy's scripts/doc-links.mjs: ${r.stderr}`); }
}

export function anchorOf(repo, lineIndex) {
  const program = `const { outline } = await import(${JSON.stringify(pathToFileURL(join(repo, 'scripts', 'doc-links.mjs')).href)});
const { readFileSync } = await import('node:fs');
const text = readFileSync(${JSON.stringify(CANVAS)}, 'utf8');
const at = Buffer.byteLength(text.split('\\n').slice(0, ${lineIndex}).join('\\n')) + (${lineIndex} ? 1 : 0);
const { headings } = outline(${JSON.stringify(CANVAS)});
console.log(JSON.stringify(headings.filter((h) => h.offset <= at).at(-1)?.id ?? null));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', program], { cwd: repo, env: cleanEnv(), encoding: 'utf8', timeout: 300_000 });
  return JSON.parse(r.stdout.trim().split('\n').at(-1) || 'null');
}

export function settleCeilings(repo, before) {
  const after = headingSizes(repo);
  const ceilings = JSON.parse(read(repo, CEILINGS));
  for (const [key, size] of Object.entries(after)) {
    if (before[key] === size) continue;
    if (size > LIMIT) ceilings[key] = size;
    else delete ceilings[key];
  }
  write(repo, CEILINGS, `${JSON.stringify(Object.fromEntries(Object.entries(ceilings).sort(([a], [b]) => a.localeCompare(b))), null, 2)}\n`);
}

export function plantRows(repo, change) {
  const before = headingSizes(repo);
  const text = read(repo, CANVAS);
  const s = section(text);
  const lines = change(s);
  write(repo, CANVAS, lines.join('\n'));
  settleCeilings(repo, before);
}

export function fixtureRow(width, name, means, never, why) {
  const c = [name, means, never, why];
  while (c.length < width) c.push('fixture');
  return `| ${c.slice(0, Math.max(width, 4)).join(' | ')} |`;
}

export function laneEnv(sandbox) {
  const env = cleanEnv();
  for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GH_HOST', 'GH_REPO', 'DEEP_PREFLIGHT', 'DEEP_OPEN_ISSUES']) delete env[key];
  return {
    ...env,
    PATH: [dirname(process.execPath), env.PATH].join(delimiter),
    HOME: join(sandbox, 'home'),
    TMPDIR: join(sandbox, 'tmp'),
    XDG_CACHE_HOME: join(sandbox, 'cache'),
    XDG_CONFIG_HOME: join(sandbox, 'config'),
    GH_CONFIG_DIR: join(sandbox, 'config', 'gh'),
  };
}

const isNode = (program) => /^node(\.exe)?$/.test(basename(String(program)));

export function laneCommands(repo, lane, env) {
  const program = `const { checks } = await import(${JSON.stringify(pathToFileURL(join(repo, 'scripts', 'lanes.mjs')).href)});
const lane = checks.find((l) => l.name === ${JSON.stringify(lane)});
console.log(JSON.stringify(lane ? lane.commands : null));`;
  const listed = spawnSync(process.execPath, ['--input-type=module', '-e', program], { cwd: repo, env, encoding: 'utf8', timeout: 300_000 });
  let commands = null;
  try { commands = JSON.parse(listed.stdout.trim().split('\n').at(-1)); } catch {}
  if (!Array.isArray(commands) || !commands.length) return { missing: `scripts/lanes.mjs lists no "${lane}" lane with commands: ${listed.stderr.trim()}` };
  return { commands: commands.filter(([command]) => isNode(command)).map(([, ...args]) => args) };
}

export const runOne = (repo, env, args) => new Promise((resolve) => {
  const child = spawn(process.execPath, args, { cwd: repo, env, timeout: COMMAND_TIMEOUT, killSignal: 'SIGKILL' });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  child.on('error', (e) => { output += `\n${e.message}\n`; });
  child.on('close', (code, signal) => {
    if (signal) output += `\nSTOPPED after ${COMMAND_TIMEOUT / 1000} s or by ${signal}\n`;
    resolve({ name: args.join(' '), status: code ?? 1, lines: output.split('\n').filter((l) => l.trim()).map((l) => l.replaceAll(repo, '<copy>')) });
  });
});

export async function runLane(repo, env, lane) {
  const { commands, missing } = laneCommands(repo, lane, env);
  if (missing) return { missing, runs: [] };
  const runs = new Array(commands.length);
  let next = 0;
  const worker = async () => { while (next < commands.length) { const i = next++; runs[i] = await runOne(repo, env, commands[i]); } };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, commands.length) }, worker));
  return { runs };
}

export const runLintLane = (repo, env) => runLane(repo, env, 'lint');

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const names = (line, name) => new RegExp(`(?<![\\p{L}\\p{N}_-])${escape(name)}(?![\\p{L}\\p{N}_-])`, 'iu').test(line);
export const namesList = (line) => names(line, HEADING) || names(line, ANCHOR);

const shape = (line) => line.replace(/\d+/g, '#');
export function newFailingLines(lane, control, test) {
  const seen = new Set(control.runs.flatMap((r) => r.lines.map((l) => `${r.name}\0${shape(l)}`)));
  return lane.runs.filter((r) => r.status !== 0).flatMap((r) => r.lines.filter((l) => test(l) && !seen.has(`${r.name}\0${shape(l)}`)).map((l) => `${r.name}: ${l}`));
}

export function summary(lane) {
  if (lane.missing) return lane.missing;
  return lane.runs.map((r) => `${r.status === 0 ? 'ok  ' : `exit ${r.status}`} ${r.name}${r.status === 0 ? '' : `\n      ${r.lines.slice(-4).join('\n      ').replaceAll(CHECKOUT, '<checkout>')}`}`).join('\n');
}

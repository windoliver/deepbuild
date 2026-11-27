import { spawn, spawnSync } from 'node:child_process';
import { constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const BASE = 'b134dd38f';
export const LANE = 'lint';
export const GLOSSARY = 'GLOSSARY.md';
export const AGENTS = 'AGENTS.md';
export const PLAIN_WORDS = 'contracts/plain-words.json';
export const DESIGN = 'docs/technical-design.md';
export const CANVAS = 'docs/canvas-primitives.md';
export const TERM = 'Zorvanthic ledger';
const COMMAND_TIMEOUT = 300_000;
const AT_ONCE = 6;

export function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  return { ...env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', ...extra };
}
const IDENTITY = { GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
function git(cwd, args, { allowFail = false } = {}) {
  const r = spawnSync('git', args, { cwd, env: cleanEnv(IDENTITY), encoding: 'utf8', maxBuffer: 1 << 30 });
  if (r.status !== 0 && !allowFail) throw new Error(`git ${args[0]} failed in ${cwd === CHECKOUT ? 'the checkout' : 'a scratch copy'}: ${String(r.stderr).trim()}`);
  return r;
}

export const checkoutFile = (path) => (existsSync(join(CHECKOUT, path)) ? readFileSync(join(CHECKOUT, path), 'utf8') : undefined);

export function makeCopy(t) {
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3412-')));
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
  commit(repo, 'base');
  git(repo, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  return { sandbox, repo };
}

export function commit(repo, message) {
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '--allow-empty', '--no-verify', '--no-gpg-sign', '-m', message]);
}

export function plantFile(repo, path, text) {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), text);
}

export const startingGlossary = () => checkoutFile(GLOSSARY) ?? readFileSync(new URL('./draft-glossary.txt', import.meta.url), 'utf8');

export function withEntries(glossary, entries) {
  const lines = glossary.split('\n');
  const groups = lines.flatMap((line, i) => (/^###\s/.test(line) ? [i] : []));
  const block = [...entries.join('\n\n').split('\n'), ''];
  if (groups.length < 2) return `${glossary.replace(/\n*$/, '\n\n')}${block.join('\n')}`;
  lines.splice(groups[1], 0, ...block);
  return lines.join('\n');
}

export function plantGlossary(repo, entries, message) {
  plantFile(repo, GLOSSARY, withEntries(startingGlossary(), entries));
  commit(repo, message);
}

export function laneEnv(sandbox) {
  const env = cleanEnv();
  for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GH_HOST', 'GH_REPO', 'DEEP_PREFLIGHT']) delete env[key];
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

export async function runLintLane(repo, env) {
  const program = `const { checks } = await import(${JSON.stringify(pathToFileURL(join(repo, 'scripts', 'lanes.mjs')).href)});
const lane = checks.find((l) => l.name === ${JSON.stringify(LANE)});
console.log(JSON.stringify(lane ? lane.commands : null));`;
  const listed = spawnSync(process.execPath, ['--input-type=module', '-e', program], { cwd: repo, env, encoding: 'utf8', timeout: 120_000 });
  let commands = null;
  try { commands = JSON.parse(listed.stdout.trim().split('\n').at(-1)); } catch {}
  if (!Array.isArray(commands) || !commands.length) return { missing: `scripts/lanes.mjs lists no "${LANE}" lane with commands: ${listed.stderr.trim()}`, runs: [] };
  const queue = commands.filter(([command]) => isNode(command)).map(([, ...args]) => args);
  const runs = new Array(queue.length);
  let next = 0;
  const one = (args) => new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: repo, env, timeout: COMMAND_TIMEOUT, killSignal: 'SIGKILL' });
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    child.on('error', (e) => { output += `\n${e.message}\n`; });
    child.on('close', (code, signal) => {
      if (signal) output += `\nSTOPPED after ${COMMAND_TIMEOUT / 1000} s or by ${signal}\n`;
      resolve({ name: args.join(' '), status: code ?? 1, lines: output.split('\n').filter((l) => l.trim()) });
    });
  });
  const worker = async () => { while (next < queue.length) { const i = next++; runs[i] = await one(queue[i]); } };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, queue.length) }, worker));
  return { runs };
}

export const failingLines = (lane, test) => lane.runs.filter((r) => r.status !== 0).flatMap((r) => r.lines.filter(test).map((l) => `${r.name}: ${l}`));

export async function plantedRun(t, entries, message) {
  const { sandbox, repo } = makeCopy(t);
  plantGlossary(repo, entries, message);
  const lane = await runLintLane(repo, laneEnv(sandbox));
  return { lane, named: failingLines(lane, (line) => names(line, TERM)) };
}

export function summary(lane) {
  if (lane.missing) return lane.missing;
  return lane.runs.map((r) => `${r.status === 0 ? 'ok  ' : `exit ${r.status}`} ${r.name}${r.status === 0 ? '' : `\n      ${r.lines.slice(-4).join('\n      ').replaceAll(CHECKOUT, '<checkout>')}`}`).join('\n');
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const names = (line, name) => new RegExp(`(?<![\\p{L}\\p{N}_-])${escape(name)}(?![\\p{L}\\p{N}_-])`, 'iu').test(line);

export function seenWords(root) {
  const plain = Object.values(JSON.parse(readFileSync(join(root, PLAIN_WORDS), 'utf8')).words);
  const design = readFileSync(join(root, DESIGN), 'utf8');
  const section = design.split(/^### States people see\s*$/m)[1]?.split(/^#{1,3} /m)[0] ?? '';
  const states = [...section.matchAll(/^\| ([^|]+?) \|/gm)].map((m) => m[1].trim()).filter((w) => !/^(Word on every surface|-+)$/.test(w));
  return { plain, states };
}

export const LIST_NAMES = { plain: ['plain-words.json'], states: ['States people see', 'states-people-see'] };

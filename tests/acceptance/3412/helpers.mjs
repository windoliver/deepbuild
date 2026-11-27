// Helpers for #3412's acceptance tests: scratch copies of the checkout with their own git history, the issue's draft
// GLOSSARY.md, planted entries, and one run of the lint lane's node commands as the copy's own scripts/lanes.mjs lists
// them. The copy approach follows tests/acceptance/3533/helpers.mjs. Node built-ins only; the checkout is never written.
import { spawn, spawnSync } from 'node:child_process';
import { constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
/** The base commit this suite was written at. */
export const BASE = 'b134dd38f';
export const LANE = 'lint';
export const GLOSSARY = 'GLOSSARY.md';
export const AGENTS = 'AGENTS.md';
export const PLAIN_WORDS = 'contracts/plain-words.json';
export const DESIGN = 'docs/technical-design.md';
export const CANVAS = 'docs/canvas-primitives.md';
/** An invented term no list, doc or product holds; every plant uses it, so a line naming it can only be about a plant. */
export const TERM = 'Zorvanthic ledger';
const COMMAND_TIMEOUT = 300_000;
/** Lane commands run this many at a time: they only read the copy, and one after another a lane run took 6 min. */
const AT_ONCE = 6;

// Git with none of the caller's repository, config, hooks or signing.
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

/** A file of the checkout, or undefined when it isn't there. */
export const checkoutFile = (path) => (existsSync(join(CHECKOUT, path)) ? readFileSync(join(CHECKOUT, path), 'utf8') : undefined);

/**
 * A sandbox under the OS temp folder, removed after the test: `repo/` holds the checkout's working tree (tracked files
 * and untracked ones git doesn't ignore; never .git), with a fresh `git init`, the checkout's origin URL as origin, and
 * everything committed as the base with origin/main pointing at it, so a later commit is the change.
 */
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

/** Commits everything in a copy as one more commit of the change. */
export function commit(repo, message) {
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '--allow-empty', '--no-verify', '--no-gpg-sign', '-m', message]);
}

/** Writes a file into a copy. */
export function plantFile(repo, path, text) {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), text);
}

/**
 * The glossary a plant starts from: the checkout's GLOSSARY.md when it has one, else the issue's draft, so a plant
 * never fails only because the file is missing.
 */
export const startingGlossary = () => checkoutFile(GLOSSARY) ?? readFileSync(new URL('./draft-glossary.txt', import.meta.url), 'utf8');

/**
 * The glossary with entries inserted in the middle of its groups: before its second `### ` group heading (after the
 * first group's last entry), or at its end when it has fewer than two.
 */
export function withEntries(glossary, entries) {
  const lines = glossary.split('\n');
  const groups = lines.flatMap((line, i) => (/^###\s/.test(line) ? [i] : []));
  const block = [...entries.join('\n\n').split('\n'), ''];
  if (groups.length < 2) return `${glossary.replace(/\n*$/, '\n\n')}${block.join('\n')}`;
  lines.splice(groups[1], 0, ...block);
  return lines.join('\n');
}

/** Plants a glossary holding these entries, and commits it as the change. */
export function plantGlossary(repo, entries, message) {
  plantFile(repo, GLOSSARY, withEntries(startingGlossary(), entries));
  commit(repo, message);
}

/** The sandboxed environment of a lane run: HOME, TMPDIR and XDG in the sandbox, no GitHub token. */
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

/** Whether a lane command runs node: its program is node, as lanes.mjs writes it (process.execPath) or by name. */
const isNode = (program) => /^node(\.exe)?$/.test(basename(String(program)));

/**
 * Runs the node commands of the lint lane, as the copy's own scripts/lanes.mjs lists them, in the copy, each one
 * whatever the others did, AT_ONCE at a time (cargo's commands can't read Markdown and are left out). Resolves to each
 * command, in the lane's order, with its exit status and output lines, or `missing` when the copy lists no such lane.
 */
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

/** The lines of failing commands (exit status not 0) that pass `test`, each as `<command>: <line>`. */
export const failingLines = (lane, test) => lane.runs.filter((r) => r.status !== 0).flatMap((r) => r.lines.filter(test).map((l) => `${r.name}: ${l}`));

/** Plants these entries into a copy, runs the lint lane's node commands, and returns the failing lines naming TERM. */
export async function plantedRun(t, entries, message) {
  const { sandbox, repo } = makeCopy(t);
  plantGlossary(repo, entries, message);
  const lane = await runLintLane(repo, laneEnv(sandbox));
  return { lane, named: failingLines(lane, (line) => names(line, TERM)) };
}

/** A short account of a lane run, for assertion messages. */
export function summary(lane) {
  if (lane.missing) return lane.missing;
  return lane.runs.map((r) => `${r.status === 0 ? 'ok  ' : `exit ${r.status}`} ${r.name}${r.status === 0 ? '' : `\n      ${r.lines.slice(-4).join('\n      ').replaceAll(CHECKOUT, '<checkout>')}`}`).join('\n');
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whether a line names a word or name whole, not inside a longer one; case is ignored. */
export const names = (line, name) => new RegExp(`(?<![\\p{L}\\p{N}_-])${escape(name)}(?![\\p{L}\\p{N}_-])`, 'iu').test(line);

/** The words a person sees: the plain words of contracts/plain-words.json, and the words of States people see. */
export function seenWords(root) {
  const plain = Object.values(JSON.parse(readFileSync(join(root, PLAIN_WORDS), 'utf8')).words);
  const design = readFileSync(join(root, DESIGN), 'utf8');
  const section = design.split(/^### States people see\s*$/m)[1]?.split(/^#{1,3} /m)[0] ?? '';
  const states = [...section.matchAll(/^\| ([^|]+?) \|/gm)].map((m) => m[1].trim()).filter((w) => !/^(Word on every surface|-+)$/.test(w));
  return { plain, states };
}

/** The names a line may use for each list: the file for the plain words, the section for the state words. */
export const LIST_NAMES = { plain: ['plain-words.json'], states: ['States people see', 'states-people-see'] };

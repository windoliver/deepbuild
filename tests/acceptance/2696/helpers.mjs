// #2696 (blind): what the suite's files share. The built files under packages/*/dist of a tree, the characters above
// U+00FF in them, the merge base built once in a scratch folder beside a like-shaped copy of this checkout's build,
// and the processes and folders the suite starts and removes. README.md says what each surface is and why.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { constants, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
export const NODE = process.execPath;
export const MIN = 60_000;
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One character above U+00FF, an astral one read whole. */
export const HIGH = /[^\u0000-ÿ]/u;
export const HIGH_ALL = /[^\u0000-ÿ]/gu;
export const codePoint = (char) => `U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;

// ---- Folders and processes this suite made. Stopped by PID only, never by name or port.
const made = [];
const owned = new Set();
/** A scratch folder under the system's temp folder, removed by cleanup(). */
export function scratch(prefix = 'deep-2696-') {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  made.push(dir);
  return dir;
}
/** A short folder under /tmp for a home: a Unix socket's path must fit in 104 bytes on macOS. */
export function shortTemp() {
  const dir = realpathSync(mkdtempSync('/tmp/d2696-'));
  made.push(dir);
  return dir;
}
export function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}
/** Stops every process the suite started that still runs (SIGTERM, then SIGKILL after 5 s) and removes its folders. */
export async function cleanup() {
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 5000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** The environment a child gets: no runner context, so a child's own node never reports to this file's runner. */
export function childEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key === 'NODE_TEST_CONTEXT' || key === 'NODE_OPTIONS' || key === 'NODE_V8_COVERAGE' || key.startsWith('DEEP_')) delete env[key];
  env.PATH = `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`;
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

/** Runs a command to its end, its output kept; one that outlasts `timeoutMs` is stopped by its PID. */
export function run(command, args, { cwd = REPO, env = childEnv(), timeoutMs = 2 * MIN, input } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    owned.add(child.pid);
    let stdout = '', stderr = '', timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d) => (stderr += d));
    if (input !== undefined) child.stdin.end(input);
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.on('error', (error) => { clearTimeout(timer); owned.delete(child.pid); resolve({ code: null, signal: null, stdout, stderr: `${stderr}${error.message}`, timedOut }); });
    child.on('close', (code, signal) => { clearTimeout(timer); owned.delete(child.pid); resolve({ code, signal, stdout, stderr, timedOut }); });
  });
}
export const shown = (ran, max = 1500) => `exit ${ran.timedOut ? 'none (stopped at its time limit)' : ran.code ?? ran.signal}; ${`${ran.stdout}\n${ran.stderr}`.trim().slice(-max)}`;

// ---- Built files: every file under packages/<package>/dist of a tree, by its path from the tree's root.
function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.isFile()) out.push(path);
  }
  return out;
}
const decoder = new TextDecoder('utf-8', { fatal: true });
/** A file's text, or null when its bytes are no UTF-8 text (a compiled helper). */
export function textOf(file) {
  try {
    return decoder.decode(readFileSync(file));
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}
/** The packages of a tree that hold a dist folder, in name order. */
export const builtPackages = (root) => readdirSync(join(root, 'packages')).sort().filter((name) => existsSync(join(root, 'packages', name, 'dist')));
/** Every built file of a tree, in path order: its path from the root and its text (null for a binary). */
export function builtFiles(root) {
  return builtPackages(root).flatMap((name) => walk(join(root, 'packages', name, 'dist'), [])).map((file) => ({ path: file.slice(root.length + 1), text: textOf(file) }));
}
/** The first character above U+00FF of a text, with its line (from 1), or null. */
export function firstHigh(text) {
  const found = HIGH.exec(text);
  if (!found) return null;
  return { line: text.slice(0, found.index).split('\n').length, char: found[0] };
}
/** The built text files of a tree that hold a character above U+00FF, each with the line of its first. */
export const highFiles = (root) => builtFiles(root).flatMap(({ path, text }) => {
  const first = text === null ? null : firstHigh(text);
  return first ? [{ path, ...first }] : [];
});
export const where = ({ path, line, char }) => `${path}:${line} (${codePoint(char)})`;
/** A line count as an editor's and a stack trace's: one more than the file's line feeds. */
export const lineCount = (text) => text.split('\n').length;

// ---- The merge base, built once a file, beside a copy of this checkout's build laid out the same way.
const firstLine = (text) => String(text ?? '').split('\n').map((line) => line.trim()).find(Boolean) ?? '';
/** The merge base with origin/main: HEAD itself in a checkout that sits on main. */
export function mergeBase() {
  const ran = spawnSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8', env: childEnv() });
  if (ran.status !== 0) throw Error(`BLOCKED: no merge base with origin/main: ${firstLine(ran.stderr || ran.error?.message)}`);
  return ran.stdout.trim();
}
/** A node_modules for a scratch tree: this checkout's installed packages by link, its own workspace packages by their relative links. */
function linkModules(tree) {
  const from = join(REPO, 'node_modules');
  mkdirSync(join(tree, 'node_modules'));
  for (const name of readdirSync(from)) {
    const source = join(from, name), target = join(tree, 'node_modules', name);
    if (name.startsWith('.') && name !== '.bin') continue;
    if (name.startsWith('@') && readdirSync(source).some((inner) => { const stat = lstatSync(join(source, inner)); return stat.isSymbolicLink() && readlinkSync(join(source, inner)).startsWith('../../packages/'); })) {
      mkdirSync(target);
      for (const inner of readdirSync(source)) {
        const link = lstatSync(join(source, inner)).isSymbolicLink() ? readlinkSync(join(source, inner)) : null;
        if (link?.startsWith('../../packages/')) { if (existsSync(join(tree, link.slice('../../'.length)))) symlinkSync(link, join(target, inner)); }
        else symlinkSync(realpathSync(join(source, inner)), join(target, inner));
      }
    } else symlinkSync(realpathSync(source), target);
  }
}
/**
 * The hub starts only with the deep-hook its checkout built (packages/hub/src/paths.ts, deepHook), and the lanes put
 * one in a copy's target/debug/ for a test that names the hub. Both trees get this checkout's, the newer of its
 * release and debug builds as the hub itself picks, so the two hubs run the same programs.
 */
function placeBinaries(tree) {
  for (const name of ['deep-hook', 'deep-show']) {
    const built = ['release', 'debug'].map((profile) => join(REPO, 'target', profile, name)).filter((file) => existsSync(file)).sort((a, b) => lstatSync(b).mtimeMs - lstatSync(a).mtimeMs)[0];
    if (!built) continue;
    mkdirSync(join(tree, 'target', 'debug'), { recursive: true });
    cpSync(built, join(tree, 'target', 'debug', name), { mode: constants.COPYFILE_FICLONE });
  }
}

/** What neither tree needs of the repository: its tests, its design and its reports, which no package's build or start reads. */
const LEFT_OUT = ['tests', 'docs', 'reports'];

/** The repository's root entries at `sha`, less those left out. */
function rootNames(sha) {
  const listed = spawnSync('git', ['ls-tree', '--name-only', sha], { cwd: REPO, encoding: 'utf8', env: childEnv() });
  const names = listed.stdout.split('\n').filter((name) => name && !LEFT_OUT.includes(name));
  if (listed.status !== 0 || !names.includes('packages')) throw Error(`BLOCKED: git ls-tree ${sha} failed: ${firstLine(listed.stderr || listed.error?.message)}`);
  return names;
}
/**
 * A copy of this checkout as it stands in the new folder `to`, its builds with it: the root entries the merge base
 * has, never its installed packages or Cargo's output, then a node_modules and the hub's programs. Nothing in it
 * links back into this checkout but installed packages, so a build there writes there.
 */
export function copyCheckout(to, names = rootNames(mergeBase())) {
  mkdirSync(to);
  for (const name of names) {
    if (!existsSync(join(REPO, name))) continue;
    cpSync(join(REPO, name), join(to, name), { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE, filter: (source) => !['node_modules', 'target'].some((part) => source.slice(REPO.length).split('/').includes(part)) });
  }
  linkModules(to);
  placeBinaries(to);
  return to;
}
/** This checkout is installed and built, or the suite has nothing to read. */
export function needBuilt() {
  if (!existsSync(join(REPO, 'node_modules')) || !builtPackages(REPO).length) throw Error('BLOCKED: this checkout is not installed and built (npm ci, npm run build --workspaces)');
}

let both;
/**
 * `base`: the merge base from `git archive`, built there with `npm run build --workspaces`.
 * `head`: this checkout as it is built now, copied. Both lie in one scratch folder under names of one length, with
 * the same node_modules and the same deep-hook, and neither has a .git, so a module can't tell which it is in.
 * Built once a test file, on first use.
 */
export function trees() {
  both ??= (async () => {
    needBuilt();
    const sha = mergeBase();
    const folder = scratch('deep-2696-trees-');
    const base = join(folder, 'base'), head = join(folder, 'head');
    const names = rootNames(sha);
    mkdirSync(base);
    const archived = spawnSync('sh', ['-c', 'root=$1; sha=$2; to=$3; shift 3; git -C "$root" archive "$sha" -- "$@" | tar -xf - -C "$to"', 'sh', REPO, sha, base, ...names], { encoding: 'utf8', env: childEnv(), maxBuffer: 1 << 28 });
    if (archived.status !== 0 || !existsSync(join(base, 'packages'))) throw Error(`BLOCKED: git archive ${sha} failed: ${firstLine(archived.stderr || archived.error?.message)}`);
    linkModules(base);
    placeBinaries(base);
    copyCheckout(head, names);
    const started = Date.now();
    const built = await run('npm', ['run', 'build', '--workspaces'], { cwd: base, timeoutMs: 15 * MIN });
    if (built.code !== 0) throw Error(`BLOCKED: the merge base ${sha.slice(0, 9)} did not build in ${base}: ${shown(built)}`);
    return { sha, base, head, buildMs: Date.now() - started };
  })();
  return both;
}

// ---- IDs, as #16's helpers make them.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function base32(value, length) {
  let s = '';
  for (let i = 0; i < length; i++) { s = CROCKFORD[Number(value & 31n)] + s; value >>= 5n; }
  return s;
}
export const ulid = (ms = Date.now()) => base32(BigInt(ms), 10) + base32(BigInt(`0x${randomBytes(10).toString('hex')}`), 16);

/** Writes a file with its folders. */
export function put(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}
/** A long-lived child of the suite's, owned until it exits. */
export function start(command, args, options) {
  const child = spawn(command, args, options);
  owned.add(child.pid);
  child.once('exit', () => owned.delete(child.pid));
  return child;
}

// ---- #16's 30-day record, and a hub started on it (tests/acceptance/16/budgets.test.ts, AC12: seedHistory and its start).
const DAY = 86_400_000;
/** 30 days of heavy use in a hub's ledger, through the record: 20 sessions a day of ten turns, 90,600 events. */
export async function seedHistory(root, days = 30) {
  const { openRecord } = await import(new URL('../../../packages/record/dist/index.js', import.meta.url).href);
  mkdirSync(root, { recursive: true });
  const end = Date.now() - 60_000;
  let now = end - days * DAY;
  const record = await openRecord({ path: join(root, 'ledger.db'), now: () => now });
  const conn = (session) => ({ writer: 'hook', actor: 'you', scope: 'you', session, agent: 'claude-code' });
  let n = 0, events = 0;
  const seq = (ms) => (BigInt(ms) * 1_000_000n + BigInt(++n % 1_000_000)).toString();
  for (let d = 0; d < days; d++) {
    const dayStart = end - (days - d) * DAY;
    for (let s = 0; s < 20; s++) {
      const session = ulid(dayStart);
      let at = dayStart + s * 600_000;
      now = at;
      const pending = [record.append(conn(session), { v: 1, id: ulid(at), kind: 'session.start', ts: at, data: { agent: 'claude-code', worktree: '~/src/shop', branch: 'main', thread: session } })];
      for (let t = 0; t < 10; t++) {
        at += 1000;
        pending.push(record.append(conn(session), { v: 1, id: ulid(at), kind: 'user.ask', ts: at, seq: seq(at), data: { msg: t, text: 'run the tests and fix what fails', tasks: [], from: 'person' } }));
        for (let k = 0; k < 13; k++) {
          at += 1000;
          pending.push(record.append(conn(session), { v: 1, id: ulid(at), kind: k % 2 === 0 ? 'tool.before' : 'tool.after', ts: at, seq: seq(at), data: { kind: 'shell', paths: [], command: `npm test -- src/${k}.test.ts` } }));
        }
        at += 1000;
        pending.push(record.append(conn(session), { v: 1, id: ulid(at), kind: 'agent.stop', subject: `session:${session}`, ts: at, seq: seq(at), data: { turn: t + 1, did_work: true } }));
      }
      await Promise.all(pending);
      events += pending.length;
    }
  }
  await record.close();
  return events;
}

const PRELOAD = fileURLToPath(new URL('./heap-preload.mjs', import.meta.url));
/** The hub's start comes to rest before its heap is read: #16 AC12 waits as long before it calls the hub idle. */
export const SETTLE_MS = 15_000;
/**
 * One reading: `deep hub run` of the tree's own build, on a home that holds a copy of the seeded root; SETTLE_MS after
 * its ready line the thread that loaded the core makes two full collections and writes its heap (heap-preload.mjs).
 * The hub is stopped by its PID and the home removed. Returns the core thread's heapUsed, in bytes.
 */
export async function coreHeap(tree, seeded) {
  const folder = shortTemp(), home = join(folder, 'h');
  cpSync(seeded, join(home, '.deepbuild'), { recursive: true });
  const out = join(folder, 'heap'), go = join(folder, 'go');
  const hub = start(NODE, [join(tree, 'packages/cli/dist/main.js'), 'hub', 'run'], { cwd: tree, stdio: ['ignore', 'pipe', 'pipe'],
    env: childEnv({ HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), LC_ALL: 'C', NODE_OPTIONS: `--import=${PRELOAD}`, DEEP_TEST_2696_HEAP: out, DEEP_TEST_2696_GO: go }) });
  let stdout = '', stderr = '';
  hub.stdout.setEncoding('utf8').on('data', (d) => (stdout += d));
  hub.stderr.setEncoding('utf8').on('data', (d) => (stderr += d));
  const exited = new Promise((resolve) => hub.once('exit', (code, signal) => resolve({ code, signal })));
  try {
    const ready = () => { try { return stdout.includes('\n') && JSON.parse(stdout.split('\n')[0]).ready === true; } catch { return false; } };
    const deadline = Date.now() + 3 * MIN;
    while (!ready()) {
      if (hub.exitCode !== null || hub.signalCode !== null || Date.now() > deadline) throw Error(`BLOCKED: the hub of ${tree} gave no ready line (${hub.exitCode === null ? 'within 3 minutes' : `exit ${hub.exitCode}`}): ${stderr.slice(-1500)}`);
      await sleep(50);
    }
    await sleep(SETTLE_MS);
    writeFileSync(go, '');
    const written = () => readdirSync(folder).filter((name) => /^heap\.\d+$/.test(name));
    const until = Date.now() + 2 * MIN;
    while (!written().length) {
      if (hub.exitCode !== null || Date.now() > until) throw Error(`BLOCKED: no thread of the hub of ${tree} wrote its heap: ${stderr.slice(-1500)}`);
      await sleep(100);
    }
    // Every thread saw the word within its 250 ms step: a second thread that loaded the core would have written by now.
    await sleep(1000);
    const files = written();
    if (files.length !== 1) throw Error(`BLOCKED: ${files.length} threads of the hub loaded the core and wrote a heap (${files.join(', ')}); the reading takes one`);
    return JSON.parse(readFileSync(join(folder, files[0]), 'utf8')).heapUsed;
  } finally {
    if (hub.exitCode === null && hub.signalCode === null) {
      hub.kill('SIGTERM');
      const hard = setTimeout(() => hub.kill('SIGKILL'), 60_000);
      await exited;
      clearTimeout(hard);
    }
    rmSync(folder, { recursive: true, force: true });
  }
}

// ---- The messages of a built file: every string its text writes, as the engine reads it.
const engine = createContext({});
const TAG = '((pieces) => ({ cooked: [...pieces], raw: [...pieces.raw] }))';
/** A template's pieces, cooked and raw, read by the engine from the template's own text with each `${…}` emptied. */
function pieces(template) {
  if (ts.isNoSubstitutionTemplateLiteral(template)) return runInContext(`${TAG}${template.getText()}`, engine);
  const texts = [template.head.getText().slice(1, -2), ...template.templateSpans.map(({ literal }) => literal.getText().slice(1, literal.kind === ts.SyntaxKind.TemplateTail ? -1 : -2))];
  return runInContext(`${TAG}\`${texts.join('${0}')}\``, engine);
}
const mayHold = (text) => HIGH.test(text) || text.includes('\\');
/**
 * Every message of a built JavaScript file that holds a character above U+00FF, in the file's order: a string
 * literal's value, a template's cooked pieces (and its raw ones when it is tagged, as String.raw's is), and a
 * property or other name. Each is read by the engine from the literal's own text, so an escape counts as what it means.
 */
export function messagesOf(path, text) {
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const found = [];
  const add = (node, kind, value) => {
    if (HIGH.test(JSON.stringify(value))) found.push({ line: file.getLineAndCharacterOfPosition(node.getStart()).line + 1, kind, value });
  };
  const visit = (node) => {
    if (ts.isTaggedTemplateExpression(node)) {
      if (mayHold(node.template.getText())) add(node, 'tagged template', pieces(node.template));
      visit(node.tag);
      if (ts.isTemplateExpression(node.template)) for (const span of node.template.templateSpans) visit(span.expression);
    } else if (ts.isTemplateExpression(node)) {
      if (mayHold(node.getText())) add(node, 'template', pieces(node).cooked);
      for (const span of node.templateSpans) visit(span.expression);
    } else if (ts.isNoSubstitutionTemplateLiteral(node)) {
      if (mayHold(node.getText())) add(node, 'string', pieces(node).cooked[0]);
    } else if (ts.isStringLiteral(node)) {
      if (mayHold(node.getText())) add(node, 'string', runInContext(node.getText(), engine));
    } else if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
      add(node, 'name', node.text);
    } else ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** The package the suite's new source file and its planted built file go to: one built by `tsc -p tsconfig.json` alone. */
export const PACKAGE = 'verdicts';

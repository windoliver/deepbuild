// Helpers for #3547's acceptance tests (README). A sandbox with a HOME of its own, so ~/deepbuild-shards is the test's
// and never the machine's; a scratch git repository; a run that claims shards, at its smallest: one node process that
// calls claimShards(root, want, say) of this checkout's scripts/shards.mjs as scripts/affected.mjs calls it, prints each
// line as affected.mjs prints it, holds what it was given for as long as its test says and gives it back; the shards a
// test starts from, made by that same script and aged; and what the folder holds afterwards. Nothing here imports the
// code under test or writes a lock: the script is reached by running it, by a path relative to this file, and read
// from outside, through what a run is given, what it prints and what it leaves. Written here, imported from no suite.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, lutimesSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
/** The script under test: this checkout's, so a planted twin's checkout runs its own. */
const SCRIPT = join(CHECKOUT, 'scripts/shards.mjs');
// The home folder of whoever runs the suite, which no message may hold.
const HOME = homedir();

const HOUR_MS = 3_600_000;
/** "Four days before" and "an hour before", as ages in milliseconds. */
export const FOUR_DAYS = 96 * HOUR_MS;
export const AN_HOUR = HOUR_MS;
/** How long one step of a run (its start, a claim, its end) is given on a loaded machine: a claim takes about a second. */
export const STEP_MS = 60_000;
/** Each test's own limit, far past its steps: a step that hangs fails at its own limit first, with its reason. */
export const TEST = { timeout: 240_000 };

// What a run's process is not given from the suite's own environment: a preload, the test runner's marker, and any
// repository git was pointed at, so git reads the scratch repository alone.
const ENV_OUT = ['NODE_OPTIONS', 'NODE_TEST_CONTEXT'];

// The run: `node run.mjs <root>`, told each step over the channel node gives a child process.
//   { claim: <n>, date }   claims n shards and answers { given: [<dir>, ...] }; `date`, when set, is the date git
//                          records in a shard this claim makes or uses (README, Aging)
//   { release: [<dir>] }   gives those shards back, or with `true` all it holds, and answers { released: [...] }
//   { end: true }          leaves the channel; the process ends once nothing of its own is left to do
// Nothing but the script's own lines goes to its output.
const RUN = (script) => `import { claimShards } from ${JSON.stringify(pathToFileURL(script).href)};

const [root] = process.argv.slice(2);
const held = [];
let last = Promise.resolve();

async function step(message) {
  if (message.claim !== undefined) {
    for (const name of ['GIT_AUTHOR_DATE', 'GIT_COMMITTER_DATE']) {
      if (message.date) process.env[name] = message.date;
      else delete process.env[name];
    }
    const got = await claimShards(root, message.claim, (line) => console.log(line));
    held.push(...got);
    return { given: got.map(({ dir }) => dir) };
  }
  if (message.release !== undefined) {
    const mine = held.filter(({ dir }) => message.release === true || message.release.includes(dir));
    for (const shard of mine) {
      shard.release();
      held.splice(held.indexOf(shard), 1);
    }
    return { released: mine.map(({ dir }) => dir) };
  }
  if (message.end) return process.disconnect(), null;
  throw Error('no step in ' + JSON.stringify(message));
}

process.on('message', (message) => {
  last = last.then(() => step(message)).then((answer) => { if (answer) process.send(answer); }, (error) => {
    process.send({ error: String(error?.stack ?? error) });
    process.exitCode = 1;
    process.disconnect();
  });
});
process.send({ ready: true });
`;

// The scratch repository's files: committed, then one untracked file git doesn't ignore, and the folders it does.
const COMMITTED = {
  '.gitignore': 'node_modules/\ndist/\ntarget/\n',
  'committed.txt': 'committed bytes\n',
  'package.json': '{"name":"fixture-3547","private":true,"workspaces":["packages/*"]}\n',
  'package-lock.json': '{"name":"fixture-3547","lockfileVersion":3,"packages":{}}\n',
  'packages/p/package.json': '{"name":"@fixture-3547/p","version":"0.0.0","private":true}\n',
  'packages/p/src/index.mjs': 'export const value = 1;\n',
  'src/one.txt': 'one\n',
  'src/deep/two.txt': 'two\n',
};
const UNCOMMITTED = {
  'untracked.txt': 'untracked bytes\n',
  'node_modules/dep/index.js': 'module.exports = 1;\n',
  'packages/p/dist/main.js': 'console.log("built");\n',
  'target/debug/worktree-build': 'worktree target bytes\n',
};
/** The worktree's files a shard made its tree holds: git's listing with the untracked file, the modules and the build. */
const HELD = [...Object.keys(COMMITTED), 'untracked.txt', 'node_modules/dep/index.js', 'packages/p/dist/main.js'];

const put = (folder, files) => {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
  }
};

/**
 * A sandbox removed after the test: a HOME (so the shards are <sandbox>/user/deepbuild-shards), a TMPDIR, the disk
 * floor at 0 as #2574's suite has it, and a scratch git repository with one commit, an untracked file, node_modules/,
 * a package's dist/ and target/. After the test every run still going is stopped, by the process group it was started
 * as, its own PID; nothing is stopped by name or port.
 */
export function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3547-')));
  // The HOME's folder is named `user`: the secrets lint reads `/home/<name>/` in a line as a home path.
  const home = join(dir, 'user'), tmp = join(dir, 'tmp'), root = join(dir, 'root');
  for (const folder of [home, tmp, root]) mkdirSync(folder);
  const env = { ...process.env, HOME: home, TMPDIR: tmp, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), DEEP_TEST_SHARD_FLOOR: '0', GIT_CONFIG_NOSYSTEM: '1' };
  for (const name of Object.keys(env)) if (ENV_OUT.includes(name) || (name.startsWith('GIT_') && name !== 'GIT_CONFIG_NOSYSTEM')) delete env[name];
  const box = { dir, home, tmp, root, env, folder: join(home, 'deepbuild-shards'), driver: join(dir, 'run.mjs'), runs: [] };
  t.after(() => {
    // A negative pid signals the group a run was started as; a run that has ended has no group of ours left.
    for (const { child } of box.runs) if (child.exitCode === null && child.signalCode === null && child.pid > 1) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    // A run killed a moment before may still be leaving its folders.
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });
  writeFileSync(box.driver, RUN(SCRIPT));
  // The HOME has a git identity of its own, so what git notes in a shard names no person of the machine.
  writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = Fixture\n\temail = fixture@example.invalid\n');
  put(root, COMMITTED);
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: root, env, encoding: 'utf8', stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'fixture');
  put(root, UNCOMMITTED);
  // The tree a shard is made: HEAD with the untracked file, written through an index of the sandbox's own.
  const index = join(tmp, 'fixture-index');
  copyFileSync(join(root, '.git/index'), index);
  const own = { cwd: root, env: { ...env, GIT_INDEX_FILE: index }, encoding: 'utf8', stdio: 'pipe' };
  execFileSync('git', ['add', '-A'], own);
  box.tree = execFileSync('git', ['write-tree'], own).trim();
  rmSync(index);
  return box;
}

/** `text` as a message may hold it: the test's HOME and the home folder as ~, the sandbox as <sandbox>, this checkout as <checkout>. */
export const redact = (box, text) => [[box.home, '~'], [box.dir, '<sandbox>'], [CHECKOUT, '<checkout>'], [HOME, '~']].reduce((said, [path, as]) => (path.length > 1 ? said.replaceAll(path, as) : said), String(text));

/** Shard k's folder and its lock's, as the script names them. */
export const shardDir = (box, k) => join(box.folder, String(k));
export const lockDir = (box, k) => join(box.folder, `${k}.lock`);
/** What ~/deepbuild-shards holds, by name; nothing when it isn't there. */
export const listing = (box) => (existsSync(box.folder) ? readdirSync(box.folder).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })) : []);
/** The shards the folder holds: its entries named by a number alone. */
export const shardsIn = (box) => listing(box).filter((name) => /^\d+$/.test(name)).map(Number);
/** What the folder holds of shard k: its folder, its lock, or anything else named from its number, as `3.lock.gone.71`. */
export const leftOf = (box, k) => listing(box).filter((name) => new RegExp(`^${k}(?:\\D|$)`).test(name));

/** The moment `ago` milliseconds before now. */
const moment = (ago) => Date.now() - ago;
// deadline: each caller says what its look bounds.
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const LATE = Symbol('late');
/** `promise`, or at `ms` a failed assertion saying what was waited for, so a hang reads as a failure with its reason. */
export async function within(promise, ms, what) {
  let timer;
  // deadline: a step still going at its limit fails its test, naming the step.
  const late = new Promise((done) => { timer = setTimeout(() => done(LATE), ms); });
  try {
    const result = await Promise.race([promise, late]);
    if (result === LATE) assert.fail(`${what} did not end within ${ms / 1000} s`);
    return result;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Starts a run in the sandbox, in a process group of its own, and waits until it has loaded the script. `claim(n)`
 * resolves with the numbers of the shards it was given, lowest first; `release()` gives all or some back; `end()`
 * resolves with its exit once it has ended; `lines()` is what it printed so far, line by line. A step that fails, or a
 * process that ends before it answers, fails the test with the run's output.
 */
export async function start(box, name = 'the run') {
  const child = spawn(process.execPath, [box.driver, box.root], { env: box.env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], detached: true });
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const answers = [], waiting = [];
  child.on('message', (message) => (waiting.length ? waiting.shift()(message) : answers.push(message)));
  const exited = new Promise((done) => child.on('exit', (status, signal) => done({ status, signal })));
  const closed = new Promise((done) => child.on('close', done));
  const lines = () => stdout.split('\n').filter(Boolean);
  const shown = () => redact(box, `${name} printed:\n${stdout || '(nothing)'}\nand on stderr:\n${stderr || '(nothing)'}`);
  // The next answer, within `ms`; with no `ms` the caller bounds the wait itself (untilRemoval, which may stop the run).
  const answer = async (what, ms = STEP_MS) => {
    const coming = () => Promise.race([new Promise((done) => waiting.push(done)), exited.then((end) => ({ ended: end }))]);
    const next = answers.length ? answers.shift() : await (ms ? within(coming(), ms, `${name}: ${what}`) : coming());
    if (next.ended) assert.fail(`${name} ended (${next.ended.signal ?? `exit ${next.ended.status}`}) before ${what}\n${shown()}`);
    if (next.error) assert.fail(`${name}: ${what} failed in the script: ${redact(box, next.error)}\n${shown()}`);
    return next;
  };
  const run = {
    name, child, pid: child.pid, exited, lines, shown, stderr: () => stderr,
    /** The answer to a claim already asked, as claim() resolves it. */
    given: async (ms) => {
      const { given } = await answer('its claim of shards', ms);
      return given.map((dir) => {
        const k = Number(dir.slice(box.folder.length + 1));
        if (dir !== shardDir(box, k)) assert.fail(`${name} was given ${redact(box, dir)}, which is no shard of ~/deepbuild-shards\n${shown()}`);
        return k;
      }).sort((a, b) => a - b);
    },
    ask: (message) => {
      if (!child.connected) assert.fail(`${name} had ended before it could be told ${JSON.stringify(Object.keys(message))}\n${shown()}`);
      child.send(message);
    },
    claim: (want, date) => (run.ask({ claim: want, date }), run.given()),
    release: async (ks = true) => (run.ask({ release: ks === true ? true : ks.map((k) => shardDir(box, k)) }), (await answer('giving its shards back')).released),
    end: async () => {
      if (child.connected) child.send({ end: true });
      const end = await within(exited, STEP_MS, `${name}: its end`);
      // Its end is its exit; its last lines are read once its pipes close, which a process it left could hold open.
      let timer;
      // deadline: the pipes' close is waited for at most 2 s past the exit.
      await Promise.race([closed, new Promise((done) => { timer = setTimeout(done, 2_000); })]);
      clearTimeout(timer);
      return end;
    },
  };
  box.runs.push(run);
  await answer('loading scripts/shards.mjs');
  return run;
}

/**
 * A whole run that claims `want` shards: it is given them, gives them back and ends. Returns the shards it was given,
 * the lines it printed, its stderr and its exit.
 */
export async function claimOnce(box, want, name = 'the run') {
  const run = await start(box, name);
  const given = await run.claim(want);
  await run.release();
  const end = await run.end();
  return { given, lines: run.lines(), stderr: run.stderr(), shown: run.shown, ...end };
}

const stamp = (box, k) => join(shardDir(box, k), 'target/fixture-3547/made');
/** Whether shard k is still the folder the test started from, not one made again: its ignored stamp is there. */
export const original = (box, k) => existsSync(stamp(box, k));

// Every entry under a folder, deepest first, the folder itself last; links are not followed.
function under(top) {
  const found = [];
  const walk = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(path, entry.name));
      else found.push(join(path, entry.name));
    }
    found.push(path);
  };
  walk(top);
  return found;
}

/**
 * Ages shard k so it was last made a tree `ago` before now, by every time a file keeps: the modification and access
 * times of each file and folder of the shard, .git/packed-refs among them, and of its lock folder when it has one.
 * The dates git itself records in the shard were set when it was made (make, below).
 */
export function age(box, k, ago) {
  const at = new Date(moment(ago));
  for (const top of [shardDir(box, k), lockDir(box, k)].filter((path) => existsSync(path))) for (const path of under(top)) lutimesSync(path, at, at);
}

/**
 * The shards a test starts from, made by this checkout's own script: one run claims them one at a time, each while it
 * holds those before it, as runs side by side would, so shard k is made at ~/deepbuild-shards/<k> with room on the
 * disk for one shard at a time. `ages` gives each shard's age in order; `keep` names the shards the maker goes on
 * holding, so their locks name a live process, and the rest are given back. Each shard gets a stamp in its ignored
 * target/ and whatever `fill(k)` adds, and is then aged. Returns the maker when it holds a shard still; else it has ended.
 */
export async function make(box, ages, { keep = [], fill = () => {} } = {}) {
  const maker = await start(box, 'the run that made the shards');
  for (const [index, ago] of ages.entries()) {
    const k = index + 1;
    const given = await maker.claim(1, `${Math.floor(moment(ago) / 1000)} +0000`);
    assert.deepEqual(given, [k], `the fixture's shard ${k} could not be made: its maker asked for one shard while it held ${k - 1} and was given ${JSON.stringify(given)} (a shard needs 5 GB free on the disk)\n${maker.shown()}`);
  }
  const all = ages.map((ago, index) => index + 1);
  await maker.release(all.filter((k) => !keep.includes(k)));
  if (!keep.length) await maker.end();
  for (const k of all) {
    put(shardDir(box, k), { 'target/fixture-3547/made': `shard ${k} of the fixture\n` });
    fill(k);
    age(box, k, ages[k - 1]);
  }
  assert.deepEqual(shardsIn(box), all, `the fixture's shards were not all made: ~/deepbuild-shards holds ${listing(box).join(', ')}\n${maker.shown()}`);
  assert.deepEqual(listing(box).filter((name) => !/^\d+$/.test(name)), keep.map((k) => `${k}.lock`), `the fixture's locks are not those of the shards its maker holds (${keep.join(', ') || 'none'}): ~/deepbuild-shards holds ${listing(box).join(', ')}`);
  return keep.length ? maker : null;
}

/** Ages the worktree's own target/ as a shard is aged: it is no shard, so it stays whatever its age. */
export function ageTarget(box, ago) {
  const at = new Date(moment(ago));
  for (const path of under(join(box.root, 'target'))) lutimesSync(path, at, at);
}
/** What the worktree lacks of the files the fixture gave it, target/ among them: nothing when no run touched it. */
export function worktreeLacks(box) {
  return Object.entries({ ...COMMITTED, ...UNCOMMITTED }).filter(([path, text]) => {
    try { return readFileSync(join(box.root, path), 'utf8') !== text; } catch { return true; }
  }).map(([path]) => path);
}

/** What shard k's folder lacks of the worktree's tree: nothing when it holds .git and every file with the worktree's bytes. */
export function missingIn(box, k) {
  const dir = shardDir(box, k);
  if (!existsSync(dir)) return [`~/deepbuild-shards/${k} is not there`];
  const missing = existsSync(join(dir, '.git/HEAD')) ? [] : ['.git/HEAD'];
  for (const path of HELD) {
    let bytes = null;
    try { bytes = readFileSync(join(dir, path)); } catch {}
    if (!bytes) missing.push(path);
    else if (!bytes.equals(readFileSync(join(box.root, path)))) missing.push(`${path} (other bytes)`);
  }
  return missing;
}

/** Every file under a folder with its text: what a lock folder holds, whatever the script keeps in it; null when it isn't there. */
export const filesOf = (folder) => (existsSync(folder) ? Object.fromEntries(under(folder).filter((path) => !lstatSync(path).isDirectory()).map((path) => [path.slice(folder.length + 1), readFileSync(path, 'utf8')])) : null);

/** Empty folders in shard k's .git, `count` of them: a folder that takes a remover long enough to be seen at work. */
export function ballast(box, k, count) {
  const folder = join(shardDir(box, k), '.git/fixture-3547-ballast');
  mkdirSync(folder);
  for (let i = 0; i < count; i++) mkdirSync(join(folder, String(i)));
}
/** What is left at shard k's path of the folder the test started from: its stamp, its ballast, or nothing. */
export const remains = (box, k) => [original(box, k) && 'its stamp', existsSync(join(shardDir(box, k), '.git/fixture-3547-ballast')) && 'folders of its .git'].filter(Boolean);

// A copy-on-write clone of a file, by the cp the script itself clones with, and never a copy: false where the disk can't.
const clone = (from, to) => spawnSync('cp', [process.platform === 'darwin' ? '-c' : '--reflink=always', from, to], { stdio: 'ignore' }).status === 0;

/**
 * Build products in shard k's ignored target/, `units` files of one size: copy-on-write clones of one 128 MiB file
 * where the disk can clone, which du counts whole for each file and the disk holds once, as a real shard's files are;
 * else real copies of a file 64 times smaller. Returns a unit's bytes.
 */
export function weigh(box, k, units) {
  const source = join(box.dir, 'weight');
  if (!existsSync(source)) {
    writeFileSync(source, Buffer.alloc(1 << 21, 0x61));
    box.clones = clone(source, `${source}.clone`);
    rmSync(`${source}.clone`, { force: true });
    if (box.clones) for (let i = 1; i < 64; i++) writeFileSync(source, Buffer.alloc(1 << 21, 0x61), { flag: 'a' });
  }
  const folder = join(shardDir(box, k), 'target/debug/fixture-3547');
  mkdirSync(folder, { recursive: true });
  for (let i = 0; i < units; i++) {
    const to = join(folder, `weight-${i}`);
    if (!box.clones) copyFileSync(source, to);
    else if (!clone(source, to)) assert.fail(`the fixture could not clone a build product into shard ${k}, though the disk cloned one a moment before`);
  }
  return statSync(source).size;
}

/** The bytes `du` gives for shard k's folder: its 1,024-byte blocks, as `du -sk` counts them. */
export function duBytes(box, k) {
  const result = spawnSync('du', ['-sk', shardDir(box, k)], { encoding: 'utf8' });
  assert.equal(result.status, 0, `du could not read shard ${k}: ${result.stderr}`);
  return Number(result.stdout.trim().split(/\s+/)[0]) * 1024;
}

const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The line the merge base prints for shard k when a run is given it: made, or reused. */
export const baseLine = (box, k, how) => `SHARD ${k} ${shardDir(box, k)}: ${how}, at tree ${box.tree}${how === 'made' ? ', node_modules cloned' : ''}`;
/** Whether a line is one the merge base prints for shard k given to a run, made or reused. */
export const isBaseLine = (box, k, line) => new RegExp(`^SHARD ${k} ${escaped(shardDir(box, k))}: (?:made|reused), at tree [0-9a-f]{40,64}(?:, node_modules cloned)?$`).test(line);
/** A run's lines beyond those the merge base prints for the shards it was given. */
export const newLines = (box, lines, given) => lines.filter((line) => !given.some((k) => isBaseLine(box, k, line)));
/** How a run's line says shard k came to it: `made`, `reused`, or null when no line of the merge base's shape names it. */
export const howGiven = (box, lines, k) => lines.find((line) => isBaseLine(box, k, line))?.match(/: (made|reused), at tree /)[1] ?? null;

// A unit's bytes, by either reading where both are in use: 1.5G is du's 1.5 GiB and 1.5 GB is 1.5e9 bytes.
const UNIT = { b: [1], byte: [1], bytes: [1], k: [1e3, 2 ** 10], kb: [1e3, 2 ** 10], kib: [2 ** 10], m: [1e6, 2 ** 20], mb: [1e6, 2 ** 20], mib: [2 ** 20], g: [1e9, 2 ** 30], gb: [1e9, 2 ** 30], gib: [2 ** 30], t: [1e12, 2 ** 40], tb: [1e12, 2 ** 40], tib: [2 ** 40] };
/** The numbers a line holds, each { text, number, decimals, unit }: unit is a byte unit that follows it, lowercased, or ''. */
export function figures(line) {
  return [...line.matchAll(/(?<![\w.])(?<!\d[,_])(\d{1,3}(?:[,_]\d{3})+|\d+)(?:\.(\d+))?(?:[ \u00a0]?(bytes?|[kmgt]i?b|[kmgt]|b)(?!\w))?/gi)]
    .map(([text, whole, fraction = '', unit = '']) => ({ text, number: Number(`${whole.replace(/[,_]/g, '')}.${fraction || '0'}`), decimals: fraction.length, unit: unit.toLowerCase() }));
}
/**
 * The figure of a line that gives `bytes`: a number with a byte unit, or a bare whole number read as bytes, within
 * the last digit it prints or 3% of the bytes, whichever is more. Null when no figure does.
 */
export function bytesFigure(line, bytes) {
  for (const figure of figures(line)) {
    if (!figure.unit && figure.decimals) continue;
    for (const size of UNIT[figure.unit || 'b']) if (Math.abs(figure.number * size - bytes) <= Math.max(size / 10 ** figure.decimals, 0.03 * bytes)) return figure;
  }
  return null;
}
/** Whether a line holds `count` as a whole number of its own, with no byte unit. */
export const countFigure = (line, count) => figures(line).some((figure) => !figure.unit && !figure.decimals && figure.number === count);

// Each folder under shard k but the ballast's own, with the time it was last changed: removing an entry changes its folder's.
const foldersOf = (box, k) => under(shardDir(box, k)).filter((path) => !path.includes('/fixture-3547-ballast/') && lstatSync(path).isDirectory()).map((path) => [path, statSync(path).mtimeMs]);
const changed = (folders) => folders.some(([path, at]) => { try { return statSync(path).mtimeMs !== at; } catch { return true; } });
// The processes of the group a run was started as, zombies apart, each with its state.
const group = (pgid) => execFileSync('ps', ['-A', '-o', 'pid=,pgid=,stat='], { encoding: 'utf8', maxBuffer: 1 << 26 }).split('\n').map((line) => line.trim().split(/\s+/)).filter(([, of, stat]) => Number(of) === pgid && !stat.startsWith('Z'));

/**
 * A run that claims `want` shards, watched from before its start for the first entry to leave the folder of one of the
 * shards `ks`: at that moment its whole process group is stopped (SIGSTOP, by its own PID), so the removal stands still
 * half done for as long as the test looks. A run given its shards with nothing touched is told to give them back and
 * end, still watched. Returns the run, `touched` (the shard, or null when the run ended with none of them touched) and
 * `finish()`, which lets a stopped run go on, gives its shards back, ends it and returns what it was given and printed.
 */
export async function untilRemoval(box, want, ks, name = 'the run') {
  const watched = ks.map((k) => [k, foldersOf(box, k)]);
  const run = await start(box, name);
  let state = 'claiming', given = null, end = null, failed = null;
  // The claim's answer has no limit of its own: the run may stand stopped while the test looks. The watch below and
  // finish() bound it instead.
  const whole = (async () => {
    run.ask({ claim: want });
    given = await run.given(0);
    state = 'ending';
    await run.release();
    end = await run.end();
  })().catch((error) => { failed = error; }).finally(() => { state = 'ended'; });
  let touched = null;
  const limit = Date.now() + 2 * STEP_MS;
  for (;;) {
    const over = state === 'ended';
    touched = watched.find(([, folders]) => changed(folders))?.[0] ?? null;
    if (touched !== null || over) break;
    if (Date.now() > limit) assert.fail(`${name} neither took an entry out of shard ${ks.join(', ')} nor ended within ${(2 * STEP_MS) / 1000} s\n${run.shown()}`);
    await pause(2);
  }
  let stopped = false;
  if (touched !== null && state !== 'ended') {
    try {
      process.kill(-run.pid, 'SIGSTOP');
      stopped = true;
    } catch {}
  }
  const still = Date.now() + STEP_MS;
  while (stopped && group(run.pid).some(([, , stat]) => !stat.startsWith('T'))) {
    if (Date.now() > still) assert.fail(`${name}'s process group did not stop within ${STEP_MS / 1000} s of SIGSTOP`);
    await pause(20);
  }
  const finish = async () => {
    if (stopped) try { process.kill(-run.pid, 'SIGCONT'); } catch {}
    await within(whole, 2 * STEP_MS, `${name}: its end`);
    if (failed) throw failed;
    return { given, lines: run.lines(), stderr: run.stderr(), shown: run.shown, ...end };
  };
  return { run, touched, stopped, finish };
}

/** How many entries shard k's folder holds, at any depth; -1 when it changes under the count. */
export function entriesOf(box, k) {
  try {
    return existsSync(shardDir(box, k)) ? readdirSync(shardDir(box, k), { recursive: true }).length : 0;
  } catch {
    return -1;
  }
}
/** How shard k's folder stands against the entries it held (entriesOf, taken before): whole, partly removed, or gone. */
export const standing = (box, k, before) => {
  const now = entriesOf(box, k);
  return !existsSync(shardDir(box, k)) ? 'gone' : now < before ? `partly removed (${now < 0 ? 'fewer' : now} of its ${before} entries left)` : 'whole';
};

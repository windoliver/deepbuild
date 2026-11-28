import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTestFile } from '../../../scripts/proof-change.mjs';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const LONG = { timeout: 15 * 60_000 };
const READ = fileURLToPath(new URL('./lanes-read.mjs', import.meta.url));
const TEST_FILE = /\.test\.(?:mjs|js|ts)$/;
const LANE_JSON = /^tests\/acceptance\/[^/]+\/(?:[^/]+\/)?lane\.json$/;
const BY_HAND = 'skipped/by hand';

const gitIn = (root, ...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=deep', '-c', 'user.email=deep@example.invalid', ...args], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

export const gitHere = (...args) => gitIn(CHECKOUT, ...args);

export const mergeBase = (root = CHECKOUT) => gitIn(root, 'merge-base', 'HEAD', 'origin/main').trim();

export function scratchFolder(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3699-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export function placesOf(scripts, files, dir, cwd = CHECKOUT) {
  const list = join(dir, `files-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(list, JSON.stringify(files));
  const result = spawnSync(process.execPath, [READ, scripts, list], { cwd, encoding: 'utf8', timeout: 10 * 60_000, maxBuffer: 256 * 1024 * 1024 });
  assert.equal(result.status, 0, `the lanes of ${scripts} could not be read: exit ${result.status}\n${(result.stderr ?? '').slice(-4_000)}`);
  return JSON.parse(result.stdout);
}

export function mergeBaseScripts(dir, root = CHECKOUT) {
  const base = mergeBase(root);
  const tracked = gitIn(root, 'ls-tree', '-r', '--name-only', base).split('\n').filter(Boolean);
  const laneFolders = tracked.filter((path) => LANE_JSON.test(path)).map((path) => path.slice(0, -'lane.json'.length));
  const laneFiles = tracked.filter((path) => laneFolders.some((folder) => path.startsWith(folder)) && (path.endsWith('/lane.json') || TEST_FILE.test(path)));
  const before = join(dir, 'before');
  mkdirSync(before);
  const tar = join(dir, 'before.tar');
  gitIn(root, 'archive', '-o', tar, base, 'scripts', ...laneFiles.map((path) => `:(literal)${path}`));
  const unpacked = spawnSync('tar', ['-xf', tar, '-C', before], { encoding: 'utf8' });
  assert.equal(unpacked.status, 0, `the merge base's scripts/ could not be unpacked: ${unpacked.stderr}`);
  symlinkSync(join(CHECKOUT, 'node_modules'), join(before, 'node_modules'));
  return { scripts: join(before, 'scripts'), tracked };
}

const laneFilesOfCheckout = () => readdirSync(join(CHECKOUT, 'tests/acceptance'), { withFileTypes: true }).filter((folder) => folder.isDirectory()).flatMap((folder) => {
  const at = `tests/acceptance/${folder.name}`;
  const subfolders = readdirSync(join(CHECKOUT, at), { withFileTypes: true }).filter((sub) => sub.isDirectory()).map((sub) => `${at}/${sub.name}`);
  return [at, ...subfolders].map((entry) => `${entry}/lane.json`).filter((path) => statSync(join(CHECKOUT, path), { throwIfNoEntry: false })?.isFile());
});

const filesUnder = (root, folder) => readdirSync(join(root, folder), { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => relative(root, join(entry.parentPath ?? entry.path, entry.name)).split(sep).join('/'));

export function checkoutScriptsWith(dir, statements) {
  const after = join(dir, 'after');
  cpSync(join(CHECKOUT, 'scripts'), join(after, 'scripts'), { recursive: true });
  for (const lane of laneFilesOfCheckout()) {
    for (const path of [lane, ...filesUnder(CHECKOUT, dirname(lane)).filter((file) => TEST_FILE.test(file))]) {
      mkdirSync(dirname(join(after, path)), { recursive: true });
      cpSync(join(CHECKOUT, path), join(after, path));
    }
  }
  symlinkSync(join(CHECKOUT, 'node_modules'), join(after, 'node_modules'));
  appendFileSync(join(after, 'scripts/lanes-lists.mjs'), `\n${statements.join('\n')}\n`);
  return join(after, 'scripts');
}

export const listedIn = (list, file) => list.some((entry) => (entry.endsWith('/') ? file.startsWith(entry) : file === entry));
const runsByHand = (byHand, file) => listedIn(byHand, file) || (file.startsWith('tests/acceptance/') && /\.live\.test\./.test(file));

export const testFilesAt = (root, path) => {
  const stat = statSync(join(root, path), { throwIfNoEntry: false });
  if (!stat) return [];
  if (stat.isFile()) return isTestFile(path) ? [path] : [];
  return filesUnder(root, path).filter(isTestFile);
};

const within = (base, at) => {
  const rel = relative(base, at);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel) ? rel.split(sep).join('/') || '.' : null;
};

const targetOf = (root, target) => {
  const realRoot = realpathSync(root);
  const at = resolve(root, String(target));
  const real = existsSync(at) ? realpathSync(at) : resolve(realRoot, relative(root, at));
  const rel = within(root, at) ?? within(realRoot, at);
  return { rel, outside: rel === null || within(realRoot, real) === null };
};

const runsAt = (block) => block?.replace(/^(?:alone|parallel)\//, 'run/') ?? null;
export const coveredBy = (key, file) => key === file || (key.endsWith('/') && file.startsWith(key));
const redraftEntry = (redrafted, file) => Object.entries(redrafted).find(([key]) => coveredBy(key, file));

export function wrongMoves({ root = CHECKOUT, was, is, redrafted, byHand = [], deleted = [] }) {
  const gone = deleted.map((file) => ({ file, why: 'deleted', line: `${file}: deleted, and no criterion-level rule names the deletion` }));
  const moved = Object.keys(was).filter((file) => !deleted.includes(file) && runsAt(was[file]) !== runsAt(is[file])).map((file) => {
    const move = `${file}: ${was[file]} -> ${is[file]}`;
    if (is[file] !== BY_HAND) return { file, why: 'leaves its place', line: move };
    const entry = redraftEntry(redrafted, file);
    if (!entry) return { file, why: 'no redrafted entry', line: `${move}, with no redrafted entry` };
    const target = String(entry[1]);
    const { rel, outside } = targetOf(root, target);
    if (outside) return { file, why: 'redraft outside the checkout', line: `${move}, redrafted to ${target}, which is outside this checkout` };
    if (rel === '.' || rel === file || file.startsWith(`${rel}/`)) return { file, why: 'redraft is the original or holds it', line: `${move}, redrafted to ${target}, which is the original or a folder holding it` };
    if (!existsSync(join(root, rel))) return { file, why: 'redraft missing', line: `${move}, redrafted to ${target}, which this checkout does not hold` };
    const tests = testFilesAt(root, rel);
    if (!tests.length) return { file, why: 'redraft holds no test file', line: `${move}, redrafted to ${target}, which holds no test file` };
    if (tests.every((path) => runsByHand(byHand, path))) return { file, why: 'redraft holds only by-hand test files', line: `${move}, redrafted to ${target}, whose test files all run by hand` };
    return null;
  }).filter(Boolean);
  return [...gone, ...moved];
}

export function movesOfCheckout(t, root = CHECKOUT) {
  const dir = scratchFolder(t);
  const { scripts, tracked } = mergeBaseScripts(dir, root);
  const before = placesOf(scripts, tracked.filter((path) => TEST_FILE.test(path)), dir, root);
  const deleted = before.tests.filter((path) => !existsSync(join(root, path)));
  const files = before.tests.filter((path) => !deleted.includes(path));
  const is = placesOf(join(root, 'scripts'), files, dir, root);
  return { was: before.blocks, is: is.blocks, lists: is.lists, redrafted: is.redrafted, deleted, moves: wrongMoves({ root, was: before.blocks, is: is.blocks, redrafted: is.redrafted, byHand: is.lists.byHand, deleted }) };
}

let checkoutReading = null;
export function movesSinceMergeBase(t) {
  checkoutReading ??= movesOfCheckout(t);
  return checkoutReading;
}

export function movesOfPlant(t, files, statements) {
  const dir = scratchFolder(t);
  const was = placesOf(join(CHECKOUT, 'scripts'), files, dir).blocks;
  const is = placesOf(checkoutScriptsWith(dir, statements), files, dir);
  return { was, is: is.blocks, moves: wrongMoves({ was, is: is.blocks, redrafted: is.redrafted, byHand: is.lists.byHand }) };
}

export function scratchRepo(t, files) {
  const root = join(scratchFolder(t), 'repo');
  mkdirSync(root);
  cpSync(join(CHECKOUT, 'scripts'), join(root, 'scripts'), { recursive: true });
  symlinkSync(join(CHECKOUT, 'node_modules'), join(root, 'node_modules'));
  writeFileSync(join(root, '.gitignore'), 'node_modules\n');
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  gitIn(root, 'init', '-q');
  gitIn(root, 'add', '-A');
  gitIn(root, 'commit', '-q', '-m', 'the merge base');
  gitIn(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  return {
    root,
    deletes(path) {
      gitIn(root, 'rm', '-q', path);
      gitIn(root, 'commit', '-q', '-m', `deletes ${path}`);
    },
  };
}

export function unlistedSuite({ lists, redrafted }) {
  const entries = [...Object.values(lists).flat(), ...Object.keys(redrafted)];
  const free = (folder) => !entries.some((entry) => entry === folder || entry.startsWith(`${folder}/`) || (entry.endsWith('/') && `${folder}/`.startsWith(entry)));
  const folder = Array.from({ length: 10_000 }, (_, at) => `tests/acceptance/${3699 + at}`).find(free);
  assert.ok(folder, 'the lane lists name every folder tests/acceptance/3699 to 13698, so no scratch suite is free of them');
  return folder;
}

export const sendsToByHand = (file, target) => [
  ...(target === undefined ? [] : [`Object.assign(redrafted, { ${JSON.stringify(file)}: ${JSON.stringify(target)} });`]),
  `byHand.push(${JSON.stringify(file)});`,
];

export const shownLines = (moves) => moves.map(({ line }) => `  ${line}`).join('\n');

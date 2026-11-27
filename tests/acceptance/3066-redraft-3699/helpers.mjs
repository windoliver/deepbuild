import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECKOUT, LONG, gitHere } from '../3066/helpers.mjs';

export { CHECKOUT, LONG, gitHere };

const READ = fileURLToPath(new URL('./lanes-read.mjs', import.meta.url));
const TEST_FILE = /\.test\.(?:mjs|js|ts)$/;
const LANE_JSON = /^tests\/acceptance\/[^/]+\/(?:[^/]+\/)?lane\.json$/;
const BY_HAND = 'skipped/by hand';

export const mergeBase = () => gitHere('merge-base', 'HEAD', 'origin/main').trim();

export function scratchFolder(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3699-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export function placesOf(scripts, files, dir) {
  const list = join(dir, `files-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(list, JSON.stringify(files));
  const result = spawnSync(process.execPath, [READ, scripts, list], { cwd: CHECKOUT, encoding: 'utf8', timeout: 10 * 60_000, maxBuffer: 256 * 1024 * 1024 });
  assert.equal(result.status, 0, `the lanes of ${scripts} could not be read: exit ${result.status}\n${(result.stderr ?? '').slice(-4_000)}`);
  return JSON.parse(result.stdout);
}

export function mergeBaseScripts(dir) {
  const base = mergeBase();
  const tracked = gitHere('ls-tree', '-r', '--name-only', base).split('\n').filter(Boolean);
  const before = join(dir, 'before');
  mkdirSync(before);
  const tar = join(dir, 'before.tar');
  gitHere('archive', '-o', tar, base, 'scripts', ...tracked.filter((path) => LANE_JSON.test(path)));
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

export function checkoutScriptsWith(dir, statements) {
  const after = join(dir, 'after');
  cpSync(join(CHECKOUT, 'scripts'), join(after, 'scripts'), { recursive: true });
  for (const path of laneFilesOfCheckout()) {
    mkdirSync(dirname(join(after, path)), { recursive: true });
    cpSync(join(CHECKOUT, path), join(after, path));
  }
  symlinkSync(join(CHECKOUT, 'node_modules'), join(after, 'node_modules'));
  appendFileSync(join(after, 'scripts/lanes-lists.mjs'), `\n${statements.join('\n')}\n`);
  return join(after, 'scripts');
}

const holdsTestFile = (path) => {
  const stat = statSync(join(CHECKOUT, path), { throwIfNoEntry: false });
  if (!stat) return false;
  if (stat.isFile()) return TEST_FILE.test(path);
  return readdirSync(join(CHECKOUT, path), { recursive: true, withFileTypes: true }).some((entry) => entry.isFile() && TEST_FILE.test(entry.name));
};

const runsAt = (block) => block?.replace(/^(?:alone|parallel)\//, 'run/') ?? null;
const redraftEntry = (redrafted, file) => Object.entries(redrafted).find(([key]) => key === file || (key.endsWith('/') && file.startsWith(key)));

export function wrongMoves(was, is, redrafted) {
  return Object.keys(was).filter((file) => runsAt(was[file]) !== runsAt(is[file])).map((file) => {
    const move = `${file}: ${was[file]} -> ${is[file]}`;
    if (is[file] !== BY_HAND) return { file, why: 'leaves its place', line: move };
    const entry = redraftEntry(redrafted, file);
    if (!entry) return { file, why: 'no redrafted entry', line: `${move}, with no redrafted entry` };
    const target = String(entry[1]);
    if (!existsSync(join(CHECKOUT, target))) return { file, why: 'redraft missing', line: `${move}, redrafted to ${target}, which this checkout does not hold` };
    if (!holdsTestFile(target)) return { file, why: 'redraft holds no test file', line: `${move}, redrafted to ${target}, which holds no test file` };
    return null;
  }).filter(Boolean);
}

let checkoutReading = null;
export function movesSinceMergeBase(t) {
  if (checkoutReading) return checkoutReading;
  const dir = scratchFolder(t);
  const { scripts, tracked } = mergeBaseScripts(dir);
  const files = tracked.filter((path) => TEST_FILE.test(path) && existsSync(join(CHECKOUT, path)));
  const was = placesOf(scripts, files, dir).blocks;
  const is = placesOf(join(CHECKOUT, 'scripts'), files, dir);
  checkoutReading = { was, is: is.blocks, moves: wrongMoves(was, is.blocks, is.redrafted) };
  return checkoutReading;
}

export function movesOfPlant(t, files, statements) {
  const dir = scratchFolder(t);
  const was = placesOf(join(CHECKOUT, 'scripts'), files, dir).blocks;
  const is = placesOf(checkoutScriptsWith(dir, statements), files, dir);
  return { was, is: is.blocks, moves: wrongMoves(was, is.blocks, is.redrafted) };
}

export const sendsToByHand = (file, target) => [
  ...(target === undefined ? [] : [`Object.assign(redrafted, { ${JSON.stringify(file)}: ${JSON.stringify(target)} });`]),
  `byHand.push(${JSON.stringify(file)});`,
];

export const shownLines = (moves) => moves.map(({ line }) => `  ${line}`).join('\n');

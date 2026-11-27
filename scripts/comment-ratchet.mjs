import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { SOURCE, read } from './comment-source.mjs';
import { testPaths } from './lanes.mjs';

const CEILINGS = 'scripts/comment-ceilings.json';
const GENERATED = /@generated|auto-generated|do not edit/i;
const OUT = /(?:^|\/)vendor\/|^tests\/acceptance\//;
const glob = (pattern) => new RegExp(`^${pattern.split(/(\*\*\/|\/\*\*$|\*\*|\*)/).map((part) =>
  part === '**/' ? '(?:.*/)?' : part === '/**' ? '/.+' : part === '**' ? '.*' : part === '*' ? '[^/]*' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('')}$`);
const TESTS = testPaths.map(glob);
const MARKERS = [
  [/^\/\/\s*deadline:\s*\S/, (path) => TESTS.some((pattern) => pattern.test(path))],
  [/^\/\/\/?\s*cache:\s*(?:[^,]*,\s*)*(?:entries|bytes)\s+\S/, (path) => /^crates\/.*\.rs$/.test(path)],
  [/^\/\/ copy-exception: \S|^\/\/\s*blocking call:\s*\S/, (path) => /^crates\/deep-app\/src\/.*\.rs$/.test(path)],
  [/^\/\/ size-literal-exception: \S/, (path, trails) => trails && /^crates\/deep-app\/src\/.*\.rs$/.test(path)],
  [/^\/\/ color-literal-exception: \S/, (path, trails) => trails && /^crates\/deep-app\/(?:src\/.*\.rs|panels\/.*\.js)$/.test(path)],
];
const LICENSE = /\bCopyright (?:\(c\)|©|\d{4}|[A-Z])|\bLicensed under the\b|SPDX-License-Identifier:/;

const write = process.argv.includes('--write');
const root = fileURLToPath(new URL('../', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
const parse = (text, from) => {
  const ceilings = JSON.parse(text);
  if (!ceilings || typeof ceilings !== 'object' || Array.isArray(ceilings) || !Object.values(ceilings).every((n) => Number.isInteger(n) && n > 0)) throw Error(`${from} isn't an object of whole numbers above 0`);
  return ceilings;
};

function count(path, text) {
  const { comments } = read(path, text);
  if (!comments.length) return 0;
  const starts = [0];
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) starts.push(at + 1);
  let line = 0;
  const lineOf = (offset) => {
    while (line + 1 < starts.length && starts[line + 1] <= offset) line++;
    return line;
  };
  const commented = new Set();
  const coded = new Set();
  const kept = [];
  let code = 0;
  const codeTo = (end) => {
    for (const match of text.slice(code, end).matchAll(/\S/g)) coded.add(lineOf(code + match.index));
  };
  for (const [from, to] of comments) {
    codeTo(from);
    const first = lineOf(from);
    const last = lineOf(Math.max(from, to - 1));
    for (let at = first; at <= last; at++) commented.add(at);
    const body = text.slice(from, to);
    if (LICENSE.test(body) || MARKERS.some(([marker, read]) => marker.test(body) && read(path, coded.has(first)))) kept.push([first, last]);
    code = to;
  }
  codeTo(text.length);
  const alone = (at) => commented.has(at) && !coded.has(at);
  for (const [first, last] of kept) {
    let from = first;
    let to = last;
    while (alone(from - 1)) from--;
    while (alone(to + 1)) to++;
    for (let at = from; at <= to; at++) commented.delete(at);
  }
  return commented.size;
}

if (!isMainThread) {
  const counts = [];
  for (const path of workerData) {
    let text;
    try {
      text = readFileSync(join(root, path), 'utf8');
    } catch {
      continue;
    }
    if (GENERATED.test(text.split('\n', 5).join('\n'))) continue;
    try {
      counts.push([path, count(path, text)]);
    } catch (error) {
      throw Error(`${path} can't be read for its comments: ${error.message}`);
    }
  }
  parentPort.postMessage(counts);
  process.exit(0);
}

let ceilings;
try {
  ceilings = parse(readFileSync(join(root, CEILINGS), 'utf8'), CEILINGS);
} catch (error) {
  if (!write || error.code !== 'ENOENT') {
    console.log(`INVALID comments: ${CEILINGS} can't be read: ${error.message}\n  Fix: Restore ${CEILINGS}: a JSON object mapping each hand-written source file that holds comments to its count of comment lines.`);
    process.exit(1);
  }
  ceilings = {};
}
let base = null;
try {
  const at = git('merge-base', 'HEAD', 'origin/main').trim();
  if (git('ls-tree', '--name-only', at, '--', CEILINGS).trim()) base = parse(git('show', `${at}:${CEILINGS}`), `${CEILINGS} at the merge base`);
} catch {}
let listing;
try {
  listing = git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0');
} catch (error) {
  console.log(`BLOCKED comments: git can't list the files under ${root}: ${error.message.split('\n')[0]}\n  Fix: Run the ratchet in a git checkout, with git on PATH.`);
  process.exit(2);
}

const paths = listing.filter((path) => SOURCE.test(path) && !OUT.test(path)).sort();
const workers = Math.min(4, availableParallelism(), paths.length);
const shares = Array.from({ length: workers }, (_, share) => paths.filter((_, index) => index % workers === share));
let counts;
try {
  counts = Object.fromEntries((await Promise.all(shares.map((share) => new Promise((resolve, reject) => {
    new Worker(new URL(import.meta.url), { workerData: share }).once('message', resolve).once('error', reject).once('exit', () => reject(Error('a counting thread ended with no counts')));
  })))).flat().sort(([a], [b]) => (a < b ? -1 : 1)));
} catch (error) {
  console.log(`BLOCKED comments: ${error.message}\n  Fix: Make the file one its language's parser reads, then run the ratchet again.`);
  process.exit(2);
}

if (write) {
  const next = {};
  for (const [path, found] of Object.entries(counts)) {
    const most = base ? base[path] ?? 0 : found;
    const ceiling = Math.min(found, most);
    if (ceiling) next[path] = ceiling;
  }
  writeFileSync(join(root, CEILINGS), `${JSON.stringify(next, null, 2)}\n`);
  ceilings = next;
}

const out = [];
const fail = (line, fix) => out.push(`FAIL comments: ${line}\n  Fix: ${fix}`);
const MOVE = 'Remove the comment: say it in the code\'s names, or record a decision in docs/adr/ (docs/adr/0001).';
let total = 0;
for (const [path, found] of Object.entries(counts)) {
  total += found;
  const ceiling = ceilings[path] ?? 0;
  const bound = base ? Math.min(ceiling, base[path] ?? 0) : ceiling;
  if (found > bound) fail(`${path}: ${found} comment line${found === 1 ? '' : 's'}, over its ceiling of ${bound}${bound < ceiling ? ', the merge base\'s' : ''}`, `${MOVE} A ceiling never rises.`);
  else if (found < ceiling) fail(`${path}: ${found} comment line${found === 1 ? '' : 's'}, under its ceiling of ${ceiling}; lower it to ${found}`, `Run node scripts/comment-ratchet.mjs --write, which ${found ? `sets its ceiling in ${CEILINGS} to ${found}` : `removes its entry from ${CEILINGS}`}.`);
}
for (const [path, ceiling] of Object.entries(ceilings))
  if (!(path in counts)) fail(`${path}: not a hand-written source file the work tree holds, with a ceiling of ${ceiling}`, `Remove its entry from ${CEILINGS}, which node scripts/comment-ratchet.mjs --write does.`);

if (out.length) console.log(out.join('\n'));
else console.log(`PASS comments: ${Object.keys(counts).length} hand-written source files, ${Object.keys(ceilings).length} of them listed with ${total} comment line${total === 1 ? '' : 's'} in all, each at its ceiling${base ? '' : '; no ceilings at a merge base with origin/main to compare with'}`);
process.exitCode = out.length ? 1 : 0;

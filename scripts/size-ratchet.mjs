// The file-size ratchet (#1432; technical design: Repo guards), run by the lint lane. Each hand-written source file
// over 1,500 lines has a ceiling in scripts/size-ceilings.json, its size in lines. A file may shrink, and its ceiling
// drops with it in the same change; it never grows past its ceiling, and a ceiling never rises above the merge base's
// with origin/main, so a file new over 1,500 lines (no ceiling at the base) fails. Out of scope: generated files (a
// `@generated`, "auto-generated" or "do not edit" marker in their first five lines) and vendored code (a `vendor/`
// folder). Lines are lines of text, a last line without a newline counted, as the work tree holds them.
// One `FAIL size: <path>: <lines> lines, …` line per finding, or one PASS line; exit 1 on a finding.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIMIT = 1500;
const CEILINGS = 'scripts/size-ceilings.json';
const SOURCE = /\.(?:rs|ts|tsx|mts|cts|js|jsx|mjs|cjs|swift|py|wgsl|c|h|cc|cpp|m|mm|lean|sh)$/;
const GENERATED = /@generated|auto-generated|do not edit/i;

const root = fileURLToPath(new URL('../', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
const parse = (text, from) => {
  const ceilings = JSON.parse(text);
  if (!ceilings || typeof ceilings !== 'object' || Array.isArray(ceilings) || !Object.values(ceilings).every(Number.isInteger)) throw Error(`${from} isn't an object of whole numbers`);
  return ceilings;
};

let ceilings;
try {
  ceilings = parse(readFileSync(join(root, CEILINGS), 'utf8'), CEILINGS);
} catch (error) {
  console.log(`INVALID size: ${CEILINGS} can't be read: ${error.message}\n  Fix: Restore ${CEILINGS}: a JSON object mapping each hand-written source file over ${LIMIT} lines to its size in lines.`);
  process.exit(1);
}
// The base's ceilings, or null when there is no origin/main or the base predates the ratchet (its first ceilings).
let base = null;
try {
  const at = git('merge-base', 'HEAD', 'origin/main').trim();
  if (git('ls-tree', '--name-only', at, '--', CEILINGS).trim()) base = parse(git('show', `${at}:${CEILINGS}`), `${CEILINGS} at the merge base`);
} catch {}

const NEWLINE = 10;
const lineCount = (bytes) => {
  let count = 0;
  for (let at = bytes.indexOf(NEWLINE); at !== -1; at = bytes.indexOf(NEWLINE, at + 1)) count++;
  return bytes.length && bytes[bytes.length - 1] !== NEWLINE ? count + 1 : count;
};
const generated = (bytes) => {
  let end = 0;
  for (let line = 0; line < 5 && end < bytes.length; line++) {
    const next = bytes.indexOf(NEWLINE, end);
    end = next === -1 ? bytes.length : next + 1;
  }
  return GENERATED.test(bytes.subarray(0, end).toString('utf8'));
};

const findings = [];
const fail = (path, why, fix) => findings.push(`FAIL size: ${path}: ${why}\n  Fix: ${fix}`);
const sources = new Set(git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0').filter((path) => SOURCE.test(path) && !/(?:^|\/)vendor\//.test(path)));
let over = 0;
for (const path of sources) {
  let bytes;
  try {
    bytes = readFileSync(join(root, path));
  } catch {
    sources.delete(path); // deleted from the work tree, still in the index
    continue;
  }
  const ceiling = ceilings[path];
  // Fewer bytes than the limit can't hold more lines than it.
  if (ceiling === undefined && bytes.length <= LIMIT) continue;
  if (generated(bytes)) {
    if (ceiling !== undefined) fail(path, `generated, with a ceiling of ${ceiling}`, `Remove its entry from ${CEILINGS}: generated files are out of scope.`);
    continue;
  }
  const lines = lineCount(bytes);
  if (lines > LIMIT) over++;
  const was = base && (base[path] ?? LIMIT);
  if (ceiling === undefined) {
    if (lines > LIMIT) fail(path, `${lines} lines, over ${LIMIT} with no ceiling`, `Split the file to ${LIMIT} lines or fewer: a file new over ${LIMIT} lines gets no ceiling.`);
  } else if (lines > ceiling) fail(path, `${lines} lines, over its ceiling of ${ceiling}`, `Split or shrink the file to ${ceiling} lines or fewer: a ceiling never rises.`);
  else if (lines <= LIMIT) fail(path, `${lines} lines, at most ${LIMIT}, under its ceiling of ${ceiling}`, `Remove its entry from ${CEILINGS}.`);
  else if (lines < ceiling) fail(path, `${lines} lines, under its ceiling of ${ceiling}; lower it to ${lines}`, `Set its ceiling in ${CEILINGS} to ${lines}.`);
  else if (was !== null && ceiling > was) fail(path, `${lines} lines, its ceiling of ${ceiling} above the merge base's ${was}`, `Split or shrink the file to ${was} lines or fewer and set its ceiling to that: a ceiling never rises.`);
}
for (const [path, ceiling] of Object.entries(ceilings))
  if (!sources.has(path)) fail(path, `not a hand-written source file the work tree holds, with a ceiling of ${ceiling}`, `Remove its entry from ${CEILINGS}.`);

if (findings.length) {
  console.log(findings.join('\n'));
  process.exit(1);
}
console.log(`PASS size: ${over} hand-written source file${over === 1 ? '' : 's'} over ${LIMIT} lines, each at its ceiling${base ? '' : '; no ceilings at a merge base with origin/main to compare with'}`);

// The design docs' size ratchet (#2338), run by the lint lane: the rule scripts/size-ratchet.mjs holds for source
// files, held for the headings of the design docs, so a section stays readable on its own. A heading's own text is the
// bytes from its line to the next heading of any level (a line in fenced code is never a heading). Each heading whose
// own text is over 16 KB has a ceiling in scripts/doc-ceilings.json, keyed `<doc>#<anchor>` with the design links
// lane's anchors, its size in bytes. Own text may shrink, and its ceiling drops with it in the same change; it never
// grows past its ceiling, and a ceiling never rises above the merge base's with origin/main, so a heading new over the
// limit (no ceiling at the base) fails. One `FAIL doc-ceilings: …` line per finding, or one PASS line; exit 1 on a
// finding.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { DOCS, outline } from './doc-links.mjs';

const LIMIT = 16_384;
const CEILINGS = 'scripts/doc-ceilings.json';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
const parse = (text, from) => {
  const ceilings = JSON.parse(text);
  if (!ceilings || typeof ceilings !== 'object' || Array.isArray(ceilings) || !Object.values(ceilings).every(Number.isInteger)) throw Error(`${from} isn't an object of whole numbers`);
  return ceilings;
};
const bytes = (n) => n.toLocaleString('en-US');

let ceilings;
try {
  ceilings = parse(readFileSync(CEILINGS, 'utf8'), CEILINGS);
} catch (error) {
  console.log(`INVALID doc-ceilings: ${CEILINGS} can't be read: ${error.message}\n  Fix: Restore ${CEILINGS}: a JSON object mapping each design doc heading, as <doc>#<anchor>, whose own text is over ${bytes(LIMIT)} bytes to its size in bytes.`);
  process.exit(1);
}
// The base's ceilings, or null when there is no origin/main or the base predates this ratchet (its first ceilings).
let base = null;
try {
  const at = git('merge-base', 'HEAD', 'origin/main').trim();
  if (git('ls-tree', '--name-only', at, '--', CEILINGS).trim()) base = parse(git('show', `${at}:${CEILINGS}`), `${CEILINGS} at the merge base`);
} catch {}

const findings = [];
const fail = (key, why, fix) => findings.push(`FAIL doc-ceilings: ${key}: ${why}\n  Fix: ${fix}`);
const keys = new Set();
let read = 0;
let over = 0;
let largest = { key: '', size: -1 };
for (const doc of DOCS) {
  const { headings } = outline(doc);
  const end = statSync(doc).size;
  for (const [i, { id, offset }] of headings.entries()) {
    const key = `${doc}#${id}`;
    const size = (headings[i + 1]?.offset ?? end) - offset;
    keys.add(key);
    read++;
    if (size > largest.size) largest = { key, size };
    if (size > LIMIT) over++;
    const ceiling = ceilings[key];
    const was = base && (base[key] ?? LIMIT);
    if (ceiling === undefined) {
      if (size > LIMIT) fail(key, `${bytes(size)} bytes of its own text, over ${bytes(LIMIT)} with no ceiling`, `Split the section's text under subheadings or shorten it to ${bytes(LIMIT)} bytes or fewer: a heading new over the limit gets no ceiling.`);
    } else if (size > ceiling) fail(key, `${bytes(size)} bytes of its own text, over its ceiling of ${bytes(ceiling)}`, `Split or shorten its own text to ${bytes(ceiling)} bytes or fewer: a ceiling never rises.`);
    else if (size <= LIMIT) fail(key, `${bytes(size)} bytes of its own text, at most ${bytes(LIMIT)}, under its ceiling of ${bytes(ceiling)}`, `Remove its entry from ${CEILINGS}.`);
    else if (size < ceiling) fail(key, `${bytes(size)} bytes of its own text, under its ceiling of ${bytes(ceiling)}; lower it to ${bytes(size)}`, `Set its ceiling in ${CEILINGS} to ${size}.`);
    else if (was !== null && ceiling > was) fail(key, `${bytes(size)} bytes of its own text, its ceiling of ${bytes(ceiling)} above the merge base's ${bytes(was)}`, `Split or shorten its own text to ${bytes(was)} bytes or fewer and set its ceiling to that: a ceiling never rises.`);
  }
}
for (const [key, ceiling] of Object.entries(ceilings))
  if (!keys.has(key)) fail(key, `no heading of ${DOCS.join(' or ')} has this anchor, and it has a ceiling of ${bytes(ceiling)}`, `Remove its entry from ${CEILINGS}.`);

if (findings.length) {
  console.log(findings.join('\n'));
  process.exit(1);
}
if (!base) console.error(`doc-ceilings: no ${CEILINGS} at a merge base with origin/main to compare ceilings with`);
console.log(`PASS doc-ceilings: ${bytes(read)} headings read, ${over} over the limit of ${bytes(LIMIT)} bytes; the largest is ${largest.key}, ${bytes(largest.size)} bytes`);

#!/usr/bin/env node
// The lint lane's check of what a state reads as on a plain surface (#3495): contracts/plain-states.json, the one closed
// table, held to the design. Each word of the table under States people see has its row there and the table holds no
// other; and no sentence holds a word its state's row in the design says never to call it, or a word
// contracts/plain-words.json lists, found as the plain words lane finds one: whole, in any case, with a plural ending.
// Each sentence is also the English of a `hub.` entry of the app's table (crates/deep-app/copy/en.json), which is how
// the app draws it in another language. One `FAIL plain states: ...` line per finding, or `PASS plain states`; exit 1
// on a finding, 2 when a file it reads can't be read. `--table <file>` points it at another copy of the table.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const at = process.argv.indexOf('--table');
const file = at === -1 ? fileURLToPath(new URL('contracts/plain-states.json', root)) : process.argv[at + 1];
const blocked = (why) => { console.log(`BLOCKED plain states: ${why}`); process.exit(2); };
const read = (path, what) => { try { return readFileSync(path, 'utf8'); } catch (e) { return blocked(`${what} can't be read: ${e.message}`); } };
if (!file || file.startsWith('--')) blocked('--table takes a file');

// The design's table: the first one under States people see, a word and the words never to call it in each row.
const design = read(new URL('docs/technical-design.md', root), 'docs/technical-design.md');
const section = design.slice(design.indexOf('\n### States people see\n'));
const rows = section.slice(section.indexOf('\n| Word on every surface |')).split('\n').slice(3);
const never = new Map();
for (const line of rows) {
  if (!line.startsWith('|')) break;
  const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
  never.set(cells[0], (cells[3] ?? '').split(',').map((word) => word.trim()).filter(Boolean));
}
if (!never.size) blocked('docs/technical-design.md holds no table under States people see');
const listed = Object.keys(JSON.parse(read(new URL('contracts/plain-words.json', root), 'contracts/plain-words.json')).words);
const COPY = 'crates/deep-app/copy/en.json';
const drawn = new Set(Object.entries(JSON.parse(read(new URL(COPY, root), COPY))).filter(([key]) => key.startsWith('hub.')).map(([, english]) => english));

let states;
try { states = JSON.parse(read(file, file)).states; } catch (e) { blocked(`${file} isn't JSON: ${e.message}`); }
if (!states || typeof states !== 'object' || Array.isArray(states)) blocked(`${file} holds no states object`);

/** Whether `text` holds `word` whole, in any case, or with a plural ending (crates/deep-app/src/plain.rs: holds). */
function holds(text, word) {
  const [t, w] = [text.toLowerCase(), word.toLowerCase()];
  const joins = (c) => c !== undefined && /[a-z0-9]/.test(c);
  for (let i = t.indexOf(w); i !== -1; i = t.indexOf(w, i + 1)) {
    let rest = t.slice(i + w.length);
    for (const ending of ['es', 's']) if (rest.startsWith(ending) && !joins(rest[ending.length])) { rest = rest.slice(ending.length); break; }
    if (!joins(t[i - 1]) && !joins(rest[0])) return true;
  }
  return false;
}

const problems = [];
for (const word of never.keys()) if (!(word in states)) problems.push(`${word} has no row: each word of States people see has one, a sentence or null for a word that reads as it is`);
for (const [word, sentence] of Object.entries(states)) {
  if (!never.has(word)) { problems.push(`${word} is no word of States people see`); continue; }
  if (sentence === null) continue;
  if (typeof sentence !== 'string' || !sentence.trim()) { problems.push(`${word}'s row holds neither a sentence nor null`); continue; }
  for (const banned of never.get(word)) if (holds(sentence, banned)) problems.push(`${word}'s sentence "${sentence}" holds "${banned}", which States people see says never to call ${word}`);
  for (const plain of listed) if (holds(sentence, plain)) problems.push(`${word}'s sentence "${sentence}" holds "${plain}", a word contracts/plain-words.json lists`);
  if (!drawn.has(sentence)) problems.push(`${word}'s sentence "${sentence}" is the English of no hub. entry in ${COPY}, so the app can't draw it in another language`);
}
for (const problem of problems) console.log(`FAIL plain states: ${problem}`);
if (!problems.length) console.log(`PASS plain states: ${never.size} words of States people see, each with its row, ${Object.values(states).filter((s) => s !== null).length} with a sentence`);
process.exitCode = problems.length ? 1 : 0;

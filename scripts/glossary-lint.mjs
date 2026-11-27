import { existsSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOCS, anchors, prose, targets } from './doc-links.mjs';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const FILE = 'GLOSSARY.md';
const GROUPS = ['What you ask for', 'Sessions', 'Proving it done', 'Verdicts', 'Asks and answers', 'The record', 'Access', 'Layers'];
const STATES = 'States people see';
const PLAIN = 'contracts/plain-words.json';
const REPO = 'https://github.com/windoliver/deepbuild/blob/main/';

const findings = [];
const fail = (at, why, fix) => findings.push(`FAIL glossary: ${at}: ${why}\n  Fix: ${fix}`);
const finish = () => {
  for (const line of findings) console.log(line);
  process.exit(findings.length ? 1 : 0);
};
const seen = new Map();
const see = (word, list) => {
  const key = word.trim().toLowerCase();
  seen.set(key, [...new Set([...(seen.get(key) ?? []), list])]);
};
let rows = false;
for (const { line } of prose(readFileSync('docs/technical-design.md', 'utf8'))) {
  if (/^#{1,6}\s/.test(line)) rows = line.replace(/^#+\s+/, '').trim() === STATES;
  else if (rows && /^\|(?!\s*-)/.test(line)) {
    const word = line.split('|')[1].trim();
    if (word && word !== 'Word on every surface') see(word, `${STATES} (docs/technical-design.md#states-people-see)`);
  }
}
for (const word of Object.values(JSON.parse(readFileSync(PLAIN, 'utf8')).words)) see(word, PLAIN);

const OLD = { 'ask-task': 'task', 'unblock task': 'unblock ask', 'standing grant': 'standing rule', 'session run': 'attempt', 'lease grant': 'acquired lease' };
const PHRASE = new RegExp(`(?<![\\p{L}\\p{N}_-])(${Object.keys(OLD).join('|')})(s?)(?![\\p{L}\\p{N}_-])`, 'giu');
const ASK_DONE = /definition of done of (?:each |every |the |an? |that |this |its )?(?:open )?asks?(?![\p{L}\p{N}_-])|(?<![\p{L}\p{N}_-])asks?['’]s? definition of done/iu;
let worded = 0;
const word = (at, why, fix) => {
  worded += 1;
  fail(at, why, fix);
};
for (const doc of DOCS) {
  const lines = [...prose(readFileSync(doc, 'utf8'))];
  for (const { number, line } of lines) {
    const text = line.replace(/(`+).+?\1|<[^>]*>|\]\([^)]*\)/g, ' ');
    for (const [, phrase, plural] of text.matchAll(PHRASE)) {
      if (phrase.toLowerCase() === 'session run' && plural) continue;
      word(`${doc}:${number}`, `the prose says "${phrase}${plural}"`, `Say ${OLD[phrase.toLowerCase()]}, as GLOSSARY.md has it; inside code the name may stay.`);
    }
    if (ASK_DONE.test(text)) word(`${doc}:${number}`, 'the prose gives an ask a definition of done', 'Only a task has a definition of done: say task, as GLOSSARY.md has it.');
  }
  if (doc !== 'docs/technical-design.md') continue;
  const entry = (name) => {
    const start = lines.findIndex(({ line }) => line.trim() === `#### ${name}`);
    const end = lines.findIndex(({ line }, i) => i > start && /^#{1,4}\s/.test(line));
    return start < 0 ? [] : lines.slice(start + 1, end < 0 ? lines.length : end);
  };
  for (const { number, line } of entry('Check')) {
    if (/^\s*[-*]\s/.test(line) && /validity gate/i.test(line)) word(`${doc}:${number}`, 'the list of check kinds names the validity gate', 'Leave the validity gate to the Claim entry: it is the gate a claim passes before any check runs, not a check.');
  }
  if (!entry('Claim').some(({ line }) => /before any check runs, a validity gate/i.test(line))) {
    word(`${doc} #### Claim`, "the Claim entry doesn't say a validity gate runs before any check", 'Say in the Claim entry that before any check runs, a validity gate looks at the claim.');
  }
}
if (worded) console.log(`FAIL glossary: the design docs' prose holds ${worded} finding${worded === 1 ? '' : 's'} against GLOSSARY.md`);

if (!existsSync(FILE)) {
  fail(FILE, 'there is no glossary at the repo root', `Write ${FILE}: the real names in their eight groups, each a term in bold and one or two sentences.`);
  finish();
}
const lands = (target) => {
  const inRepo = target.startsWith(REPO);
  if (!inRepo && /^[a-z][\w+.-]*:/i.test(target)) return true;
  const [, path, anchor = ''] = (inRepo ? target.slice(REPO.length) : target).match(/^([^#?]*)(?:\?[^#]*)?(?:#(.*))?$/);
  const file = path ? posix.normalize(path) : FILE;
  if (!existsSync(file)) return false;
  let id = anchor;
  try {
    id = decodeURIComponent(anchor);
  } catch {}
  return !id || (file.endsWith('.md') && anchors(file).has(id));
};

const entries = [];
const groups = [];
let entry = null;
for (const { number, line } of prose(readFileSync(FILE, 'utf8'))) {
  const at = `${FILE}:${number}`;
  for (const target of targets(line)) {
    if (!lands(target)) fail(at, `the link ${target} lands nowhere`, 'Link to a file in the repo, and to a heading or anchor that file has.');
  }
  const group = line.match(/^###\s+(.*)$/);
  const term = line.match(/^\*\*(.+?)\*\*:\s*(.*)$/);
  if (/^#{1,6}\s/.test(line)) entry = null;
  if (group) groups.push({ at, name: group[1].trim() });
  if (term) entries.push(entry = { at, term: term[1].trim(), text: term[2].trim(), avoid: [] });
  else if (/^\s*\*\*/.test(line)) fail(at, `the bold line "${line.trim()}" isn't an entry`, 'Write each entry as **Term**: on its own line, its sentences on the next.');
  else if (!line.trim()) entry = entry && (entry.text || entry.avoid.length) ? null : entry;
  else if (entry && /^_Avoid_:/.test(line)) entry.avoid.push(...line.replace(/^_Avoid_:/, '').split(/[;,]/));
  else if (entry && entry.avoid.length) fail(at, `the term ${entry.term} has text after its Avoid line`, 'Put the sentences before the Avoid line, which ends the entry.');
  else if (entry) entry.text = `${entry.text} ${line.trim()}`.trim();
}

const named = groups.map(({ name }) => name);
if (named.join('\n') !== GROUPS.join('\n')) {
  fail(FILE, `its groups are ${named.length ? named.map((name) => `"${name}"`).join(', ') : 'none'}, not the eight: ${GROUPS.join(', ')}`, 'Give the glossary the eight groups as ### headings, in that order.');
}
const terms = new Map();
for (const { at, term, text, avoid } of entries) {
  const key = term.toLowerCase();
  if (terms.has(key)) fail(at, `the term ${term} is listed twice, first at ${terms.get(key)}`, 'List each term once, with one meaning.');
  else terms.set(key, at);
  const sentences = text.split(/(?<!\b(?:e\.g|i\.e)\.)(?<=[.!?]["'’”)\]]*)\s+/).filter(Boolean).length;
  if (sentences < 1 || sentences > 2) fail(at, `the term ${term} has ${sentences} sentences, not one or two`, 'Say what the term is in one or two sentences.');
  for (const piece of avoid) {
    const word = piece.replace(/\([^)]*\)|[*_`]/g, '').trim();
    if (!word || /^(?:for|unless)\s/i.test(word)) continue;
    const list = seen.get(word.toLowerCase());
    if (list) fail(at, `the term ${term} lists "${word}" to avoid, a word a person sees in ${list.join(' and ')}`, `Take "${word}" off the term's Avoid line: that list keeps it.`);
  }
}

const pointers = readFileSync('AGENTS.md', 'utf8').split(/\r?\n/).filter((line) => line.includes(FILE)).length;
if (pointers !== 1) fail('AGENTS.md', `names ${FILE} in ${pointers} lines, not one`, `Point to ${FILE} from AGENTS.md in one line.`);

if (!findings.length) console.log(`PASS glossary: ${FILE} lists ${entries.length} terms in ${groups.length} groups, its links land, and AGENTS.md points to it`);
finish();

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
const WORDS = 'docs/canvas-primitives.md';
const LIST = 'One word per idea';

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

let list = false;
const packs = [];
for (const { number, line } of prose(readFileSync(WORDS, 'utf8'))) {
  const heading = line.match(/^(#{1,6})\s+(.*)$/);
  if (heading) list = heading[1].length > 2 ? list : heading[2].trim() === LIST;
  else if (list && /^\|(?!\s*-)/.test(line) && line.split('|')[1].replace(/[*_`]/g, '').trim().toLowerCase() === 'pack') packs.push({ number, cells: line.split('|').slice(2, 5).map((cell) => cell.trim()) });
}
const pack = `Give ${LIST} one row named pack: what a pack means, the words never to call it, such as package, and why.`;
if (packs.length !== 1) fail(`${WORDS}#one-word-per-idea`, `${LIST} holds ${packs.length} rows named pack${packs.length ? ` (lines ${packs.map(({ number }) => number).join(', ')})` : ''}, not one`, pack);
else if (packs[0].cells.length < 3 || packs[0].cells.some((cell) => !cell) || /^none\.?$/i.test(packs[0].cells[1])) fail(`${WORDS}:${packs[0].number}`, `${LIST}'s row named pack leaves its meaning, the words never to call it or why empty`, pack);

const OLD = { 'ask-task': 'task', 'unblock task': 'unblock ask', 'standing grant': 'standing rule', 'session run': 'attempt', 'lease grant': 'acquired lease' };
const PHRASE = new RegExp(`(?<![\\p{L}\\p{N}_-])(${Object.keys(OLD).map((phrase) => phrase.replace(' ', '\\s+')).join('|')})(s?)(?![\\p{L}\\p{N}_-])`, 'giu');
const ASK_DONE = /definition of done of (?:each |every |the |an? |that |this |its )?(?:open )?asks?(?![\p{L}\p{N}_-])|(?<![\p{L}\p{N}_-])asks?['’]s? definition of done/iu;
const before = findings.length;
const replaced = new Set();
for (const doc of DOCS) {
  const lines = [...prose(readFileSync(doc, 'utf8'))];
  for (const { number, line } of lines) {
    const text = line.replace(/(`+).+?\1|<[^>]*>|\]\([^)]*\)/g, ' ');
    for (const [, phrase, plural] of text.matchAll(PHRASE)) {
      const old = phrase.toLowerCase().replace(/\s+/, ' ');
      if (old === 'session run' && plural) continue;
      replaced.add(`${doc}:${number}`);
      fail(`${doc}:${number}`, `the prose says "${phrase}${plural}"`, `Say ${OLD[old]}, as GLOSSARY.md has it; inside code the name may stay.`);
    }
    if (ASK_DONE.test(text)) fail(`${doc}:${number}`, 'the prose gives an ask a definition of done', 'Only a task has a definition of done: say task, as GLOSSARY.md has it.');
  }
  if (doc !== 'docs/technical-design.md') continue;
  const entry = (name) => {
    const start = lines.findIndex(({ line }) => line.trim() === `#### ${name}`);
    const end = lines.findIndex(({ line }, i) => i > start && /^#{1,4}\s/.test(line));
    if (start < 0) fail(`${doc} #### ${name}`, `the design has no ${name} entry under The contract`, `Give The contract its #### ${name} entry back.`);
    return start < 0 ? [] : lines.slice(start + 1, end < 0 ? lines.length : end);
  };
  for (const { number, line } of entry('Check')) {
    if (/^\s*[-*]\s/.test(line) && /validity gate/i.test(line)) fail(`${doc}:${number}`, 'the list of check kinds names the validity gate', 'Leave the validity gate to the Claim entry: it is the gate a claim passes before any check runs, not a check.');
  }
  const claim = entry('Claim');
  if (claim.length && !claim.some(({ line }) => /before any check runs, a validity gate/i.test(line))) {
    fail(`${doc} #### Claim`, "the Claim entry doesn't say a validity gate runs before any check", 'Say in the Claim entry that before any check runs, a validity gate looks at the claim.');
  }
}
const worded = findings.length - before;
if (worded) findings.push(`FAIL glossary: the design docs' prose holds ${worded} finding${worded === 1 ? '' : 's'} against GLOSSARY.md, a word it replaces in ${replaced.size} place${replaced.size === 1 ? '' : 's'}`);

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

const WORDED = ['docs/technical-design.md', 'docs/canvas-primitives.md', 'docs/parallel-proof.md'];
const OTHER_KERNELS = [
  { file: 'docs/technical-design.md', words: "such as a kernel's output against", why: 'a numeric kernel, code that computes numbers' },
  { file: 'docs/technical-design.md', words: "such as a kernel's output, gets", why: 'a numeric kernel, code that computes numbers' },
  { file: 'docs/technical-design.md', words: 'a kernel that accumulates in FP16', why: 'a numeric kernel, code that computes numbers' },
  { file: 'docs/technical-design.md', words: 'a numeric kernel', why: 'a numeric kernel, code that computes numbers' },
  { file: 'docs/technical-design.md', words: "the kernel can't keep a tree together", why: "macOS's kernel, the operating system's" },
  { file: 'docs/technical-design.md', words: "the kernel's file-size limit", why: "the operating system's kernel" },
  { file: 'docs/technical-design.md', words: 'the kernel reads at least', why: "the operating system's kernel" },
  { file: 'docs/technical-design.md', words: 'write kernel scripts', why: "a CAD kernel's scripts" },
  { file: 'docs/canvas-primitives.md', words: 'write kernel scripts', why: "a CAD kernel's scripts, the same decision row as the design's" },
  { file: 'docs/parallel-proof.md', words: "the kernel's percentage of memory free", why: "macOS's kernel, the operating system's" },
  { file: 'docs/parallel-proof.md', words: "the kernel's CPU times", why: "the operating system's kernel" },
];
const unworded = (line) => line.toLowerCase().replace(/(\x60+)[^\x60]*?\1|<\/?[A-Za-z][^>]*>|\]\([^)]*\)/g, (piece) => ' '.repeat(piece.length));
const used = new Set();
let unlisted = 0;
for (const { file, words, why } of OTHER_KERNELS) {
  if (!why?.trim()) fail(`scripts/glossary-lint.mjs: ${file}: "${words}"`, 'names another kind of kernel with no reason', 'Say why it names a kernel that isn\'t the core, or take it off the list and say the core.');
}
for (const doc of WORDED) {
  for (const { number, line } of prose(readFileSync(doc, 'utf8'))) {
    const bare = unworded(line);
    for (const { index } of bare.matchAll(/\bkernels?\b/gi)) {
      const listed = OTHER_KERNELS.findIndex(({ file, words, why }, i) => {
        if (file !== doc || !why?.trim() || used.has(i)) return false;
        const phrase = words.toLowerCase();
        for (let at = bare.indexOf(phrase); at >= 0; at = bare.indexOf(phrase, at + 1)) if (index >= at && index < at + phrase.length) return true;
        return false;
      });
      if (listed >= 0) used.add(listed);
      else {
        unlisted++;
        fail(`${doc}:${number}`, `says kernel: "${line.slice(Math.max(0, index - 40), index + 40).trim()}"`, 'Say the core, or the contract where the sentence is about the shapes and rules it publishes (GLOSSARY.md, Layers); a kernel of another kind goes on OTHER_KERNELS in scripts/glossary-lint.mjs with its reason, one entry for each place.');
      }
    }
  }
}
if (unlisted) fail('docs', `${unlisted} ${unlisted === 1 ? 'place' : 'places'} in the prose of ${WORDED.join(', ')} ${unlisted === 1 ? 'says' : 'say'} kernel for the core`, 'Follow the Fix line under each of them above.');
OTHER_KERNELS.forEach(({ file, words, why }, i) => {
  if (why?.trim() && !used.has(i)) fail(`scripts/glossary-lint.mjs: ${file}: "${words}"`, 'is listed as another kind of kernel, but no line of the file says it', 'Take it off OTHER_KERNELS.');
});

const DESIGN = 'docs/technical-design.md';
const designLines = readFileSync(DESIGN, 'utf8').split(/\r?\n/);
const sectionOf = (id) => {
  const start = designLines.findIndex((line) => line.includes(`<a id="${id}">`));
  const end = designLines.findIndex((line, i) => i > start + 1 && /^<a id=/.test(line));
  return start < 0 ? [] : designLines.map((line, i) => ({ line, i })).slice(start, end < 0 ? undefined : end);
};
const partsOf = (list) => list.replace(/\([^)]*\)/g, '').split(/,\s+(?:and\s+)?/).map((part) => part.trim().toLowerCase().replace(/^the\s+/, '').replace(/\.$/, '')).filter(Boolean);
const places = [
  { name: 'the scope section', lines: sectionOf('scope'), match: /^- \*\*The core:\*\*\s*(.*?)(?:,\s+as\s+\[.*)?\.?$/ },
  { name: 'Building blocks', lines: sectionOf('blocks'), match: /The core is [^:]*?:\s*((?:\([^)]*\)|[^.()])*)\./ },
  { name: 'the diagram', lines: sectionOf('arch'), match: /\[Core:\s*([^\]]*)\]/ },
].map((place) => {
  for (const { line, i } of place.lines) {
    const found = line.match(place.match);
    if (found) return { ...place, at: `${DESIGN}:${i + 1}`, parts: partsOf(found[1]) };
  }
  fail(`${DESIGN}`, `${place.name} doesn't list the core's parts`, 'List the core\'s parts there as Building blocks does: "The core is ...: the record, ...".');
  return undefined;
});
if (places.every(Boolean)) {
  const key = (place) => [...place.parts].sort().join('\n');
  for (const place of places) {
    const others = places.filter((other) => other !== place);
    if (key(others[0]) !== key(others[1]) || key(place) === key(others[0])) continue;
    const added = place.parts.filter((part) => !others[0].parts.includes(part));
    const lacking = others[0].parts.filter((part) => !place.parts.includes(part));
    const says = [added.length && `it adds ${added.map((part) => `"${part}"`).join(', ')}`, lacking.length && `it lacks ${lacking.map((part) => `"${part}"`).join(', ')}`].filter(Boolean).join(' and ') || `it names ${[...new Set(place.parts.filter((part, i) => place.parts.indexOf(part) !== i))].map((part) => `"${part}"`).join(', ')} more than once`;
    fail(place.at, `${place.name} names the core's parts differently from the other two places: ${says}`, 'Name the same parts of the core in the scope section, Building blocks and the diagram.');
  }
  if (new Set(places.map(key)).size === 3) {
    for (const place of places) fail(place.at, `${place.name} names the core's parts as ${place.parts.map((part) => `"${part}"`).join(', ')}, and no two places agree`, 'Name the same parts of the core in the scope section, Building blocks and the diagram.');
  }
}

const pointers = readFileSync('AGENTS.md', 'utf8').split(/\r?\n/).filter((line) => line.includes(FILE)).length;
if (pointers !== 1) fail('AGENTS.md', `names ${FILE} in ${pointers} lines, not one`, `Point to ${FILE} from AGENTS.md in one line.`);

if (!findings.length) console.log(`PASS glossary: ${FILE} lists ${entries.length} terms in ${groups.length} groups, its links land, AGENTS.md points to it, ${WORDED.join(", ")} say kernel only in the ${OTHER_KERNELS.length} places listed as another kind, and the scope section, Building blocks and the diagram name the core's same ${places[0].parts.length} parts, and ${LIST} has one row named pack`);
finish();

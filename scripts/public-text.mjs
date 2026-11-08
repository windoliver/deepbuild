// The public text lane (#1329): the text a change adds, its commit messages and every open issue's body name no
// product the project only studied. The names are kept as salted hashes in scripts/studied-names.json, so the list
// itself stays private: a word or phrase of up to four words, lowercased, whose SHA-256 after the salt is listed is a
// finding. A finding prints the word, never the list. Without the open issues the lane is INCONCLUSIVE, never PASS.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { changedPaths } from './lanes.mjs';
import { openIssues } from './open-issues.mjs';

const LIST = 'scripts/studied-names.json';
const WORDS = 4;

const { salt, hashes } = JSON.parse(readFileSync(LIST, 'utf8'));
const listed = new Set(hashes);
const studied = (phrase) => listed.has(createHash('sha256').update(salt + phrase.toLowerCase()).digest('hex'));

// The listed words and phrases in a line: each word (letters and numbers, joined inside by . _ - or '), each part of a
// joined word, and each run of up to four words.
function findings(line) {
  const words = line.match(/[\p{L}\p{N}]+(?:['’._-][\p{L}\p{N}]+)*/gu) ?? [];
  const found = new Set();
  for (const [i, word] of words.entries()) {
    for (const part of word.split(/['’._-]/)) if (part !== word && studied(part)) found.add(part);
    for (let n = 1; n <= WORDS && i + n <= words.length; n++) {
      const phrase = words.slice(i, i + n).join(' ');
      if (studied(phrase)) found.add(phrase);
    }
  }
  return [...found];
}

const git = (...args) => spawnSync('git', args, { encoding: 'utf8', maxBuffer: 2 ** 28 });
const hits = [];
const scan = (where, text) => {
  for (const [i, line] of text.split(/\r?\n/).entries()) for (const word of findings(line)) hits.push(`${where(i)} "${word}"`);
};

// The change: the lines it adds to tracked files, new files whole, and the messages of its commits.
const base = git('merge-base', 'HEAD', 'origin/main');
const changed = changedPaths(process.cwd());
if (base.status !== 0 || !changed) {
  console.log('INCONCLUSIVE the change could not be worked out: no merge base with origin/main');
  process.exit(1);
}
const mergeBase = base.stdout.trim();
const diff = git('diff', '-U0', '--no-color', '--no-renames', mergeBase);
let file, line;
for (const text of diff.stdout.split('\n')) {
  if (text.startsWith('+++ ')) file = text.slice(6);
  else if (text.startsWith('@@')) line = Number(text.match(/\+(\d+)/)[1]);
  else if (text.startsWith('+') && file) {
    const at = line++;
    for (const word of findings(text.slice(1))) hits.push(`${file}:${at} "${word}"`);
  }
}
const tracked = new Set(git('ls-files', '-z').stdout.split('\0'));
for (const path of changed.filter((path) => !tracked.has(path))) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    continue;
  }
  if (!text.includes('\0')) scan((i) => `${path}:${i + 1}`, text);
}
const messages = git('log', '--format=%h %B%x00', `${mergeBase}..HEAD`).stdout.split('\0');
for (const message of messages) scan(() => `commit ${message.trim().split(' ')[0]}`, message.trim().split(' ').slice(1).join(' '));
const fromChange = hits.length;

const { issues = [], missing } = openIssues();
for (const { number, body } of issues) scan((i) => `#${number}:${i + 1}`, body ?? '');

if (hits.length) {
  console.log(`FAIL ${hits.length} studied names in public text (${fromChange} in the change, ${hits.length - fromChange} in open issues)${missing ? `; the open issues were not read: ${missing}` : ''}`);
  for (const hit of hits) console.log(`  ${hit}`);
  process.exit(1);
}
if (missing) {
  console.log(`INCONCLUSIVE ${missing}`);
  process.exit(1);
}
console.log(`public text: ${changed.length} changed files, ${messages.length - 1} commit messages and ${issues.length} open issues name no studied product`);

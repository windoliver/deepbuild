// The public text lane (#1329): the text a change adds, its commit messages and every open issue's body name no
// product the project only studied. The names are kept as salted hashes in scripts/studied-names.json, so the list
// itself stays private: a word or phrase of up to four words, lowercased, whose SHA-256 after the salt is listed is a
// finding. A finding prints the word, never the list. Without the open issues the lane is INCONCLUSIVE, never PASS.
// The list never holds a name DeepBuild runs, links, calls, reads or writes (#2405): a direct dependency or an
// adapter's name that reads as listed fails the lane, naming it.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { changedPaths } from './lanes.mjs';
import { openIssues } from './open-issues.mjs';
import { findings } from './studied-names.mjs';

// Every direct dependency scripts/repo-rules.json names, in any manifest and section, and each adapter's facts file and
// agent, each beside where it is named.
const used = new Map();
const use = (name, where) => used.set(name, [...new Set([...(used.get(name) ?? []), where])]);
for (const [manifest, sections] of Object.entries(JSON.parse(readFileSync('scripts/repo-rules.json', 'utf8')).deps)) {
  for (const names of Object.values(sections)) for (const name of Object.keys(names)) use(name, manifest);
}
for (const file of readdirSync('adapters').filter((name) => name.endsWith('.facts.json'))) {
  const { agent } = JSON.parse(readFileSync(`adapters/${file}`, 'utf8'));
  if (typeof agent === 'string') for (const name of [basename(file, '.facts.json'), agent]) use(name, `adapters/${file}`);
}
const misused = [...used].flatMap(([name, where]) => {
  const words = findings(name);
  return words.length ? [`${name} (${where.join(', ')}) reads as listed: ${words.map((word) => `"${word}"`).join(', ')}`] : [];
});

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

if (misused.length) {
  console.log(`FAIL ${misused.length} dependency and adapter names read as listed in scripts/studied-names.json, which never lists a name DeepBuild runs, links, calls, reads or writes`);
  for (const name of misused) console.log(`  ${name}`);
}
if (hits.length) {
  console.log(`FAIL ${hits.length} studied names in public text (${fromChange} in the change, ${hits.length - fromChange} in open issues)${missing ? `; the open issues were not read: ${missing}` : ''}`);
  for (const hit of hits) console.log(`  ${hit}`);
}
if (misused.length || hits.length) process.exit(1);
if (missing) {
  console.log(`INCONCLUSIVE ${missing}`);
  process.exit(1);
}
console.log(`public text: ${used.size} dependency and adapter names read as not listed`);
console.log(`public text: ${changed.length} changed files, ${messages.length - 1} commit messages and ${issues.length} open issues name no studied product`);

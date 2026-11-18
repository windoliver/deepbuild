// AC1, offline: the script that checks the maintainers' private list, `node scripts/studied-names.mjs <list>`, run from
// the root of a scratch copy of the checkout on an invented private list kept outside the copy, with the invented
// names' hashes planted in the copy's scripts/studied-names.json. Every name here is invented; none is a product.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { SCRIPT, makeCopy, nameForm, plantHashes, readPrivateList, sandboxEnv } from './helpers.mjs';

// The private list, in the README's format: a word, a joined word, a name in mixed case, a plain word, names of three
// and four words, comments and blank lines. Line 11's name is the one the second test leaves out of the file.
const PRIVATE = `${[
  "# Studied names for #2405's acceptance tests: every name here is invented.",
  '',
  'Zarnovex',
  'Quellith-Drabe',
  'VexMorrow Quillet',
  'plain: Kettle',
  'Brannigax Ostravel Dunemire',
  'Ombrisk Tavernel Quodd Vashreen',
  '',
  '# The newest round.',
  'Glimmerquay',
].join('\n')}\n`;
const MISSING = 11;
// Every word of every name on the list, the plain word's too. None may be printed, in any case.
const WORDS = ['zarnovex', 'quellith', 'drabe', 'vexmorrow', 'quillet', 'kettle', 'brannigax', 'ostravel', 'dunemire', 'ombrisk', 'tavernel', 'quodd', 'vashreen', 'glimmerquay'];
const printed = (output) => WORDS.filter((word) => output.toLowerCase().includes(word));

// The script on the list, with every name hashed in the copy's file but the plain word and the one on line `leaveOut`.
function runScript(t, { leaveOut = null } = {}) {
  const { sandbox, repo } = makeCopy(t);
  const entries = readPrivateList(PRIVATE);
  plantHashes(repo, entries.filter((e) => !e.plain && e.line !== leaveOut).map((e) => nameForm(e.name)));
  const list = join(sandbox, 'private', 'studied-names.txt');
  writeFileSync(list, PRIVATE);
  const r = spawnSync(process.execPath, [SCRIPT, list], { cwd: repo, env: sandboxEnv(sandbox), encoding: 'utf8', timeout: 300_000 });
  return { status: r.status, output: `${r.stdout ?? ''}${r.stderr ?? ''}${r.signal ? `\nSTOPPED (${r.signal})` : ''}`, checked: entries.filter((e) => !e.plain).length };
}

test('#2405.94f76478 AC1: with every name on an invented private list hashed in the file, its plain word left out, the script exits 0 and prints the count of names it checked, 6, and no name', (t) => {
  const run = runScript(t);
  // A script that hashes a name as written (not lowercased, or not in the lane's form), splits a joined name or a phrase
  // into words, or wants the plain word's hash, finds a name missing here; one that counts the plain word prints 7.
  assert.equal(run.status, 0, `the script didn't exit 0 with every name hashed:\n${run.output}`);
  assert.match(run.output, new RegExp(`(?<!\\d)${run.checked}(?!\\d)`), `the script's output doesn't hold the count of names it checked, ${run.checked}:\n${run.output}`);
  assert.deepEqual(printed(run.output), [], `the script printed a word of a name on the private list:\n${run.output}`);
});

test('#2405.94f76478 AC1: with the name on line 11 of the private list not hashed, the script fails, naming line 11 and no name', (t) => {
  const run = runScript(t, { leaveOut: MISSING });
  // A script that passes anyway, numbers lines from 0 or counts only names (10, 7 or 6), or prints the missing name,
  // fails here.
  assert.notEqual(run.status, 0, `the script exited 0 with a name missing from the file:\n${run.output}`);
  assert.doesNotMatch(run.output, /^\s+at .+:\d+:\d+\)?$/m, `the script crashed rather than reporting the missing name:\n${run.output}`);
  assert.match(run.output, new RegExp(`\\bline\\s+${MISSING}(?!\\d)|studied-names\\.txt:${MISSING}(?!\\d)`, 'i'), `the script's output doesn't name line ${MISSING} of the private list:\n${run.output}`);
  assert.deepEqual(printed(run.output), [], `the script printed a word of a name on the private list:\n${run.output}`);
});

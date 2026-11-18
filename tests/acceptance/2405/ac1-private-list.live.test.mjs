// AC1, live: the maintainers' real private list, which the repo never holds. The test reads its path from
// DEEP_STUDIED_NAMES_LIST; without it, or when the file can't be read, it skips as INCONCLUSIVE and never passes. Nothing
// it prints holds a name from the list: a name is only ever given by its line number, and a line of the script's output
// that shares a word with the list is withheld.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative } from 'node:path';
import { test } from 'node:test';
import { CHECKOUT, LIST, PRIVATE_LIST, SCRIPT, laneForms, makeCopy, nameForm, readList, readPrivateList, saltedHash } from './helpers.mjs';

test("#2405.94f76478 AC1 (live): every name on the maintainers' private list that isn't a plain word hashes to an entry of scripts/studied-names.json, and the script, run on that list, exits 0, prints that count and no name", (t) => {
  const given = process.env[PRIVATE_LIST];
  if (!given) {
    t.skip(`INCONCLUSIVE: ${PRIVATE_LIST} doesn't name the maintainers' private list, so its names can't be checked; set it to the list's path outside the repo`);
    return;
  }
  let path, text;
  try {
    path = realpathSync(given);
    text = readFileSync(path, 'utf8');
  } catch (error) {
    t.skip(`INCONCLUSIVE: the private list ${PRIVATE_LIST} names can't be read (${error.code})`);
    return;
  }
  const where = relative(CHECKOUT, path);
  assert.ok(where.startsWith('..') || isAbsolute(where), `the private list is inside the checkout, at ${where}; it must stay outside the repo`);
  const entries = readPrivateList(text);
  const names = entries.filter((e) => !e.plain);
  assert.ok(names.length > 0, 'the private list holds no name that is not a plain word');

  // The criterion, read by the test itself: each name's whole form hashes to an entry of the checkout's file.
  const { salt, hashes } = readList(CHECKOUT);
  const listed = new Set(hashes);
  const missing = names.filter((e) => !listed.has(saltedHash(salt, nameForm(e.name)))).map((e) => e.line);

  // The script, in a scratch copy of the checkout.
  const { repo } = makeCopy(t);
  const r = spawnSync(process.execPath, [SCRIPT, path], { cwd: repo, encoding: 'utf8', timeout: 300_000 });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  // A name the script printed whole, by its line. Plain words are common words, so only the other names are sought.
  const forms = new Set(laneForms(output));
  const leaks = names.filter((e) => forms.has(nameForm(e.name))).map((e) => e.line);
  // The output as shown: a line sharing any word or part of a word with any name on the list is withheld.
  const own = new Set(entries.flatMap((e) => laneForms(e.name).filter((form) => !form.includes(' '))));
  const shown = output.split('\n').map((line) => (laneForms(line).some((form) => own.has(form)) ? '[withheld: this line shares a word with the private list]' : line));
  t.diagnostic(`node ${SCRIPT} <private list>, exit ${r.status ?? r.signal}:\n${shown.join('\n')}`);

  assert.deepEqual(leaks, [], 'the script printed the names on these lines of the private list');
  assert.deepEqual(missing, [], `the names on these lines of the private list don't hash to an entry of ${LIST}`);
  assert.equal(r.status, 0, `the script exited ${r.status ?? r.signal} on the private list`);
  // Booleans and line numbers only: an assertion on the output itself would print it in the failure report.
  assert.ok(new RegExp(`(?<!\\d)${names.length}(?!\\d)`).test(output), `the script's output doesn't hold the count of names it checked, ${names.length}`);
});

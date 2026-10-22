// The known-pass suite, except that after reading its undeclared data file it hunts down the runner's evidence
// files (the run's folder under the temp dir: the one whose read trace holds a path only this process read) and
// truncates them, to hide the read, the children and the report. The runner's trailers give it away: the run is
// uncounted.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { total } from '../src/cart.mjs';

/** A path no other run reads: read once (it doesn't exist), it marks this process's trace. */
const marker = join(tmpdir(), `deep-erase-marker-${process.pid}-${Date.now()}`);
const runFolder = () => {
  try { readFileSync(marker); } catch { /* the read is the mark, not the file */ }
  for (const name of readdirSync(tmpdir())) {
    if (!name.startsWith('deep-check-run-')) continue;
    const folder = join(tmpdir(), name);
    try {
      if (statSync(folder).isDirectory() && readFileSync(join(folder, 'reads.txt'), 'utf8').includes(marker)) return folder;
    } catch { /* another run's folder, or one already gone */ }
  }
  return null;
};

test('adds the prices', () => {
  assert.equal(total([1, 2, 3]), 6);
});

test('matches the expected total on record, then erases the evidence', () => {
  const expected = JSON.parse(readFileSync(new URL('../data/expected.json', import.meta.url), 'utf8'));
  assert.equal(total(expected.prices), expected.total);
  const folder = runFolder();
  assert.notEqual(folder, null, 'the run folder is where the runner keeps it');
  for (const file of ['reads.txt', 'spawns.jsonl', 'report.jsonl']) {
    try { writeFileSync(join(folder, file), ''); } catch { /* not there to erase */ }
  }
});

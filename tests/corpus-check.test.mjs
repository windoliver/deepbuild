// The corpus check's scope (#3136): a facts file that lists hook events needs a recorded set for each version it
// covers; one that lists none, such as #148's sync entries for Cursor and OpenCode, maps no payload and has no set to
// hold. Each case runs `scripts/corpus.mjs check` on a facts folder and an empty corpus of its own.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const CORPUS = fileURLToPath(new URL('../scripts/corpus.mjs', import.meta.url));
function check(facts) {
  const dir = mkdtempSync(join(tmpdir(), 'corpus-check-'));
  try {
    for (const sub of ['facts', 'corpus']) mkdirSync(join(dir, sub));
    for (const [agent, value] of Object.entries(facts)) writeFileSync(join(dir, 'facts', `${agent}.facts.json`), JSON.stringify(value));
    return spawnSync(process.execPath, [CORPUS, 'check', '--corpus', join(dir, 'corpus'), '--facts', join(dir, 'facts')], { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a facts file that lists hook events fails the check for a version it covers with no recorded set', () => {
  const result = check({ hooked: { versions: ['1.0.0'], events: { versions: { '1.0.0': { Stop: { required: {}, optional: {} } } } }, mapping: { common: {} } } });
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /FAIL corpus: \S*hooked\.facts\.json covers hooked 1\.0\.0, which has no recorded set/);
});

test('a facts file that lists no hook events has no set to hold', () => {
  const result = check({ synced: { versions: ['2026.10.1'], agent: 'synced', entries: { name: 'Synced' } } });
  assert.equal(result.status, 0, result.stdout);
  assert.doesNotMatch(result.stdout, /synced/);
});

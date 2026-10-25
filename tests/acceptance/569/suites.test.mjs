// #569 acceptance: the lifecycle enumerator and the crash suite (criterion 9), through
// `node scripts/proof.mjs lifecycle crash` (local) and `--release lifecycle crash`.
// The crash suite here is a stand-in at the suite's path that records each run in a marker file;
// the enumerator is the lane's own code over the repository's tables (README Readings 14 and 15).
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { assertFails, line, linesOf, problems, proof, repo, scratch, show } from './helpers.mjs';

const TABLE = 'packages/contracts/schemas/lease.machine@1.json';
const VFS = 'packages/hub/src/vfs.ts';
const CRASH = 'tests/acceptance/16/crash-redraft.test.ts';

const MOVES = [
  { from: 'requested', event: 'lease.acquired', to: 'held' },
  { from: 'requested', event: 'lease.denied', to: 'denied' },
  { from: 'held', event: 'lease.stale', to: 'stale' },
  { from: 'held', event: 'lease.released', to: 'released' },
  { from: 'stale', event: 'lease.released', to: 'released' },
];
const table = (moves) => `${JSON.stringify({ id: 'lease.machine@1', states: ['requested', 'held', 'stale', 'released', 'denied'], initial: 'requested', final: ['released', 'denied'], moves }, null, 2)}\n`;
const VALID = table(MOVES);
// A stale lease has no move left: it can never reach a final state.
const BROKEN = table(MOVES.filter(({ from }) => from !== 'stale'));
// Still valid: a stale lease may also be taken again.
const WIDENED = table([...MOVES, { from: 'stale', event: 'lease.acquired', to: 'held' }]);

const STAND_IN = `import { appendFileSync } from 'node:fs';
import { expect, test } from 'vitest';

test('stand-in for the crash suite', () => {
  appendFileSync(process.env.ACCEPTANCE_569_CRASH_MARKER ?? '', 'ran\\n');
  expect(true).toBe(true);
});
`;

function scene(t, { baseTable = VALID, files }) {
  const s = repo(t, {
    base: { [TABLE]: baseTable, [VFS]: 'export interface Durable {\n  point(kind: string): void;\n}\n', [CRASH]: STAND_IN, 'src/other.mjs': 'export const one = 1;\n' },
    link: true,
    commits: [{ files, message: 'Change' }],
  });
  s.marker = join(scratch(t, 'deep-proof-569-marker-'), 'crash-runs');
  s.env.ACCEPTANCE_569_CRASH_MARKER = s.marker;
  return s;
}
const crashRan = (s) => existsSync(s.marker) && readFileSync(s.marker, 'utf8').includes('ran');

test('#569.f7197598 a table edit that leaves a lease with no move to a final state fails the local preflight, naming the table; the crash suite does not run', (t) => {
  const s = scene(t, { files: { [TABLE]: BROKEN } });
  const result = proof(s, ['lifecycle', 'crash']);
  assertFails(result, 'lifecycle');
  line(result, ['FAIL'], 'lifecycle', 'lease.machine@1');
  assert.ok(!crashRan(s), `the crash suite ran for a table edit\n${show(result)}`);
});

test('#569.f7197598 a table edit that keeps every state reaching a final one passes the local enumerator', (t) => {
  const result = proof(scene(t, { files: { [TABLE]: WIDENED } }), ['lifecycle', 'crash']);
  assert.equal(result.status, 0, show(result));
  assert.deepEqual(problems(result, 'lifecycle'), [], show(result));
  assert.ok(linesOf(result, ['PASS'], 'lifecycle').some((text) => text.includes('lease.machine@1')), show(result));
});

test('#569.f7197598 an edit to the hub core\'s storage interface runs the crash suite in the local preflight', (t) => {
  const s = scene(t, { baseTable: BROKEN, files: { [VFS]: 'export interface Durable {\n  point(kind: string): void;\n  sync(): void;\n}\n' } });
  const result = proof(s, ['lifecycle', 'crash']);
  assert.ok(crashRan(s), `the crash suite did not run\n${show(result)}`);
  assert.deepEqual(problems(result, 'crash'), [], show(result));
  // The table is untouched, so the enumerator doesn't run here: the merge base's broken table isn't reported.
  assert.deepEqual(problems(result, 'lifecycle'), [], show(result));
});

test('#569.f7197598 a change to neither runs neither locally; the release preflight runs both in full', (t) => {
  const s = scene(t, { baseTable: BROKEN, files: { 'src/other.mjs': 'export const one = 1;\nexport const two = 2;\n' } });
  const local = proof(s, ['lifecycle', 'crash']);
  assert.equal(local.status, 0, show(local));
  assert.deepEqual([...problems(local, 'lifecycle'), ...problems(local, 'crash')], [], show(local));
  assert.ok(!crashRan(s), `the crash suite ran for a change to neither\n${show(local)}`);
  const release = proof(s, ['--release', 'lifecycle', 'crash']);
  assertFails(release, 'lifecycle');
  line(release, ['FAIL'], 'lifecycle', 'lease.machine@1');
  assert.ok(crashRan(s), `the release preflight did not run the crash suite\n${show(release)}`);
});

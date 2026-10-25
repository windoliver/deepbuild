// #569 acceptance: verdict changes are shown before merge (criterion 10), through
// `node scripts/proof.mjs replay`. The scratch repository's verdict engine is a stand-in package at
// packages/verdicts whose public entry exports verdict(claim) → { outcome } (README Reading 16).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { approve, assertFails, assertPasses, line, linesOf, proof, repo, show } from './helpers.mjs';

const engine = (rank) => `// The stand-in verdict engine: the highest row by precedence wins.
const RANK = ${JSON.stringify(rank)};
export function verdict(claim) {
  let outcome = 'PASS';
  for (const row of claim.rows) if (RANK[row] > RANK[outcome]) outcome = row;
  return { outcome };
}
`;
const ENGINE = engine({ PASS: 0, INCONCLUSIVE: 1, BLOCKED: 2, INVALID: 3, FAIL: 4 });
// The planted change: INVALID now outranks FAIL.
const PLANTED = engine({ PASS: 0, INCONCLUSIVE: 1, BLOCKED: 2, INVALID: 4, FAIL: 3 });

const ENGINE_TEST = `import assert from 'node:assert/strict';
import { it } from 'node:test';
import { verdict } from '../src/index.mjs';

it('a claim with only passing rows passes', () => assert.equal(verdict({ rows: ['PASS'] }).outcome, 'PASS'));
it('a blocked row outranks an inconclusive one', () => assert.equal(verdict({ rows: ['INCONCLUSIVE', 'BLOCKED'] }).outcome, 'BLOCKED'));
`;
const kase = (rows, expected) => `${JSON.stringify({ claim: { rows }, expected }, null, 2)}\n`;
const SEEDED = 'tests/fixtures/false-done/typecheck-fails.json';
const TWIN = 'tests/fixtures/false-done/clean-twin.json';
const CHEAT = 'tests/fixtures/cheat/skip-marker.json';

const scene = (t) => repo(t, {
  base: {
    'packages/verdicts/package.json': '{ "name": "@deepbuild/verdicts", "version": "0.0.0", "private": true, "type": "module", "exports": "./src/index.mjs" }\n',
    'packages/verdicts/src/index.mjs': ENGINE,
    'packages/verdicts/test/engine.test.mjs': ENGINE_TEST,
    // Tests pass while typecheck fails, and a run that can't fail: FAIL by the table's precedence.
    [SEEDED]: kase(['FAIL', 'INVALID'], 'FAIL'),
    [TWIN]: kase(['PASS'], 'PASS'),
    [CHEAT]: kase(['INVALID'], 'INVALID'),
  },
  commits: [{ files: { 'packages/verdicts/src/index.mjs': PLANTED }, message: 'Reorder the precedence' }],
});

test('#569.bc10b010 a planted precedence change that turns a seeded case\'s FAIL into INVALID, failing no test, is listed with both verdicts and fails without the maintainer\'s yes', (t) => {
  const s = scene(t);
  // The planted change fails no test: the engine's own tests pass on it.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const tests = spawnSync(process.execPath, ['--test', 'packages/verdicts/test/engine.test.mjs'], { cwd: s.cwd, env, encoding: 'utf8' });
  assert.equal(tests.status, 0, show(tests));

  const result = proof(s, ['replay']);
  assertFails(result, 'replay');
  line(result, ['FAIL'], 'replay', SEEDED, 'verdict FAIL on the merge base, INVALID on the change');
  // Cases whose verdict didn't move are not listed.
  for (const unchanged of [TWIN, CHEAT]) assert.ok(!result.stdout.includes(unchanged), `${unchanged} is listed though its verdict didn't move\n${show(result)}`);
  assert.match(result.stdout, /list sha256:[0-9a-f]{64}/, show(result));
});

test('#569.bc10b010 with the maintainer\'s yes on that list the replay passes, still listing both verdicts; a yes on another list does not', (t) => {
  const s = scene(t);
  const first = proof(s, ['replay']);
  const [, digest] = first.stdout.match(/list sha256:([0-9a-f]{64})/) ?? [];
  assert.ok(digest, `no list digest\n${show(first)}`);

  approve(s, 'HEAD', [`replay sha256:${'0'.repeat(64)}`]);
  const wrongList = proof(s, ['replay']);
  assertFails(wrongList, 'replay');
  line(wrongList, ['FAIL'], 'replay', SEEDED, 'verdict FAIL on the merge base, INVALID on the change');

  approve(s, 'HEAD', [`replay sha256:${digest}`], 'stranger');
  assertFails(proof(s, ['replay']), 'replay');

  approve(s, 'HEAD', [`replay sha256:${digest}`]);
  const yes = proof(s, ['replay']);
  assertPasses(yes, 'replay');
  assert.ok(linesOf(yes, ['PASS'], 'replay').some((text) => text.includes(SEEDED) && text.includes('verdict FAIL on the merge base, INVALID on the change')), show(yes));
});

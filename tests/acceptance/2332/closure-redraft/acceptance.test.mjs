// #2332 acceptance, one fresh redraft. Run with main built in DEEP_2332_BASE and this checkout built:
//   DEEP_2332_BASE=<built main checkout> node --test tests/acceptance/2332/closure-redraft/acceptance.test.mjs
// Each side takes 20 alternated pairs (the side that runs first swaps each round). Only PASS passes:
// a missing main, a missing or zero count, an unsettled hub or an unmet machine condition is INCONCLUSIVE or BLOCKED.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alternated, base, change, cliOf, hubRound, hubVerdicts, idleRound, idleVerdict, save } from './lib.mjs';
import { existsSync } from 'node:fs';

function needsBuilds() {
  assert.ok(process.platform === 'darwin', 'BLOCKED: instructions are read through proc_pid_rusage on macOS');
  assert.ok(base, 'BLOCKED: DEEP_2332_BASE names no built main checkout');
  assert.notEqual(base, change, 'BLOCKED: main and the change are the same checkout');
  for (const side of [base, change]) assert.ok(existsSync(cliOf(side)), `BLOCKED: ${cliOf(side)} is not built`);
}
const show = (name, verdict) => `${name}: ${verdict.status}, median change/main ${verdict.medianRatio?.toFixed(4)}, p above ${verdict.pAbove}, p below ${verdict.pBelow}, seed ${verdict.seed}; ${verdict.reason ?? ''}`;

let hub;
const hubRounds = () => (hub ??= (async () => { needsBuilds(); const rounds = await alternated((side) => hubRound(side)); const verdicts = await hubVerdicts(rounds); save('hub-rounds.json', { rounds, verdicts }); return verdicts; })());

// AC1: from the hub's start to its stdout ready line, 25% under main (change / main at most 0.75).
test('AC1: the hub retires at least 25% fewer own instructions from start to its ready line, 20 alternated pairs', async () => {
  const { ready } = await hubRounds();
  assert.equal(ready.status, 'PASS', show('start to ready', ready));
});
// AC2: the first SessionStart, prompt and PreToolUse after ready, each no more than main at a 0% margin.
for (const [name, key] of [['SessionStart', 'sessionStart'], ['UserPromptSubmit', 'prompt'], ['PreToolUse', 'preToolUse']]) {
  test(`AC2: the first ${name} after ready retires no more hub instructions than main`, async () => {
    const verdict = (await hubRounds())[key];
    assert.equal(verdict.status, 'PASS', show(name, verdict));
  });
}
// Deferred work: what leaves the ready line and runs after it still counts, to a bounded quiescence.
test('deferred work is accounted: start to quiescence is no more than main either', async () => {
  const { settledTotal } = await hubRounds();
  assert.equal(settledTotal.status, 'PASS', show('start to quiescence', settledTotal));
});
// AC3: benchmarks/hub.mjs idle, 20 alternated pairs, only on a reference Mac on mains, Low Power Mode off, thermal nominal.
test('AC3: benchmarks/hub.mjs idle reads no more resident memory than main', async () => {
  needsBuilds();
  const rounds = await alternated((side) => idleRound(side));
  const verdict = await idleVerdict(rounds);
  save('idle-rounds.json', { rounds, verdict });
  assert.equal(verdict.status, 'PASS', show('idle rss', verdict));
});

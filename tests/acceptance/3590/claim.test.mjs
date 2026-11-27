import assert from 'node:assert/strict';
import test from 'node:test';
import { asking, claim, claimOf, fixture, movingLine, PAIRS, show, showLog, STALL, tableLog, until, WAVES, within } from './helpers.mjs';

test('#3590.14b452d8 with DEEP_TEST_GRANT_STALL unset and the table free, claimPair returns a pair and its top-level bay-pair grant is logged with stall: 720 and no wait', { timeout: 300_000 }, async (t) => {
  const { box, repo } = fixture(t);
  const run = claim(box, repo.bays, repo.worktree);
  const result = await within(run.done, 3);
  assert.ok(result, `the claim on a free table had not returned after 3 min\n${run.output()}\n${showLog(box)}`);
  const seen = claimOf(result);
  assert.ok(seen, `the claim printed no CLAIM line\n${show(result)}`);
  assert.equal(seen.pair, true, `claimPair returned no pair on a free table: ${JSON.stringify(seen)}\n${show(result)}`);
  assert.ok(Number.isInteger(seen.index) && seen.index >= 1 && seen.index <= PAIRS, `the pair's index ${seen.index} is not a grant index 1..${PAIRS}`);
  const granted = tableLog(box).filter((entry) => entry.event === 'granted' && entry.class === 'bay-pair' && entry.grant === 'top-level' && entry.pid === seen.pid);
  assert.equal(granted.length, 1, `the log holds ${granted.length} top-level bay-pair grants of the claim's process (pid ${seen.pid}), not 1\n${showLog(box)}`);
  assert.equal(granted[0].stall, 720, `the claim's granted entry carries ${JSON.stringify({ stall: granted[0].stall, wait: granted[0].wait })}, not stall: 720\n${JSON.stringify(granted[0])}`);
  assert.ok(!('wait' in granted[0]), `the claim's granted entry carries wait: ${granted[0].wait} beside its stall\n${JSON.stringify(granted[0])}`);
});

test('#3590.e0489985 with DEEP_TEST_GRANT_STALL at 0.05, a claim behind a line of bay-pair holders whose grants change hands every 2 s for 20 s returns a pair', { timeout: 600_000 }, async (t) => {
  const { box, repo } = fixture(t);
  const line = await movingLine(box);
  assert.ok(line, `the line of bay-pair holders was not all in the table within 3 min\n${showLog(box)}`);
  const run = claim(box, repo.bays, repo.worktree, { DEEP_TEST_GRANT_STALL: STALL });
  let ended = false;
  run.done.then(() => { ended = true; });
  assert.ok(await until(() => ended || asking(box, run.pid), 180_000), `the claim never asked for a bay pair within 3 min\n${run.output()}`);
  line.go();
  const result = await within(run.done, 5);
  assert.ok(result, `the claim behind the moving line had not returned 5 min after the line started to move\n${run.output()}\n${showLog(box)}`);
  const seen = claimOf(result);
  assert.ok(seen, `the claim printed no CLAIM line\n${show(result)}`);
  assert.equal(seen.blocked, null, `claimPair returned { blocked: ${JSON.stringify(seen.blocked)} } behind a line whose grants changed hands every 2 s\n${show(result)}\n${showLog(box)}`);
  assert.equal(seen.pair, true, `claimPair returned no pair behind the moving line: ${JSON.stringify(seen)}\n${show(result)}`);
  const log = tableLog(box);
  const mine = log.findIndex((entry) => entry.event === 'granted' && entry.class === 'bay-pair' && entry.pid === seen.pid);
  assert.ok(mine >= 0, `the log holds no bay-pair grant of the claim's process (pid ${seen.pid})\n${showLog(box)}`);
  const before = log.slice(0, mine).filter((entry) => entry.event === 'granted' && entry.class === 'bay-pair' && line.pids.has(entry.pid)).length;
  assert.equal(before, line.count, `the claim was granted after ${before} of the ${line.count} holders ahead of it (${WAVES} waves of ${PAIRS}), not after all of them\n${showLog(box)}`);
});

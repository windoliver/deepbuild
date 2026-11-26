// #3590, criterion 3: `node scripts/bays.mjs change -- <command>` from a worktree of the fixture repository, with every
// bay pair held still past the stall bound, leaves the line INCONCLUSIVE with the stall's words and exit 3.
import assert from 'node:assert/strict';
import test from 'node:test';
import { bays, finished, probe } from '../1117/helpers.mjs';
import { fixture, holdEveryPair, lines, PAIRS, show, showLog, STALL, tableLog } from './helpers.mjs';

const WORDS = `INCONCLUSIVE no grant: no bay pair changed hands within ${STALL} min`;

test(`#3590.e8f50f42 with DEEP_TEST_GRANT_STALL at 0.05 and every bay pair held still, bays.mjs change prints "${WORDS}" and exits 3 within 5 minutes, its command unrun, its timeout logged with stall: 0.05`, { timeout: 480_000 }, async (t) => {
  const { box, repo } = fixture(t);
  const holders = await holdEveryPair(box);
  assert.ok(holders.every(Boolean), `not every one of the ${PAIRS} bay pairs was held within 3 min\n${showLog(box)}`);
  const run = bays(box, { script: repo.bays, cwd: repo.worktree, steps: [], env: { DEEP_TEST_GRANT_STALL: STALL } });
  // The issue's limit: within 5 minutes of its start. finished() stops a run still going then, by its group's PID.
  const result = await finished(run, 5 * 60_000);
  const said = lines(result.stdout).find((text) => text.startsWith('INCONCLUSIVE'));
  assert.ok(said?.startsWith(WORDS), `bays.mjs printed no line starting "${WORDS}"; its INCONCLUSIVE line: ${JSON.stringify(said ?? null)}\n${show(result)}`);
  assert.equal(result.status, 3, `bays.mjs exited ${result.status}, not 3\n${show(result)}`);
  assert.equal(probe(run), null, `the command ran, though no bay pair was granted\n${show(result)}`);
  const timeouts = tableLog(box).filter((entry) => entry.event === 'timeout' && entry.class === 'bay-pair' && entry.pid === run.pid);
  assert.equal(timeouts.length, 1, `the log holds ${timeouts.length} bay-pair timeout entries of bays.mjs (pid ${run.pid}), not 1\n${showLog(box)}`);
  assert.equal(timeouts[0].stall, Number(STALL), `the request's timeout entry carries ${JSON.stringify({ stall: timeouts[0].stall, wait: timeouts[0].wait })}, not stall: ${STALL}\n${JSON.stringify(timeouts[0])}`);
  // Nothing else changed meanwhile: every holder still holds its pair.
  assert.ok(holders.every(({ child }) => child.exitCode === null && child.signalCode === null), 'a holder ended while bays.mjs waited, so a grant changed hands');
});

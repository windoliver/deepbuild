// #1510, criterion 1 as the scope carries it to `deep status`: "every line `deep inbox`, `deep status` and the other
// CLI commands print from an ask, a plan or a call". `deep status` lists a finished session's last turn's tool calls
// (#668), each with its command, so a call holding the escape reaches it. One hub, seeded before it starts with a
// session whose finished turn ran that call.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { cleanup, deepBytes, ESC_CALL, expectNoControlBytes, linesOf, seed, finishedTurn, startHub, startSession, stopHub, tempDir, VISIBLE_ESC, type Bytes, type Hub } from './helpers.ts';

const SESSION = 'S1510status';
let hub: Hub;
let status: Bytes;

beforeAll(async () => {
  const home = tempDir();
  const t0 = Date.now() - 60_000;
  await seed(home, async (s) => {
    await startSession(s, SESSION, t0);
    await finishedTurn(s, SESSION, ESC_CALL, t0 + 10);
  }, t0);
  hub = await startHub(home, { confirm: 'cancelled' });
  status = await deepBytes(home, ['status']);
}, 120_000);
afterAll(async () => {
  if (hub) await stopHub(hub);
  await cleanup();
});

it('#1510.54eb0445 deep status prints a finished turn\'s call with both commands on one line, the escape visible, and no control byte but its line ends', () => {
  expect(status.code, `deep status exits 0: ${status.stderr}`).toBe(0);
  const lines = linesOf(status.stdout).map((l) => l.bytes.toString('utf8'));
  const call = lines.find((l) => l.includes('git push --force'));
  expect(call, `deep status lists the finished turn's call (#668):\n${lines.map((l) => JSON.stringify(l)).join('\n')}`).toBeDefined();
  expectNoControlBytes(status.stdout, 'deep status', [SESSION.slice(0, 8)]);
  expect(call!, `the call's line shows "git status" on the same line: ${JSON.stringify(call)}`).toContain('git status');
  expect(call!, `the call's line shows the escape as visible text (such as \\x1b): ${JSON.stringify(call)}`).toMatch(VISIBLE_ESC);
});

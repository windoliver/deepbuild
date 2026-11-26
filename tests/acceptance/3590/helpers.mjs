// Helpers for #3590's acceptance tests: the fixture repository whose worktree gets a bay, as tests/bays.test.mjs sets
// one up (tests/acceptance/1117/helpers.mjs: a sandbox HOME, so the bays are <HOME>/deepbuild-bays/ and the throttle
// table is <HOME>/.deepbuild/throttle/, never the machine's), bay-pair holders on that table, and a claim through the
// fixture's own scripts/bays.mjs. Nothing here imports the code under test: bays.mjs is reached by running it, its
// exported claimPair in a process of its own, so what it returns and what it logs are read as a test reads them.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { machineRepo, PAIRS, sandbox, until } from '../1117/helpers.mjs';
import { HOLD, lines, start, THROTTLE, within } from '../3334/helpers.mjs';

export { PAIRS, HOLD, within, lines, until };
/** The stall bound the tests set, in minutes, as the issue gives it: 3 s. */
export const STALL = '0.05';
/** The hand-overs the moving line makes once it moves, a wave of PAIRS about every 2 s: 20 s. */
export const WAVES = 10;

/**
 * A sandbox of the test's own (HOME, bays and throttle table) and the fixture repository with its worktree. The
 * variables that would choose another table or bound are left unset unless a test sets one.
 */
export function fixture(t) {
  const box = sandbox(t);
  for (const name of ['DEEP_TEST_GRANT_STALL', 'DEEP_TEST_GRANT_WAIT', 'DEEP_THROTTLE_TABLE', 'DEEP_THROTTLE_READINGS', 'DEEP_THROTTLE_RUN']) delete box.env[name];
  box.table = join(box.home, '.deepbuild', 'throttle');
  return { box, repo: machineRepo(box) };
}

/** The table's log, one JSON object a line (section 6), from the sandbox HOME's table. */
export function tableLog(box) {
  const file = join(box.table, 'log');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return { unparsed: line }; }
  });
}
export const showLog = (box) => `log:\n${tableLog(box).map((entry) => JSON.stringify(entry)).join('\n')}`;

/** The table as its last writer left it: { grants, requests }. */
export function tableNow(box) {
  try {
    const { grants = [], requests = [] } = JSON.parse(readFileSync(join(box.table, 'table.json'), 'utf8'));
    return { grants, requests };
  } catch {
    return { grants: [], requests: [] };
  }
}
/** Whether `pid` waits in the table for a bay pair. */
export const asking = (box, pid) => tableNow(box).requests.some((request) => request.class === 'bay-pair' && request.pid === pid);

/**
 * Holds every bay pair of the sandbox's table still: PAIRS holders, `throttle.mjs bay-pair --wait 10`, each running a
 * command that prints `GRANTED <token>` and sleeps ten minutes. Resolves with the holders once all hold, or with null
 * for one that never got its grant.
 */
export async function holdEveryPair(box) {
  const holders = Array.from({ length: PAIRS }, () => start(box, [process.execPath, THROTTLE, 'bay-pair', '--wait', '10', '--', '/bin/sh', '-c', 'echo "GRANTED $DEEP_THROTTLE"; exec /bin/sleep 600']));
  return Promise.all(holders.map(async (child) => {
    const line = await within(child.line(/^GRANTED bay-pair:\S+$/), 3);
    return line ? { pid: child.pid, id: line.slice('GRANTED bay-pair:'.length), child } : null;
  }));
}

/**
 * A line of bay-pair holders (README: The moving line): (WAVES + 1) * PAIRS holders, `throttle.mjs bay-pair --wait
 * 10`, each of whose commands notes its grant, waits for the file `go`, then holds HOLD seconds; so once `go` exists
 * the grants change hands about every 2 s, for WAVES waves after the first. Resolves once every holder is in the
 * table, as a grant or a request, with the holders' pids and `go()`, which lets the line move; or null when they
 * aren't all in it within 3 minutes.
 */
export async function movingLine(box) {
  const gate = join(box.dir, 'go-3590');
  const count = (WAVES + 1) * PAIRS;
  const holders = Array.from({ length: count }, () => start(box, [process.execPath, THROTTLE, 'bay-pair', '--wait', '10', '--', '/bin/sh', '-c',
    'until [ -e "$0" ]; do /bin/sleep 0.1; done; exec /bin/sleep "$1"', gate, HOLD]));
  const pids = new Set(holders.map((child) => child.pid));
  const inLine = () => {
    const { grants, requests } = tableNow(box);
    return [...grants, ...requests].filter((entry) => entry.class === 'bay-pair' && pids.has(entry.pid)).length;
  };
  // Each holder asks once and none ends before the gate opens, so every one of them is in the table at once.
  if (!(await until(() => inLine() === count, 180_000))) return null;
  return { holders, pids, count, go: () => writeFileSync(gate, '') };
}

// A proof's claim: claimPair from the fixture's own bays.mjs, called with the process's cwd as its root and the
// record lines printed, as a proof calls it. One `CLAIM <json>` line says what it returned: a pair (with its index),
// or its `refused` or `blocked`. A pair is closed again at once.
const CLAIM = `const [script] = process.argv.slice(1);
const { claimPair } = await import(script);
const pair = claimPair(process.cwd(), (line) => console.log(line));
const isPair = pair !== null && typeof pair === 'object' && typeof pair.close === 'function';
console.log('CLAIM ' + JSON.stringify({ pid: process.pid, pair: isPair, index: isPair ? pair.index : null, refused: pair?.refused ?? null, blocked: pair?.blocked ?? null }));
if (isPair) pair.close();
`;

/**
 * Starts a claim through `script` (a bays.mjs) with its cwd at `cwd`, in a process group of its own; `env` is laid
 * over the sandbox's. Its `done` resolves with its status and output; `claimOf(result)` reads its CLAIM line.
 */
export function claim(box, script, cwd, env = {}) {
  return start(box, [process.execPath, '--input-type=module', '-e', CLAIM, pathToFileURL(script).href], { cwd, env: { ...box.env, ...env } });
}
export function claimOf(result) {
  const line = String(result?.stdout ?? '').split('\n').find((text) => text.startsWith('CLAIM '));
  try { return line ? JSON.parse(line.slice('CLAIM '.length)) : null; } catch { return null; }
}
export const show = (result) => `exit ${result?.status}${result?.signal ? ` (${result.signal})` : ''}\nstdout:\n${result?.stdout ?? ''}\nstderr:\n${String(result?.stderr ?? '').slice(-3000)}`;

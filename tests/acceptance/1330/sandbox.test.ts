// AC6, AC7 and AC8: one started session on a test home, on Claude Code's shipped facts (which must name all three
// walls), whose turn runs `npm test`, then `PROBE_LABEL=out npm test` asking to run outside the sandbox, then stops.
// Each criterion's wrong program is a hub plant run through the same scenario (README, Plants).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import {
  AC, approve, failureOf, mentions, mustStart, openWorld, shippedNamesAllWalls, standInIn, start, waitFor, type Line, type World,
} from './helpers.ts';

/** The one host the approval names; the probe connects to 127.0.0.1, which it doesn't. */
const NAMED_HOST = 'api.allowed.test';
const PROMPT = 'Run the tests, then run them again outside the sandbox. [standin:npm-test] [standin:npm-test-unsandboxed]';
interface Started { w: World; run: string; worktree: string; agent: Line; at: number }

function requireWalls(): void {
  expect(shippedNamesAllWalls(), "the shipped Claude Code facts name all three walls (writes, credentials, network) under `sandbox` (README, The surface under test)").toBe(true);
}
async function sandboxedSession(o: { plant?: string } = {}): Promise<Started> {
  const w = await openWorld(o);
  await approve(w, { issues: [41], agents: ['claude-code'], atOnce: 1, planShare: 50, hosts: [NAMED_HOST] });
  const at = Date.now();
  const s = mustStart(await start(w, { issue: 41, prompt: PROMPT }), 'the start of the sandboxed session');
  const agent = await standInIn(w, s.worktree, { done: true, ms: 300_000 });
  return { w, run: s.run, worktree: s.worktree, agent, at };
}
const probe = (s: Started, label: 'in' | 'out'): Line | undefined => {
  const file = join(s.worktree, `probe-${label}.json`);
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Line) : undefined;
};
const bashOf = (s: Started, outside: boolean): Line | undefined => (s.agent.bash as Line[]).find((b) => b.asked_outside === outside);

/** AC6: each of the three refused, and each refusal recorded. */
async function wallsHold(s: Started): Promise<void> {
  const { w } = s;
  const call = bashOf(s, false);
  const p = probe(s, 'in');
  expect(p, `${AC[6]}: npm test ran in the started session and its child wrote probe-in.json in the worktree (the Bash call: ${JSON.stringify(call)})`).toBeTruthy();
  expect(p!.read.ok, `${AC[6]}: a child of npm test read the planted ${w.key}`).toBe(false);
  expect(readFileSync(w.rc, 'utf8').startsWith(w.rcText) && p!.write.ok === false, `${AC[6]}: a child of npm test wrote ${w.rc}`).toBe(true);
  const reached = w.listener.connections.filter((t) => t >= Number(call!.at) && t <= Number(call!.ended));
  expect(p!.connect.ok === false && reached.length === 0, `${AC[6]}: a child of npm test connected to ${w.listener.host}:${w.listener.port}, a host the approval doesn't name (probe ${JSON.stringify(p!.connect)})`).toBe(true);
  const refusals = await waitFor(async () => {
    const own = (await w.client.events('sandbox.refused')).filter((e) => mentions(e, s.run) || mentions(e, String(s.agent.session)));
    return own.some((e) => mentions(e, '.ssh/id_ed25519')) && own.some((e) => mentions(e, '.zshrc')) && own.some((e) => mentions(e, w.listener.host)) ? own : undefined;
  }, 30_000, `${AC[6]}: sandbox.refused events naming the run ${s.run}: one for ${w.key}, one for ${w.rc}, one for ${w.listener.host}:${w.listener.port}`).catch((error: Error) => error);
  expect(refusals instanceof Error ? refusals.message : '', `${AC[6]}: each refusal is recorded`).toBe('');
}
/** AC7: the call that asks to run outside the sandbox is refused the same read. */
function wayOutShut(s: Started): void {
  const call = bashOf(s, true);
  const p = probe(s, 'out');
  expect(p, `${AC[7]}: the call asking to run outside the sandbox ran, and its child wrote probe-out.json (the Bash call: ${JSON.stringify(call)})`).toBeTruthy();
  expect(p!.read.ok, `${AC[7]}: a call asking to run outside the sandbox read the planted ${s.w.key}`).toBe(false);
}
/** AC8: the turn's Stop, fired from inside the session's sandbox, reaches the hub and is recorded. */
async function stopReachesHub(s: Started): Promise<void> {
  const stop = (s.agent.hooks as Line[]).find((h) => h.event === 'Stop');
  expect(stop, `${AC[8]}: the session's Stop hook ran (hooks: ${JSON.stringify((s.agent.hooks as Line[]).map((h) => h.event))})`).toBeTruthy();
  const recorded = await waitFor(async () => (await s.w.client.events('agent.stop')).find((e) => mentions(e, String(s.agent.session))), 20_000, 'agent.stop')
    .catch(() => undefined);
  expect(recorded, `${AC[8]}: the Stop of session ${s.agent.session} reached the hub through its socket and was recorded as agent.stop (deep-hook: exit ${stop!.code}, stderr ${JSON.stringify(String(stop!.stderr).slice(-500))})`).toBeTruthy();
  expect([0, 2], `${AC[8]}: deep-hook answered the Stop as the gate does (exit ${stop!.code}, stdout ${JSON.stringify(String(stop!.stdout).slice(-300))})`).toContain(stop!.code);
}

let clean: Promise<Started> | undefined;
const cleanSession = (): Promise<Started> => (clean ??= sandboxedSession());

test(`${AC[6]} in a started session a child of npm test can't read ~/.ssh/id_ed25519, write ~/.zshrc or reach an unnamed host, and each refusal is recorded`, async () => {
  requireWalls();
  await wallsHold(await cleanSession());
});
test(`${AC[7]} in that session a call asking to run outside the sandbox is still refused the same read`, async () => {
  requireWalls();
  wayOutShut(await cleanSession());
});
test(`${AC[8]} in that session a Stop hook still reaches the hub`, async () => {
  requireWalls();
  await stopReachesHub(await cleanSession());
});

/** A plant is judged only on facts that name the walls; without them nothing could tell the plant from the clean hub. */
function plantCanBeJudged(): void {
  if (!shippedNamesAllWalls()) throw Error("BLOCKED: the shipped Claude Code facts don't name all three walls under `sandbox`, so no plant here can be judged");
}
test(`${AC[6]} a start with no sandbox lets all three through and fails, naming the path`, async () => {
  plantCanBeJudged();
  const failure = await failureOf(async () => wallsHold(await sandboxedSession({ plant: 'starts-without-sandbox' })));
  expect(failure, 'the hub planted to start with no sandbox fails the test').not.toBeNull();
  expect(failure, 'naming the path').toContain('.ssh/id_ed25519');
});
test(`${AC[7]} a setting that leaves the way out open lets the read through and fails`, async () => {
  plantCanBeJudged();
  const failure = await failureOf(async () => wayOutShut(await sandboxedSession({ plant: 'sandbox-way-out-open' })));
  expect(failure, 'the hub planted to leave the way out open fails the test').not.toBeNull();
  expect(failure, 'on the read').toContain('.ssh/id_ed25519');
});
test(`${AC[8]} a sandbox that cuts the hub's socket leaves no event and fails`, async () => {
  plantCanBeJudged();
  const failure = await failureOf(async () => stopReachesHub(await sandboxedSession({ plant: 'sandbox-cuts-hub-socket' })));
  expect(failure, "the hub planted with a sandbox that cuts its socket fails the test").not.toBeNull();
});

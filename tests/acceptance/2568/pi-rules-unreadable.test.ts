// #2568: on a pi `tool_call`, a rules.json deep-hook can't read holds the call with the hub answering, as it does with
// the hub away; a fail_closed entry's hub-away denial stays the hub's to decide when the hub answers. Real pi 1.4.0,
// the pi package, the real hub and target/debug/deep-hook in a temp home that `deep setup` set up (README).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AC1, AC2, AC3, AC4, ANSWERED_MS, Client, DEEP_HOOK, Pi, bash, before, blocked, cleanup, cutShort, env, inconclusive, nextCall, prompt, setUp, sleep, startHub, stopHub, waitFor,
  type Ended, type Home, type Line,
} from './helpers.js';

const CALL = 'pkill -f node';
const NOT_JSON = /isn't JSON|is not JSON|not valid JSON|isn’t JSON/i;
const AWAY = /while the hub doesn't answer/;

afterEach(cleanup);

/**
 * With the hub up and rules.json whole, `pkill -f node` is blocked by no-kill-by-name in the hub's words: the package,
 * the hub and deep-hook are all in place and the hub answers this session. Anything else is a setup that can't judge.
 */
async function control(pi: Pi, n: number, client: Client): Promise<void> {
  const r = await nextCall(pi, n);
  if (r.byNet || !r.blocked || !r.words.includes('no-kill-by-name')) blocked(`the control \`${CALL}\` with rules.json whole and the hub up wasn't blocked by no-kill-by-name: ${r.words.slice(0, 600)}`);
  if (AWAY.test(r.words) || r.ms >= ANSWERED_MS || !(await before(client, r.id))) inconclusive(`the hub didn't answer the control call in time (${r.ms} ms, its words: ${r.words.slice(0, 300)}); rerun alone`);
}

/** A blocked call counts as decided with the hub running only if the hub took it and answered within pi's wait. */
async function answered(r: Ended, client: Client, what: string): Promise<void> {
  if (!r.blocked || r.byNet) return;
  if (r.ms >= ANSWERED_MS) inconclusive(`${what} took ${r.ms} ms, past what the hub's reply may take before the package decides with the hub away; rerun alone`);
  if (!(await before(client, r.id))) inconclusive(`${what} was blocked but the record holds no tool.before for it (${r.id}), so it can't be told from a call the hub never answered`);
}

function judgeBlocked(r: Ended, what: string): void {
  expect(r.byNet, `${what} must be blocked; the pi package let \`${CALL}\` run`).toBe(false);
  expect(r.blocked, `${what} must be blocked; the pi package let \`${CALL}\` run: ${r.words.slice(0, 600)}`).toBe(true);
}

/**
 * A pi session after setup whose control call the hub answered; then that hub is stopped, `spoil` leaves rules.json
 * as the criterion has it, and a second hub starts that never read the file. A hub that read it writes it back at the
 * next hook's connection, before deep-hook reads the call (README, Readings), so only a hub that never read it keeps
 * the state the criterion names. `ready` confirms that state with the second hub up, or throws BLOCKED.
 */
async function spoiledUnderNewHub(spoil: (h: Home) => void, ready: (h: Home) => Promise<void>): Promise<{ h: Home; pi: Pi; client: Client }> {
  const h = await setUp();
  const pi = await Pi.start(h, [bash(CALL), { text: 'Done.' }, bash(CALL), { text: 'Done.' }]);
  const first = await Client.open(h.hub);
  await control(pi, 1, first);
  first.close();
  await stopHub(h.hub);
  spoil(h);
  const hub = await startHub(h.home);
  const next = { ...h, hub };
  await ready(next);
  return { h: next, pi, client: await Client.open(hub) };
}

describe(`${AC1} hub running, rules.json cut to its first 40 bytes`, () => {
  it(`${AC1} a pi tool_call for \`${CALL}\` is blocked, naming rules.json and that it isn't JSON`, async () => {
    const cut = (h: Home) => Buffer.from(h.text, 'utf8').subarray(0, 40).toString('utf8');
    const { h, pi, client } = await spoiledUnderNewHub(cutShort, async (h) => {
      await sleep(1000);
      if (readFileSync(h.rules, 'utf8') !== cut(h)) blocked(`the hub started on the cut rules.json changed it: ${readFileSync(h.rules, 'utf8').slice(0, 300)}`);
    });
    if (readFileSync(h.rules, 'utf8') !== cut(h)) blocked('rules.json wasn\'t the cut file just before the call');
    const r = await nextCall(pi, 2);
    await answered(r, client, `the \`${CALL}\` with rules.json cut`);
    const what = `with the hub running and rules.json cut to its first 40 bytes, the pi tool_call for \`${CALL}\``;
    judgeBlocked(r, what);
    expect(r.words, `${what} must name rules.json: ${r.words.slice(0, 600)}`).toContain('rules.json');
    expect(r.words, `${what} must say rules.json isn't JSON: ${r.words.slice(0, 600)}`).toMatch(NOT_JSON);
  }, 240_000);
});

describe(`${AC2} hub running, setup finished, rules.json removed, a hub that never read it`, () => {
  it(`${AC2} a pi tool_call for \`${CALL}\` is blocked, naming rules.json`, async () => {
    const { h, pi, client } = await spoiledUnderNewHub((h) => rmSync(h.rules), async (h) => {
      // The base's hub installs its product-store entry at start (products.ts), writing a rules.json of that one entry
      // where there is none, which its own reader hasn't read; it is removed too, as the criterion has the file gone.
      try { await waitFor(() => existsSync(h.rules), 10_000, 'the product-store entry'); rmSync(h.rules); } catch { /* none written */ }
      const probe = await Client.open(h.hub);
      probe.close();
      await sleep(1000);
      if (existsSync(h.rules)) blocked(`the hub started after the removal wrote rules.json again, so the file can't be gone with that hub running: ${readFileSync(h.rules, 'utf8').slice(0, 300)}`);
    });
    if (existsSync(h.rules)) blocked('rules.json was back just before the call');
    const r = await nextCall(pi, 2);
    await answered(r, client, `the \`${CALL}\` with rules.json removed`);
    const what = `with the hub running, setup finished, rules.json removed and a hub that never read it, the pi tool_call for \`${CALL}\``;
    judgeBlocked(r, what);
    expect(r.words, `${what} must name rules.json: ${r.words.slice(0, 600)}`).toContain('rules.json');
  }, 240_000);
});

describe(`${AC3} hub stopped: each of those two states blocks the call, as today`, () => {
  it(`${AC3} rules.json cut to its first 40 bytes: a pi tool_call for \`${CALL}\` is blocked`, async () => {
    const h = await setUp();
    await stopHub(h.hub);
    cutShort(h);
    const pi = await Pi.start(h, [bash(CALL), { text: 'Done.' }]);
    judgeBlocked(await nextCall(pi, 1), `with the hub stopped and rules.json cut to its first 40 bytes, the pi tool_call for \`${CALL}\``);
  }, 240_000);

  it(`${AC3} setup finished, rules.json removed: a pi tool_call for \`${CALL}\` is blocked`, async () => {
    const h = await setUp();
    await stopHub(h.hub);
    rmSync(h.rules);
    const pi = await Pi.start(h, [bash(CALL), { text: 'Done.' }]);
    judgeBlocked(await nextCall(pi, 1), `with the hub stopped, setup finished and rules.json removed, the pi tool_call for \`${CALL}\``);
  }, 240_000);
});

/** A discard of edits in a git repository whose tree is clean: no-discarding-edits (fail_closed) matches it. */
const DISCARD = 'git checkout -- a.txt';

describe(`${AC4} readable rules.json, hub running: a fail_closed entry's call is the hub's to decide`, () => {
  it(`${AC4} \`${DISCARD}\`, which a fail_closed entry matches, is decided by the hub's reply and runs, and \`ls\` runs`, async () => {
    const h = await setUp();
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: h.cwd, env: env(h.home), encoding: 'utf8' });
    git('init', '-q');
    execFileSync('sh', ['-c', 'echo a > a.txt'], { cwd: h.cwd });
    git('add', 'a.txt');
    git('commit', '-q', '-m', 'a');
    // The criterion's premise, from the real deep-hook: a fail_closed entry matches the call, with a hub-away denial.
    const entries = (JSON.parse(readFileSync(h.rules, 'utf8')) as Line).entries as Record<string, Line>;
    const read = JSON.parse(execFileSync(DEEP_HOOK, ['match'], { input: `${JSON.stringify({ tool_name: 'bash', tool_input: { command: DISCARD }, cwd: h.cwd })}\n`, env: env(h.home), encoding: 'utf8' }).split('\n')[0]!) as Line;
    const closed = (read.matched as string[] | undefined ?? []).filter((n) => entries[n]?.fail_closed === true);
    if (!closed.length || !(read.denials as unknown[] | undefined)?.length) blocked(`\`${DISCARD}\` isn't matched by a fail_closed entry with a hub-away denial: deep-hook match said ${JSON.stringify(read).slice(0, 600)}`);

    const client = await Client.open(h.hub);
    // One run, both calls: a run that did work ends in the hub's stop hold, which a second prompt would wait behind.
    const pi = await Pi.start(h, [bash(DISCARD), bash('ls'), { text: 'Done.' }]);
    const [r, ls] = await prompt(pi, 1, 2, false);
    await answered(r!, client, `\`${DISCARD}\``);
    expect(r!.blocked, `with rules.json readable and the hub running, the pi tool_call for \`${DISCARD}\` (matched by ${closed.join(', ')}) must be decided by the hub's reply, which lets it run; it was blocked: ${r!.words.slice(0, 600)}`).toBe(false);
    expect(ls!.blocked, `with rules.json readable and the hub running, the pi tool_call for \`ls\` must run: ${ls!.words.slice(0, 600)}`).toBe(false);
    expect(ls!.words, '`ls` must have run in the working folder').toContain('a.txt');
  }, 240_000);
});

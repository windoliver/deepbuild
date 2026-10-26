// #315 AC2 and AC8's overhead half, blind redraft (AC2-AC8-REDRAFT.md). Hook overhead "under 10 ms at p95 on top of
// process start, measured over 1,000 calls" (AC2), the same number as a budget on the reference Mac (AC8), measured
// "with hyperfine against a native no-op binary as the floor" (AC9). The call timed is the issue's: a PreToolUse for
// `ls` forwarded to a running hub, with the matcher running. The home's rules.json holds an entry `ls` matches in
// `watch` mode (guard@1: watch and warn don't deny; block does, #316) beside the suite's fail_closed `pkill` entry,
// so every measured call is matched and allowed, and the request the hub receives names the entry it matched.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, type TestContext } from 'vitest';
import {
  bash, buildDeepHook, childEnv, cleanup, decision, environmentProblem, forwarder, hook, hyperfinePath, jsonLines, judge,
  makeHome, newSession, p95, readSpool, run, RULES, setAddress, shared, shown, startHub, stopHub, tempDir, writeRules, type Guard,
  type Line,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const LIMIT_MS = 10;
const CALLS = 1000;
const HYPERFINE_RUNS = 5;

/** The entry the measured `ls` matches without being denied, beside the suite's fail_closed entry it doesn't match. */
const WATCHED = 'listing-watched';
const ENTRIES: Record<string, Guard> = {
  'no-kill-by-name': RULES['no-kill-by-name']!,
  [WATCHED]: { match: 'shell:ls*', scope: 'all_repos', mode: 'watch', reason: 'Listing is watched by the hub.', next_step: 'Nothing to do.', fail_closed: false },
};

/** The floor: a native binary that does nothing, `fn main() {}` built by rustc at opt-level 3 (README, Budgets). */
async function buildNoop(): Promise<string> {
  const dir = join(tempDir(), 'noop');
  mkdirSync(dir);
  writeFileSync(join(dir, 'noop.rs'), 'fn main() {}\n');
  const binary = join(dir, 'noop');
  const r = await run('rustc', ['-C', 'opt-level=3', '-o', binary, join(dir, 'noop.rs')], { timeoutMs: 120_000 });
  if (r.code !== 0) throw Error(`BLOCKED: rustc failed to build the no-op floor: ${r.stderr.slice(-2000)}`);
  const first = spawnSync(binary, [], { stdio: 'ignore', timeout: 30_000 }); // the first exec of a new binary is slow on macOS
  if (first.status !== 0) throw Error(`BLOCKED: the no-op floor exited ${first.status}`);
  return binary;
}

interface Measured {
  /** The proof call's result, through the forwarder, before any number is read. */
  proof: { ran: Awaited<ReturnType<typeof hook>>; requests: Line[] };
  /** Per hyperfine run: p95 of 1,000 deep-hook calls minus p95 of 1,000 floor runs, in ms. */
  overheadMs: number[];
  /** Per hyperfine run: the two commands' exit codes as hyperfine saw them. */
  exits: { hook: number[]; floor: number[] }[];
  /** Requests in the home's spool after the runs: a forwarded call is never spooled, a failed-open one is. */
  spooled: number;
}

/**
 * One measurement for both criteria: the release deep-hook, a hub on a fresh home whose rules.json holds ENTRIES, one
 * forwarded `ls` read through the forwarder as the proof, then HYPERFINE_RUNS hyperfine runs of CALLS calls each of the
 * floor and of deep-hook straight to the hub's socket (`-N`, `--input`), exported as JSON.
 */
const measure = shared(async (): Promise<Measured> => {
  const hyperfine = hyperfinePath();
  if (!hyperfine) throw Error('BLOCKED: hyperfine missing on PATH');
  const [binary, noop] = await Promise.all([buildDeepHook({ release: true }), buildNoop()]);
  const home = makeHome();
  writeRules(home, ENTRIES);
  const s = newSession(home);
  const hub = await startHub({ home });
  try {
    // The proof: the call the bench times, once, through a forwarder that keeps the bytes the hub receives.
    const f = await forwarder(tempDir(), hub.socket);
    setAddress(home, `unix:${f.path}`);
    const ran = await hook(home, s, 'PreToolUse', bash(s, 'ls'), { binary });
    await f.close();
    const requests = jsonLines(f.upText()).filter((l) => l.event === 'PreToolUse' && l.payload?.session_id === s.id);

    // The measurement: the same call, straight to the hub, CALLS times per run beside the floor.
    setAddress(home, `unix:${hub.socket}`);
    const input = join(tempDir(), 'pretooluse.json');
    writeFileSync(input, JSON.stringify(bash(s, 'ls')));
    const overheadMs: number[] = [];
    const exits: Measured['exits'] = [];
    for (let i = 0; i < HYPERFINE_RUNS; i++) {
      const out = join(tempDir(), `hyperfine-${i}.json`);
      const args = ['-N', '--input', input, '--warmup', '20', '--runs', String(CALLS), '--style', 'none', '--export-json', out, noop, `${binary} claude-code PreToolUse`];
      const r = await run(hyperfine, args, { env: childEnv(home), cwd: s.cwd, timeoutMs: 600_000 });
      if (r.code !== 0) throw Error(`hyperfine run ${i + 1} exited ${r.code}: ${r.stderr.trim().slice(-1500)}`);
      const results = (JSON.parse(readFileSync(out, 'utf8')) as { results: { command: string; times: number[]; exit_codes: number[] }[] }).results;
      const floor = results.find((x) => x.command === noop);
      const dh = results.find((x) => x.command !== noop);
      if (!floor || !dh) throw Error(`BLOCKED: hyperfine's JSON names ${results.map((x) => x.command).join(', ')}`);
      exits.push({ hook: dh.exit_codes, floor: floor.exit_codes });
      overheadMs.push((p95(dh.times) - p95(floor.times)) * 1000);
    }
    return { proof: { ran, requests }, overheadMs, exits, spooled: readSpool(home).requests.length };
  } finally {
    await stopHub(hub);
  }
});

/** INCONCLUSIVE, naming why, when this machine's numbers are a reading only or hyperfine is missing (README, Budgets). */
function gate(ctx: TestContext): boolean {
  const problem = environmentProblem();
  if (problem) { ctx.skip(`INCONCLUSIVE: ${problem}`); return false; }
  if (!hyperfinePath()) { ctx.skip('INCONCLUSIVE: hyperfine is not on PATH'); return false; }
  return true;
}

/** Before a number counts, the timed call is shown to be the issue's: allowed, matched by WATCHED only, and every call exited 0. */
function proven(m: Measured): void {
  const { ran, requests } = m.proof;
  expect(ran.code, `the forwarded ls exits 0 (${shown(ran)})`).toBe(0);
  expect(decision(ran), `the forwarded ls is allowed, not denied by its watch-mode entry (${shown(ran)})`).toBe('allow');
  expect(requests.length, 'the hub received the one PreToolUse request of this session').toBe(1);
  expect(requests[0]!.matched, `the request names the entry ls matched, so the matcher ran (${JSON.stringify(requests[0]!.matched)})`).toEqual([WATCHED]);
  for (const [i, e] of m.exits.entries()) {
    expect(e.hook.length, `hyperfine run ${i + 1} timed ${CALLS} deep-hook calls`).toBe(CALLS);
    expect(e.floor.length, `hyperfine run ${i + 1} timed ${CALLS} floor runs`).toBe(CALLS);
    expect(e.hook.every((c) => c === 0), `hyperfine run ${i + 1}: every deep-hook call exited 0`).toBe(true);
  }
  expect(m.spooled, 'no measured call was spooled: each reached the hub rather than failing open').toBe(0);
}

describe('AC2 #315.9543886e overhead under 10 ms at p95 on top of process start, measured over 1,000 calls (redraft)', () => {
  it('AC2 1,000 PreToolUse calls for ls forwarded to a running hub, each matched by a watch-mode entry and allowed, cost under 10 ms at p95 over a native no-op binary', async (ctx: TestContext) => {
    if (!gate(ctx)) return;
    const m = await measure();
    proven(m);
    judge(ctx, 'AC2 p95 overhead over the no-op floor, ms, per hyperfine run', m.overheadMs, LIMIT_MS);
  }, 900_000);
});

describe('AC8 #315.515d4e08 budgets on the reference Mac in the local preflight, compared with the merge base (redraft)', () => {
  it('AC8 on the reference Mac, the forwarded call\'s p95 overhead on top of process start, measured with hyperfine against the no-op floor, is under 10 ms', async (ctx: TestContext) => {
    if (!gate(ctx)) return;
    const m = await measure();
    proven(m);
    judge(ctx, 'AC8 p95 overhead over the no-op floor, ms, per hyperfine run', m.overheadMs, LIMIT_MS);
  }, 900_000);
});

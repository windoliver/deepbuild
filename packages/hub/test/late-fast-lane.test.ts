// #2075 scope the hook acceptance cases leave out: the runner's own hold expires, then INVALID, loop/background
// holds and the next turn's stop. Real checkouts, record, supervisor and command checks; only the gate's clock is
// stepped. A file in the fast check's checkout lets that real process finish after the turn-end reading.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openAsks } from '@deepbuild/asks';
import { runCommandCheck } from '@deepbuild/checks-command';
import { openCheckouts } from '@deepbuild/gate';
import { openLeases } from '@deepbuild/leases';
import { openRecord, ulid, type Connection } from '@deepbuild/record';
import { openSupervisor } from '@deepbuild/supervisor';
import { GateRunner, type GateOptions } from '../src/gate-runner.js';

const CORE: Connection = { writer: 'core', actor: 'you', scope: 'you' };
const CLAIM = 'claim:late', SESSION = 'late';
const FAST = 'fast.test.mjs', SLOW = 'slow.test.mjs';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
async function until(ok: () => boolean | Promise<boolean>, reason: string): Promise<void> {
  for (const end = Date.now() + 15_000; Date.now() < end;) { if (await ok()) return; await sleep(20); }
  expect(await ok(), reason).toBe(true);
}

async function world(invalid = false, pendingDefinition = false, beforeSnapshot = false) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-late-fast-')));
  const cwd = join(dir, 'repo');
  mkdirSync(cwd);
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  writeFileSync(join(cwd, 'value.txt'), '1');
  const imports = "import { test } from 'node:test'; import assert from 'node:assert/strict'; import { existsSync, readFileSync } from 'node:fs';\n";
  const assertion = "assert.equal(readFileSync('value.txt', 'utf8'), '1')";
  writeFileSync(join(cwd, FAST), `${imports}for (const end = Date.now() + 20000; !existsSync('release') && Date.now() < end;) await new Promise(r => setTimeout(r, 20));\ntest('fast', { skip: ${invalid} }, () => { assert.ok(existsSync('release')); ${assertion}; });\n`);
  writeFileSync(join(cwd, SLOW), `${imports}test('slow', () => { ${assertion}; });\n`);
  git('add', '.'); git('commit', '-qm', 'checks and input');
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const leases = await openLeases({ record, now: Date.now, cores: 4 });
  const host = await openSupervisor({ record, asks, leases, now: Date.now, settings: { asks: { unblock: { deadline_ms: 60_000 } } } });
  const checkouts = await openCheckouts({ store: join(dir, 'store'), root: join(dir, 'checkouts'), kinds: [], host, leases, now: Date.now });
  const starts: Parameters<GateOptions['start']>[0][] = [];
  const runs = new Map<string, Promise<string>>();
  const capped: string[][] = [];
  let now = 0;
  let busy = 0;
  const gate: GateRunner = new GateRunner({
    raw: (q, p) => record.raw(q, p), append: async (c, e) => { await record.append(c, e); }, core: CORE,
    now: () => now, budget_ms: 10_000, hold_ms: 30, slots: () => ({ free: 2 - busy }),
    checkouts: () => checkouts, stopping: () => false,
    invalid: async (_claim, _commit, why) => { throw Error(why); }, stoodIn: async () => undefined,
    capped: (_session, checks) => { capped.push(checks); },
    start: async (r) => {
      starts.push(r); busy++;
      const run = `run:${ulid(Date.now())}`;
      runs.set(run, runCommandCheck({ host, run, spec: { kind: 'command', runner: r.command, inputs: ['value.txt'], depth: 'unit', oracle: 'code', contract: null }, checkout: r.cwd, deadline: 30_000 }).then(async (result) => {
        gate.recorded(run, result);
        if (r.key) await gate.keyed(r.key, run, result);
        return result.outcome;
      }).finally(() => { busy--; }));
      return run;
    },
    ended: (run) => runs.get(run)!,
  });
  const release = () => { for (const r of starts.filter((r) => r.check === FAST)) writeFileSync(join(r.cwd, 'release'), 'go'); };
  cleanups.push(async () => {
    await host.close();
    await Promise.allSettled(runs.values());
    await sleep(30);
    await checkouts.close();
    await record.close();
    rmSync(dir, { recursive: true, force: true });
  });
  if (beforeSnapshot) await gate.turnEnded(CLAIM, [], 0, { session: SESSION, origin: 'person', due: null, starter: null });
  const lane = await gate.stop({
    session: SESSION, claim: CLAIM, task: 'task:late', cwd, base: git('rev-parse', 'HEAD'), stopAt: 0, definition: pendingDefinition ? 'pending' : 'locked',
    requirements: [FAST, SLOW].map((req) => ({ req, oracle: 'code', depth: 'unit', on_base: 'passes' })),
    checks: [FAST, SLOW].map((check) => ({ check, approved: null, command: `node --test ${check}`, covers: [check], depth: 'unit', on_base: 'passes', source: pendingDefinition ? 'spec' : 'definition', asserts: [], expected_ms: check === FAST ? 0 : 300_000 })),
  });
  expect(lane.fast).toEqual([FAST]); expect(lane.slow).toEqual([SLOW]);
  await until(() => starts.some((r) => r.check === FAST), 'the fast run started');
  expect(gate.standing(CLAIM).find((r) => r.check === FAST)?.result).toBe('pending');
  return {
    gate, starts, capped, release,
    at: (ms: number) => { now = ms; gate.tick(); },
    end: (background: string[] = [], origin = 'continuation') => gate.turnEnded(CLAIM, background, 0, { session: SESSION, origin, due: null, starter: null }),
    held: async () => record.raw("SELECT data FROM events WHERE kind = 'check.held'"),
    slow: () => starts.filter((r) => r.check === SLOW),
    fastDone: () => until(() => gate.standing(CLAIM).find((r) => r.check === FAST)?.result !== 'pending', 'the fast check ended'),
    passed: async () => {
      await until(() => gate.verdictOf(CLAIM)?.outcome === 'PASS', 'both real checks pass');
      expect(starts.filter((r) => r.check === SLOW).map((r) => r.lane)).toEqual(['slow']);
    },
  };
}

describe('#2075 late fast-lane handoff', () => {
  it('starts no slow run while the fast check runs or after its zero-test run makes it INVALID', async () => {
    const w = await world(true);
    await w.end([], 'person');
    expect(w.slow(), 'the fast check is still running').toEqual([]);
    w.release(); await w.fastDone();
    expect(w.gate.verdictOf(CLAIM)?.outcome).toBe('INVALID');
    await sleep(100);
    expect(w.slow(), 'INVALID starts no slow check').toEqual([]);
    expect(w.gate.standing(CLAIM).find((r) => r.check === SLOW)?.result).toBe('pending');
  }, 30_000);

  it('keeps the loop grace deadline at the reply, not at the late fast completion', async () => {
    const w = await world();
    w.at(100); await w.end();
    expect(w.slow()).toEqual([]);
    w.at(55_100); w.release(); await w.fastDone();
    await until(async () => (await w.held()).length > 0, 'the slow check takes its held place');
    expect(w.slow(), 'the loop grace is still open').toEqual([]);
    w.at(60_100); await w.passed();
  }, 30_000);

  it('keeps the background cap at the stop, not at the late fast completion', async () => {
    const w = await world();
    await w.end(['build'], 'scheduled');
    expect(w.slow()).toEqual([]);
    w.at(29 * 60_000); w.release(); await w.fastDone();
    await until(async () => (await w.held()).length > 0, 'background work holds the slow check');
    expect(w.slow()).toEqual([]);
    w.at(30 * 60_000); await w.passed();
    expect(w.capped).toEqual([[SLOW]]);
  }, 30_000);

  it.each(['background', 'session'] as const)('observes the %s ending before the fast lane finishes', async (ended) => {
    const w = await world();
    await w.end(['build'], 'scheduled');
    if (ended === 'background') w.gate.idle(SESSION, { background: 0, crons: 0 });
    else w.gate.ended(SESSION);
    expect(w.slow(), 'ending background work never outruns the fast check').toEqual([]);
    w.release(); await w.passed();
    expect(await w.held(), 'no obsolete background hold is created').toEqual([]);
  }, 30_000);

  it('retains a turn end received before the snapshot exists, without starting slow checks before fast completion', async () => {
    const w = await world(false, false, true);
    expect(w.slow()).toEqual([]);
    w.release(); await w.passed();
  }, 30_000);

  it('keeps spec checks running while the definition is pending, without passing the claim', async () => {
    const w = await world(false, true);
    await w.end([], 'person');
    w.release(); await w.fastDone();
    await until(() => w.gate.standing(CLAIM).find((r) => r.check === SLOW)?.result === 'PASS', 'the slow spec check finishes while the definition waits');
    expect(w.gate.verdictOf(CLAIM)?.outcome, 'nothing passes before the definition locks').toBe('pending');
  }, 30_000);

  it('cancels placement when a prompt arrives while the loop queue wait is being read', async () => {
    const w = await world();
    w.release(); await w.fastDone();
    const placing = w.end();
    w.gate.prompted(SESSION);
    await placing;
    w.at(60_000); await sleep(100);
    expect(w.slow(), 'the earlier reply cannot create a grace timer after the prompt').toEqual([]);
    expect(await w.held()).toEqual([]);
    await w.end([], 'person'); await w.passed();
  }, 30_000);

  it('waits for the newer turn to stop, then starts once even when the snapshot is unchanged', async () => {
    const w = await world();
    await w.end([], 'person');
    w.gate.prompted(SESSION);
    w.release(); await w.fastDone(); await sleep(100);
    expect(w.slow(), 'the previous reply cannot end the new turn').toEqual([]);
    await w.end([], 'person'); await w.passed();
    await w.end([], 'person');
    expect(w.slow(), 'repeating the turn end does not run the check twice').toHaveLength(1);
  }, 30_000);
});

// AC10 #148.b1b5d323, blind redraft for #1830 (README): "Budgets, on the reference Mac in the local preflight, compared
// with the merge base: a sync across five agents takes under 1 s and makes no network call."
//
// It runs in place of tests/acceptance/148/budgets.test.ts and measures what that draft measures. The five agents are
// Claude Code, Codex and pi, real, and OpenCode and Cursor, each a command its facts name on the login PATH answering
// its newest covered version (../148/README.md: The world). Each run proposes one new server to all five, then times
// your yes: from the start of `deep inbox answer` to the first agents.read that shows the sync complete, so a reading is
// late, never early. One warm-up, then five runs.
//
// What this draft adds: each run reads the one-minute load average, os.loadavg()[0], at its start (just before your
// yes) and at its end (once the sync reads complete), and scripts/benchmark.mjs's `judgeLimit` gets them as `loads`,
// one { start, end } per run in the runs' order, with this machine's fingerprint (the design's timing rule: a run whose
// load at its start or its end is above the core count counts neither way). judgeLimit is the judge: PASS passes, FAIL
// fails, and INCONCLUSIVE (off a reference Mac, or loaded) or BLOCKED fails as `INCONCLUSIVE: ...`, the #148 suite's
// way, never a pass. "No network call" holds anywhere: the hub runs with fixtures/net-log.cjs preloaded, which writes
// every TCP or UDP connect and DNS lookup it makes, and none may fall inside a run, from its proposal to its completion.
import { readFileSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, NET_LOG_PRELOAD, REPO, answer, inconclusive, makeWorld, parse, propose, shown, startHub, stdioServer, syncReaches, tag, useCleanup, type Line,
} from '../148/helpers.ts';

useCleanup();
const FIVE = ['claude-code', 'codex', 'pi', 'opencode', 'cursor'];
const LIMIT_MS = 1000;

/** The one-minute load average at a run's start and at its end. */
interface Load { start: number; end: number }
interface Judged { status: string; reason?: string }
interface Benchmark {
  judgeLimit(a: { limit: number; runs: number[]; fingerprint: unknown; loads: Load[] }): Judged;
  fingerprint(): unknown;
}

describe('#148 budgets', () => {
  it(`${AC[10]} a sync across five agents takes under 1 s and makes no network call`, async () => {
    const w = await makeWorld({ opencode: true, cursor: true });
    const netLog = join(w.tmp, 'net.jsonl');
    writeFileSync(netLog, '');
    await startHub(w, { env: { NODE_OPTIONS: `--require ${NET_LOG_PRELOAD}`, FIXTURE_NET_LOG: netLog } });
    const runs: number[] = [];
    const loads: Load[] = [];
    const calls: Line[] = [];
    for (let i = 0; i < 6; i++) {
      const from = Date.now();
      const p = await propose(w, { via: 'app', server: stdioServer(w, `forge-${tag()}`), agents: FIVE });
      const reached = new Set(p.files.flatMap((f) => f.agents));
      expect(FIVE.filter((a) => !reached.has(a)), `the plan reaches all five agents: ${shown(p.files)}`).toEqual([]);
      const start = loadavg()[0]!;
      const t0 = performance.now();
      await answer(w, p.ask, 'apply');
      await syncReaches(w, p.sync, ['complete'], 60_000);
      const ms = performance.now() - t0;
      const end = loadavg()[0]!;
      const to = Date.now();
      calls.push(...readFileSync(netLog, 'utf8').split('\n').flatMap((l) => (parse(l) ? [parse(l)!] : [])).filter((c) => c.at >= from && c.at <= to));
      if (i > 0) {
        runs.push(ms);
        loads.push({ start, end });
      }
    }
    expect(calls, 'a sync makes no network call: the hub connected or looked up a name during a sync').toEqual([]);

    const { judgeLimit, fingerprint } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as Benchmark;
    const verdict = judgeLimit({ limit: LIMIT_MS, runs, fingerprint: fingerprint(), loads });
    const line = `a sync across five agents, ms from your yes to complete: ${verdict.status} ${runs.map((r) => r.toFixed(0)).join(', ')} against ${LIMIT_MS}`
      + `, one-minute load at each run's start and end ${loads.map((l) => `${l.start.toFixed(2)}-${l.end.toFixed(2)}`).join(', ')}${verdict.reason ? ` (${verdict.reason})` : ''}`;
    console.log(`${AC[10]}: ${line}`);
    expect(verdict.status, `FAIL: ${line}`).not.toBe('FAIL');
    if (verdict.status !== 'PASS') inconclusive(line);
  });
});

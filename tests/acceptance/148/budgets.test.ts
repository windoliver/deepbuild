// AC10 #148.b1b5d323: Budgets, on the reference Mac in the local preflight, compared with the merge base: a sync across
// five agents takes under 1 s and makes no network call.
//
// The five agents are Claude Code, Codex and pi, real, and OpenCode and Cursor, each a command its facts name on the
// login PATH answering its newest covered version (README: The agents). Each run proposes one new server to all five,
// then times your yes: from the start of `deep inbox answer` to the first agents.read that shows the sync complete, so
// a reading is late, never early. One warm-up, then five runs, judged by scripts/benchmark.mjs's `judgeLimit` with this
// machine's fingerprint, as #149's budgets are: off a reference Mac, or on a loaded one, the timing is INCONCLUSIVE,
// never PASS. The merge base has no sync to compare with. "No network call" holds anywhere: the hub runs with
// fixtures/net-log.cjs preloaded, which writes every TCP or UDP connect and DNS lookup it makes, and none may fall
// inside a run, from its proposal to its completion.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, NET_LOG_PRELOAD, REPO, answer, inconclusive, loadPerCore, makeWorld, parse, propose, shown, startHub, stdioServer, syncReaches, tag, useCleanup, type Line,
} from './helpers.ts';

useCleanup();
const FIVE = ['claude-code', 'codex', 'pi', 'opencode', 'cursor'];
const LIMIT_MS = 1000;

describe('#148 budgets', () => {
  it(`${AC[10]} a sync across five agents takes under 1 s and makes no network call`, async () => {
    const w = await makeWorld({ opencode: true, cursor: true });
    const netLog = join(w.tmp, 'net.jsonl');
    writeFileSync(netLog, '');
    await startHub(w, { env: { NODE_OPTIONS: `--require ${NET_LOG_PRELOAD}`, FIXTURE_NET_LOG: netLog } });
    const runs: number[] = [];
    const calls: Line[] = [];
    for (let i = 0; i < 6; i++) {
      const from = Date.now();
      const p = await propose(w, { via: 'app', server: stdioServer(w, `forge-${tag()}`), agents: FIVE });
      const reached = new Set(p.files.flatMap((f) => f.agents));
      expect(FIVE.filter((a) => !reached.has(a)), `the plan reaches all five agents: ${shown(p.files)}`).toEqual([]);
      const t0 = performance.now();
      await answer(w, p.ask, 'apply');
      await syncReaches(w, p.sync, ['complete'], 60_000);
      const ms = performance.now() - t0;
      const to = Date.now();
      calls.push(...readFileSync(netLog, 'utf8').split('\n').flatMap((l) => (parse(l) ? [parse(l)!] : [])).filter((c) => c.at >= from && c.at <= to));
      if (i > 0) runs.push(ms);
    }
    expect(calls, 'a sync makes no network call: the hub connected or looked up a name during a sync').toEqual([]);

    const { judgeLimit, fingerprint } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as {
      judgeLimit(a: { limit: number; runs: number[]; fingerprint: unknown }): { status: string; reason?: string };
      fingerprint(): unknown;
    };
    const verdict = judgeLimit({ limit: LIMIT_MS, runs, fingerprint: fingerprint() });
    const line = `a sync across five agents, ms from your yes to complete: ${verdict.status} ${runs.map((r) => r.toFixed(0)).join(', ')} against ${LIMIT_MS} at load ${loadPerCore().toFixed(2)} a core${verdict.reason ? ` (${verdict.reason})` : ''}`;
    console.log(`${AC[10]}: ${line}`);
    if (loadPerCore() > 1) inconclusive(`under load: ${line}`);
    expect(['PASS', 'INCONCLUSIVE'], `FAIL or BLOCKED: ${line}`).toContain(verdict.status);
    if (verdict.status === 'INCONCLUSIVE') inconclusive(line);
  });
});

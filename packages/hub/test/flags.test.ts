// The flags a row shows beside its word (#2019): one reading of a session's facts gives its word and at most one flag,
// never a flag as its word; each flag reads only its own record facts.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRecord } from '@deepbuild/record';
import { verdictLine } from '@deepbuild/verdicts';
import { afterEach, expect, it } from 'vitest';
import { decide, repeatOf, sessionStates, type Call, type SessionFacts } from '../src/status.js';
import { ulid } from '../src/wire.js';

const NOW = 1_800_000_000_000;
const at = (log_pos: number, kind = 'tool.after') => ({ kind, ts: NOW - 60_000 + log_pos, log_pos });
const facts = (more: Partial<SessionFacts>): SessionFacts => ({ id: 's1', project_id: null, agent: 'claude-code', worktree: null, status: 'working', stopCause: null, last_seen: NOW - 1000, statusBy: at(1, 'user.ask'), ...more });
const failed = (n: number, command: string, signature: string, outcome = 'failed'): Call => ({ kind: 'shell', command, server: null, tool: null, args: null, outcome, exit_code: outcome === 'failed' ? 1 : 0, signature: outcome === 'failed' ? signature : null, at: at(n) });

afterEach(() => { delete process.env.DEEP_HUB_PLANT; });

it('three alike failures in one turn read working, flagged repeating with the command and the count', () => {
  const calls = [failed(4, 'pnpm test --filter api', 'sig:a'), failed(3, 'pnpm test --filter api', 'sig:a'), failed(2, 'pnpm test --filter api', 'sig:a')];
  const r = decide(facts({ calls }), NOW);
  expect([r.state, r.flag?.code, r.flag?.command, r.flag?.count]).toEqual(['working', 'repeating', 'pnpm test --filter api', 3]);
  expect(r.flag?.text).toBe('`pnpm test --filter api` failed 3 times in a row with the same error (exit 1)');
  expect(r.flag?.since).toBe(at(2).ts);
  // Two signatures, or a pass between, is no repeat; keyed on the command alone, the planted detector reads one.
  const mixed = [failed(4, 'pnpm test --filter api', 'sig:a'), failed(3, 'pnpm test --filter api', 'sig:b'), failed(2, 'pnpm test --filter api', 'sig:a')];
  expect(decide(facts({ calls: mixed }), NOW).flag).toBeUndefined();
  expect(repeatOf([failed(4, 'pnpm test --filter api', 'sig:a'), failed(3, 'pnpm test --filter api', 'sig:a', 'ok'), failed(2, 'pnpm test --filter api', 'sig:a')])?.count).toBe(1);
  process.env.DEEP_HUB_PLANT = 'repeat-by-command';
  expect(decide(facts({ calls: mixed }), NOW).flag?.code).toBe('repeating');
});

it('a usage limit and a process gone mid-turn read interrupted; a session nothing proves gone reads quiet with no flag', () => {
  const limited = decide(facts({ status: 'stuck', stopCause: 'rate_limited', stopped: at(9, 'agent.stop'), resets: NOW + 3_600_000, doing: { call: failed(8, 'pnpm build', 'sig:b'), at: at(8, 'tool.before') } }), NOW);
  expect([limited.state, limited.flag?.code]).toEqual(['stuck', 'interrupted']);
  expect([limited.flag?.doing, limited.flag?.until]).toEqual(['pnpm build', NOW + 3_600_000]);
  expect(limited.flag?.text).toMatch(/^a usage limit stopped it while it ran `pnpm build`; it can pick up at \d{4}-\d\d-\d\d \d\d:\d\d$/);
  const gone = decide(facts({ gone: at(9, 'session.gone') }), NOW);
  expect([gone.state, gone.flag?.code, gone.flag?.text]).toEqual(['flagged', 'interrupted', 'its process exited mid-turn']);
  const unread = decide(facts({ status: 'unknown', last_seen: NOW - 2 * 86_400_000 }), NOW);
  expect([unread.state, unread.flag]).toEqual(['quiet', undefined]);
});

it('a watch-only session whose FAIL no send-back reached never reads sent back; its line says watch-only, why and the fix', () => {
  const claim = { made: at(5, 'claim.made'), outcome: 'FAIL', judged: at(6, 'verdict.made'), round: 1, owner: null, evidence: null };
  const watch = { cause: 'version' as const, version: '2.1.400', at: at(2, 'holds.watch') };
  const held = decide(facts({ status: 'finished', claim, watch, stopped: at(7, 'agent.stop') }), NOW);
  expect([held.state, held.flag?.code, held.flag?.text]).toEqual(['finished', 'watch-only', 'it runs claude-code 2.1.400, past the versions its facts cover']);
  expect(decide(facts({ status: 'finished', claim: { ...claim, sent: at(7, 'claim.sent_back') }, watch }), NOW).state).toBe('sent back');
  process.env.DEEP_HUB_PLANT = 'sent-back-without-hold';
  expect(decide(facts({ status: 'finished', claim, watch }), NOW).state).toBe('sent back');
  const line = verdictLine({ outcome: 'FAIL', requirements: [{ req: 'req:c#R1', outcome: 'FAIL', smallest: null, points_to: null }], round: 1, running: [], watch: { why: '2.1.400 past its facts', unsent: true } });
  expect(line).toMatch(/^watch-only: 2\.1\.400 past its facts · FAIL 0\/1 · next: you/);
  expect(line).not.toMatch(/sent back/);
});

it('an idle session with commits no remote branch holds is flagged; a working one is not', () => {
  const unpushed = { commits: 2, branch: 'fix/cart', at: at(9, 'commits.unpushed') };
  expect(decide(facts({ status: 'finished', stopped: at(8, 'agent.stop'), unpushed }), NOW).flag?.text).toBe('2 commits on fix/cart on no remote branch');
  expect(decide(facts({ unpushed }), NOW).flag).toBeUndefined();
});

it('retries read from the record show from the first, clear at the reply, and an older one read late changes nothing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'deep-flags-'));
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  let ts = Date.now();
  const append = (writer: string, kind: string, data: Record<string, unknown>, when = ++ts) => record.append({ writer, actor: 'you', scope: 'you', session: 's1' }, { v: 1, id: ulid(when + Math.floor(Math.random() * 1000)), kind, ts: when, ...(writer === 'hook' ? { seq: `${BigInt(when) * 1_000_000n}` } : { subject: 'session:s1' }), data: data as never });
  const read = async () => (await sessionStates((q) => record.raw(q), ts + 1)).find((r) => r.id === 's1')!;
  try {
    await append('hook', 'user.ask', { msg: 0, text: 'fix the cart', tasks: [], from: 'person' });
    const first = ++ts;
    await append('core', 'model.call', { outcome: 'retry', attempt: 1, max: 10, cause: 'overloaded', at: first, record: 'r1' }, first);
    await append('core', 'model.call', { outcome: 'retry', attempt: 2, max: 10, cause: 'overloaded', at: ++ts, record: 'r2' }, ts);
    const retrying = await read();
    expect([retrying.state, retrying.flag?.code, retrying.flag?.text, retrying.flag?.cause, retrying.flag?.count, retrying.flag?.since]).toEqual(['working', 'retrying', 'its model call was refused, overloaded: retry 2 of 10', 'overloaded', 2, first]);
    process.env.DEEP_HUB_PLANT = 'retry-reads-working';
    expect((await read()).flag).toBeUndefined();
    delete process.env.DEEP_HUB_PLANT;
    await append('core', 'model.call', { outcome: 'reply', at: ++ts, record: 'r3' }, ts);
    expect((await read()).flag).toBeUndefined();
    await append('core', 'model.call', { outcome: 'retry', attempt: 3, max: 10, cause: 'overloaded', at: first + 1, record: 'r0' }, ++ts);
    expect((await read()).flag).toBeUndefined();
  } finally {
    await record.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

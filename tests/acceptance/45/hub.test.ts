// #45, what you see through a real hub: the socket method numbers.read, the `deep numbers` command, deep_search over MCP and
// a real deep-hook's billing keys. The record is seeded before the hub starts, through the real record (tests/acceptance/26/
// helpers.ts). This file imports no readings, so at the merge base it fails at its assertions. Needs `npm run build` and
// `cargo build -p deep-hook`; a hub that can't start is BLOCKED, never a pass.
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Agent, agentWorld, callTool, cleanup, control, deep, events as logOf, filesHolding, makeHome, makeWorktree, rootOf, seed, startHub, stopHub, type Line, type Seeding } from '../26/helpers.ts';
import { ask, DAY, held, MINUTE, recorded, SECOND, usage, type Cost } from './events.ts';
import type { RecordEvent } from '../../../packages/readings/src/index.ts';

afterEach(cleanup, 30_000);
const TIMEOUT = 180_000;
const WHO = { actor: 'you', scope: 'you', project: 'shop' };

async function put(s: Seeding, events: RecordEvent[]): Promise<void> {
  for (const e of events) {
    s.at(e.ts);
    const writer = e.kind === 'user.ask' || e.kind === 'session.start' ? 'hook' : 'core';
    await s.record.append({ writer, ...WHO, ...(e.session ? { session: e.session } : {}), ...(writer === 'hook' ? { agent: 'claude-code' } : {}) }, { v: e.v ?? 1, id: e.id, kind: e.kind, ts: e.ts, data: e.data as never });
  }
}
async function rowsOf(hub: Parameters<typeof control>[0]): Promise<Line[]> {
  const conn = await control(hub);
  try {
    const reply = await conn.call('numbers.read', {});
    expect(reply.error, `numbers.read: ${JSON.stringify(reply.error)}`).toBeUndefined();
    expect(Array.isArray(reply.result?.rows), 'numbers.read returns rows').toBe(true);
    return reply.result.rows as Line[];
  } finally {
    conn.close();
  }
}
async function seededHub(events: (now: number) => RecordEvent[]) {
  const { home } = makeHome();
  const now = Date.now();
  await seed(home, (s) => put(s, events(now)), now - 45 * DAY);
  return startHub(home);
}

describe('the hub\'s Numbers', () => {
  it('#45.d2d39357 AC2 numbers.read gives every row its source and age, and `deep numbers` prints both on each line', async () => {
    const hub = await seededHub((now) => [recorded(now - 2 * DAY, 'reading:firstreview', 3600, 's', 'github', now - 2 * DAY), ask('Sa', now - 3 * MINUTE), held('Sa', now - MINUTE, { fast: 3000 })]);
    try {
      const rows = await rowsOf(hub);
      const first = rows.find((r) => r.id === 'reading:firstreview');
      expect(first?.source).toBe('github');
      expect(Math.abs(Number(first?.age_ms) - 2 * DAY), 'about 2 days old').toBeLessThan(5 * MINUTE);
      for (const r of rows) {
        expect(String(r.source ?? '').length, `${r.id} names its source`).toBeGreaterThan(0);
        expect(typeof r.age_ms, `${r.id} shows its age`).toBe('number');
      }
      const shown = await deep(hub.home, ['numbers']);
      expect(shown.code, shown.stderr).toBe(0);
      const line = shown.stdout.split('\n').find((l) => l.includes('firstreview'));
      expect(line, `deep numbers lists the reading: ${shown.stdout}`).toBeDefined();
      expect(line).toContain('github');
      expect(line, 'its age, such as 2d').toMatch(/\b\d+\s?(ms|s|m|min|h|d)\b/);
    } finally { await stopHub(hub); }
  }, TIMEOUT);

  it('#45.a5d4e1cd AC3 a reading 40 days old is STALE in numbers.read and `deep numbers`; one a minute old is not', async () => {
    const hub = await seededHub((now) => [recorded(now - 40 * DAY, 'reading:oldmerge', 7200, 's', 'github', now - 40 * DAY), recorded(now - MINUTE, 'reading:newmerge', 3600, 's', 'github', now - MINUTE)]);
    try {
      const rows = await rowsOf(hub);
      expect(rows.find((r) => r.id === 'reading:oldmerge')?.status).toBe('STALE');
      expect(rows.find((r) => r.id === 'reading:newmerge')?.status).toBe('current');
      const lines = (await deep(hub.home, ['numbers'])).stdout.split('\n');
      expect(lines.find((l) => l.includes('oldmerge')), 'the line says so').toContain('STALE');
      expect(lines.find((l) => l.includes('newmerge')), 'never on a current one').not.toContain('STALE');
    } finally { await stopHub(hub); }
  }, TIMEOUT);

  it('#45.f68b8bc0 AC12 through the hub, the turn reads 14 s, and the session 14 s, each by reason', async () => {
    const hub = await seededHub((now) => {
      const start = now - 10 * MINUTE;
      return [ask('Sh', start), held('Sh', start + 8 * SECOND, { snapshot_start: 1000, fast: 7000 }), held('Sh', start + 134 * SECOND, { snapshot_start: 1000, queue_wait: 1000, fast: 4000 })];
    });
    try {
      const rows = await rowsOf(hub);
      const turn = rows.find((r) => r.id === 'held.turn');
      expect(turn?.value, 'not 134 s, not 6 s').toBe(14_000);
      expect(turn?.unit).toBe('ms');
      expect(rows.find((r) => r.id === 'held.session')?.value).toBe(14_000);
    } finally { await stopHub(hub); }
  }, TIMEOUT);

  it('#45.4768ed8f AC6 a session a real deep-hook starts with ANTHROPIC_API_KEY set shows as billing an API key, and the key\'s value is nowhere in the state folder', async () => {
    const secret = `sk-ant-fixture-${'x'.repeat(24)}`;
    const { tmp, home } = makeHome();
    const wt = makeWorktree(join(tmp, 'work'));
    const agent = Agent.start(home, wt.path, { ANTHROPIC_API_KEY: secret });
    const session = agent.session(wt.path);
    const hub = await startHub(home);
    try {
      await agent.establish(hub, session);
      const log = await logOf(hub);
      expect(log.find((e) => e.kind === 'session.start')?.data?.billing?.ANTHROPIC_API_KEY, 'the hook reports the key as true').toBe(true);
      const rows = await rowsOf(hub);
      expect(rows.filter((r) => r.id === 'billing.mode').map((r) => r.value), 'one session, billing an API key').toEqual(['api_key']);
      expect(filesHolding(rootOf(home), [secret]), 'never a value').toEqual([]);
    } finally { await stopHub(hub); }
  }, TIMEOUT);
});

describe('deep_search over MCP', () => {
  const TASK = 'task:01K74FX2B4D6F8H0K2M4P6R8T0';
  const COST: Cost = { basis: 'reported', usd: 0.25 };

  it('#45.eb25cf40 AC11 a session\'s deep_search for spend returns the task\'s spend, $0.25, with its source and as-of time', async () => {
    const at = Date.now() - 5 * MINUTE;
    const w = await agentWorld({
      seeded: (s, session) => put(s, [ask(session.id, at, 'person', [TASK]), usage(session.id, at + 1000, 'msg_spend', { input: 10, output: 5 }, COST)]),
    });
    try {
      const outcome = await callTool(w.agent, 'deep_search', { query: 'spend' });
      expect(outcome.isError, JSON.stringify(outcome.reply).slice(0, 800)).toBe(false);
      const hits = (outcome.value?.hits ?? []) as Line[];
      const hit = hits.find((h) => h.reading?.id === 'spend.usd' && h.reading?.subject === TASK);
      expect(hit, `a reading among the hits: ${JSON.stringify(hits).slice(0, 800)}`).toBeDefined();
      expect(hit?.reading.value).toBeCloseTo(0.25, 10);
      expect(String(hit?.source ?? '').length, 'its source').toBeGreaterThan(0);
      expect(hit?.as_of, 'as of the usage it sums').toBe(at + 1000);
    } finally { await stopHub(w.hub); }
  }, TIMEOUT);
});

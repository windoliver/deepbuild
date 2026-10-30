// #45 AC11 (in part): `deep_search` returns a task's spend, with its source and as-of time, to a session's search, over
// MCP, through a real hub. The record is seeded before the hub starts through the real record package, with events
// held to the schemas published at the base. README: Surfaces chosen.

import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { validate } from '../../../packages/contracts/src/index.ts';
import {
  Agent, callTool, cleanup, HOUR, initialize, makeHome, makeWorktree, MINUTE, PROJECT, seed, startHub, ulid, valueOf, type Line, type Seeding, type Session,
} from '../26/helpers.ts';

afterEach(cleanup, 30_000);

/** A session ID as turn.usage@1's subject takes it: letters and digits. */
const sessionId = (): string => `S${randomBytes(12).toString('hex')}`;

let clock = 0n;
/** Appends one event by the writer `writer` for `session`, first holding it to its published schema. */
async function append(s: Seeding, session: string, writer: string, event: Line): Promise<void> {
  const id = ulid(event.ts);
  const seq = String(BigInt(event.ts) * 1_000_000n + (clock += 1n));
  const whole = { id, writer, actor: 'you', scope: 'you', seq, ...event };
  const checked = validate(`${event.kind}@${event.v}`, whole);
  if (!checked.ok) throw Error(`BLOCKED: seeded ${event.kind}@${event.v} doesn't match its schema: ${JSON.stringify(checked)}`);
  await s.record.append({ writer, actor: 'you', scope: 'you', session, project: PROJECT, ...(writer === 'hook' ? { agent: 'claude-code' } : {}) }, { v: event.v, id, kind: event.kind, ts: event.ts, seq, data: event.data, ...(event.subject ? { subject: event.subject } : {}) });
}

/** A session that started, was asked for one task, and spent `costs` over its turns. */
async function seedTask(s: Seeding, o: { session: string; worktree: string; task: string; title: string; costs: { usd: number; at: number }[]; from: number }): Promise<void> {
  const { session, worktree, task, title, costs, from } = o;
  s.at(from);
  await append(s, session, 'hook', { v: 3, kind: 'session.start', ts: from, data: { agent: 'claude-code', worktree, branch: 'main', thread: session, loads: [] } });
  await append(s, session, 'core', { v: 1, kind: 'task.created', ts: from + 1, data: { task_ref: task, thread: session, owner: 'you', title } });
  await append(s, session, 'hook', { v: 1, kind: 'user.ask', ts: from + 2, data: { msg: 1, text: title, tasks: [task], from: 'person' } });
  for (const [i, { usd, at }] of costs.entries()) {
    s.at(at);
    await append(s, session, 'hook', {
      v: 1, kind: 'turn.usage', ts: at, subject: `session:${session}`,
      data: { turn: `msg_${session}_${i}`, model: 'claude-haiku-5-5', covers: 'turn', tokens: { input: 100, cached: 1000, output: 20, exact: true }, cost: { basis: 'reported', usd } },
    });
  }
}

/** Every value under `key`-matching keys, at any depth. */
function valuesAt(value: unknown, key: RegExp, into: unknown[] = []): unknown[] {
  if (Array.isArray(value)) for (const v of value) valuesAt(v, key, into);
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (key.test(k)) into.push(v);
      valuesAt(v, key, into);
    }
  }
  return into;
}
/** A time as a hit may give it: ms since the epoch, or a date string. */
const asTime = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : NaN);

test('#45.d2b85f36 AC11 a session\'s deep_search for spend returns its task\'s spend, summed over the task\'s turns only, with its source and an as-of time', async () => {
  const { tmp, home } = makeHome();
  const wt = makeWorktree(join(tmp, 'work'));
  const id = sessionId();
  const other = sessionId();
  const task = `task:${ulid()}`;
  const otherTask = `task:${ulid()}`;
  const title = 'Fix the login page';

  const start = Date.now() - 2 * HOUR;
  const lastUsage = start + 40 * MINUTE;
  await seed(home, async (s) => {
    await seedTask(s, { session: id, worktree: wt.path, task, title, from: start, costs: [{ usd: 0.25, at: start + 20 * MINUTE }, { usd: 0.5, at: lastUsage }] });
    // Another session's task: its 9 dollars are no part of this task's spend.
    await seedTask(s, { session: other, worktree: wt.path, task: otherTask, title: 'Rewrite the billing page', from: start + MINUTE, costs: [{ usd: 9, at: start + 30 * MINUTE }] });
  }, start);

  const transcript = join(home, '.claude/projects', wt.path.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, `${JSON.stringify({ type: 'user', sessionId: id, cwd: wt.path, message: { role: 'user', content: title } })}\n`);
  const session: Session = { id, cwd: wt.path, transcript };

  const hub = await startHub(home);
  const agent = Agent.start(home, wt.path);
  await agent.hook(hub, session, 'SessionStart', { source: 'resume' });
  await agent.hook(hub, session, 'PreToolUse');
  await initialize(agent);
  const bound = valueOf(await callTool(agent, 'deep_status', {}), 'deep_status from the session');
  if (bound?.session !== id) throw Error(`BLOCKED: the agent's deep mcp isn't bound to ${id}: ${JSON.stringify(bound)}`);

  const value = valueOf(await callTool(agent, 'deep_search', { query: 'spend' }), 'deep_search for spend');
  const called = Date.now();
  const hits = (value?.hits ?? []) as Line[];
  const shown = JSON.stringify(hits).slice(0, 2000);

  const handle = task.slice('task:'.length);
  const reading = hits.find((h) => { const j = JSON.stringify(h); return j.includes(handle) || j.includes(title); });
  expect(reading, `deep_search for "spend" returns a hit naming the task ${task} ("${title}"): ${shown}`).toBeDefined();
  expect(JSON.stringify(reading), `the hit gives the task's spend, 0.25 + 0.50 = 0.75 USD: ${shown}`).toMatch(/(^|[^0-9.])0\.750*([^0-9]|$)/);

  const sources = valuesAt(reading, /^source$/i).filter((v) => typeof v === 'string' && v);
  expect(sources.length, `the reading names its source: ${shown}`).toBeGreaterThan(0);

  const asOf = valuesAt(reading, /^as[ _-]?of$/i).map(asTime);
  expect(asOf.length, `the reading gives an as-of time: ${shown}`).toBeGreaterThan(0);
  // The figure holds the last usage, so its as-of time is no earlier than that, and no later than this call.
  expect(asOf[0]!, `the as-of time is no earlier than the last usage it counts: ${shown}`).toBeGreaterThanOrEqual(lastUsage);
  expect(asOf[0]!, `the as-of time is no later than the call: ${shown}`).toBeLessThanOrEqual(called);
}, 120_000);

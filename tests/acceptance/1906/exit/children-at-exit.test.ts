// #1906 AC3: every child the core thread starts is in children.ts's table at exit, and fails on the merge base for
// the two forks (open-items.ts's `run`, scope.ts's `git log`). The design's side of it: the hub tracks every process
// it starts (One hub per user, deep hub; Platforms, process ownership).
//
// Read as (README): the core's thread is this one. It loads the modules core.ts loads (open-items.ts, scope.ts,
// session-facts.ts and children.ts, from the hub's build) and calls them as core.ts does; every child is a real `git`
// or `ps` behind a stand-in that holds at its own exit until this thread has read children.ts's tables. A child is in
// the table at exit when the tables then hold an entry they did not hold before the call, and no earlier child's.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { join } from 'node:path';
import { openRecord, ulid, type RecordStore } from '../../../../packages/record/src/index.ts';
import { hub, outside, tables, watched, world, type Child, type World } from './helpers.ts';

/** The recorded seed and the cases the local preflight runs (design: Universal rules are tested as properties). */
const SEED = 1906;
const RUNS = 1000;

type Hub = Awaited<ReturnType<typeof hub>>;
let h: Hub;
let w: World;
let record: RecordStore;
let table: ReturnType<typeof tables>;
beforeAll(async () => {
  h = await hub();
  w = world();
  record = await openRecord({ path: join(w.dir, 'ledger.db'), now: Date.now });
  table = tables(h.children, h.childrenFile);
}, 60_000);
afterAll(async () => {
  table?.close();
  await record?.close();
  w?.close();
});

const never = (what: string) => (): never => { throw Error(`${what} is not reached in this test`); };

/** One call of the core's that starts children, as core.ts makes it. */
type Call =
  // open-items.ts at a claim: the lines the change added since `base`, read with `git diff` and `git ls-files`.
  | { call: 'claim'; base: number }
  // scope.ts at a plan's lock: the repo's accepted changes of a kind up to `at`, read with `git log`, each measured by packages/gate.
  | { call: 'accepted'; kind: 'feature' | 'fix' | 'docs'; at: number }
  // session-facts.ts after a tool call: the commits between two, read with `git rev-list` through children.ts.
  | { call: 'commits'; from: number; to: number }
  // children.ts for a session's process: its start time, read with `ps`.
  | { call: 'start' };

/** Makes the call on real components, checks what it answered, and gives the children it started as they were at exit. */
async function make(c: Call): Promise<Child[]> {
  if (c.call === 'claim') {
    const task = `task:${ulid(Date.now())}`;
    const items = new h.openItems.OpenItems({
      raw: (query, params) => record.raw(query, params), append: async (connection, input) => { await record.append(connection, input); }, now: Date.now,
      connection: (session) => ({ writer: 'core', actor: 'you', scope: 'you', ...(session ? { session } : {}) }),
      asks: never('an ask'), pin: never('a pin'), github: never('GitHub'), taskList: () => undefined,
    });
    const { children } = await watched(w, table, () => items.atClaim({ session: 'session-1906', agent: 'claude-code', task, cwd: w.repo, base: w.commits[c.base]!, message: 'Done.', transcript: undefined, pr: undefined }));
    const opened = ((await record.raw(`SELECT data FROM events WHERE kind = 'open_item.opened' AND json_extract(data, '$.task_ref') = ? ORDER BY log_pos`, [task])) as { data: string }[]).map((r) => (JSON.parse(r.data) as { text: string }).text);
    expect(opened, 'the claim leaves the placeholder git diff shows and the one in the file git ls-files lists').toEqual([
      expect.stringContaining('placeholder left in a.js:2'), expect.stringContaining('placeholder left in notes.js:1'),
    ]);
    expect(children.length, 'the claim read started git').toBeGreaterThanOrEqual(1);
    return children;
  }
  if (c.call === 'accepted') {
    const sizing = new h.scope.SizeScope({
      raw: never('the record'), append: never('the record'), connection: never('a connection'), asks: never('an ask'), now: Date.now,
      pin: never('a pin'), keep: never('evidence'), scopeOf: never('a task'), evidence: w.dir, accepted: undefined,
    });
    const { result, children } = await watched(w, table, () => sizing.usual(w.repo, c.kind, w.commits[c.at]!));
    // Every `feat` adds 2 lines in 1 file and every `fix` 3 lines in 1: commits 1 and 3 are `feat`, commit 2 is `fix`.
    const n = c.kind === 'feature' ? [1, 3].filter((i) => i <= c.at).length : c.kind === 'fix' ? [2].filter((i) => i <= c.at).length : 0;
    expect(result, `the usual ${c.kind} as of commit ${c.at}`).toEqual(n ? { lines: c.kind === 'feature' ? 2 : 3, files: 1, n } : null);
    expect(children.length, 'the accepted read started git for the log, and again to measure each change').toBeGreaterThanOrEqual(1 + n);
    return children;
  }
  if (c.call === 'commits') {
    const [from, to] = [Math.min(c.from, c.to), Math.max(c.from, c.to)];
    const { result, children } = await watched(w, table, () => h.facts.commitsBetween(w.repo, w.commits[from]!, w.commits[to]!));
    // With none between them, the answer is the later commit alone.
    expect(result, `the commits after ${from} up to ${to}`).toEqual(from === to ? [w.commits[to]] : w.commits.slice(from + 1, to + 1));
    expect(children.length, 'the read started git').toBeGreaterThanOrEqual(1);
    return children;
  }
  const { result, children } = await watched(w, table, () => h.children.startOf(process.pid));
  expect(result, 'this process has a start time').toMatch(/\d{4}/);
  expect(children.length, 'the read started ps').toBeGreaterThanOrEqual(1);
  return children;
}

/**
 * The reading is live before a fork is judged by it: a child children.ts runs for the core (session-facts.ts's
 * `git rev-list`, its own `ps`) is in the table at its exit.
 */
async function reads(): Promise<void> {
  expect(Object.keys(table.read()), 'children.ts holds a table: a Map, a Set or an array under a top-level name').not.toEqual([]);
  expect(outside([...await make({ call: 'commits', from: 0, to: 3 }), ...await make({ call: 'start' })]), 'the children children.ts runs').toEqual([]);
}

describe('#1906 AC3 every child the core thread starts is in children.ts\'s table at exit', () => {
  it('the first fork: the two `git` children open-items.ts starts at a claim are each in the table at exit', async () => {
    await reads();
    expect(outside(await make({ call: 'claim', base: 0 }))).toEqual([]);
  }, 60_000);

  it('the second fork: the `git log` scope.ts starts to read the accepted changes is in the table at exit', async () => {
    await reads();
    // No accepted change is of this kind, so the log is the only child.
    const children = await make({ call: 'accepted', kind: 'docs', at: 3 });
    expect(children.map((c) => c.command), 'the accepted read is a git log').toContainEqual(expect.stringContaining('log --first-parent'));
    expect(outside(children)).toEqual([]);
  }, 60_000);

  it('a child started through another package: each `git` packages/gate runs to measure an accepted change is in the table at exit', async () => {
    await reads();
    const measuring = (await make({ call: 'accepted', kind: 'fix', at: 3 })).filter((c) => !c.command.includes('log --first-parent'));
    expect(measuring.length, 'measuring the one accepted fix started git').toBeGreaterThan(0);
    expect(outside(measuring)).toEqual([]);
  }, 60_000);

  it(`for ${RUNS} seeded runs of the core's calls, every child started is in the table at its exit (generator: calls, seed ${SEED})`, async () => {
    const index = fc.integer({ min: 0, max: 3 });
    const call: fc.Arbitrary<Call> = fc.oneof(
      fc.record({ call: fc.constant('claim' as const), base: index }),
      fc.record({ call: fc.constant('accepted' as const), kind: fc.constantFrom('feature' as const, 'fix' as const, 'docs' as const), at: index }),
      fc.record({ call: fc.constant('commits' as const), from: index, to: index }),
      fc.record({ call: fc.constant('start' as const) }),
    );
    await fc.assert(fc.asyncProperty(fc.array(call, { minLength: 1, maxLength: 2 }), async (calls) => {
      const children: Child[] = [];
      for (const c of calls) children.push(...await make(c));
      expect(outside(children), `calls ${JSON.stringify(calls)}`).toEqual([]);
    }), { seed: SEED, numRuns: RUNS });
  }, 1_800_000);
});

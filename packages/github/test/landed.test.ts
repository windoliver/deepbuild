// What the acceptance suite in tests/acceptance/2750 doesn't reach of the reading of landed commits: the watch-only
// causes a session's commit reads none for, the thirty days ending at the last read, a refused push a later read
// names, a verdict made after the read, an escape and the band, and what a second read asks the forge.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { landedReadings, readPushes, type PushesRead } from '../src/index.ts';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 20, 12);
const ago = (days: number): number => NOW - days * DAY;
const date = (days: number): string => new Date(ago(days)).toISOString().slice(0, 10);
const sha = (n: number): string => n.toString(16).padStart(2, '0').repeat(20);
type Push = PushesRead['pushes'][number];
/** A push of one commit each, whose tree is its own: commit n has tree n + 100. */
const push = (id: number, days: number, commits: number[] | null, pusher = 'maya'): Push => ({ id, at: ago(days), pusher, commits: commits && commits.map((n) => ({ commit: sha(n), tree: sha(n + 100) })) });
const read = (as_of: number, pushes: Push[], snapshots: PushesRead['snapshots'] = []) => ({ kind: 'pushes.read', ts: as_of, session: null, data: { repo: 'acme/shop', ref: 'refs/heads/main', as_of, pushes, snapshots } });
const made = (n: number, session: string, branch: string, days: number) => ({ kind: 'commit.made', ts: ago(days), session, data: { sha: sha(n), worktree: '/w', branch } });
const verdict = (n: number, outcome: string, days: number) => ({ kind: 'verdict.made', ts: ago(days), session: null, data: { commit: sha(n), outcome } });
const watch = (session: string | null, cause: string, on: boolean, days: number) => ({ kind: 'holds.watch', ts: ago(days), session, data: { cause, on } });
const one = (events: Parameters<typeof landedReadings>[0]) => {
  const [reading, ...more] = landedReadings(events);
  expect(more).toEqual([]);
  return reading!;
};

describe('landedReadings', () => {
  it('reads a session\'s unjudged commit as none with the first cause that held when it was pushed', () => {
    const reading = one([
      watch(null, 'off', true, 9), watch(null, 'off', false, 7),
      watch('s1', 'version', true, 6), watch('s1', 'checks', true, 6), watch('s2', 'version', true, 6), watch('s3', 'hooks', true, 6),
      made(1, 's1', 'main', 8), made(2, 's1', 'main', 5), made(3, 's2', 'main', 5), made(4, 's3', 'main', 5), made(5, 's3', 'main', 2),
      // A hook's own call takes back hooks that didn't reach; a FAIL on the branch's earlier head names the squash's cause.
      { kind: 'tool.before', ts: ago(3), session: 's3', data: {} },
      made(7, 's4', 'topic', 4), verdict(7, 'FAIL', 3.5), made(6, 's4', 'topic', 2),
      read(NOW, [push(1, 8, [1]), push(2, 5, [2, 3, 4]), push(3, 2, [5, 6])], [{ commit: sha(7), tree: sha(999) }]),
    ]);
    expect(reading.detail.slice(1)).toEqual([
      { commit: sha(1), judged: 'none', cause: 'off' },
      { commit: sha(2), judged: 'none', cause: 'checks' },
      { commit: sha(3), judged: 'none', cause: 'version' },
      { commit: sha(4), judged: 'none', cause: 'hooks' },
      { commit: sha(5), judged: 'none', cause: 'tree' },
      { commit: sha(6), judged: 'none', cause: 'tree', verdict: 'FAIL', verdict_commit: sha(7) },
    ]);
    expect(reading.detail[0]).toEqual({ commits: 6, none: 6, off: 1, checks: 1, version: 1, hooks: 1, tree: 2 });
  });

  it('ends its thirty days at the last read, says missing only while no read names a push\'s commits, and takes a verdict made after the read', () => {
    const first = read(ago(2), [push(1, 31.5, [1]), push(2, 10, null), push(3, 9, null), push(4, 5, [4])]);
    expect(one([first])).toMatchObject({
      id: 'landed.none', subject: 'acme/shop', value: 1, unit: 'share', source: 'github', as_of: ago(2), band: 'over',
      detail: [{ commits: 2, none: 2, no_session: 2 }, { commit: sha(1), judged: 'none', cause: 'no_session', pusher: 'maya' }, { commit: sha(4), judged: 'none', cause: 'no_session', pusher: 'maya' }, { missing: true, from: date(10), to: date(9) }],
    });
    // The next read names the tenth day's push; the ninth's is still refused, so the read says nothing new of it.
    const reading = one([first, read(NOW, [push(2, 10, [2])]), verdict(4, 'PASS', 0.5)]);
    expect(reading).toMatchObject({ value: 0.5, as_of: NOW, band: 'over' });
    expect(reading.detail).toEqual([{ commits: 2, none: 1, no_session: 1, PASS: 1 }, { commit: sha(2), judged: 'none', cause: 'no_session', pusher: 'maya' }, { commit: sha(4), judged: 'PASS' }, { missing: true, from: date(9), to: date(9) }]);
  });

  it('counts a revert of a commit that passed as an escape, and a share of a tenth is inside its band', () => {
    const passed = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const revert: Push = { id: 2, at: ago(1), pusher: 'sam', commits: [{ commit: sha(10), tree: sha(110), reverts: sha(1) }] };
    const reading = one([...passed.map((n) => verdict(n, 'PASS', 4)), read(NOW, [push(1, 3, passed), revert])]);
    expect(reading).toMatchObject({ value: 0.1, band: 'inside' });
    expect(reading.detail[0]).toEqual({ commits: 10, PASS: 9, none: 1, no_session: 1, escape: 1 });
    expect(reading.detail.at(-1)).toEqual({ commit: sha(10), judged: 'none', cause: 'no_session', pusher: 'sam', reverts: sha(1), counted: 'escape' });
  });
});

describe('readPushes', () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((done) => { server?.closeAllConnections(); server ? server.close(() => done()) : done(); }));
  /** A forge that answers each path and query with what `answers` holds for it, 404 otherwise; what it was asked, in order. */
  async function forge(answers: Record<string, { status?: number; body: unknown }>): Promise<{ api: string; asked: string[] }> {
    const asked: string[] = [];
    server = createServer((req, res) => {
      asked.push(req.url ?? '');
      const answer = answers[req.url ?? ''] ?? { status: 404, body: { message: 'Not Found' } };
      res.writeHead(answer.status ?? 200, { 'content-type': 'application/json' }).end(JSON.stringify(answer.body));
    });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    return { api: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, asked };
  }
  const commit = (n: number, message = 'Add it') => ({ sha: sha(n), commit: { message, tree: { sha: sha(n + 100) } } });
  const change = (id: number, before: string, after: string, actor: string | null) => ({ id, before, after, ref: 'refs/heads/trunk', timestamp: new Date(ago(id)).toISOString(), actor: actor && { login: actor } });
  const ACTIVITY = '/repos/acme/shop/activity?ref=refs%2Fheads%2Ftrunk&time_period=month&per_page=100';
  const answers = {
    '/repos/acme/shop': { body: { default_branch: 'trunk' } },
    [ACTIVITY]: { body: [change(3, sha(2), sha(4), 'maya'), change(2, sha(1), sha(2), null), change(1, '0'.repeat(40), sha(1), 'maya')] },
    [`/repos/acme/shop/commits?sha=${sha(1)}&per_page=100`]: { body: [commit(1), commit(0)] },
    [`/repos/acme/shop/compare/${sha(1)}...${sha(2)}?per_page=100&page=1`]: { status: 403, body: { message: 'Forbidden' } },
    [`/repos/acme/shop/compare/${sha(2)}...${sha(4)}?per_page=100&page=1`]: { body: { total_commits: 2, commits: [commit(3)] } },
    [`/repos/acme/shop/compare/${sha(2)}...${sha(4)}?per_page=100&page=2`]: { body: { total_commits: 2, commits: [commit(4, `Revert "Add it"\n\nThis reverts commit ${sha(3)}.`)] } },
  };
  const ask = (api: string, earlier: PushesRead[]) => readPushes({ api, token: 't', repo: 'acme/shop', now: NOW, read: earlier, verdicts: [], store: '/nowhere' });

  it('reads a new branch\'s commits, every page of a push and a refused push as unnamed, then asks only for what no read named', async () => {
    const f = await forge(answers);
    const first = await ask(f.api, []);
    expect(first).toEqual({
      repo: 'acme/shop', ref: 'refs/heads/trunk', as_of: NOW, snapshots: [],
      pushes: [
        { id: 1, at: ago(1), pusher: 'maya', commits: [{ commit: sha(0), tree: sha(100) }, { commit: sha(1), tree: sha(101) }] },
        { id: 2, at: ago(2), pusher: null, commits: null },
        { id: 3, at: ago(3), pusher: 'maya', commits: [{ commit: sha(3), tree: sha(103) }, { commit: sha(4), tree: sha(104), reverts: sha(3) }] },
      ],
    });
    f.asked.length = 0;
    expect((await ask(f.api, [first])).pushes).toEqual([]);
    expect(f.asked).toEqual(['/repos/acme/shop', ACTIVITY, `/repos/acme/shop/compare/${sha(1)}...${sha(2)}?per_page=100&page=1`]);
  });

  it('gives no read when the forge limits it, so nothing is recorded as read', async () => {
    const f = await forge({ ...answers, [`/repos/acme/shop/compare/${sha(2)}...${sha(4)}?per_page=100&page=2`]: { status: 429, body: { message: 'slow down' } } });
    await expect(ask(f.api, [])).rejects.toThrow('429');
  });
});

// #2123: the Scope's branches its acceptance suite leaves out, since no criterion states them. A dispute whose redraft
// can't be submitted is taken back; one the record holds with no job gets its first redraft at the start; a fetch
// under a standing rule whose job throws past its own catch is forgotten; and a page of review threads that says more
// follow but names no cursor is a read cut short. Each class is the hub's own. What it is given stands in for the
// runner, the record, the extension host and the forge.
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { Acceptance } from '../src/acceptance.js';
import { Libraries } from '../src/libraries.js';
import { OpenItems } from '../src/open-items.js';

const ISSUE = 'https://github.com/fixture/widgets/issues/7';
const CRITERION = 'The widget is blue.';
const TAG = `#7.${createHash('sha256').update(CRITERION).digest('hex').slice(0, 8)}`;
const TEST = `tests/acceptance/7/widget.test.mjs › ${TAG} the widget is blue`;
const WORK = 'a'.repeat(40);
const ASKED = { issue: ISSUE, test: TEST, work: WORK, why: 'the issue says blue' };
interface Shown { outcome: string | null; jobs: string[] }

/** An Acceptance over a record that holds one ready issue with `disputes`, and a runner whose jobs never end. */
async function acceptance(disputes: unknown[], submit: () => Promise<{ job: string }>): Promise<Acceptance> {
  const entry = {
    issue: ISSUE, n: 7, repo: '/repo', base: 'b'.repeat(40), design: [], command: 'node --test', agent: 'claude-code', body: `### Acceptance criteria\n- [ ] ${CRITERION}\n`,
    inputs: [], jobs: ['job:0'], result: 'ready', why: null, branch: 'deep/attempt/7', commit: WORK, runs: [], disputes, queued: false, slot: true,
  };
  const record = { raw: async () => [{ head: 1 }], read: async () => [{ log_pos: 1, data: { issue: ISSUE, entry } }] };
  const a = new Acceptance({ record, runner: () => ({ submit, wait: () => new Promise(() => undefined) }), append: async () => undefined, slots: 1 } as never);
  await a.open();
  return a;
}
const shown = (a: Acceptance): Shown => (a.status({ issue: ISSUE }) as { disputes: Shown[] }).disputes[0]!;

it("a dispute whose redraft can't be submitted is taken back, so the next dispute of that test submits one", async () => {
  let calls = 0;
  const a = await acceptance([], async () => { if (++calls === 1) throw Error('the runner is closed'); return { job: 'job:2' }; });
  await expect(a.dispute(ASKED)).rejects.toThrow('the runner is closed');
  expect(await a.dispute(ASKED), 'the second dispute of the same test').toEqual({ job: 'job:2' });
});

it('a dispute the record holds with no job gets its first redraft when the hub starts, and no outcome', async () => {
  const a = await acceptance([{ test: TEST, work: WORK, why: ASKED.why, criterion: TAG, jobs: [], drafts: [], outcome: null, commit: null, refused: [] }], async () => ({ job: 'job:9' }));
  await vi.waitFor(() => { if (shown(a).outcome === null && !shown(a).jobs.length) throw Error('the dispute is as the record held it'); });
  expect(shown(a), 'the dispute once the hub has started').toMatchObject({ outcome: null, jobs: ['job:9'] });
});

it('a fetch under a standing rule whose job throws past its own catch can be fetched again', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tried-again-'));
  try {
    const sha = 'c'.repeat(64);
    const picked = {
      file: { path: '/files/chair.bin', bytes: 3, sha256: sha }, sidecars: [], upstream: { url: 'https://shelf.example/chair', version: '1', modified: '2026-11-01' },
      license: { id: 'CC0-1.0', terms: 'https://creativecommons.org/publicdomain/zero/1.0/', shareable: true, credit: null },
    };
    const host = { libraries: () => [{ name: 'ext.shelf.library' }], libraryCall: async () => ({ value: picked, noAnswer: false }), assetFile: async () => sha };
    const libraries = new Libraries({ root, now: Date.now, host: () => host, keep: async () => sha, keepFile: async () => sha, has: async () => false, raise: async () => { throw Error('a standing rule asks nothing'); } } as never);
    libraries.turn('ext.shelf.library', true);
    libraries.rule('ext.shelf.library', ['CC0-1.0']);
    // The job's last step, saving libraries.json, can't write: a folder stands where its temporary file goes.
    mkdirSync(join(root, 'libraries.json.tmp'));
    await expect(libraries.fetch('ext.shelf.library', 'chair')).rejects.toThrow();
    rmSync(join(root, 'libraries.json.tmp'), { recursive: true });
    expect((await libraries.fetch('ext.shelf.library', 'chair')).status, 'the second fetch, once the file can be written').toBe('fetched');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('a page of review threads that says more follow and names no cursor is a read cut short: nothing opens from it', async () => {
  const appended: unknown[] = [];
  const pages: unknown[] = [];
  const thread = { id: 'PRRT_1', isResolved: false, path: 'src/a.js', line: 1, resolvedBy: null, comments: { nodes: [{ author: { login: 'maya' }, body: 'Compare with >= here.', url: 'https://github.com/acme/shop/pull/5#discussion_r1' }] } };
  const page = { data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: true, endCursor: null }, nodes: [thread] } } } } };
  const items = new OpenItems({
    raw: async () => [], append: async (_connection: unknown, event: unknown) => { appended.push(event); }, connection: () => ({}), asks: () => ({ raise: async () => 'ask:1' }), pin: async () => null,
    now: Date.now, taskList: () => undefined,
    github: async () => ({
      fetch: async () => ({ status: 200, headers: {}, body: { body: '' } }),
      graphql: async (_query: string, variables: unknown) => { pages.push(variables); return { status: 200, headers: {}, body: page }; },
    }),
  } as never);
  await items.atClaim({ session: 's1', agent: 'claude-code', task: 'task:1', cwd: tmpdir(), base: 'HEAD', message: 'Done.', transcript: undefined, pr: 'https://github.com/acme/shop/pull/5', same: true });
  expect(pages, 'the pages asked for').toHaveLength(1);
  expect(appended, 'open items recorded from the page').toEqual([]);
});

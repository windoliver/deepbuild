// Work the hub leaves in the background takes its own failure: a refused ask or an append the record refuses there is
// one line on stderr, never a rejection nobody handles, which would stop the hub's core.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, expect, it } from 'vitest';
import type { Runner } from '@deepbuild/runner';
import { session } from '../../../tests/acceptance/63/corpus.ts';
import { ACCOUNT, cleanup } from '../../../tests/acceptance/63/helpers.ts';
import { CORE, openWorld } from '../../../tests/acceptance/63/world.ts';
import { Acceptance } from '../src/acceptance.js';
import { Agents } from '../src/agents.js';
import { Runs } from '../src/runs.js';
import { rootOf } from '../src/paths.js';
import { openWikiBuild } from '../src/wiki-build.js';

let dir: string;
const temp = (): string => (dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-detached-'))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));
afterAll(cleanup);
const closed = () => Promise.reject(Error('the record is closed'));

/** The rejections nobody handled while `body` ran and for `ms` after it. */
async function unhandled(body: () => unknown, ms = 100): Promise<string[]> {
  const seen: string[] = [];
  const note = (reason: unknown) => { seen.push(String(reason)); };
  process.on('unhandledRejection', note);
  try {
    await body();
    await new Promise((done) => setTimeout(done, ms));
  } finally { process.off('unhandledRejection', note); }
  return seen;
}

/** Runs over a host whose run exits 0 at once, a lease table that grants, and a record that refuses each finish. */
function runs(journal: Record<string, unknown>, lives: () => Promise<boolean>): Runs {
  const journalFile = join(temp(), 'runs.json');
  writeFileSync(journalFile, JSON.stringify(journal));
  const sink = { write: async () => undefined, close: async () => ({ status: 'empty' }) };
  return new Runs({
    journalFile, point: () => undefined, checkouts: dir, now: () => Date.now(), plant: undefined, held: [], raw: async () => [], sync: async () => undefined, stopping: () => false,
    appendAsCore: async () => undefined, appendCore: closed,
    store: () => ({ connect: () => ({ text: () => sink }) }),
    host: () => ({ start: async () => ({ status: 'started' }), wait: async () => ({ code: 0 }) }),
    supervisor: () => ({ cleanup: async () => undefined, lives }),
    leases: () => ({ lease: async () => ({ status: 'granted', lease: { id: 'lease:1' } }), release: async () => undefined }),
  } as never);
}

it('a run whose finish the record refuses leaves no unhandled rejection', async () => {
  const r = runs({}, async () => false);
  expect(await unhandled(async () => {
    const { run } = await r.start({ check: 'unit', claim: 'claim:01K74G1Z3X5V7T9R1P3N5M7K9H', commit: 'a'.repeat(40), argv: ['/usr/bin/true'], cwd: dir });
    await r.ended(String(run));
  })).toEqual([]);
});

it('a kept run that ends while the record refuses its finish leaves no unhandled rejection', async () => {
  let looks = 0;
  const kept = { run: 'run:kept', check: 'unit', claim: 'claim:01K74G1Z3X5V7T9R1P3N5M7K9H', commit: 'a'.repeat(40), argv: ['/usr/bin/true'], env: {}, cwd: '/', grant: {}, keep: true };
  // Alive when the hub starts, gone at its next look a second later.
  const r = runs({ [kept.run]: kept }, async () => looks++ === 0);
  expect(await unhandled(async () => { await r.open(); await r.recover(); }, 1500)).toEqual([]);
});

it('a sync whose conflict ask is refused leaves no unhandled rejection', async () => {
  const root = temp();
  const path = join(root, 'SKILL.md');
  for (const p of ['syncs', 'journal', 'staged/s1']) mkdirSync(join(root, 'agents', p), { recursive: true });
  // The hub stopped mid-sync, and the file now holds bytes that are neither the sync's before nor its after.
  writeFileSync(path, 'yours\n');
  writeFileSync(join(root, 'agents/staged/s1/staged'), 'the skill\n');
  writeFileSync(join(root, 'agents/journal/s1.json'), JSON.stringify({ sync: 's1', files: [{ path, before: null, after: 'f'.repeat(64) }] }));
  writeFileSync(join(root, 'agents/syncs/s1.json'), JSON.stringify({
    id: 's1', created: 1, via: 'cli', item: { kind: 'skill', skill: { name: 'notes' } }, agents: ['claude-code'], refused: [], ask: 'ask:1', status: 'applying',
    targets: [{ path, agents: ['claude-code'], before: null, after: 'f'.repeat(64), diff: '', file: { sha: 'staged', mode: 0o644 }, status: 'planned' }],
  }));
  const agents = new Agents({ root, plant: undefined, durable: { point: () => undefined }, now: () => Date.now(), held: [], raise: () => Promise.reject(Error('asks are closed')) } as never);
  expect(await unhandled(() => agents.recover())).toEqual([]);
});

it('a blind job whose judging fails while the record refuses its result leaves no unhandled rejection', async () => {
  temp();
  const issue = 'https://github.com/fixture/widgets/issues/7';
  const entry = { issue, n: 7, jobs: ['job:1'], result: null, why: null, disputes: [], queued: false, slot: true };
  const record = { raw: async () => [{ head: 1 }], read: async () => [{ log_pos: 1, data: { issue, entry } }] };
  const acceptance = new Acceptance({ record, runner: () => ({ wait: () => Promise.reject(Error('the job is gone')) }), append: closed, slots: 1 } as never);
  expect(await unhandled(() => acceptance.open())).toEqual([]);
});

// Real record, runner, wiki and fake agent from #63's acceptance world; only submit is wrapped, to plant the page.
it('a reading job that ends while a wiki page can\'t be read leaves no unhandled rejection', async () => {
  temp();
  const w = await openWorld();
  try {
    // One session whose second message is worth a reading, so the build starts one job.
    await w.seed([session(6391, { project: 'api', count: 4 })]);
    // The plan window has a reading, so the job starts instead of waiting for one.
    const at = w.clock.now();
    await w.runner.report({ agent: 'claude-code', account: ACCOUNT, rate_limits: { five_hour: { used_percentage: 5, resets_at: Math.floor((at + 3 * 3_600_000) / 1000) }, seven_day: { used_percentage: 20, resets_at: Math.floor((at + 5 * 86_400_000) / 1000) } } });
    const runner: Runner = Object.create(w.runner);
    // As the job starts, a page appears that is a link to nothing: listed, then unreadable.
    runner.submit = async (spec) => { symlinkSync(join(w.root, 'nowhere'), join(w.root, 'wiki', 'gone.md')); return w.runner.submit(spec); };
    const wiki = openWikiBuild({ record: w.record, root: rootOf(w.root), store: w.store, runner, asks: w.asks, now: w.clock.now, archive: async () => undefined, core: CORE, cli: { ...CORE, writer: 'cli' } });
    expect(await unhandled(() => wiki.build().catch(() => undefined), 500)).toEqual([]);
  } finally {
    await w.close();
  }
}, 120_000);

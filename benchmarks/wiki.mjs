// The wiki's build, for the perf lane's budgets (issue #356): node benchmarks/wiki.mjs build.
// One process archives 212 seeded sessions (30 days of history, four repos, twelve messages each, the second a `remember:`
// fact), builds the wiki from them as setup does, then builds it again, failing unless the first build wrote a page for
// each repo and the second changed no page, read no message again and started no more reading jobs than the first
// needed. The reading agent is a stand-in that reads nothing, so the number is DeepBuild's own work: archive,
// pattern matching, claims, pages and read positions. The issue's 5% of a plan window and 4,000-token start slice stay
// in tests/acceptance/356/budgets.test.ts.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { shipped } from '../packages/adapters/dist/index.js';
import { openArchive } from '../packages/archive/dist/index.js';
import { openAsks } from '../packages/asks/dist/index.js';
import { openEvidenceStore } from '../packages/evidence/dist/index.js';
import { openWikiBuild, rootOf } from '../packages/hub/dist/index.js';
import { openRecord } from '../packages/record/dist/index.js';

const T0 = 1_760_013_451_000;
const task = process.argv[2];
const root = mkdtempSync(join(tmpdir(), 'deep-wiki-bench-'));
const pages = (dir) => new Map(readdirSync(dir, { recursive: true }).filter((f) => f.endsWith('.md')).map((f) => [f, readFileSync(join(dir, f), 'utf8')]));
try {
  if (task !== 'build') throw Error(`Unknown task ${task}; one of: build`);
  const now = () => T0;
  const env = { HOME: root, CLAUDE_CONFIG_DIR: join(root, 'claude') };
  const repos = ['api', 'web', 'cli', 'docs'].map((n) => join(root, 'work', n));
  for (const r of repos) mkdirSync(join(r, '.git'), { recursive: true });
  const folder = join(env.CLAUDE_CONFIG_DIR, 'projects', '-bench');
  mkdirSync(folder, { recursive: true });
  for (let i = 0; i < 212; i++) {
    const id = `${(0x35600 + i).toString(16).padStart(8, '0')}-0000-4000-a000-${String(i).padStart(12, '0')}`;
    const lines = Array.from({ length: 12 }, (_, k) => {
      const text = k === 1 ? `remember: ${repos[i % 4].split('/').pop()} fact ${i} starts with \`npm run dev${i % 5}\`. ${'lorem ipsum dolor '.repeat(25)}` : `${'sit amet consectetur '.repeat(30)}`;
      const role = k === 1 || k % 2 === 0 ? 'user' : 'assistant';
      return JSON.stringify({ type: role, uuid: `m${k + 1}`, sessionId: id, cwd: repos[i % 4], timestamp: new Date(T0 + k * 1000).toISOString(), message: { role, content: role === 'user' ? text : [{ type: 'text', text }] } });
    });
    writeFileSync(join(folder, `${id}.jsonl`), `${lines.join('\n')}\n`);
  }
  const hub = join(root, 'hub');
  const store = await openEvidenceStore({ root: join(hub, 'evidence'), now });
  const record = await openRecord({ path: join(hub, 'ledger.db'), now, evidence: store });
  const asks = await openAsks({ record, now, deliver: () => undefined });
  const { repoOf } = await import('../packages/hub/dist/paths.js');
  const archive = await openArchive({ record, evidence: store, asks, adapters: shipped(), env, connection: { writer: 'ext:deepbuild/archive', actor: 'you', scope: 'you' }, now, projectOf: (cwd) => repoOf(cwd) });
  // A reading agent that finds nothing: each job ends at once.
  let jobs = 0;
  const runner = {
    submit: async () => ({ job: `run:BENCH${++jobs}`, account: null }),
    wait: async (job) => ({ job, state: 'finished', account: null }),
    status: async (job) => ({ job, state: 'finished' }),
    output: async () => `${JSON.stringify({ type: 'result', result: '{"findings":[]}' })}\n`,
    planWindows: () => new Map(),
    list: async () => [],
  };
  const core = { writer: 'core', actor: 'you', scope: 'you' };
  const build = openWikiBuild({ record, root: rootOf(hub), store, runner, asks, now, archive: () => archive.pass(), core, cli: { writer: 'cli', actor: 'you', scope: 'you' } });
  const first = await build.build();
  const written = pages(rootOf(hub).wiki);
  const repoPages = [...written.keys()].filter((f) => f.startsWith('repos'));
  if (repoPages.length !== 4) throw Error(`${repoPages.length} repo pages after the first build, not 4`);
  const firstJobs = jobs;
  const again = await build.build();
  const after = pages(rootOf(hub).wiki);
  for (const [name, text] of after) if (name !== 'log.md' && written.get(name) !== text) throw Error(`${name} changed on a second build of unchanged history`);
  if (again.changed.length) throw Error(`the second build says it changed ${again.changed.join(', ')}`);
  if (jobs !== firstJobs) throw Error(`the second build started ${jobs - firstJobs} more reading jobs`);
  if (!firstJobs || first.changed.length < 4) throw Error('the first build read nothing');
  await record.close();
} finally {
  rmSync(root, { recursive: true, force: true });
}

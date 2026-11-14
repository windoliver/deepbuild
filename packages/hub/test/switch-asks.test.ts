// #2065: lookup-and-create is one operation for a repository switch across concurrent worktrees.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openAsks } from '@deepbuild/asks';
import { fixtures } from '@deepbuild/contracts';
import { openRecord, ulid, type EventInput } from '@deepbuild/record';
import { AskTasks } from '../src/ask-tasks.js';
import { McpOperations } from '../src/mcp-operations.js';
import { OpenItems } from '../src/open-items.js';
import { StopJudging, type StopJudgingOptions } from '../src/stop-judging.js';

it('two first Closes checks in linked worktrees raise only one switch ask', async () => {
  const dir = mkdtempSync('/tmp/switch-asks-');
  const repo = join(dir, 'repo'), other = join(dir, 'other');
  mkdirSync(join(repo, '.deepbuild'), { recursive: true });
  writeFileSync(join(repo, '.deepbuild/done.yaml'), 'switches: {file: flags.json, deployed: deployed.json}\n');
  writeFileSync(join(repo, 'flags.json'), '{}'); writeFileSync(join(repo, 'deployed.json'), '{"feature":false}');
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD'); git('worktree', 'add', '-q', '-b', 'second', other);
  for (const cwd of [repo, other]) writeFileSync(join(cwd, 'flags.json'), '{"feature":false}');
  const now = () => Date.UTC(2026, 10, 1);
  const record = await openRecord({ path: join(dir, 'record.db'), now });
  const core = { writer: 'core', actor: 'you', scope: 'you' };
  try {
    const asks = await openAsks({ record, now, deliver: () => undefined });
    for (const [i, session] of ['S1', 'S2'].entries()) {
      const task = `task:item${41 + i}`;
      await record.append({ ...core, session, writer: 'hook' }, { v: 1, id: ulid(now()), kind: 'session.start', ts: now(), data: { agent: 'claude-code', worktree: i ? other : repo, branch: i ? 'second' : 'main', thread: session } });
      await record.append({ ...core, session }, { v: 1, id: ulid(now()), kind: 'task.created', ts: now(), data: { task_ref: task, thread: session, owner: 'you', title: 'fixture' } });
      const fixture = fixtures('definition.locked@1')[0] as unknown as EventInput & { data: Record<string, unknown> };
      await record.append(core, { v: 1, id: ulid(now()), kind: 'definition.locked', ts: now(), data: { ...fixture.data, task_ref: task, requirements: [], base_commit: base } as EventInput['data'] });
    }
    const raw = record.raw.bind(record);
    const tasks = new AskTasks({ raw } as ConstructorParameters<typeof AskTasks>[0]);
    const openItems = new OpenItems({ raw } as ConstructorParameters<typeof OpenItems>[0]);
    const mcp = new McpOperations({} as ConstructorParameters<typeof McpOperations>[0]);
    const live = new Map([['S1', { cwd: repo, agent: 'claude-code' }], ['S2', { cwd: other, agent: 'claude-code' }]]);
    const judging = new StopJudging({ settings: {}, services: { record, asks, tasks, openItems, now }, state: () => ({ live }), mcp: () => mcp,
      events: { connection: (_writer: string, extra: object = {}) => ({ ...core, ...extra }) },
    } as unknown as StopJudgingOptions);
    const reasons = await Promise.all([judging.closesGate('S1', 'gh pr create --body "Closes #41"', repo), judging.closesGate('S2', 'gh pr create --body "Closes #42"', other)]);
    expect(reasons.every((r) => r?.includes('feature')), 'both calls are held by the deployed-off switch').toBe(true);
    expect(await record.read({ after: 0, kinds: ['ask.created'] }), 'one repo/name is one question, even across threads').toHaveLength(1);
  } finally { await record.close(); rmSync(dir, { recursive: true, force: true }); }
});

// #2074 review regressions: real hub/record/checks, with only the permitted checkout service planted.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ulid, type RecordStore } from '@deepbuild/record';
import type { Checkouts } from '@deepbuild/gate';
import type { GateRunner } from '../src/gate-runner.ts';
import type { StopJudging } from '../src/stop-judging.ts';

export async function world(held: string[] = []) {
  const saved = { ...process.env };
  const dir = mkdtempSync(join(tmpdir(), 'setup-failure-'));
  process.env.HOME = dir;
  process.env.CLAUDE_CONFIG_DIR = join(dir, '.claude');
  process.env.CODEX_HOME = join(dir, '.codex');
  process.env.PATH = (saved.PATH ?? '').split(':').filter((p) => !p.startsWith('/Users/') && !p.startsWith('/home/')).join(':');
  for (const key of Object.keys(process.env)) if (/^(?:DEEP_HUB_|GH_|GITHUB_|ANTHROPIC_|OPENAI_)/.test(key)) delete process.env[key];
  const cwd = join(dir, 'repo'); mkdirSync(cwd);
  writeFileSync(join(cwd, '.gitignore'), 'node_modules\n');
  writeFileSync(join(cwd, 'check.mjs'), "import { test } from 'node:test'; import assert from 'node:assert/strict'; test('value', () => assert.equal(1, 2));\n");
  const git = (...args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', ...args], { cwd, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-qm', 'fixture');
  const commit = git('rev-parse', 'HEAD');
  const { createCore } = await import(new URL('../dist/hub-runtime.js', import.meta.url).href) as typeof import('../src/hub-runtime.ts');
  const core = createCore({ root: join(dir, 'hub'), held, clock: { start: Date.now(), real: Date.now() } }, () => undefined);
  await core.started();
  const ports = core as unknown as { record: RecordStore; judging: StopJudging; gate: GateRunner; checkouts: Checkouts };
  const connection = { writer: 'core', actor: 'you', scope: 'you', session: 'setup2074', agent: 'claude-code' };
  const task = 'task:setup2074';
  const claim = async (slow = false) => {
    const ts = Date.now(), id = ulid(ts), claim = `claim:${id}`;
    await ports.record.append(connection, { v: 2, id, kind: 'claim.made', ts, data: { task_ref: task, attempt: 1, commit, scope: 'session', predictions: [] } });
    await ports.judging.runClaim({ claim, session: connection.session, task, commit, base: commit, cwd, deliverables: [], requirements: [], checks: [{ check: 'check', approved: null, command: 'node --test check.mjs', on_base: 'passes', asserts: [], expected_ms: slow ? 60_000 : 0 }], definition: 'locked', joins: true });
    const lane = await Promise.allSettled([ports.judging.lanes.get(claim)!]);
    await ports.judging.verdictWrites.get(claim)?.catch(() => undefined);
    return { claim, lane: lane[0]! };
  };
  return { ports, cwd, task, claim,
    close: async () => {
      await new Promise((done) => setTimeout(done, 50));
      await core.stop('setup failure regression');
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved); rmSync(dir, { recursive: true, force: true });
    },
  };
}

// #2121 regression edges beyond its frozen acceptance suite, through the real hub and CLI.
import { chmodSync, existsSync, mkdirSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';
import { apply, bare, bytes, call, commitMore, config, deep, gitRepo, propose, server, skill, skillTree, start, stop, syncReaches, waitFor, world, type Line } from '../../../tests/acceptance/2121/helpers.ts';

it('recovery keeps each replacement digest for undo, for files already written and files it finishes', async () => {
  for (const present of [false, true]) {
    const w = world(); await start(w);
    const paths = [config(w), join(w.home, '.codex/config.toml')];
    mkdirSync(dirname(paths[1]!), { recursive: true });
    if (present) { writeFileSync(paths[0]!, '{}\n'); writeFileSync(paths[1]!, 'model = "old"\n'); }
    const p = await propose(w, { server: server('recovered'), agents: ['claude-code', 'codex'] });
    expect(p.files).toHaveLength(2);
    const before = ['{ "theme": "mine", "mcpServers": {} }\n', '# mine\nmodel = "current"\n'];
    paths.forEach((path, i) => writeFileSync(path, before[i]!));
    await stop(w);
    await start(w, { DEEP_HUB_TEST_VFS: JSON.stringify({ cutAt: { kind: 'sync_flush', nth: 1 } }) });
    const h = w.hub!, approval = deep(w, ['inbox', 'answer', `ask:${bare(p.ask)}`, 'apply']);
    await waitFor(() => h.child.signalCode === 'SIGKILL', 15_000, 'cut after the first replacement'); await approval;
    w.hub = undefined; await start(w);
    await syncReaches(w, p.sync, ['complete']);
    expect(paths.map(bytes).every(text => text?.includes('recovered'))).toBe(true);
    expect(await deep(w, ['undo', p.sync])).toMatchObject({ code: 0 });
    expect.soft(paths.map(bytes), `undo recovered ${present ? 'edited' : 'created'} files`).toEqual(before);
    await stop(w);
  }
});

it('a mode-only skill commit is applied even when its script bytes did not change', async () => {
  const w = world(); await start(w);
  const r = gitRepo(w, 'mode-only', skillTree), source = join(r.dir, 'skills/notes/run.sh');
  chmodSync(source, 0o644);
  await apply(w, await propose(w, skill(r.dir, commitMore(r.dir, {}))));
  chmodSync(source, 0o755);
  const p = await propose(w, skill(r.dir, commitMore(r.dir, {})));
  await apply(w, p);
  const installed = join(w.home, '.claude/skills/notes/run.sh');
  expect(bytes(installed)).toBe(skillTree['skills/notes/run.sh']);
  expect(statSync(installed).mode & 0o777).toBe(0o755);
});

it('a skill proposal refused during reading or planning leaves no orphaned staged files', async () => {
  for (const reason of ['missing SKILL.md', 'unmanaged file']) {
    const w = world(); await start(w);
    const r = gitRepo(w, 'refused', reason === 'missing SKILL.md' ? { 'skills/notes/run.sh': '#!/bin/sh\necho notes\n' } : skillTree);
    if (reason === 'unmanaged file') {
      const file = join(w.home, '.claude/skills/notes/SKILL.md');
      mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, 'My own notes\n');
    }
    const result = await call(w, 'agents.propose', { ...skill(r.dir, r.commit), agents: ['claude-code'] }).catch(error => ({ error: String(error) }));
    expect(result.error).toEqual(expect.stringContaining(reason === 'missing SKILL.md' ? 'holds no SKILL.md' : "isn't DeepBuild's"));
    const staged = join(w.root, 'agents/staged');
    expect.soft(existsSync(staged) ? readdirSync(staged) : [], reason).toEqual([]);
    expect((await call(w, 'agents.read')).syncs).toEqual([]);
    await stop(w);
  }
});

it('syncing a skill to another agent and then with no changes keeps both agents and their files', async () => {
  const w = world(); await start(w);
  const r = gitRepo(w, 'shared', skillTree);
  for (const agent of ['claude-code', 'codex', 'claude-code']) await apply(w, await propose(w, { ...skill(r.dir, r.commit), agents: [agent] }));
  const read = async () => (await call(w, 'agents.read')).skills as Line[];
  const installed = await read();
  expect.soft(installed[0]?.agents.sort()).toEqual(['claude-code', 'codex']);
  expect(installed[0]?.differs).toBe(false);
  writeFileSync(join(w.home, '.codex/skills/notes/run.sh'), '# edited by you\n');
  expect((await read())[0]?.differs, 'the earlier agent file remains tracked after a no-op sync').toBe(true);
});

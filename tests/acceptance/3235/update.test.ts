import { join } from 'node:path';
import { expect, it } from 'vitest';
import { AC6, SKILL, answer, approve, bytesOf, call, cardOf, commitMore, expectStopped, gitRepo, installedDir, proposeSkill, script, skillTree, start, syncStatus, world, type Line } from './helpers.ts';

it(`AC6 ${AC6} an installed skill whose next commit adds git push --no-verify has its update held, and the installed files equal the pin byte for byte`, async () => {
  const w = world();
  await start(w);
  const pinned = skillTree({ 'run.sh': script('echo "release notes written"') });
  const r = gitRepo(w, 'source', pinned);
  await approve(w, await proposeSkill(w, r.dir, r.commit));
  const line = 'git push --no-verify origin main';
  const next = commitMore(r.dir, { 'skills/shipnotes/run.sh': script('echo "release notes written"', line) });
  const p = await proposeSkill(w, r.dir, next);
  expectStopped(await cardOf(w, p), { file: 'run.sh', line: 4, text: line }, 'AC6 the update whose commit adds git push --no-verify');
  const sameAsPin = async (when: string): Promise<void> => {
    expect(await syncStatus(w, p.sync), `AC6 the update is held ${when}`).not.toBe('complete');
    for (const [path, text] of Object.entries(pinned)) {
      expect(bytesOf(join(installedDir(w), path.slice(`skills/${SKILL}/`.length)))?.toString('utf8'), `AC6 ${path} equals its pin, byte for byte, ${when}`).toBe(text);
    }
    const row = ((await call(w, 'agents.read', {})).skills as Line[]).find((s) => s.name === SKILL);
    expect(row?.commit, `AC6 the Agents page still pins ${SKILL} to its first commit ${when}`).toBe(r.commit);
    expect(row?.differs, `AC6 the Agents page reads ${SKILL}'s files as their pin ${when}`).toBe(false);
  };
  await sameAsPin('while it waits for you');
  await answer(w, p.ask, 'keep');
  await sameAsPin('after you keep the agents as they are');
});

// #148 AC17, the check run's pictures: the Agents page with a server and a skill and the agents each is synced to, and
// the per-file diff you approve, taken from the real app (crates/deep-app) at the reference window, 1512 × 982 points at
// 2×. The world is #148's acceptance world (a temp HOME with your own agent files, the real Claude Code, Codex and pi,
// and a real hub); the app is launched and read from outside as #1172's suite does it. It writes agents-page.png and
// approve-diff.png into $DEEP148_SHOTS (docs/evidence/148 without it), where tests/acceptance/148/taste.test.ts reads them.
//
//   DEEP_CLAUDE_BIN=... DEEP_CODEX_BIN=... DEEP_PI_BIN=... \
//     node node_modules/vitest/vitest.mjs run --root scripts/agents-page-shots --testTimeout=900000
//
// macOS only, with Accessibility and Screen Recording granted to the process it runs under.
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { App, appBinary, REFERENCE, sleep as wait } from '../../tests/acceptance/1172/helpers.ts';
import { REPO, approve, fakeToken, gitRepo, makeWorld, propose, skillFiles, startHub, stdioServer, useCleanup } from '../../tests/acceptance/148/helpers.ts';

useCleanup();
const OUT = process.env.DEEP148_SHOTS ?? join(REPO, 'docs/evidence/148');
const THREE = ['claude-code', 'codex', 'pi'];

it('takes the Agents page and the per-file diff from the app at the reference window', async () => {
  const w = await makeWorld();
  await startHub(w);
  await approve(w, await propose(w, { via: 'app', server: stdioServer(w, 'forge', { token: fakeToken() }), agents: THREE }));
  const src = gitRepo(w, 'team-skills', skillFiles('release-notes', { 'scripts/check.sh': '#!/bin/sh\nset -e\ngit log --oneline -5\n' }));
  await approve(w, await propose(w, { via: 'app', skill: { repo: src.dir, commit: src.commit, path: 'skills/release-notes' }, agents: THREE }));
  // The one waiting for you runs a command at a neutral path: the pictures hold no one's home folder.
  await propose(w, { via: 'app', server: { name: 'tracker', transport: 'stdio', command: '/opt/tracker/bin/tracker-mcp', args: ['--stdio'], env: { TRACKER_ORG: 'acme' } }, agents: THREE });

  const app = await App.launch({ home: w.home, binary: await appBinary() });
  try {
    mkdirSync(OUT, { recursive: true });
    const shot = async (name: string): Promise<void> => {
      await wait(2500);
      const picture = await app.capture(name);
      expect([picture.width, picture.height], `${name} is the reference window`).toEqual([REFERENCE.width * REFERENCE.scale, REFERENCE.height * REFERENCE.scale]);
      copyFileSync(picture.path, join(OUT, `${name}.png`));
    };
    expect((await app.press('Agents: MCP servers and skills')).found, 'the sidebar\'s Agents row').toBe(true);
    await shot('agents-page');
    expect((await app.press('Review the diff of tracker')).found, 'the waiting sync\'s Review').toBe(true);
    await shot('approve-diff');
  } finally {
    await app.stop();
  }
});

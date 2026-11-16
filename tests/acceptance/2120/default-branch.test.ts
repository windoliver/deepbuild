// AC8: a refused push to the default branch is recorded in a repo with no origin/HEAD (README).
//
// #1330's world: its repo was made with git init, a remote added and main pushed to it, so it has origin/main and no
// origin/HEAD (the test makes sure of both). Under an approval for issue 41, `deep start` starts a session; its one
// Bash call prints what git prints when the forge refuses a push to refs/heads/main under a ruleset
// (fixtures/gh013-main.txt), standing for the forge, the boundary this suite doesn't own. forge.refused with action
// push-default-branch must then be on the record for the run. On the base the default branch is read only from
// origin/HEAD, so it reads as none here and nothing is recorded.
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { approve, git, mentions, openWorld, sh, standInIn, start, waitFor, type Line } from '../1330/helpers.ts';
import { bashTurn, blocked, installStandIn, started } from './helpers.ts';

const AC8 = 'AC8 #2120.dd8501f8';
const REFUSAL = fileURLToPath(new URL('./fixtures/gh013-main.txt', import.meta.url));
const has = (repo: string, ref: string): boolean => { try { git(repo, 'rev-parse', '--verify', '--quiet', ref); return true; } catch { return false; } };

test(`${AC8} in a repo with origin/main and no origin/HEAD, a started session's call whose output shows the forge refusing a push to refs/heads/main under a ruleset records forge.refused with action push-default-branch`, async () => {
  const w = await openWorld();
  installStandIn(w);
  await blocked('a repo with origin/main and no origin/HEAD', () => {
    if (has(w.repo, 'refs/remotes/origin/HEAD')) git(w.repo, 'remote', 'set-head', 'origin', '--delete');
    if (has(w.repo, 'refs/remotes/origin/HEAD') || !has(w.repo, 'refs/remotes/origin/main')) throw Error(`${w.repo} must have origin/main and no origin/HEAD`);
  });
  await blocked('the approval of issue 41', () => approve(w, { issues: [41], agents: ['claude-code'], atOnce: 1, planShare: 50 }));
  const s = started(await start(w, { issue: 41, prompt: bashTurn('Work on issue 41.', `cat ${sh(REFUSAL)} >&2; exit 1`) }), 'deep start --issue 41 from origin/main');

  const agent = await blocked("the started agent's turn", () => standInIn(w, s.worktree, { done: true }));
  const call = ((agent.bash ?? []) as Line[])[0];
  await blocked('the call that prints the refusal', () => { if (!call || call.denied || !String(call.stderr ?? '').includes('GH013')) throw Error(`it must run and print GitHub's GH013 refusal: ${JSON.stringify(call ?? null).slice(0, 600)}`); });
  await blocked(`start.session for ${s.run}`, () => waitFor(async () => (await w.client.events('start.session')).find((e) => mentions(e, s.run) && mentions(e, String(agent.session))), 30_000, `start.session naming ${s.run} and session ${String(agent.session)}`));

  const refused = async () => (await w.client.events('forge.refused')).filter((e) => mentions(e, s.run) || mentions(e, String(agent.session)));
  await waitFor(async () => (await refused()).some((e) => e.data?.action === 'push-default-branch'), 30_000, 'forge.refused').catch(() => undefined);
  const recorded = await refused();
  expect(recorded.map((e) => e.data?.action), `${AC8} session ${String(agent.session)} (run ${s.run}) printed the forge refusing its push to refs/heads/main under a ruleset, in a repo with origin/main and no origin/HEAD, so forge.refused with action push-default-branch is on the record; the record's forge.refused for it: ${JSON.stringify(recorded.map((e) => e.data)).slice(0, 600)}`)
    .toContain('push-default-branch');
});

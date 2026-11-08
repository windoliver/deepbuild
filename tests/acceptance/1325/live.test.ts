// The issue's Proof, by hand: the forge's refusal of each call on the real repo, and the rule's own response, once
// #1324's forge step is done. Skipped unless the variables below name a test repo whose rules are already on, your own
// token for it, and the two apps' IDs and keys (README: The live run). It never changes a rule and creates no repo or
// app: it reads the default branch's rules, pushes a proof branch and opens one pull request as you, starts one stand-in
// session (no model) under a run against the repo, and reads what GitHub did with its calls. At the end it closes the
// pull request and deletes the branches it made. Never in hosted CI.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AC, APPROVED_TAGS, CONTEXT, forgeCalls, promptOf, REFUSED_CALLS, tag, World } from './helpers.ts';

const env = process.env;
const LIVE = env.DEEPBUILD_1325_LIVE_REPO && env.DEEPBUILD_1325_LIVE_TOKEN && env.DEEPBUILD_1325_LIVE_GATE_APP_ID && env.DEEPBUILD_1325_LIVE_GATE_KEY
  && env.DEEPBUILD_1325_LIVE_AGENTS_APP_ID && env.DEEPBUILD_1325_LIVE_AGENTS_KEY
  ? {
    repo: env.DEEPBUILD_1325_LIVE_REPO, token: env.DEEPBUILD_1325_LIVE_TOKEN,
    gate: { id: Number(env.DEEPBUILD_1325_LIVE_GATE_APP_ID), pem: readFileSync(env.DEEPBUILD_1325_LIVE_GATE_KEY, 'utf8') },
    agents: { id: Number(env.DEEPBUILD_1325_LIVE_AGENTS_APP_ID), pem: readFileSync(env.DEEPBUILD_1325_LIVE_AGENTS_KEY, 'utf8') },
  }
  : undefined;

describe.skipIf(!LIVE)('Proof (live, by hand): GitHub refuses each call of a session on the real repo, and its rule requires the gate', () => {
  it(`${AC[1]} ${AC[2]} the default branch's rule names the gate's app, and GitHub refuses a session's status, merge, default-branch push and ${APPROVED_TAGS} tag`, async () => {
    const w = await World.open({ live: LIVE! });
    const suffix = tag();
    const agentBranch = `agent-${suffix}`;
    try {
      const rules = await w.api('GET', `/repos/${w.name}/rules/branches/${w.defaultBranch}`, undefined, w.personToken);
      expect(rules.status, `the default branch's rules read: ${JSON.stringify(rules.json)}`).toBe(200);
      const checks = (Array.isArray(rules.json) ? rules.json : []).filter((r: { type: string }) => r.type === 'required_status_checks')
        .flatMap((r: { parameters?: { required_status_checks?: { context: string; integration_id?: number }[] } }) => r.parameters?.required_status_checks ?? []);
      expect(checks, `the default branch requires ${CONTEXT} from the gate's app (${LIVE!.gate.id})`).toContainEqual(expect.objectContaining({ context: CONTEXT, integration_id: LIVE!.gate.id }));

      const tipBefore = (await w.api('GET', `/repos/${w.name}/branches/${w.defaultBranch}`, undefined, w.personToken)).json.commit?.sha;
      await w.approveRun();
      const started = await w.start(promptOf([forgeCalls(w, ['push-branch', ...REFUSED_CALLS], suffix)]));
      const log = await w.standIn(started.worktree);
      const out = String((log.bash as { stdout?: string }[])[0]?.stdout ?? '');
      const done = (JSON.parse(/\{"forgeCalls":.*\}\s*$/.exec(out)?.[0] ?? '{"forgeCalls":{}}') as { forgeCalls: Record<string, number> }).forgeCalls;
      expect(String(log.env?.GH_TOKEN ?? ''), "the session's GH_TOKEN is an installation token").toMatch(/^ghs_/);
      expect(done['push-branch'], `the session's credential pushes a branch: ${out.slice(-2000)}`).toBe(0);
      for (const call of REFUSED_CALLS) expect(done[call], `GitHub refused ${call}: ${out.slice(-3000)}`).not.toBe(0);
      const tipAfter = (await w.api('GET', `/repos/${w.name}/branches/${w.defaultBranch}`, undefined, w.personToken)).json.commit?.sha;
      expect(tipAfter, 'the default branch is where it was').toBe(tipBefore);
      expect((await w.api('GET', `/repos/${w.name}/git/ref/tags/${APPROVED_TAGS}1325-${suffix}`, undefined, w.personToken)).status, 'no deep/approved/ tag was made').toBe(404);
      const pull = (await w.api('GET', `/repos/${w.name}/pulls/${w.pr}`, undefined, w.personToken)).json;
      expect(pull.merged, 'the pull request is not merged').toBe(false);
      const statuses = (await w.api('GET', `/repos/${w.name}/commits/${w.head}/statuses`, undefined, w.personToken)).json as { context: string; creator?: { login: string } }[];
      expect(statuses.filter((s) => s.context === CONTEXT), `no ${CONTEXT} status was posted on the proof's head`).toEqual([]);
    } finally {
      if (w.pr) await w.api('PATCH', `/repos/${w.name}/pulls/${w.pr}`, { state: 'closed' }, w.personToken);
      for (const branch of [w.proofBranch, agentBranch]) if (branch) await w.api('DELETE', `/repos/${w.name}/git/refs/heads/${branch}`, undefined, w.personToken);
    }
  }, 900_000);
});

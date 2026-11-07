// The issue's Proof, by hand: a test repository with branch protection requiring the status, on the real GitHub API.
// It is skipped unless DEEPBUILD_46_LIVE_REPO (owner/name) and DEEPBUILD_46_LIVE_TOKEN name a test repo and a token that
// can push and post statuses there. It changes no protection and creates no repository: it reads the rule, pushes a
// branch of its own, opens a pull request, reads what GitHub says of it, then closes it and deletes the branch.
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, World } from './helpers.ts';

const REPO_NAME = process.env.DEEPBUILD_46_LIVE_REPO;
const TOKEN = process.env.DEEPBUILD_46_LIVE_TOKEN;
const CONTEXT = 'deepbuild/verdict';
const API = 'https://api.github.com';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function api(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${API}${path}`, { method, headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, json: await res.json().catch(() => undefined) };
}
const pollUntil = async <T>(read: () => Promise<T | undefined>, ms: number): Promise<T | undefined> => {
  for (const deadline = Date.now() + ms; Date.now() < deadline; await new Promise((r) => setTimeout(r, 1000))) {
    const got = await read();
    if (got !== undefined) return got;
  }
  return undefined;
};

describe.skipIf(!REPO_NAME || !TOKEN)('Proof (live, by hand): a test repository with branch protection requiring the status', () => {
  afterAll(cleanup, 60_000);

  it(`a PR's required ${CONTEXT} holds it until the hub posts a PASS on its head, and not on a pending verdict`, async () => {
    const about = await api('GET', `/repos/${REPO_NAME}`);
    const branch = String(about.json.default_branch);
    const rule = await api('GET', `/repos/${REPO_NAME}/branches/${branch}/protection/required_status_checks`);
    expect(rule.status, `BLOCKED unless ${branch}'s protection requires a status: ${JSON.stringify(rule.json)}`).toBe(200);
    expect(rule.json.contexts ?? rule.json.checks?.map((c: { context: string }) => c.context), `${branch}'s protection requires ${CONTEXT}`).toContain(CONTEXT);

    const w = await World.start({ live: { repo: REPO_NAME!, token: TOKEN! } });
    const s = await w.session({ branch: `deepbuild-46-proof-${Date.now()}` });
    let number: number | undefined;
    try {
      const first = await s.commitFile('deepbuild-46-proof.md');
      await s.push();
      const pull = await api('POST', `/repos/${REPO_NAME}/pulls`, { title: 'DeepBuild #46 proof', head: s.branch, base: branch });
      number = Number(pull.json.number);
      await s.verdict(await s.claim(first), 'INCONCLUSIVE');
      const pending = await pollUntil(async () => {
        const got = await api('GET', `/repos/${REPO_NAME}/commits/${first}/status`);
        return (got.json.statuses as { context: string; state: string }[]).find((x) => x.context === CONTEXT);
      }, 30_000);
      expect(pending?.state, 'INCONCLUSIVE is pending').toBe('pending');
      const blocked = await pollUntil(async () => { const got = (await api('GET', `/repos/${REPO_NAME}/pulls/${number}`)).json; return got.mergeable_state === 'unknown' ? undefined : got.mergeable_state as string; }, 30_000);
      expect(blocked, 'branch protection holds the PR').toBe('blocked');
      await s.verdict(await s.claim(first), 'PASS');
      const green = await pollUntil(async () => {
        const got = await api('GET', `/repos/${REPO_NAME}/commits/${first}/status`);
        return (got.json.statuses as { context: string; state: string }[]).find((x) => x.context === CONTEXT && x.state === 'success');
      }, 30_000);
      expect(green, 'PASS is green').toBeDefined();
      const clear = await pollUntil(async () => { const got = (await api('GET', `/repos/${REPO_NAME}/pulls/${number}`)).json; return got.mergeable_state !== 'unknown' && got.mergeable_state !== 'blocked' ? got.mergeable_state as string : undefined; }, 30_000);
      expect(clear, 'a required status alone held it, so a repo needing reviews reads blocked here: use a test repo that requires only the status').toBeDefined();
    } finally {
      if (number) await api('PATCH', `/repos/${REPO_NAME}/pulls/${number}`, { state: 'closed' });
      await api('DELETE', `/repos/${REPO_NAME}/git/refs/heads/${s.branch}`);
      await w.stop();
    }
  }, 600_000);
});

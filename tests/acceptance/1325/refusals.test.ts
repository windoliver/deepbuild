// AC2: From a session under a run, each of these is refused by the forge and recorded: posting a status, merging a
// PR, pushing the default branch, pushing a `deep/approved/` tag. A credential that can do any one fails, naming the
// call.
//
// The session is one `deep start` launched under an approved run (#1330), naming 127.0.0.1, the forge's host. Its one
// Bash call runs fixtures/forge-calls.mjs, whose git and curl are its children, which no hook sees: the forge has to
// refuse them. They use GH_TOKEN, the session's credential (README: The surface). First the credential pushes a branch,
// which it may, so its refusals are a working credential's; then the four calls. The pull request is green from the
// gate (a status the world posts with a token of the gate's app), so nothing but the credential holds the merge back.
// "Recorded" is a `forge.refused` event naming the session and the call. The wrong programs are the four plants
// `agent-credential-<can>`, one per call.
import { describe, expect, it } from 'vitest';
import { AC, CONTEXT, failureOf, forgeCalls, mentions, must, promptOf, REFUSED_CALLS, type RefusedCall, SHOP, tag, waitFor, World } from './helpers.ts';

const LONG = 600_000;
const DESCRIBED: Record<RefusedCall, string> = {
  'post-status': `post a ${CONTEXT} status`, merge: 'merge the pull request', 'push-default-branch': 'push the default branch', 'push-approved-tag': 'push a deep/approved/ tag',
};

async function scenario(plant?: string): Promise<void> {
  const w = await World.open(plant ? { plant } : {});
  await w.applyRules();
  const gateToken = await w.mint('gate');
  const green = await w.api('POST', `/repos/${SHOP}/statuses/${w.head}`, { state: 'success', context: CONTEXT, description: 'PASS' }, gateToken);
  if (green.status !== 201) throw Error(`BLOCKED: the gate's app must post the pull request's green status: ${green.status}`);
  const state = await w.pullState();
  must(state === 'clean', `pull request #${w.pr} reads ${state} with the gate identity's green ${CONTEXT}, so a refused merge would prove nothing of the credential`);
  await w.approveRun();
  const started = await w.start(promptOf([forgeCalls(w, ['push-branch', 'post-status', 'push-approved-tag', 'push-default-branch', 'merge'], tag())]));
  const log = await w.standIn(started.worktree);
  const session = String(log.session);
  const token = log.env?.GH_TOKEN as string | undefined;
  const ran = JSON.stringify((log.bash as { command: string; denied?: boolean; code?: number; stdout?: string; stderr?: string }[]).map((b) => ({ denied: b.denied, code: b.code, out: `${b.stdout ?? ''}${b.stderr ?? ''}`.slice(-1500) })));
  const credential = w.credentialOf(token);
  must(credential.agents, `the session's GH_TOKEN is ${credential.what}, not a credential of the session's own from the agents' app`);
  const tried = (action: string) => w.forge.attempts.filter((a) => a.token === token && a.action === action);
  must(tried('push-branch').some((a) => !a.refused), `the session's credential can't push a branch, so its refusals prove nothing: ${JSON.stringify(tried('push-branch'))} ${ran}`);

  const problems: string[] = [];
  for (const call of REFUSED_CALLS) {
    const attempts = tried(call);
    const let_ = attempts.find((a) => !a.refused);
    if (let_) problems.push(`the forge let the session's credential ${call} (${DESCRIBED[call]}: ${let_.method} ${let_.target}, ${let_.status})`);
    else if (!attempts.length) problems.push(`the session's ${call} call never reached the forge: ${ran}`);
  }
  must(!problems.length, problems.join('; '));
  // Each refusal in the record, naming the session and the call.
  const unrecorded = await waitFor(async () => {
    const refused = (await w.events('forge.refused')).filter((e) => e.session === session || mentions(e, session));
    const missing = REFUSED_CALLS.filter((call) => !refused.some((e) => e.data?.action === call));
    return missing.length ? undefined : [];
  }, 60_000, 'forge.refused').catch(async () => {
    const refused = (await w.events('forge.refused')).filter((e) => e.session === session || mentions(e, session));
    return REFUSED_CALLS.filter((call) => !refused.some((e) => e.data?.action === call));
  });
  must(!unrecorded.length, `the record holds no forge.refused naming session ${session} for ${unrecorded.join(', ')}`);
}

describe(`${AC[2]} A session's credential can't post a status, merge, push the default branch or push a deep/approved/ tag, and each refusal is recorded`, () => {
  it(`${AC[2]} each of the four calls from a session under a run is refused by the forge and recorded`, async () => {
    await scenario();
  }, LONG);

  const plants: [string, RefusedCall][] = [
    ['agent-credential-posts-statuses', 'post-status'], ['agent-credential-merges', 'merge'],
    ['agent-credential-pushes-default-branch', 'push-default-branch'], ['agent-credential-pushes-approved-tags', 'push-approved-tag'],
  ];
  for (const [plant, call] of plants) {
    it(`${AC[2]} (planted ${plant}) a credential that can ${DESCRIBED[call]} fails, naming the call`, async () => {
      const failure = await failureOf(() => scenario(plant));
      expect(failure, 'the scenario must fail on the wrong program').not.toBeNull();
      expect(failure).toContain(`the forge let the session's credential ${call} (`);
    }, LONG);
  }
});

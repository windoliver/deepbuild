// #316 AC5: workflow dispatch is blocked in every form with the hub stopped (gh workflow run, gh api
// .../dispatches, curl .../dispatches); a rerun is allowed; and the denial shows the dispatch in full, so an
// approval runs exactly the workflow, branch and inputs it showed. With no hub-side authority path yet (that is
// #321), the "approval" is the shown dispatch run by a person: this test runs the agent's dispatch verbatim
// against a stub `gh` on PATH that records its argv and never calls the network, and checks what it recorded
// matches what the denial showed. Hub stopped.
import { afterEach, beforeAll, describe, it } from 'vitest';
import {
  bash, buildDeepHook, carriesReasonNextStep, childEnv, cleanup, decision, denialText, hook, installDefaults,
  makeHome, newSession, run as runCmd, shown, stubBins, type Ran, type Rules,
} from './helpers.ts';

let BIN: string;
beforeAll(async () => { BIN = await buildDeepHook(); }, 900_000);
afterEach(cleanup, 60_000);

function world(): { home: string; rules: Rules; session: ReturnType<typeof newSession> } {
  const home = makeHome();
  const rules = installDefaults(home);
  return { home, rules, session: newSession(home) };
}
async function call(w: ReturnType<typeof world>, command: string): Promise<Ran> {
  return hook(w.home, w.session, 'PreToolUse', bash(w.session, command), { binary: BIN });
}

// The one dispatch the approval reruns: a named workflow, a branch, and two inputs.
const WORKFLOW = 'deploy.yml';
const REF = 'release-1';
const INPUTS: [string, string][] = [['env', 'prod'], ['tag', 'v1']];
const DISPATCH = `gh workflow run ${WORKFLOW} --ref ${REF} ${INPUTS.map(([k, v]) => `-f ${k}=${v}`).join(' ')}`;

describe('AC5 #316.b9fa0a58 workflow dispatch is blocked in every form; a rerun is allowed; an approval runs exactly the workflow, branch and inputs it showed', () => {
  it('AC5 gh workflow run, gh api .../dispatches and curl .../dispatches are each denied; a rerun is allowed', async () => {
    const w = world();
    const forms = [
      DISPATCH,
      `gh api repos/acme/app/actions/workflows/${WORKFLOW}/dispatches -f ref=${REF}`,
      `curl -X POST -H 'Accept: application/vnd.github+json' https://api.github.com/repos/acme/app/actions/workflows/${WORKFLOW}/dispatches -d '{"ref":"${REF}"}'`,
    ];
    for (const command of forms) {
      const ran = await call(w, command);
      if (decision(ran) !== 'deny') throw Error(`\`${command}\` must be denied with the hub stopped: ${shown(ran)}`);
      if (!carriesReasonNextStep(ran, w.rules)) throw Error(`\`${command}\`: the denial carries no default entry's reason and next_step: ${shown(ran)}`);
    }
    // A rerun of an existing run is not a dispatch.
    const rerun = await call(w, 'gh run rerun 123456');
    if (decision(rerun) !== 'allow') throw Error(`a rerun must be allowed: ${shown(rerun)}`);
  }, 900_000);

  it('AC5 the denial shows the workflow, branch and inputs, and running the shown dispatch hits exactly them', async () => {
    const w = world();
    const ran = await call(w, DISPATCH);
    if (decision(ran) !== 'deny') throw Error(`the dispatch must be denied: ${shown(ran)}`);
    const text = denialText(ran);
    for (const shownToken of [WORKFLOW, REF, ...INPUTS.map(([k, v]) => `${k}=${v}`)]) {
      if (!text.includes(shownToken)) throw Error(`the denial does not show ${shownToken} (so you can't run exactly what it showed): ${shown(ran)}`);
    }
    // The approval: run the shown dispatch against a stub gh that records argv and never reaches GitHub.
    const stub = stubBins(['gh', 'curl']);
    const env = childEnv(w.home, { PATH: `${stub.dir}:${process.env.PATH ?? ''}` });
    const approved = await runCmd('/bin/sh', ['-c', DISPATCH], { env, cwd: w.session.cwd });
    if (approved.code !== 0) throw Error(`the stub gh did not run the shown dispatch: ${shown(approved)}`);
    const argv = stub.calls('gh').at(-1);
    if (!argv) throw Error('the stub gh recorded no call for the approved dispatch');
    const joined = argv.join(' ');
    for (const want of ['workflow', 'run', WORKFLOW, '--ref', REF, ...INPUTS.map(([k, v]) => `${k}=${v}`)]) {
      if (!argv.includes(want) && !joined.includes(want)) throw Error(`the approved dispatch ran ${JSON.stringify(argv)}, which is not the workflow, branch and inputs shown (missing ${want})`);
    }
  }, 900_000);
});

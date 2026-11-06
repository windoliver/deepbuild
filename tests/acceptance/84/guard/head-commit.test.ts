// #84 AC29, and the Scope line it rests on: merge authority covers one head commit. One thread: the fix is committed,
// pushed, the PR opened and the claim PASS on `head`; you type "merge PR 12".
//
// - A merge with no commit, or with another, is denied naming `head`, through `gh pr merge`, the MCP merge tool (`sha`)
//   and the API (`sha`), and so is `gh pr merge 12 --auto` with no commit.
// - Each naming `head` goes through.
// - Armed with `--auto`, a push to the PR's branch is denied, naming the rule, until `gh pr merge --disable-auto` runs.
// - The new head needs its own verdict: naming it is denied until its stop's claim is PASS, then it goes through and
//   the old head is denied, naming the new one.
// - The entry ships as guard@1 with its planted call and twin: `deep guard add` installs it as the default ships it.
//
// A planted rule that allows `gh pr merge 12 --auto` with no commit and then a push to its branch
// (DEEP_HUB_PLANT=auto-merge-unpinned) fails this test, naming the push.
import { afterEach, describe, it } from 'vitest';
import {
  AC29, BUMP, MERGE, MERGE_TOOL, PUSH, Session, bash, cleanup, decision, delivered, expectAllowed, expectDecided, expectDenied, expectPass, failureOf, makeWorld, mcpMerge,
  MERGE_ASK, must, namesCommit, reinstall, rulesIn, replyText, shipped, shown, startHub, stopHub, verdict, type Call, type Hub,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const AUTO = `${MERGE} --auto`;
const API = 'gh api -X PUT repos/acme/shop/pulls/12/merge';
const DISABLE = 'gh pr merge --disable-auto 12';
interface Seen { pushAfterAuto?: string }

async function deniedNaming(hub: Hub, s: Session, call: Call, commit: string): Promise<void> {
  const denied = await expectDenied(hub, s, call, AC29);
  must(namesCommit(denied.text, commit), `${AC29} the denial of \`${denied.label}\` must name the commit ${commit}: ${denied.text.slice(0, 600)}`);
}

async function scenario(seen: Seen, plant?: string): Promise<void> {
  const w = makeWorld();
  const hub = await startHub(w, { plant });
  try {
    const s = new Session(w);
    const head = await delivered(hub, s, AC29);
    await s.typed(MERGE_ASK);

    // No commit, or another: `w.base` is a real commit of the repo, an earlier one.
    await deniedNaming(hub, s, bash(MERGE), head);
    await deniedNaming(hub, s, bash(`${MERGE} --match-head-commit ${w.base}`), head);
    await deniedNaming(hub, s, mcpMerge(), head);
    await deniedNaming(hub, s, mcpMerge({ sha: w.base }), head);
    await deniedNaming(hub, s, bash(API), head);
    await deniedNaming(hub, s, bash(`${API} -f sha=${w.base}`), head);

    // `--auto` with no commit: a wrong program lets it through, and then the push to its branch.
    const auto = await s.call(bash(AUTO));
    if (auto.allowed) {
      await expectDecided(hub, auto, AUTO, AC29);
      const push = await s.call(bash(PUSH));
      seen.pushAfterAuto = decision(push.before);
      throw Error(`${AC29} \`${AUTO}\` names no commit and must be denied naming ${head}; it went through (${shown(auto.before)})${push.allowed ? `, and then the push \`${PUSH}\` to its branch went through too` : ''}`);
    }
    const said = replyText(auto.before);
    must(namesCommit(said, head), `${AC29} the denial of \`${AUTO}\` must name the commit ${head}: ${said.slice(0, 600)}`);
    const shippedAs = rulesIn(said).filter((r) => shipped().proofs[r] !== undefined);
    must(shippedAs.length > 0, `${AC29} the rule that denies \`${AUTO}\` must ship with its planted call and twin (proofs in crates/deep-hook/default-rules.json); the denial names ${rulesIn(said).join(', ') || 'no entry'}: ${said.slice(0, 600)}`);

    // Naming the commit the PASS is pinned to.
    await expectAllowed(hub, s, bash(`${MERGE} --match-head-commit ${head}`), AC29);
    await expectAllowed(hub, s, mcpMerge({ sha: head }), `${AC29} ${MERGE_TOOL} with the PASS's sha:`);
    await expectAllowed(hub, s, bash(`${API} -f sha=${head}`), AC29);

    // Armed with --auto: the branch is held until the merge is disarmed.
    await expectAllowed(hub, s, bash(`${AUTO} --match-head-commit ${head}`), AC29);
    await s.edit(BUMP);
    const next = await s.commit('Note the second head');
    await expectDenied(hub, s, bash(PUSH), `${AC29} with a merge armed with --auto pending,`);
    await expectAllowed(hub, s, bash(DISABLE), AC29);
    await expectAllowed(hub, s, bash(PUSH), `${AC29} after \`${DISABLE}\`,`);

    // The new head needs its own verdict.
    await expectDenied(hub, s, bash(`${MERGE} --match-head-commit ${next}`), `${AC29} the new head has no verdict yet:`);
    const stop = await s.stop('Pushed the second head.');
    must(decision(stop) !== 'deny', `BLOCKED: ${AC29} the stop on the passing new head must not be sent back: ${shown(stop)}`);
    await expectPass(hub, next, AC29);
    await expectAllowed(hub, s, bash(`${MERGE} --match-head-commit ${next}`), `${AC29} with the new head's own PASS,`);
    await deniedNaming(hub, s, bash(`${MERGE} --match-head-commit ${head}`), next);

    // It ships as a guard@1 entry with its planted call and twin: the install runs both through the one matcher.
    for (const rule of shippedAs) {
      const added = await reinstall(w, rule);
      must(added.code === 0, `${AC29} ${rule} must install as guard@1 with its planted call denied and its twin allowed: ${shown(added)}`);
    }
  } finally {
    await stopHub(hub);
  }
}

describe(`${AC29} a merge covers one head commit, named in the call`, () => {
  it(`${AC29} a merge with no commit or another is denied naming the PASS's commit, through gh, MCP and the API; naming it goes through; --auto holds the branch until --disable-auto; a new head needs its own verdict; the entry installs with its planted call and twin`, async (ctx) => verdict(ctx, () => scenario({})), 600_000);

  it(`${AC29} (wrong program) a planted rule that allows ${AUTO} with no commit and then a push to its branch (DEEP_HUB_PLANT=auto-merge-unpinned) fails this test, naming the push`, async (ctx) => verdict(ctx, async () => {
    const seen: Seen = {};
    const why = await failureOf(() => scenario(seen, 'auto-merge-unpinned'));
    must(why !== null, `${AC29} the planted rule auto-merge-unpinned must fail this test; it passed`);
    must(seen.pushAfterAuto === 'allow', `${AC29} the planted rule must let the push through after ${AUTO}; the push was ${seen.pushAfterAuto ?? 'never called'}: ${why}`);
    must(why.includes(PUSH), `${AC29} the failure must name the push \`${PUSH}\`: ${why}`);
  }), 600_000);
});

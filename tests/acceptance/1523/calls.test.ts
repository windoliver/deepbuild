// #1523's call list through deep-hook's check mode, on its real matcher (Proof: "The call list through deep-hook in
// check mode, on its real matcher, each form shown going through on the merge base"). No hub: each call is matched
// against a guard@1 entry of one class, `{"entry", "call"}` on stdin, `{"matched": bool}` on stdout.
//
// - AC1's calls, and every new form the Scope names, meet the effect classes their Scope lines give them.
// - AC3's calls meet none of push, PR, merge, send or `unread:push`; nor does a `--method GET` of the merge endpoint.
// - AC4's `"$(printf jj)" git push` meets `unread:push`, as `"$(printf git)" push` does.
// - The install check (Scope): each new form has a planted call and a twin in default-rules.json, under an entry of
//   its class; its entry matches the planted call and not the twin.
//
// Controls that hold on the base too (`git push`, `gh pr merge`, a PUT of the merge endpoint, `"$(printf git)" push`)
// show the method reads the base's own forms, so a failure here is the new form's.
import { afterEach, describe, it } from 'vitest';
import {
  AC1, AC3, AC4, FREE, HELD, INSTALL, UNREADABLE_JJ, bash, cleanup, entry, filled, graphqlAutoMerge, graphqlMerge, makeWorld, matches, must, proofsOf,
  shipped, type Effect, type World,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const CLASSES = ['effect:push', 'effect:pr', 'effect:merge', 'effect:send', 'unread:push'];
const pattern = (e: Effect) => `effect:${e}`;

/** Each call, and the patterns that must match it. Failures are gathered, so one run names every call that fails. */
async function mustMatch(w: World, who: string, table: [string, string[]][]): Promise<void> {
  const failed: string[] = [];
  for (const [command, patterns] of table) {
    for (const p of patterns) if (!await matches(w, entry(p), bash(command))) failed.push(`\`${command}\` must meet ${p}; check mode says it doesn't`);
  }
  must(!failed.length, `${who} ${failed.join('; ')}`);
}

describe(`${AC1} the new push, PR and merge forms meet their effect classes in check mode`, () => {
  it(`${AC1} each of AC1's calls meets the effect classes its Scope line gives it; git push and gh pr merge still do`, async () => {
    const w = makeWorld();
    await mustMatch(w, AC1, [
      ['git push origin HEAD', ['effect:push']],
      ['gh pr merge 12', ['effect:merge']],
      ...HELD.map(([command, effects]): [string, string[]] => [command, effects.map(pattern)]),
    ]);
  }, 300_000);

  it(`${AC1} (Scope) every new form the Scope names meets its classes: jj, sl, gt, git town, glab, a GraphQL merge or auto-merge, and gh issue create`, async () => {
    const w = makeWorld();
    await mustMatch(w, AC1, [
      ['jj git push', ['effect:push']],
      ['jj git push --remote fork', ['effect:push']],
      ['jj git push --bookmark b', ['effect:push']],
      ['sl push --to main', ['effect:push']],
      ['gt submit', ['effect:push', 'effect:pr']],
      ['git town propose', ['effect:push', 'effect:pr']],
      ['git town sync', ['effect:push']],
      ['sl pr submit', ['effect:pr']],
      ['glab mr create --fill', ['effect:pr']],
      ['gt merge', ['effect:merge']],
      ['glab mr merge 3 --sha 0123456789abcdef0123456789abcdef01234567', ['effect:merge']],
      [graphqlMerge('0123456789abcdef0123456789abcdef01234567'), ['effect:merge']],
      [graphqlAutoMerge, ['effect:merge']],
      ['gh issue create -t x', ['effect:send']],
    ]);
  }, 300_000);
});

describe(`${AC3} the read-only forms of the same tools meet no push, PR, merge or send`, () => {
  it(`${AC3} jj log, jj git fetch, gt log and a gh api GET of a pull request or its merge endpoint meet none of ${CLASSES.join(', ')}; a PUT of the merge endpoint is still a merge`, async () => {
    const w = makeWorld();
    const failed: string[] = [];
    for (const command of [...FREE, 'gh api --method GET repos/acme/shop/pulls/3/merge']) {
      for (const p of CLASSES) if (await matches(w, entry(p), bash(command))) failed.push(`\`${command}\` must go through, yet it meets ${p}`);
    }
    if (!await matches(w, entry('effect:merge'), bash('gh api -X PUT repos/acme/shop/pulls/3/merge'))) failed.push('`gh api -X PUT repos/acme/shop/pulls/3/merge` must still meet effect:merge');
    must(!failed.length, `${AC3} ${failed.join('; ')}`);
  }, 300_000);
});

describe(`${AC4} a jj push whose program the line computes meets unread:push`, () => {
  it(`${AC4} ${UNREADABLE_JJ} meets unread:push, as "$(printf git)" push origin main does`, async () => {
    const w = makeWorld();
    await mustMatch(w, AC4, [['"$(printf git)" push origin main', ['unread:push']], [UNREADABLE_JJ, ['unread:push']]]);
  }, 120_000);
});

/** Each new form (Scope), how a planted call is known to be one, and the classes its entry may have. */
const FORMS: { form: string; words: string[]; classes: string[] }[] = [
  // Controls: forms the base ships proofs for, so the reading of default-rules.json is shown sound on the base.
  { form: 'git push (control)', words: ['git push'], classes: ['effect:push'] },
  { form: 'gh pr merge (control)', words: ['gh pr merge'], classes: ['effect:merge'] },
  { form: 'jj git push', words: ['jj git push'], classes: ['effect:push'] },
  { form: 'sl push', words: ['sl push'], classes: ['effect:push'] },
  { form: 'gt submit', words: ['gt submit'], classes: ['effect:push', 'effect:pr'] },
  { form: 'git town propose', words: ['git town propose'], classes: ['effect:push', 'effect:pr'] },
  { form: 'git town ship', words: ['git town ship'], classes: ['effect:push', 'effect:merge'] },
  { form: 'git town sync', words: ['git town sync'], classes: ['effect:push'] },
  { form: 'sl pr submit', words: ['sl pr submit'], classes: ['effect:pr'] },
  { form: 'glab mr create', words: ['glab mr create'], classes: ['effect:pr'] },
  { form: 'gh api graphql mergePullRequest', words: ['gh api graphql', 'mergePullRequest'], classes: ['effect:merge'] },
  { form: 'gh api graphql enablePullRequestAutoMerge', words: ['gh api graphql', 'enablePullRequestAutoMerge'], classes: ['effect:merge'] },
  { form: 'glab mr merge', words: ['glab mr merge'], classes: ['effect:merge'] },
  { form: 'gt merge', words: ['gt merge'], classes: ['effect:merge'] },
  { form: 'gh issue create', words: ['gh issue create'], classes: ['effect:send'] },
  { form: '"$(printf jj)" git push', words: ['$(printf jj)'], classes: ['unread:push'] },
];

describe(`${INSTALL} each new form lands with a planted call and a twin in the guard's install check`, () => {
  it(`${INSTALL} for each new form, a default entry of its class ships a planted call of that form and a twin, and check mode matches the planted call and not the twin`, async () => {
    const w = makeWorld();
    const { entries } = shipped();
    const failed: string[] = [];
    for (const { form, words, classes } of FORMS) {
      let found = false;
      const seen: string[] = [];
      for (const [name, guard] of Object.entries(entries)) {
        if (!classes.includes(guard.match)) continue;
        for (const proof of proofsOf(name)) {
          const command = String(proof.planted.tool_input?.command ?? '').replace(/\s+/g, ' ');
          if (proof.planted.tool_name !== 'Bash' || !words.every((x) => command.includes(x))) continue;
          const planted = await matches(w, guard, filled(w, proof.planted));
          const twin = await matches(w, guard, filled(w, proof.twin));
          seen.push(`${name}: planted \`${command}\` ${planted ? 'matched' : 'not matched'}, twin \`${String(proof.twin.tool_input?.command ?? proof.twin.tool_name)}\` ${twin ? 'matched' : 'not matched'}`);
          if (planted && !twin) found = true;
        }
      }
      if (!found) failed.push(`${form}: no entry of ${classes.join(' or ')} ships a planted call of this form that check mode matches with a twin it doesn't${seen.length ? ` (${seen.join('; ')})` : ''}`);
    }
    must(!failed.length, `${INSTALL} ${failed.join('; ')}`);
  }, 600_000);
});

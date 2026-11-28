// Criterion 4: every changed line's token count is at or under its count on the merge base (`git merge-base HEAD
// origin/main`), counted by the repo's pinned tokenizer (gpt-tokenizer's o200k_base, as scripts/tool-load.mjs counts).
// The lines: what the hub sent into the chat at each step of the fixture run (README, The fixture run), run on the
// merge base built (#83's mergeBase) and on this checkout, with IDs, paths and times made the same; and the default
// rules' reason and next_step, which deep-hook sends when it blocks on its own, read from each side's
// crates/deep-hook/default-rules.json. A line the merge base doesn't send is new, counted against 0 (Scope: no new line).
// The merge base can't fail this against itself; its wrong program is the twin `longer-rule-line` (twins.json).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import * as t83 from '../83/helpers.ts';
import { fixtureRun, git, ID, MIN, mergeBaseSha, REPO, ruleFailures, ruleTexts, tokenFailures } from './helpers.ts';

afterAll(t83.cleanup, 60_000);

const RULES = 'crates/deep-hook/default-rules.json';

describe(`AC4 ${ID.tokens} Every changed line's token count is at or under its count on the merge base`, () => {
  it(`AC4 ${ID.tokens} each default rule's reason and next_step, and each line the fixture run's hub sent into the chat, counts at most its merge base line's tokens, and none is new`, async () => {
    const sha = mergeBaseSha();
    expect(ruleFailures(ruleTexts(git('show', `${sha}:${RULES}`)), ruleTexts(readFileSync(join(REPO, RULES), 'utf8')))).toEqual([]);
    const base = await fixtureRun(await t83.mergeBase());
    const here = await fixtureRun(t83.CURRENT);
    expect(tokenFailures(base, here)).toEqual([]);
  }, 45 * MIN);
});

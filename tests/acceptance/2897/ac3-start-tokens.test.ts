// #2897 AC3: "By the pinned tokenizer, what a client that loads by search holds of DeepBuild at a session's start is at
// most 800 tokens (drafted: 149 of names, about 250 of instructions, 244 of `deep_status` and 53 of the skill's
// description). A planted instructions text of 4,000 characters fails, naming its size"
//
// The servers `deep setup` writes into Claude Code's config, `deepbuild` (deep mcp) and `deep-actions` (deep-hook mcp
// actions), are started fresh and initialized as Claude Code. What such a client holds at the start is the issue's four
// parts ("the names, the instructions, the marked tools and the skill's description"): every tool's name as Claude Code
// lists it (mcp__<server>__<tool>, one per line), each server's instructions, each marked tool whole, and the
// description in skills/deepbuild/SKILL.md's front matter, each counted by gpt-tokenizer 4.0.0's o200k_base. Each part
// the issue drafts must be there: deep sends instructions and marks a tool. Then the planted text: deep's instructions
// replaced by one of 4,000 characters, through the same count, which must fail naming its size.
import { expect, test } from 'vitest';
import { ACTIONS_HOOK, AC, DEEP, START_MAX, instructionsOf, startCount, startFailures, startSession, type Session } from './helpers.ts';

test(`${AC.startTokens} a client that loads by search holds at most ${START_MAX} tokens of DeepBuild at a session's start, names, instructions, marked tools and the skill's description; the same count fails a planted instructions text of 4,000 characters, naming its size`, { timeout: 120_000 }, async () => {
  const sessions = [{ server: DEEP, session: await startSession(DEEP) }, { server: ACTIONS_HOOK, session: await startSession(ACTIONS_HOOK) }];
  const start = startCount(sessions);
  const deep = sessions[0]!.session;
  expect({ instructions: start.instructions > 0, marked: start.marked > 0 }, `each part the issue counts is there: deep's instructions and its marked tool (${start.parts.join('; ')})\n${deep.output}`).toEqual({ instructions: true, marked: true });
  expect(startFailures(start), 'what a client that loads by search holds at the start').toEqual([]);

  const own = instructionsOf(deep) ?? '';
  const filler = own.length ? own : 'DeepBuild tools record what is open and run the checks that decide a claim. ';
  let text = '';
  while (text.length < 4000) text += `${filler} `;
  text = text.slice(0, 4000);
  const plantedDeep: Session = { ...deep, initialize: { ...(deep.initialize ?? {}), instructions: text } };
  const planted = startFailures(startCount([{ server: DEEP, session: plantedDeep }, sessions[1]!]));
  expect(planted.some((line) => line.includes('4000 characters of instructions')), `the planted instructions text of 4,000 characters fails, naming its size: ${planted.join(' | ') || 'it passed'}`).toBe(true);
});

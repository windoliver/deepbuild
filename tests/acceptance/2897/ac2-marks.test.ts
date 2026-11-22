// #2897 AC2: "In `deep`'s `tools/list`, exactly the stated set carries the load mark, and no canvas tool does. A planted
// list that marks every tool fails, naming the tokens it would load, 8,349 on the merge base"
//
// deep is started fresh and initialized as Claude Code, a client that reads the mark. The mark is the one the issue reads
// on Claude Code's page, `anthropic/alwaysLoad: true` in a tool's `_meta`; the stated set is the issue's draft,
// deep_status alone (README: Open questions 1). Then the planted list: deep's own list with every tool marked, through the
// same check, which must fail naming the tokens a client would load of it, by the pinned tokenizer. That figure is the
// whole list's: at least the merge base's whole list (base-tools.json), which the issue counts as 8,349 at 55fd5b84a and
// which this suite's base, 6a2b68d44, counts as 8,429 (README: The base).
import { expect, test } from 'vitest';
import { AC, DEEP, MARK, base, markFailures, markedTokens, startSession, tokens, type Tool } from './helpers.ts';

test(`${AC.marks} in deep's tools/list exactly deep_status carries ${MARK} and no canvas tool does; the same check fails a planted list that marks every tool, naming the tokens it would load`, { timeout: 120_000 }, async () => {
  const session = await startSession(DEEP);
  const tools = session.tools ?? [];
  expect(tools.length, `deep lists its tools\n${session.output}`).toBeGreaterThan(0);
  expect(markFailures(tools), 'deep\'s marked tools').toEqual([]);

  const planted: Tool[] = tools.map((t) => ({ ...t, _meta: { ...(t._meta ?? {}), [MARK]: true } }));
  const would = markedTokens(planted);
  const whole = base().servers.deep!.reduce((sum, t) => sum + tokens(t), 0);
  expect(would, `the planted list's tokens are the whole list's, at least the merge base's ${whole}`).toBeGreaterThanOrEqual(whole);
  const failures = markFailures(planted);
  expect(failures.some((line) => line.includes(`${would} tokens`)), `the planted list that marks every tool fails, naming the ${would} tokens it would load: ${failures.join(' | ')}`).toBe(true);
});

// AC20 #18.9a7f6c86 At session start the agent gets a short briefing of active checks and how to declare a claim.
//
// What the agent gets at SessionStart is what deep-hook prints for Claude Code: Claude Code adds a SessionStart
// hook's `hookSpecificOutput.additionalContext`, or its plain stdout, to the session's context (code.claude.com
// hooks reference). Two repos with different checks: each session's briefing names its own repo's active checks (the
// checks its .deepbuild/done.yaml names) and none of the other's, and says how to declare a claim, naming the
// deep_claim tool; it is short, at most 2,000 characters (README: AC20).

import { join } from 'node:path';
import { afterEach, beforeAll, expect, test } from 'vitest';
import { buildDeepHook, cleanup, hook, makeHome, makeWorktree, newestCovered, newSession, parse, payload, shown, startHub, word, type Ran } from './helpers.ts';

beforeAll(buildDeepHook, 900_000);
afterEach(cleanup, 30_000);

const SHORT = 2000;

/** The text Claude Code adds to the session's context from deep-hook's SessionStart output. */
function briefing(r: Ran, what: string): string {
  expect(r.code, `deep-hook's SessionStart for ${what} exits 0, so Claude Code reads its output as context: ${shown(r)}`).toBe(0);
  const text = r.stdout.trim();
  expect(text, `deep-hook printed nothing at SessionStart for ${what}: the agent got no briefing (${shown(r)})`).not.toBe('');
  const json = parse(text);
  if (!json) return text;
  expect(json.decision === undefined && json.continue !== false, `the SessionStart reply for ${what} decides nothing: ${text.slice(0, 600)}`).toBe(true);
  const out = json.hookSpecificOutput;
  expect(out?.hookEventName, `a JSON SessionStart reply for ${what} names its event, as Claude Code requires: ${text.slice(0, 600)}`).toBe('SessionStart');
  expect(typeof out?.additionalContext, `a JSON SessionStart reply for ${what} carries the briefing as additionalContext: ${text.slice(0, 600)}`).toBe('string');
  return String(out.additionalContext);
}

test('AC20 #18.9a7f6c86 at session start the agent gets a short briefing of its repo\'s active checks and how to declare a claim', async () => {
  const { tmp, home } = makeHome();
  const checksA = [word('unit'), word('lint')];
  const checksB = [word('e2e')];
  const wa = makeWorktree(join(tmp, 'a'), checksA);
  const wb = makeWorktree(join(tmp, 'b'), checksB);
  await startHub(home);
  const version = newestCovered();
  const sa = newSession(home, wa, version);
  const sb = newSession(home, wb, version);

  const a = briefing(await hook(home, sa, payload(sa, 'SessionStart')), `session ${sa.id} in repo a`);
  const b = briefing(await hook(home, sb, payload(sb, 'SessionStart')), `session ${sb.id} in repo b`);

  for (const [text, own, other, where] of [[a, checksA, checksB, 'a'], [b, checksB, checksA, 'b']] as const) {
    expect(own.filter((check) => !text.includes(check)), `the briefing in repo ${where} names each of its active checks (${own.join(', ')}): ${JSON.stringify(text)}`).toEqual([]);
    expect(other.filter((check) => text.includes(check)), `the briefing in repo ${where} names no other repo's checks: ${JSON.stringify(text)}`).toEqual([]);
    expect(text, `the briefing in repo ${where} says how to declare a claim, naming the deep_claim tool`).toContain('deep_claim');
    expect(text.length, `the briefing in repo ${where} is short, at most ${SHORT} characters: ${JSON.stringify(text)}`).toBeLessThanOrEqual(SHORT);
  }
}, 300_000);

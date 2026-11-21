// AC1 #1884.ae94b96f With facts listing versions 1.0.0 and 1.2.0 and version 1.1.0 installed, `deep doctor` reports
//   `version_uncovered` and a session's hooks are watch-only. On the merge base the doctor reads healthy.
// AC2 #1884.158e699a With a listed version installed, both read covered.
//
// Both read the same facts: the shipped adapters/claude-code.facts.json of a copy of this checkout's built tree, whose
// `versions` are [1.0.0, 1.2.0] (README: The test's facts). The doctor's reading is its `claude.binary` item; the
// hub's is the reply to one PreToolUse whose Bash call matched a block entry (not fail_closed): blocked when the
// session is gated, let through when it is watch-only (README: The hook).

import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';
import { BETWEEN, LISTED, answered, blocked, cleanup, doctor, factsCopy, listed, makeHome, newSession, preToolUse, shown, startHub, stopAll, word, writeRules } from './helpers.ts';

let copy: ReturnType<typeof factsCopy>;
beforeAll(() => { copy = factsCopy(); }, 600_000);
afterEach(stopAll, 30_000);
afterAll(cleanup, 60_000);

const binaryItem = async (home: string, tmp: string, version: string) => {
  const { items, ran } = await doctor(copy.cli, home, tmp, version);
  const item = items.find((i) => i.item === 'claude.binary');
  expect(item, `deep doctor --json gives a claude.binary item for the stand-in Claude Code ${version}; its items: ${listed(items)}; run: ${shown(ran)}`).toBeDefined();
  return { item: item!, items };
};

/** One session on Claude Code `version`, and its one Bash call that a block entry matched: the hub's answer. */
async function oneHook(version: string) {
  const { tmp, home, cwd } = makeHome();
  const rule = word('deep1884-');
  const command = `echo ${word('c')}`;
  writeRules(home, rule, command);
  const hub = await startHub(copy.cli, home, cwd);
  const s = newSession(home, cwd, version);
  const answer = await preToolUse(hub, s, command, rule);
  expect(answer.reply, `the hub replies to the PreToolUse of session ${s.id} (Claude Code ${version}); it wrote: ${answered(answer)}; hub output: ${hub.output().slice(0, 800)}`).toBeDefined();
  return { tmp, home, answer, s };
}

test(`AC1 #1884.ae94b96f facts listing ${LISTED.join(' and ')}, Claude Code ${BETWEEN} installed: deep doctor reports version_uncovered and the session's hook is watch-only`, async () => {
  expect(copy.facts.versions, 'the facts both read list exactly the issue\'s two versions').toEqual([...LISTED]);
  const { tmp, home } = makeHome();
  const { item } = await binaryItem(home, tmp, BETWEEN);
  expect(item.code, `deep doctor reads Claude Code ${BETWEEN} as the hub does, uncovered by facts listing ${LISTED.join(' and ')}: ${item.level} (${item.code}): ${item.evidence}`).toBe('version_uncovered');
  expect(item.level, `the version_uncovered item is not ok: ${item.evidence}`).not.toBe('ok');

  const { answer, s } = await oneHook(BETWEEN);
  expect(blocked(answer), `session ${s.id} on Claude Code ${BETWEEN}, a version the facts (${LISTED.join(', ')}) don't list, is watch-only: its Bash call that matched a block entry is let through, not blocked: ${answered(answer)}`).toBe(false);
}, 600_000);

for (const version of LISTED) {
  test(`AC2 #1884.158e699a Claude Code ${version}, listed in the facts: deep doctor reads it covered and the session's hook is gated, not watch-only`, async () => {
    const { tmp, home, answer, s } = await oneHook(version);
    expect(blocked(answer), `session ${s.id} on Claude Code ${version}, listed in the facts, is gated: its Bash call that matched a block entry is blocked: ${answered(answer)}`).toBe(true);

    const { item } = await binaryItem(home, tmp, version);
    expect(`${item.code} ${item.level}`, `deep doctor reads Claude Code ${version}, listed in the facts, as covered: ${item.evidence}`).toBe('healthy ok');
  }, 600_000);
}

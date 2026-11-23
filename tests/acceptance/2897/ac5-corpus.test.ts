// #2897 AC5: "The corpus gains a scenario with DeepBuild's own server set up, recorded on each listed Claude Code version:
// the first `deep_status` has no search before it, every other tool the session calls is loaded by a search before its
// first call, and no call is refused for a schema the agent didn't have. A recording from a planted server with no marks
// shows a search before `deep_status` and fails, naming the call"
//
// The recording is made by a live run (scripts/corpus.mjs record, on each version adapters/claude-code.facts.json lists),
// as the corpus's other scenarios are; this test reads what the corpus keeps, adapters/corpus/claude-code/<version>/
// <scenario>/events.jsonl, and fails while a version has none. A scenario "with DeepBuild's own server set up" is one
// whose recorded hooks call DeepBuild's deep_status (mcp__deepbuild__deep_status as `deep setup` names the server, or
// mcp__deep__). Its hooks are read in order: ToolSearch's PreToolUse and PostToolUse (its select: query and its result's
// matches) and each DeepBuild tool's calls and results. Then the planted recording: the same session with a search that
// loads deep_status before its first call, as a server with no marks makes the agent do (README: How the plants work).
import { expect, test } from 'vitest';
import { AC, deepScenarios, facts, scenarioFailures, searchedFirst } from './helpers.ts';

test(`${AC.corpus} on each listed Claude Code version a recorded scenario with DeepBuild's server calls deep_status with no search before it, loads every other DeepBuild tool by a search before its first call and has no call refused for a schema; the same check fails a planted recording that searches before deep_status, naming the call`, () => {
  const versions = facts('claude-code').versions as string[];
  const failures: string[] = [];
  for (const version of versions) {
    const found = deepScenarios(version);
    if (!found.length) failures.push(`${version}: the corpus holds no scenario with DeepBuild's server set up (adapters/corpus/claude-code/${version}/<scenario>/events.jsonl calling deep_status)`);
    for (const { name, lines } of found) failures.push(...scenarioFailures(lines).map((line) => `${version}/${name}: ${line}`));
  }
  expect(failures, 'each listed version\'s recorded scenario').toEqual([]);

  for (const version of versions) {
    for (const { name, lines } of deepScenarios(version)) {
      const planted = scenarioFailures(searchedFirst(lines));
      expect(planted.some((line) => line.includes('a search before the first deep_status') && line.includes('toolu_planted_search')),
        `${version}/${name} with a search before deep_status fails, naming the call: ${planted.join(' | ') || 'it passed'}`).toBe(true);
    }
  }
});

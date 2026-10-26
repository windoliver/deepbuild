import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { score } from '../scripts/agent-eval.mjs';

// The skill a session loaded must be pinned to the installed DeepBuild (#26, skill hygiene): the recorded run of
// tests/acceptance/26 with the installed skill, and the same run with the skill pinned to another version.
const skill = readFileSync(new URL('../skills/deepbuild/SKILL.md', import.meta.url), 'utf8');
const { version } = JSON.parse(readFileSync(new URL('../packages/hub/package.json', import.meta.url), 'utf8'));
const recorded = () => {
  const run = JSON.parse(readFileSync(new URL('./acceptance/26/fixtures/eval/run.json', import.meta.url), 'utf8'));
  run.skill.text = skill;
  run.tools = ['deep_ask', 'deep_wait', 'deep_open_item', 'deep_status', 'deep_search', 'deep_claim', 'deep_evidence', 'deep_run'].map((name) => ({ name }));
  return run;
};

test('a skill pinned to the installed version passes; one pinned to another fails, naming both', () => {
  assert.match(skill, new RegExp(`^version: ${version.replaceAll('.', '\\.')}$`, 'm'));
  assert.deepEqual(score(recorded()), []);
  const stale = recorded();
  stale.skill.text = skill.replace(/^version: .*$/m, 'version: 0.0.0-stale');
  assert.deepEqual(score(stale).map((r) => [r.code, r.detail]), [['skill_version_mismatch', `the skill is pinned to 0.0.0-stale, not the installed ${version}`]]);
  const unpinned = recorded();
  unpinned.skill.text = skill.replace(/^version: .*\n/m, '');
  assert.deepEqual(score(unpinned).map((r) => r.code), ['skill_version_mismatch']);
});

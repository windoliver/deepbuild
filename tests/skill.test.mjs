// Every agent session reads the whole skill, so it says each thing once (#26): a tool's line stands under the first
// block that names it, and a later block names the tool and where its line is. The craft guide deep_kinds serves is
// the one scripts/skill.mjs writes from craft.json (#2697), so a check added there can't leave it stale.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { generate } from '../scripts/skill.mjs';

const skill = readFileSync(new URL('../skills/deepbuild/SKILL.md', import.meta.url), 'utf8').split('\n');
const tools = Object.keys(JSON.parse(readFileSync(new URL('../packages/hub/tools.json', import.meta.url), 'utf8')));

test('the skill a session loads describes each tool once', () => {
  for (const tool of tools) assert.equal(skill.filter((line) => line.startsWith(`- ${tool}. `)).length, 1, `${tool}'s line`);
});

test('the installed craft guide is the one scripts/skill.mjs generates from craft.json', () => {
  const installed = readFileSync(new URL('../crates/deep-show/gallery/craft.md', import.meta.url), 'utf8');
  assert.equal(installed, generate().guide, 'run node scripts/skill.mjs after changing crates/deep-canvas/src/craft.json');
});

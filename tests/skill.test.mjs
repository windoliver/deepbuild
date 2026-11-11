// Every agent session reads the whole skill, so it says each thing once (#26): a tool's line stands under the first
// block that names it, and a later block names the tool and where its line is.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const skill = readFileSync(new URL('../skills/deepbuild/SKILL.md', import.meta.url), 'utf8').split('\n');
const tools = Object.keys(JSON.parse(readFileSync(new URL('../packages/hub/tools.json', import.meta.url), 'utf8')));

test('the skill a session loads describes each tool once', () => {
  for (const tool of tools) assert.equal(skill.filter((line) => line.startsWith(`- ${tool}. `)).length, 1, `${tool}'s line`);
});

// #2897: the counts a session's start records are the tool lists' as served now, and the way is the one its client's
// facts give for the session's version.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { toolLoadCounts } from '../../../scripts/tool-load.mjs';
import { toolLoad } from '../src/tool-load.js';
import { actionToolList, instructionsFor, toolList } from '../src/tools.js';

describe('a session start counts what it holds of DeepBuild', () => {
  it('holds the counts of the tool lists, instructions and skill as served now', () => {
    const counts = toolLoadCounts({
      lists: { deep: toolList(), 'deep-actions': actionToolList() },
      instructions: { deep: instructionsFor('deep'), 'deep-actions': instructionsFor('deep-actions') },
      skill: readFileSync(new URL('../../../skills/deepbuild/SKILL.md', import.meta.url), 'utf8'),
    });
    expect(JSON.parse(readFileSync(new URL('../tool-load.json', import.meta.url), 'utf8')), 'run node scripts/tool-load.mjs after building the hub').toEqual(counts);
  });

  it('says the way the client loads tools at the session\'s version', () => {
    expect(toolLoad('claude-code', '2.1.304')?.way).toBe('search');
    expect(toolLoad('claude-code', undefined)?.way).toBe('search');
    expect(toolLoad('claude-code', '2.1.1')?.way).toBe('unread');
    expect(toolLoad('codex', '0.160.0')?.way).toBe('unread');
  });
});

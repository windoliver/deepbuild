// What a session holds of DeepBuild's own MCP servers at its start, both ways a client loads them (#2897), written from
// the built hub to packages/hub/tool-load.json, which the hub records at each session's start: the counts never change
// while a hub runs, so it holds no tokenizer. Run after `npm run build -w @deepbuild/hub`;
// packages/hub/test/tool-load.test.ts fails while the file holds anything else.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { countTokens } from 'gpt-tokenizer/encoding/o200k_base';

/** The names `deep setup` gives the two servers in Claude Code's config (packages/hub/src/setup.ts), which prefix their tools there. */
const SERVERS = { deep: 'deepbuild', 'deep-actions': 'deep-actions' };
const count = (value) => countTokens(typeof value === 'string' ? value : JSON.stringify(value));

/**
 * A client that loads by search holds the tools' names, both servers' instructions, each tool marked to load up front
 * as it is listed, and the skill's description; one that loads the whole list holds every tool as listed and the whole
 * skill. Counted by the pinned tokenizer, gpt-tokenizer 4.0.0's o200k_base, each value as its JSON.
 */
export function toolLoadCounts({ lists, instructions, skill }) {
  const names = Object.entries(lists).flatMap(([server, tools]) => tools.map((t) => `mcp__${SERVERS[server]}__${t.name}`)).join('\n');
  const all = Object.values(lists).flat();
  const description = /^description: (.*)$/m.exec(skill)?.[1] ?? '';
  const marked = all.filter((t) => t._meta?.['anthropic/alwaysLoad'] === true);
  return {
    startTokens: count(names) + Object.values(instructions).reduce((n, text) => n + count(text), 0) + marked.reduce((n, t) => n + count(t), 0) + count(description),
    wholeTokens: all.reduce((n, t) => n + count(t), 0) + count(skill),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { actionToolList, instructionsFor, toolList } = await import('../packages/hub/dist/tools.js');
  const counts = toolLoadCounts({
    lists: { deep: toolList(), 'deep-actions': actionToolList() },
    instructions: { deep: instructionsFor('deep'), 'deep-actions': instructionsFor('deep-actions') },
    skill: readFileSync(new URL('../skills/deepbuild/SKILL.md', import.meta.url), 'utf8'),
  });
  writeFileSync(new URL('../packages/hub/tool-load.json', import.meta.url), `${JSON.stringify(counts, null, 1)}\n`);
}

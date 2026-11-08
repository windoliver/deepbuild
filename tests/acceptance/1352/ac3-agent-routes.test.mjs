// Criterion 3: each agent's route on a hosted machine is written down from its provider's own terms, as allowed, API key
// only, or not allowed. Offline: it reads the new section of docs/technical-design.md. The agents are those the
// design's "What each agent gives us" table names at the base (README.md, The agents).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NO_SECTION, findSection, readDesign } from './helpers.mjs';

const AGENTS = [
  ['Claude Code', /\bClaude Code\b/],
  ['Codex', /\bCodex\b/],
  ['pi', /(?<![\w-])pi(?![\w-])/],
  ['Cursor', /\bCursor\b/],
  ['Copilot', /\bCopilot\b/],
  ['OpenCode', /\bOpenCode\b/],
];
const ROUTE = /\bnot allowed\b|\bAPI key only\b|\ballowed\b/i;
// A link out to a provider's terms: any http(s) address that isn't this repo's.
const TERMS = /https?:\/\/(?!(?:www\.)?github\.com\/windoliver\/)[^\s)>\]|]+/i;

test('#1352.fbaaa304 criterion 3: the new section gives each agent the design supports a line naming it with its route on a hosted machine (allowed, API key only, or not allowed) and a link to its provider\'s terms', () => {
  const section = findSection(readDesign());
  assert.ok(section, NO_SECTION);
  // A line is one line of the section's text: a table row, a list item or a paragraph line.
  const lines = section.body.split('\n');
  const missing = AGENTS.filter(([, name]) => !lines.some((l) => name.test(l) && ROUTE.test(l) && TERMS.test(l)))
    .map(([agent, name]) => {
      const named = lines.filter((l) => name.test(l));
      return `${agent}: ${named.length ? `named on ${named.length} line(s), none with both a route word and a link to the provider's terms` : 'not named in the section'}`;
    });
  assert.deepEqual(missing, [], `the section "${section.heading}" doesn't write down these agents' routes`);
});

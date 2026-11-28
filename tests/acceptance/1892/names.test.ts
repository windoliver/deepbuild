// #1892 AC1: packages/runner/src/runner.ts compares against no agent name: the audit's count for the runner goes to 0.
//
// The count is taken as tests/agent-name-branches.test.mjs takes the hub's (#1689): line by line, comment lines
// left out, over the same names, with the runner's own registered names added. It counts a name written as a
// literal, since every comparison against a name is written with one: `agent === 'codex'`, a `case 'pi':`, an
// `includes('claude-code')` or a table keyed by name. At the base every literal is an equality, so this count and
// the audit rule's (an equality with a name on either side) are the same lines.
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { AGENTS } from '../../../packages/runner/src/agents.ts';

const RUNNER = new URL('../../../packages/runner/src/runner.ts', import.meta.url);
/** The names tests/agent-name-branches.test.mjs counts, and every agent the runner has parts for. */
const NAMES = [...new Set(['claude-code', 'claude', 'codex', 'pi', 'paseo', 'cursor', 'opencode', 'grok', ...Object.keys(AGENTS)])];
const LITERAL = new RegExp(`(['"\`])(?:${NAMES.map((name) => name.replace(/[^\w-]/g, '\\$&')).join('|')})\\1`);

it('#1892.4c7de5fe AC1: runner.ts names no agent: no line of it compares against an agent\'s name', () => {
  const named = readFileSync(RUNNER, 'utf8').split('\n').flatMap((line, index) => (
    !/^\s*(\/\/|\*|\/\*)/.test(line) && LITERAL.test(line) ? [`packages/runner/src/runner.ts:${index + 1} ${line.trim().slice(0, 120)}`] : []));
  expect(named, 'lines of runner.ts that name an agent; each belongs behind AgentParts in agents.ts').toEqual([]);
});

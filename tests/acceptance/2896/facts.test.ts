// #2896 AC1: each adapter's facts hold what its client keeps of one tool result, for every version they list, with the source of
// each figure; a facts file that lists a version with no limit fails its conformance case, naming the version. The case runs as
// the preflight's corpus lane runs the adapter-facts cases (`node scripts/corpus.mjs check --facts <dir>`, as #1514's and
// #1296's suites run it). The entry is found by what it holds, not by a key (README: The facts entry).
import { rmSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { check, factsFolder, limitProblems, withoutLimit } from './facts.ts';
import { FACTS, readFacts, type Agent } from './helpers.ts';

const made: string[] = [];
afterAll(() => { for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const AGENTS: Agent[] = ['claude-code', 'codex'];
const fileOf = (agent: Agent): string => FACTS[agent].replace('adapters/', '');

describe('#2896 AC1: each client\'s limits are in its facts', () => {
  // AC1: "`adapters/claude-code.facts.json` and `adapters/codex.facts.json` each hold the result and error limits for every
  // version they list, with the source of each figure. A facts file that lists a version with no limit fails its conformance
  // case, naming the version"
  it('AC1 #2896.b9f34dd1 claude-code.facts.json and codex.facts.json each hold the result and error limits for every version they list, with the source of each figure', () => {
    const problems = AGENTS.flatMap((agent) => limitProblems(readFacts(agent), agent, FACTS[agent]));
    console.log(`AC1 limit problems: ${JSON.stringify(problems, null, 1)}`);
    expect(problems, 'every listed version of each facts file has its result limit (Claude Code: 50,000 characters, 25,000 tokens, past them a file; Codex: 10,000 tokens, past them a cut), an error limit, and each figure\'s source (Claude Code\'s MCP page; `codex debug models`)').toEqual([]);
  }, 60_000);

  it('AC1 #2896.b9f34dd1 a facts file that lists a version with no limit fails its conformance case, naming the version (each agent\'s newest listed version taken out of its limits)', () => {
    const failures: string[] = [];
    const control = check(factsFolder(made)).fails;
    for (const agent of AGENTS) {
      const facts = readFacts(agent);
      const version = (facts.versions as string[]).at(-1)!;
      const { facts: planted, removed } = withoutLimit(facts, agent, version);
      const fails = check(factsFolder(made, fileOf(agent), planted)).fails;
      const added = fails.filter((l) => !control.includes(l));
      console.log(`AC1 ${agent} ${version} taken out of its limits (an entry was ${removed ? '' : 'not '}found to take it out of): the new FAIL lines: ${JSON.stringify(added)}`);
      if (!added.some((l) => l.includes(version))) {
        failures.push(`${FACTS[agent]} listing ${version} with no limit${removed ? '' : ' (the shipped facts hold none for it to take out)'} fails no conformance case naming ${version}: the FAIL lines it adds to the shipped facts' are ${JSON.stringify(added).slice(0, 1500)}`);
      }
    }
    expect(failures, 'node scripts/corpus.mjs check fails a facts file listing a version with no limit, with a line naming the version').toEqual([]);
  }, 600_000);
});

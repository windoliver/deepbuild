// The body of the planted reading-rule check for #2338's acceptance tests: a twin of scripts/reading-rule.mjs written by
// the blind test job from the issue and the README's surface alone, never from an implementation. The planted file
// beside it runs `main` with one fault, named in that file's own code, never chosen by an environment variable
// (design: Wrong programs). No test runs it without a fault. Run from the repository root.
import { readFileSync } from 'node:fs';

const START = 'Read the design sections';
const sentence = (line) => line.slice(line.indexOf(START)).match(/^.*?(?:\.(?=\s|$)|$)/)[0];

function find(file) {
  const lines = readFileSync(file, 'utf8').split('\n');
  const index = lines.findIndex((line) => line.includes(START));
  return index < 0 ? null : { where: `${file}:${index + 1}`, line: lines[index], rule: sentence(lines[index]) };
}

export function main(fault = {}) {
  const agents = find('AGENTS.md');
  const contributing = find('CONTRIBUTING.md');
  if (fault.agentsOnly) {
    if (agents) console.log(`PASS reading rule: ${agents.where} states it`);
    else console.log('FAIL reading rule: AGENTS.md states no reading rule');
    process.exit(agents ? 0 : 1);
  }
  if (agents && contributing && agents.rule === contributing.rule) {
    console.log(`PASS reading rule: ${agents.where} and ${contributing.where} state it in the same words`);
    return;
  }
  console.log(`FAIL reading rule: ${agents?.where ?? 'AGENTS.md (none)'} and ${contributing?.where ?? 'CONTRIBUTING.md (none)'} differ:\n  ${agents?.line ?? ''}\n  ${contributing?.line ?? ''}`);
  process.exit(1);
}

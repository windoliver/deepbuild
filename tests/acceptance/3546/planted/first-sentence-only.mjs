// A planted wrong check for #3546 criterion 6 (#3546.c49452fc): a twin of the text check that holds AGENTS.md and
// CONTRIBUTING.md to the reading rule's first sentence alone, as the check did before #3546, so an edit of the sentence
// that names the limit, made in one file alone, passes it. ac6-same-words.test.mjs runs it and must fail it. Written by
// the blind test job from the issue alone; run from the repository root.
import { readFileSync } from 'node:fs';

const START = 'Read the design sections';
const sentence = (line) => line.slice(line.indexOf(START)).match(/^.*?(?:\.(?=\s|$)|$)/)[0];
function find(file) {
  const lines = readFileSync(file, 'utf8').split('\n');
  const index = lines.findIndex((line) => line.includes(START));
  return index < 0 ? null : { where: `${file}:${index + 1}`, rule: sentence(lines[index]) };
}

const agents = find('AGENTS.md');
const contributing = find('CONTRIBUTING.md');
if (agents && contributing && agents.rule === contributing.rule) console.log(`PASS reading rule: ${agents.where} and ${contributing.where} both say "${agents.rule}"`);
else {
  console.log(`FAIL reading rule: ${agents?.where ?? 'AGENTS.md (none)'} and ${contributing?.where ?? 'CONTRIBUTING.md (none)'} don't state the reading rule in the same words`);
  process.exit(1);
}

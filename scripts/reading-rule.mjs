// The reading rule, held in two places (#2338), run by the lint lane: AGENTS.md's first rule, the first sentence of
// its first line after the title, and CONTRIBUTING.md's line marked `<!-- reading rule -->` state it in the same words,
// so neither file is edited alone. So do the two lines' sentences on the limit (#3546): the one of each that names the
// tokens past which an issue's sections print as outlines. One PASS line, or one FAIL line naming both lines; exit 1 on
// a finding.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LIMIT } from './linked-sections.mjs';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const MARK = '<!-- reading rule -->';
const agents = readFileSync('AGENTS.md', 'utf8').split(/\r?\n/);
const contributing = readFileSync('CONTRIBUTING.md', 'utf8').split(/\r?\n/);

const first = agents.findIndex((line, i) => i > 0 && line.trim());
// The sentence ends at the first `.` followed by white space or the end of the line.
const rule = first === -1 ? '' : agents[first].trim().match(/^.*?(?:\.(?=\s|$)|$)/)[0];
const marked = contributing.findIndex((line) => line.includes(MARK));
const agentsAt = `AGENTS.md:${first + 1}`;
const contributingAt = marked === -1 ? `CONTRIBUTING.md (no line marked ${MARK})` : `CONTRIBUTING.md:${marked + 1}`;

// The rule must be a whole sentence of the marked line, not part of a longer one.
const sentences = marked === -1 ? [] : contributing[marked].replace(MARK, '').trim().replace(/^[-*]\s+/, '').split(/(?<=\.)\s+/);
if (!rule || !sentences.includes(rule)) {
  console.log(`FAIL reading rule: ${agentsAt} and ${contributingAt} don't state the reading rule in the same words; AGENTS.md's first rule is "${rule}"`);
  console.log(`  Fix: Edit both lines together, so CONTRIBUTING.md's marked line holds AGENTS.md's first sentence word for word.`);
  process.exit(1);
}
// The limit's sentence is found by the limit it names, as scripts/design-section.mjs holds it, not by its wording.
const number = LIMIT.toLocaleString('en-US');
const limit = agents[first].trim().split(/(?<=\.)\s+/).find((sentence) => sentence.includes(number));
if (!limit || !sentences.includes(limit)) {
  console.log(`FAIL reading rule: ${agentsAt} and ${contributingAt} don't say in the same words what an issue's sections print as past ${number} tokens; AGENTS.md says "${limit ?? ''}"`);
  console.log(`  Fix: Edit both lines together, so each holds one sentence that names the limit, ${number}, word for word the other's.`);
  process.exit(1);
}
console.log(`PASS reading rule: ${agentsAt} and ${contributingAt} both say "${rule}" and "${limit}"`);

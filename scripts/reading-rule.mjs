// The reading rule, held in two places (#2338), run by the lint lane: AGENTS.md's first rule, the first sentence of
// its first line after the title, and CONTRIBUTING.md's line marked `<!-- reading rule -->` state it in the same words,
// so neither file is edited alone. One PASS line, or one FAIL line naming both lines; exit 1 on a finding.
import { readFileSync } from 'node:fs';

const MARK = '<!-- reading rule -->';
const agents = readFileSync('AGENTS.md', 'utf8').split(/\r?\n/);
const contributing = readFileSync('CONTRIBUTING.md', 'utf8').split(/\r?\n/);

const first = agents.findIndex((line, i) => i > 0 && line.trim());
// The sentence ends at the first `.` followed by white space or the end of the line.
const rule = first === -1 ? '' : agents[first].trim().match(/^.*?(?:\.(?=\s|$)|$)/)[0];
const marked = contributing.findIndex((line) => line.includes(MARK));
const agentsAt = `AGENTS.md:${first + 1}`;
const contributingAt = marked === -1 ? `CONTRIBUTING.md (no line marked ${MARK})` : `CONTRIBUTING.md:${marked + 1}`;

if (!rule || marked === -1 || !contributing[marked].includes(rule)) {
  console.log(`FAIL reading rule: ${agentsAt} and ${contributingAt} don't state the reading rule in the same words; AGENTS.md's first rule is "${rule}"`);
  console.log(`  Fix: Edit both lines together, so CONTRIBUTING.md's marked line holds AGENTS.md's first sentence word for word.`);
  process.exit(1);
}
console.log(`PASS reading rule: ${agentsAt} and ${contributingAt} both say "${rule}"`);

// One section of a design doc by its anchor (#2338), so an agent reads the sections its issue links and not the whole
// design. A section is the text from its heading, or from the explicit <a id> before it, to the next heading of the
// same or a higher level, subsections included; a line in fenced code is never a heading. Anchors resolve as the
// design links lane (#910) resolves them, so a link that lands there prints here.
//
//   node scripts/design-section.mjs <doc>#<anchor>   the section's bytes, as the doc holds them
//   node scripts/design-section.mjs --issue <n>      each section open issue n links, once each, in the order it first
//                                                    links them, each after a `==> <doc>#<anchor> <==` line
//   node scripts/design-section.mjs --issue <n> --all
//                                                    the same, with the text whatever it adds up to
//
// An issue's run ends with one line on standard error (#3546): the sections it printed, their bytes and their tokens by
// the pinned tokenizer. Past 25,000 tokens it prints each section's outline in place of its text, one line a heading
// with its anchor and its own tokens, and that last line names the command that prints one; --all prints the text.
//
// The issue comes from the open issues the doc lanes read; without them the run is BLOCKED and prints no section.
// A section that can't be printed exits 1, naming the doc and the anchor; a wrong command line exits 2.
import { resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve } from './doc-links.mjs';
import { LIMIT, cost, headings, linked, section } from './linked-sections.mjs';
import { openIssues } from './open-issues.mjs';

// Docs paths are the repository's, wherever it runs from; a relative cached issues file stays the caller's.
if (process.env.DEEP_OPEN_ISSUES) process.env.DEEP_OPEN_ISSUES = pathResolve(process.env.DEEP_OPEN_ISSUES);
process.chdir(fileURLToPath(new URL('../', import.meta.url)));

const fail = (problem) => {
  console.error(`no section: ${problem}`);
  process.exit(1);
};

const count = (n) => n.toLocaleString('en-US');
const args = process.argv.slice(2);
const all = args[0] === '--issue' && args[2] === '--all';
if (args[0] === '--issue' && args.length === (all ? 3 : 2) && /^\d+$/.test(args[1])) {
  const number = Number(args[1]);
  const { issues = [], missing } = openIssues();
  const issue = issues.find((candidate) => candidate.number === number);
  if (missing || !issue) {
    console.log(`BLOCKED #${number}'s linked sections: ${missing ?? `#${number} is not among the ${issues.length} open issues read`}`);
    process.exit(1);
  }
  const { sections, problems } = linked(issue.body);
  const { bytes, tokens } = await cost(sections);
  // Tokens that weren't counted pass no limit: the text prints, and the closing line says so.
  const outlined = !all && tokens > LIMIT;
  const out = [];
  for (const s of sections) out.push(Buffer.from(`==> ${s.file}#${s.id} <==\n`), outlined ? Buffer.from((await headings(s)).map((h) => `${h.line}  ${s.file}#${h.id}  ${count(h.tokens)} tokens\n`).join('')) : s.bytes);
  // Not process.exit: on macOS a pipe's write finishes after it returns.
  process.stdout.write(Buffer.concat(out));
  if (!sections.length && !problems.size) problems.add(`no section of docs/*.md`);
  if (problems.size) {
    console.error(`no section: #${number} links ${[...problems].join('; ')}`);
    process.exitCode = 1;
  }
  if (sections.length) {
    const totals = `#${number}: ${count(sections.length)} section${sections.length === 1 ? '' : 's'}, ${count(bytes)} bytes, ${tokens === null ? 'tokens not counted, gpt-tokenizer is not installed (npm ci)' : `${count(tokens)} tokens`}`;
    console.error(outlined ? `${totals}, past ${count(LIMIT)}, so each section's outline is printed in place of its text. \`node scripts/design-section.mjs <doc>#<anchor>\` prints one section, and \`node scripts/design-section.mjs --issue ${number} --all\` the text.` : `${totals}.`);
  }
} else if (args.length === 1 && args[0].includes('#') && !args[0].startsWith('-')) {
  const link = resolve(args[0], null);
  if (!link) fail(`${args[0]} is not a link into docs/*.md`);
  const { bytes, problem } = section(link.file, link.id);
  if (problem) fail(problem);
  process.stdout.write(bytes);
} else {
  console.error('usage: node scripts/design-section.mjs <doc>#<anchor> | --issue <n> [--all]');
  process.exit(2);
}

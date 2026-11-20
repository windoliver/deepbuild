// One section of a design doc by its anchor (#2338), so an agent reads the sections its issue links and not the whole
// design. A section is the text from its heading, or from the explicit <a id> before it, to the next heading of the
// same or a higher level, subsections included; a line in fenced code is never a heading. Anchors resolve as the
// design links lane (#910) resolves them, so a link that lands there prints here.
//
//   node scripts/design-section.mjs <doc>#<anchor>   the section's bytes, as the doc holds them
//   node scripts/design-section.mjs --issue <n>      each section open issue n links, once each, in the order it first
//                                                    links them, each after a `==> <doc>#<anchor> <==` line
//
// The issue comes from the open issues the doc lanes read; without them the run is BLOCKED and prints no section.
// A section that can't be printed exits 1, naming the doc and the anchor; a wrong command line exits 2.
import { existsSync, readFileSync } from 'node:fs';
import { resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { outline, prose, resolve, targets } from './doc-links.mjs';
import { openIssues } from './open-issues.mjs';

// Docs paths are the repository's, wherever it runs from; a relative cached issues file stays the caller's.
if (process.env.DEEP_OPEN_ISSUES) process.env.DEEP_OPEN_ISSUES = pathResolve(process.env.DEEP_OPEN_ISSUES);
process.chdir(fileURLToPath(new URL('../', import.meta.url)));

// The section's bytes, or what stops it.
function section(file, id) {
  if (!/^docs\/[^/]+\.md$/.test(file) || !existsSync(file)) return { problem: `${file} is not a doc under docs/` };
  const { anchors: found, headings, lines } = outline(file);
  if (!found.has(id)) return { problem: `no heading or <a id> in ${file} is #${id}` };
  const heading = found.get(id);
  const bytes = readFileSync(file);
  const at = headings.findIndex((candidate) => candidate.id === heading);
  // An <a id> in a doc with no heading: the lane lands it, so its section runs from its line to the end.
  if (at === -1) return { bytes: bytes.subarray(lines.get(id)), heading: `#${id}`, start: lines.get(id), end: bytes.length };
  const { level, offset } = headings[at];
  // An <a id> before its heading starts the section at its own line; one inside a section's text belongs to that section.
  const start = id === heading ? offset : Math.min(offset, lines.get(id) ?? offset);
  const end = headings.slice(at + 1).find((next) => next.level <= level)?.offset ?? bytes.length;
  return { bytes: bytes.subarray(start, end), heading, start, end };
}

const fail = (problem) => {
  console.error(`no section: ${problem}`);
  process.exit(1);
};

const args = process.argv.slice(2);
if (args[0] === '--issue' && args.length === 2 && /^\d+$/.test(args[1])) {
  const number = Number(args[1]);
  const { issues = [], missing } = openIssues();
  const issue = issues.find((candidate) => candidate.number === number);
  if (missing || !issue) {
    console.log(`BLOCKED #${number}'s linked sections: ${missing ?? `#${number} is not among the ${issues.length} open issues read`}`);
    process.exit(1);
  }
  // Each linked section once, in the order the issue first links it: a link to a heading already printed, or to a
  // subsection inside a section already printed, prints nothing more.
  const printed = new Set();
  const ranges = [];
  const out = [];
  const problems = new Set();
  for (const { line } of prose(issue.body ?? '')) {
    for (const target of targets(line)) {
      const link = resolve(target, null);
      if (!link?.id) continue;
      const { bytes, heading, start, end, problem } = section(link.file, link.id);
      if (problem) problems.add(problem);
      else if (!printed.has(`${link.file}#${heading}`) && !ranges.some((r) => r.file === link.file && r.start <= start && end <= r.end)) {
        printed.add(`${link.file}#${heading}`);
        ranges.push({ file: link.file, start, end });
        out.push(Buffer.from(`==> ${link.file}#${link.id} <==\n`), bytes);
      }
    }
  }
  // Not process.exit: on macOS a pipe's write finishes after it returns.
  process.stdout.write(Buffer.concat(out));
  if (!printed.size && !problems.size) problems.add(`no section of docs/*.md`);
  if (problems.size) {
    console.error(`no section: #${number} links ${[...problems].join('; ')}`);
    process.exitCode = 1;
  }
} else if (args.length === 1 && args[0].includes('#') && !args[0].startsWith('-')) {
  const link = resolve(args[0], null);
  if (!link) fail(`${args[0]} is not a link into docs/*.md`);
  const { bytes, problem } = section(link.file, link.id);
  if (problem) fail(problem);
  process.stdout.write(bytes);
} else {
  console.error('usage: node scripts/design-section.mjs <doc>#<anchor> | --issue <n>');
  process.exit(2);
}

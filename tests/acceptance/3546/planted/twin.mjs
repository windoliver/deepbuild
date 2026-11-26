// The body of the planted programs for #3546's acceptance tests: a twin of what the issue asks of
// scripts/design-section.mjs and of the design links lane's reading, written by the blind test job from the issue and
// this suite's README alone, never from an implementation. Each planted file beside it runs one of the two mains with
// one fault, named in that file's own code, never chosen by an environment variable (design: Wrong programs). No test
// runs a main without a fault; the README says how they were checked clean. Run from the repository root, where the
// real scripts run: headings, anchors, links and the open issues are read with the merge base's own code, copied in
// ../merge-base/.
import { countTokens } from 'gpt-tokenizer/encoding/o200k_base';
import { existsSync, readFileSync } from 'node:fs';
import { outline, prose, resolve, targets } from '../merge-base/doc-links.mjs';
import { openIssues } from '../merge-base/open-issues.mjs';

const LIMIT = 25_000;
const number = (n) => n.toLocaleString('en-US');
const tokens = (bytes) => countTokens(bytes.toString('utf8'));

// One section, as the merge base's script reads it, with each of its headings and that heading's own text.
function section(file, id) {
  if (!/^docs\/[^/]+\.md$/.test(file) || !existsSync(file)) return { problem: `${file} is not a doc under docs/` };
  const { anchors, headings, lines } = outline(file);
  if (!anchors.has(id)) return { problem: `no heading or <a id> in ${file} is #${id}` };
  const heading = anchors.get(id);
  const bytes = readFileSync(file);
  const at = headings.findIndex((candidate) => candidate.id === heading);
  if (at === -1) return { bytes: bytes.subarray(lines.get(id)), heading: `#${id}`, start: lines.get(id), end: bytes.length, parts: [] };
  const { level, offset } = headings[at];
  const start = id === heading ? offset : Math.min(offset, lines.get(id) ?? offset);
  const after = headings.slice(at + 1).findIndex((next) => next.level <= level);
  const last = after === -1 ? headings.length : at + 1 + after;
  const end = headings[last]?.offset ?? bytes.length;
  const parts = headings.slice(at, last).map((part, i) => {
    const own = bytes.subarray(i === 0 ? start : part.offset, headings[at + i + 1]?.offset ?? bytes.length);
    return { id: part.id, line: bytes.subarray(part.offset).toString('utf8').split('\n')[0], tokens: tokens(own) };
  });
  return { bytes: bytes.subarray(start, end), heading, start, end, parts };
}

/**
 * The sections an issue's body prints, in the order it first links them, as the merge base's loop finds them: a link to
 * a heading already printed, or to a section inside one already printed, prints nothing more. `counted` is what the
 * closing line counts: the same sections, or with `everyLink` each link's section again.
 */
function linked(body, { everyLink = false, innerAgain = false } = {}) {
  const printed = new Set();
  const ranges = [];
  const sections = [];
  const counted = [];
  const problems = new Set();
  for (const { line } of prose(body ?? '')) {
    for (const target of targets(line)) {
      const link = resolve(target, null);
      if (!link?.id) continue;
      const found = section(link.file, link.id);
      if (found.problem) {
        problems.add(found.problem);
        continue;
      }
      const key = `${link.file}#${found.heading}`;
      const inside = ranges.some((r) => r.file === link.file && r.start <= found.start && found.end <= r.end);
      const entry = { file: link.file, id: link.id, ...found };
      if (!printed.has(key) && !inside) {
        printed.add(key);
        ranges.push({ file: link.file, start: found.start, end: found.end });
        sections.push(entry);
        counted.push(entry);
      } else if (everyLink || (innerAgain && !printed.has(key))) counted.push(entry);
    }
  }
  return { sections, counted, problems };
}

/**
 * The section printer. Faults: `countsInnerTwice` counts a linked section that sits inside one already printed again in
 * the closing line; `textPastLimit` prints the text whatever the total; `outlineAtLimit` prints the outline from the
 * limit on, not past it.
 */
export function sectionMain(fault = {}) {
  const args = process.argv.slice(2);
  const all = args.at(-1) === '--all';
  if (args[0] !== '--issue' || !/^\d+$/.test(args[1] ?? '') || args.length !== (all ? 3 : 2)) {
    console.error('usage: node <planted program> --issue <n> [--all]');
    process.exit(2);
  }
  const issue = Number(args[1]);
  const { issues = [], missing } = openIssues();
  const found = issues.find((candidate) => candidate.number === issue);
  if (missing || !found) {
    console.log(`BLOCKED #${issue}'s linked sections: ${missing ?? `#${issue} is not among the open issues read`}`);
    process.exit(1);
  }
  const { sections, counted, problems } = linked(found.body, { innerAgain: fault.countsInnerTwice });
  const total = {
    sections: counted.length,
    bytes: counted.reduce((sum, { bytes }) => sum + bytes.length, 0),
    tokens: counted.reduce((sum, { bytes }) => sum + tokens(bytes), 0),
  };
  const past = fault.outlineAtLimit ? total.tokens >= LIMIT : total.tokens > LIMIT;
  const outlined = past && !all && !fault.textPastLimit;
  const out = [];
  for (const { file, id, bytes, parts } of sections) {
    out.push(Buffer.from(`==> ${file}#${id} <==\n`));
    if (outlined) for (const part of parts) out.push(Buffer.from(`${part.line}  ${file}#${part.id}  ${number(part.tokens)} tokens\n`));
    else out.push(bytes);
  }
  process.stdout.write(Buffer.concat(out));
  if (problems.size) {
    console.error(`no section: #${issue} links ${[...problems].join('; ')}`);
    process.exitCode = 1;
  }
  const counts = `${number(total.sections)} sections, ${number(total.bytes)} bytes, ${number(total.tokens)} tokens`;
  console.error(outlined
    ? `design-section: #${issue} links ${counts}, past ${number(LIMIT)}, so each section's outline is printed: \`node scripts/design-section.mjs <doc>#<anchor>\` prints one section, --all prints them all`
    : `design-section: #${issue} printed ${counts}`);
}

/**
 * The design links lane's reading: one line over every open issue that prints a section. Fault: `perLink` counts a
 * section once for each link an issue makes to it, not once.
 */
export function laneMain(fault = {}) {
  const { issues = [], missing } = openIssues();
  if (missing) {
    console.log(`INCONCLUSIVE ${missing}`);
    process.exit(1);
  }
  const read = [];
  for (const { number: issue, body } of issues) {
    const { counted } = linked(body, { everyLink: fault.perLink });
    if (counted.length) read.push({ issue, tokens: counted.reduce((sum, { bytes }) => sum + tokens(bytes), 0) });
  }
  read.sort((a, b) => a.tokens - b.tokens || a.issue - b.issue);
  const at = (share) => read[Math.max(0, Math.ceil(share * read.length) - 1)]?.tokens ?? 0;
  const largest = read.at(-1);
  console.log(`first reads: ${number(read.length)} issues read; median ${number(at(0.5))} tokens, 90th percentile ${number(at(0.9))}, largest ${number(largest?.tokens ?? 0)} (#${largest?.issue}); ${number(read.filter((r) => r.tokens > LIMIT).length)} past ${number(LIMIT)} tokens`);
}

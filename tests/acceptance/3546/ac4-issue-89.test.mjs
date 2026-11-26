// Criterion 4 (#3546.9cf18941): on main, #89 prints an outline, where the merge base prints 442,782 bytes with its
// `==>` lines. Offline, "on main" is this checkout's own two design docs, and #89 is its body as GitHub held it on
// 2026-11-26 (fixture/issue-89.md), served from the cached open issues: the merge base's script prints its four
// sections' text, and the script prints one line for each heading of theirs, the own tokens adding up to the total.
// The live run on main is a reading for the pull request (README: Readings). A body whose links no longer land on
// these docs is BLOCKED, never a pass.
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { BASE_SECTION, cachedIssues, firstRead, LIMIT, n, none, outlineProblems, readSections, runIn, scratch, SECTION } from './helpers.mjs';

const ARGS = ['--issue', '89'];
const BODY = readFileSync(new URL('./fixture/issue-89.md', import.meta.url), 'utf8');

test('#3546.9cf18941 AC4 on this checkout\'s docs #89 prints an outline, one line for each heading of its four sections, where the merge base prints their text with its ==> lines', (t) => {
  const copy = scratch(t, { real: true });
  const env = cachedIssues(copy, [{ number: 89, body: BODY }]);
  const base = runIn(copy, BASE_SECTION, ARGS, { env });
  if (base.status !== 0 || readSections(base.stdout).length !== 4) throw new Error(`BLOCKED: #89's body of 2026-11-26 no longer prints four sections from this checkout's docs, so it shows nothing of the script:\n${base.output}`);
  const read = firstRead(copy, { number: 89, body: BODY });
  if (read.tokens <= LIMIT || read.byHeading !== read.tokens) throw new Error(`BLOCKED: #89's four sections hold ${n(read.tokens)} tokens here, ${n(read.byHeading)} by their headings' own text, so they don't show an outline whose lines add up`);
  t.diagnostic(`the merge base's script prints ${n(base.stdout.length)} bytes for #89 on these docs, ${n(read.bytes)} without its ==> lines: ${n(read.tokens)} tokens under ${n(read.headings.length)} headings`);

  const run = runIn(copy, SECTION, ARGS, { env });
  const problems = outlineProblems(run, read, { titles: false });
  none(problems, `${SECTION} ${ARGS.join(' ')} doesn't print #89's outline, though its sections total ${n(read.tokens)} tokens, past the limit of ${n(LIMIT)}, and the merge base prints ${n(base.stdout.length)} bytes:\n${problems.join('\n')}\n\n${run.output}`);
});

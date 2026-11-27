// Criterion 1 (#3546.05239cdb): from a fixture doc and a fixture issue that links three sections, one of them inside
// another, `node scripts/design-section.mjs --issue <n>` ends with one line on standard error whose sections, bytes and
// tokens equal those of the text it printed. #9546 links the outer section, another by its explicit <a id>, then the
// inner one, which prints nothing more: two sections. #9547 links the inner one first, so the outer prints it again:
// three sections, the inner's text twice. The planted program is planted/counts-inner-twice.mjs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BASE_SECTION, baseHolds, cachedIssues, closing, closingProblems, firstRead, fixtureHolds, INNER_FIRST, NESTED, none, runIn, sameProblems, scratch, SECTION, SECTION_ISSUES, sectionDocs, TD } from './helpers.mjs';

test('#3546.05239cdb AC1 an issue linking three sections, one inside another, ends with one line on standard error whose sections, bytes and tokens equal those of the text printed; a planted counter that counts the inner section twice fails, naming both totals', (t) => {
  const copy = scratch(t, { docs: sectionDocs() });
  fixtureHolds(copy, TD);
  const env = cachedIssues(copy, SECTION_ISSUES);
  const problems = [];
  for (const issue of [NESTED, INNER_FIRST]) {
    const args = ['--issue', String(issue.number)];
    const base = runIn(copy, BASE_SECTION, args, { env });
    baseHolds(base, firstRead(copy, issue));
    const run = runIn(copy, SECTION, args, { env });
    const found = [...sameProblems(run, base), ...closingProblems(run)];
    if (found.length) problems.push(`#${issue.number}, which links ${issue.prints.length === 2 ? 'the outer section before the inner one' : 'the inner section before the outer one'}:\n${found.join('\n')}\n\n${run.output}`);
  }
  none(problems, `${SECTION} --issue doesn't end with a line on standard error that counts the text it printed:\n${problems.join('\n\n')}`);

  const args = ['--issue', String(NESTED.number)];
  const planted = runIn(copy, null, args, { planted: 'counts-inner-twice', env });
  const base = runIn(copy, BASE_SECTION, args, { env });
  assert.ok(planted.stdout.equals(base.stdout) && closing(planted)?.sections === 3, `the planted counter doesn't print #${NESTED.number}'s two sections and count three, so it shows nothing here:\n${planted.output}`);
  const caught = closingProblems(planted);
  assert.ok(caught.some((problem) => /says 3 sections, [\d,]+ bytes and [\d,]+ tokens; the text printed is 2 sections, [\d,]+ bytes and [\d,]+ tokens/.test(problem)), `this test passes the planted counter that counts the inner section twice, or fails it without naming both totals:\n${caught.join('\n') || 'no problem found'}\n\n${planted.output}`);
  t.diagnostic(`planted counts-inner-twice.mjs fails: ${caught.join('; ')}`);
});

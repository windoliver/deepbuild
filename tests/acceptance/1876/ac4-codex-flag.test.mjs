// #1876 criterion 4: the Codex flag in the design's DeepBuild's own jobs line equals the `-s` value of readOnlyJob.args
// in adapters/codex.facts.json, and a planted facts file with `-s read-only` fails the design links lane, naming the
// flag (README: Criteria and tests).
import assert from 'node:assert/strict';
import test from 'node:test';
import { CHECKOUT, DESIGN, FACTS, clean, codexFlag, flagsIn, item, namesWord, read, runLane, shown, unfailed, write } from './helpers.mjs';

const JOBS = "- **DeepBuild's own jobs.**";
const VALUE = 'read-only';

test('AC4 #1876.281ab39b the Codex flag in the DeepBuild\'s own jobs line equals the `-s` value of readOnlyJob.args in adapters/codex.facts.json, and a planted facts file with `-s read-only` fails the design links lane, naming the flag', (t) => {
  const copy = clean(t);
  const problems = [];
  // The tree: the checkout's own design and facts file.
  const jobs = item(read(CHECKOUT, DESIGN), JOBS);
  const flags = flagsIn(jobs.line);
  const value = codexFlag(CHECKOUT);
  if (flags.length !== 1 || flags[0] !== value) problems.push(`the DeepBuild's own jobs line (${DESIGN}:${jobs.number}) holds ${flags.length ? flags.map((flag) => `\`-s ${flag}\``).join(' and ') : 'no `-s <value>` in code'}, and launch.readOnlyJob.args in ${FACTS} has \`-s ${value}\``);
  // The plant: the copy's facts file with the value after readOnlyJob's `-s` replaced, every other byte as it is.
  assert.notEqual(codexFlag(copy.repo), VALUE, `${FACTS} already has \`-s ${VALUE}\`, so planting it would prove nothing`);
  const facts = read(copy.repo, FACTS);
  const job = facts.indexOf('"readOnlyJob"');
  write(copy.repo, FACTS, facts.slice(0, job) + facts.slice(job).replace(/("-s"\s*,\s*")[^"]*(")/, `$1${VALUE}$2`));
  assert.equal(codexFlag(copy.repo), VALUE, `the planted ${FACTS} isn't read as \`-s ${VALUE}\` in launch.readOnlyJob.args`);
  const run = runLane(copy.repo, copy.issues);
  const planted = `a planted ${FACTS} whose launch.readOnlyJob.args has \`-s ${VALUE}\``;
  problems.push(...unfailed(run, planted));
  if (run.status !== 0 && !namesWord(run, '-s') && !namesWord(run, VALUE)) problems.push(`on ${planted}, the lane failed without naming the flag, \`-s\` or its planted value \`${VALUE}\`: ${shown(run)}`);
  if (problems.length) assert.fail(problems.join('\n\n'));
});

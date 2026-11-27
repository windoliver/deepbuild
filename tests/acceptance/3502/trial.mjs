// Criterion 9's judge (README: The Rebase trial): the record under "## Rebase trial" in
// vendor/gpui-pre-apple/upstream/README.md, in the shape #1426's suite pinned (a `Tried:` line, an `Outcome:` line, a
// table of suites and results), held to what this criterion adds: the versions moved to, each of the three trees' and
// gpui-kit's, as the tree holds them; a result for each suite it lists; and the outcome. A suite unrun leaves it open.
import { inGpui, lockPackages, rowName, TREES, treeVersion } from './common.mjs';

export const HEADING = '## Rebase trial';
/** The suites #1426's criterion names for a moved pin, which its judge still asks of this section. */
export const NAMED = ['#377', '#390', '#391', '#140', '#358'];
const MOVED = ['gpui-pre', 'gpui-pre-apple', 'gpui-pre-macos', 'gpui-kit'];

/** The record, parsed; null when the file has no such section. */
export function readTrial(text) {
  const lines = (text ?? '').split('\n');
  const start = lines.indexOf(HEADING);
  if (start < 0) return null;
  const end = lines.findIndex((line, index) => index > start && /^##? /.test(line));
  const section = lines.slice(start + 1, end < 0 ? lines.length : end);
  const tried = Object.fromEntries([...(section.find((line) => line.startsWith('Tried:')) ?? '').matchAll(/(gpui-pre(?:-apple|-macos)?|gpui-kit) (\d+\.\d+\.\d+) (?:->|→) (\d+\.\d+\.\d+)/g)].map(([, name, from, to]) => [name, { from, to }]));
  const outcome = /^Outcome:\s*(.*?)\s*$/.exec(section.find((line) => line.startsWith('Outcome:')) ?? '')?.[1] ?? null;
  const suites = section.flatMap((line) => {
    const [, suite, result] = /^\|\s*(#\d+)\s*\|\s*(.*?)\s*\|$/.exec(line) ?? [];
    return suite ? [{ suite, result }] : [];
  });
  return { tried, outcome, suites };
}

/** What the tree holds of each thing a trial moves: the three trees' versions and Cargo.lock's gpui-kit. */
export const pinsAt = (root) => ({
  ...Object.fromEntries(TREES.map((tree) => [tree, treeVersion(root, tree)])),
  'gpui-kit': lockPackages(root).find(({ name }) => name === 'gpui-kit')?.version ?? null,
});

/**
 * The record's words, and the tree where the tree can answer: `pins` from `pinsAt`, `rows` the carried rows. Each
 * failure is a sentence naming what is missing.
 */
export function judgeTrial(text, pins, rows) {
  const record = readTrial(text);
  if (!record) return [`no "${HEADING}" section: the trial has no record, which leaves this open`];
  const failures = [];
  for (const name of MOVED) {
    const tried = record.tried[name];
    if (!tried) failures.push(`the record's Tried line names no version ${name} moved to`);
    else if (tried.to !== pins[name]) failures.push(`the record says ${name} moved to ${tried.to}, and the tree holds ${pins[name] ?? 'none'}`);
  }
  const moved = MOVED.some((name) => record.tried[name] && record.tried[name].from !== pins[name]);
  if (!record.outcome) failures.push('the record names no outcome: it has no Outcome line');
  else if (!['pin moved', 'pin left'].includes(record.outcome)) failures.push(`the record ends "Outcome: ${record.outcome}", neither "pin moved" nor "pin left"`);
  else if ((record.outcome === 'pin moved') !== moved) failures.push(`the record ends "Outcome: ${record.outcome}", and the tree holds ${MOVED.map((name) => `${name} ${pins[name] ?? 'none'}`).join(', ')}`);
  if (!record.suites.length) failures.push('the record lists no suite');
  for (const { suite, result } of record.suites) {
    if (/^(?:not run\b.*)?$/i.test(result)) failures.push(`the suite ${suite} reads "${result || 'nothing'}": a trial with a suite unrun leaves this open`);
    else if (!/^(?:pass|fail: \S.*)$/.test(result)) failures.push(`the suite ${suite} reads "${result}", which is no result: pass, or fail: <what failed>`);
    else if (record.outcome === 'pin moved' && result !== 'pass') failures.push(`the pin moved and the suite ${suite} reads "${result}"`);
  }
  const listed = new Set(record.suites.map(({ suite }) => suite));
  for (const suite of NAMED) if (!listed.has(suite)) failures.push(`the record lists no result for the suite ${suite}, which #1426 names for a moved pin`);
  for (const row of rows.filter(inGpui)) {
    if (listed.has(row.issue)) continue;
    listed.add(row.issue);
    failures.push(`the record lists no result for the suite ${row.issue}, whose row ${rowName(row)} the moved trees still carry: that suite is unrun as far as the record says`);
  }
  return [...new Set(failures)];
}

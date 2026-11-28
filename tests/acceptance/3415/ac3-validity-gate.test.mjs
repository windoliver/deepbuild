import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DESIGN, LIMIT, checkoutFile, makeCopy, named, read, runCheck, shown, write } from './helpers.mjs';

const ID = '#3415.7fecea8f';
const PLANTED = '- the validity gate: a Zorvanthic fixture kind, before anything else;';

function entry(lines, name) {
  const start = lines.findIndex((line) => line === `#### ${name}`);
  assert.ok(start >= 0, `BLOCKED: ${DESIGN} has no "#### ${name}" entry`);
  const end = lines.findIndex((line, i) => i > start && /^#{1,4} /.test(line));
  return { start, end: end < 0 ? lines.length : end };
}

function kinds(lines) {
  const { start, end } = entry(lines, 'Check');
  const items = [];
  for (let i = start + 1; i < end; i += 1) {
    if (/^- /.test(lines[i])) items.push(i);
    else if (items.length && !lines[i].trim()) break;
  }
  assert.ok(items.length, `BLOCKED: the Check entry of ${DESIGN} holds no list of kinds`);
  return items;
}

test(`${ID} AC3: the Check entry's list of kinds no longer holds the validity gate, and the Claim entry still says it runs before any check`, () => {
  const lines = checkoutFile(DESIGN).split('\n');
  const held = kinds(lines).filter((i) => /validity gate/i.test(lines[i])).map((i) => `${DESIGN}:${i + 1}: ${lines[i]}`);
  assert.deepEqual(held, [], 'the list of check kinds still holds the validity gate');
  const { start, end } = entry(lines, 'Claim');
  const claim = lines.slice(start + 1, end).join(' ');
  const sentences = claim.split(/(?<=[.;:])\s+/).filter((s) => /validity gate/i.test(s) && /before any check/i.test(s));
  assert.ok(sentences.length, `the Claim entry no longer says the validity gate runs before any check: ${claim.slice(0, 600)}`);
});

test(`${ID} AC3: a planted list of check kinds that names the validity gate fails the check, naming the line`, LIMIT, (t) => {
  const { sandbox, repo } = makeCopy(t);
  const lines = read(repo, DESIGN).split('\n');
  const [first] = kinds(lines);
  lines.splice(first, 0, PLANTED);
  write(repo, DESIGN, lines.join('\n'));
  const run = runCheck(repo, sandbox);
  t.diagnostic(`exit ${run.status}\n${shown(run)}`);
  assert.notEqual(run.status, 0, `the check passes a list of check kinds that names the validity gate\n${shown(run)}`);
  assert.ok(named(run, DESIGN, first + 1).length, `no failing line names ${DESIGN}:${first + 1}, the planted kind\n${shown(run)}`);
});

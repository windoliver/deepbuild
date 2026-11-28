import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { DESIGN, LIMIT, baseFile, checkoutFile, makeCopy, read, runLinks, shown, write } from './helpers.mjs';

const ID = '#3415.9322769a';
const OLD = 'ask-task';
const KEPT = new RegExp(`<a id=["']${OLD}["']`);

function renamed(lines) {
  const kept = lines.flatMap((line, i) => (KEPT.test(line) ? [i] : []));
  assert.equal(kept.length, 1, `the renamed heading's old anchor #${OLD} is kept by ${kept.length} <a id> lines of ${DESIGN}, not one`);
  const near = [kept[0] - 2, kept[0] - 1, kept[0] + 1, kept[0] + 2].filter((i) => /^#{2,6} /.test(lines[i] ?? ''));
  assert.equal(near.length, 1, `no heading sits beside <a id="${OLD}"> at ${DESIGN}:${kept[0] + 1}`);
  return { anchor: kept[0], heading: near[0] };
}

function anchors(text) {
  let fence = null;
  const headings = [], ids = [];
  for (const line of text.split('\n')) {
    const mark = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) { if (mark && mark[1][0] === fence[0]) fence = null; continue; }
    if (mark) { fence = mark[1]; continue; }
    const heading = line.match(/^#{1,6} (.+?)\s*#*\s*$/);
    if (heading) headings.push(heading[1].toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, '').replace(/ /g, '-'));
    for (const [, id] of line.matchAll(/<a id=["']([^"']+)["']/g)) ids.push(id);
  }
  return { headings: new Set(headings), all: new Set([...headings, ...ids]) };
}

function openIssues(repo) {
  const file = join(repo, 'target', 'open-issues.json');
  assert.ok(existsSync(file), 'the design links lane read no open issues (no target/open-issues.json in the copy)');
  return JSON.parse(readFileSync(file, 'utf8'));
}

test(`${ID} AC4: the Ask-task heading reads Task and keeps #${OLD} as an <a id>, and every link the open issues make into a heading it renames lands, by the design links lane with the open issues read`, LIMIT, (t) => {
  const lines = checkoutFile(DESIGN).split('\n');
  assert.deepEqual(lines.filter((line) => /^#{2,6} Ask-task\s*$/i.test(line)), [], `${DESIGN} still has the Ask-task heading`);
  const { heading } = renamed(lines);
  assert.match(lines[heading], /^#{2,6} Task\s*$/, `the heading beside <a id="${OLD}"> is not Task`);
  const was = anchors(baseFile(DESIGN)).headings;
  const now = anchors(checkoutFile(DESIGN));
  const gone = [...was].filter((anchor) => !now.headings.has(anchor));
  assert.ok(gone.includes(OLD), `#${OLD} is still a heading's anchor`);
  assert.deepEqual(gone.filter((anchor) => !now.all.has(anchor)), [], `renamed headings of ${DESIGN} whose old anchor no <a id> keeps`);
  const { repo } = makeCopy(t);
  const run = runLinks(repo);
  t.diagnostic(`exit ${run.status}\n${shown(run)}`);
  const issues = openIssues(repo);
  assert.ok(issues.length > 0, 'the lane read no open issue');
  assert.doesNotMatch(run.out, /^INCONCLUSIVE|the open issues were not read/m, `the lane did not read the open issues\n${shown(run)}`);
  if (run.status === 0) assert.match(run.out, new RegExp(`${issues.length} open issues`), `the lane does not say it read the ${issues.length} open issues\n${shown(run)}`);
  const broken = run.lines.filter((line) => /no heading or <a id>/.test(line) && gone.some((anchor) => new RegExp(`#${anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(line)));
  assert.deepEqual(broken, [], `links into a heading this renames that land nowhere\n${shown(run)}`);
});

test(`${ID} AC4: a planted rename of the Ask-task heading with no <a id> fails the design links lane, naming an issue that links it`, LIMIT, (t) => {
  const { repo } = makeCopy(t);
  const lines = read(repo, DESIGN).split('\n');
  const { anchor, heading } = renamed(lines);
  lines[heading] = lines[heading].replace(/^(#+) .*$/, '$1 Zorvanthic fixture heading');
  lines.splice(anchor, 1);
  write(repo, DESIGN, lines.join('\n'));
  const run = runLinks(repo);
  t.diagnostic(`exit ${run.status}\n${shown(run)}`);
  const linking = openIssues(repo).filter(({ body }) => new RegExp(`technical-design\\.md#${OLD}(?![\\w-])`).test(body ?? '')).map(({ number }) => number);
  assert.ok(linking.length, `BLOCKED: no open issue links ${DESIGN}#${OLD}, so no rename of its heading can break a link`);
  assert.notEqual(run.status, 0, `the design links lane passes with the heading renamed and no <a id>\n${shown(run)}`);
  const naming = run.lines.filter((line) => linking.some((n) => new RegExp(`#${n}(?!\\d)`).test(line)) && new RegExp(`#${OLD}(?![\\w-])`).test(line));
  assert.ok(naming.length, `no line of the failing lane names one of #${linking.join(', #')} and its link to #${OLD}\n${shown(run)}`);
});

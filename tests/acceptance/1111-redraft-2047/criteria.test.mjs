// #1111, the blind redraft for #2047's sweep: docs/parallel-proof.md and the design's budget line. Five tests over
// the checkout this file sits in: the real design-links check (scripts/design-links.mjs) run on a frozen copy of the
// twelve T0–T10 issues, those issues' links resolved by the repo's own link reader (scripts/doc-links.mjs), and what
// the two docs state, read sentence by sentence (README: what each test means by its criterion's words).
// Run: node --test tests/acceptance/1111-redraft-2047/criteria.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { anchors, prose, resolve, targets } from '../../../scripts/doc-links.mjs';

const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const PROOF = 'docs/parallel-proof.md';
const DESIGN = 'docs/technical-design.md';
// The T0–T10 issues, #1112 to #1123, number and body, as `gh issue list --json number,body` shapes them.
const TWELVE = JSON.parse(readFileSync(new URL('./fixtures/t0-t10-issues.json', import.meta.url), 'utf8'));
// The check is bounded at two minutes; a run that can't start, overruns or is killed fails INCONCLUSIVE.
const BOUND_MS = 120_000;

/** The frozen issues' links into docs/*.md, read as the check reads an issue's: outside code, by the repo's reader. */
function issueLinks() {
  const numbers = TWELVE.map(({ number }) => number);
  if (numbers.join() !== [1112, 1113, 1114, 1115, 1116, 1117, 1118, 1119, 1120, 1121, 1122, 1123].join()) throw new Error(`BLOCKED: the frozen copy holds ${numbers.join(', ')}, not #1112 to #1123`);
  const links = TWELVE.flatMap(({ number, body }) => [...prose(body)].flatMap(({ line }) => targets(line))
    .map((target) => ({ number, target, ...resolve(target, null) })).filter(({ file }) => file));
  const without = numbers.filter((number) => !links.some((link) => link.number === number && link.file === PROOF));
  if (without.length) throw new Error(`BLOCKED: the repo's link reader finds no link to ${PROOF} in the frozen copy of ${without.map((n) => `#${n}`).join(', ')}, so there is nothing to resolve`);
  return links;
}

/** One open issue for each planned name's issue outside the twelve, naming what scripts/planned-names.txt says it plans. */
function plannedIssues() {
  const file = join(CHECKOUT, 'scripts/planned-names.txt');
  const planned = new Map();
  for (const raw of existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/) : []) {
    const entry = raw.trim().match(/^([^#].*?)\s+#(\d+)$/);
    if (entry && !TWELVE.some(({ number }) => number === Number(entry[2]))) planned.set(Number(entry[2]), [...(planned.get(Number(entry[2])) ?? []), `\`${entry[1]}\``]);
  }
  return [...planned].map(([number, names]) => ({ number, body: names.join('\n') }));
}

/** `node scripts/design-links.mjs` from the checkout's root, reading `issues` as the open issues; its counts when it passed. */
function check(issues) {
  const directory = mkdtempSync(join(tmpdir(), 'deep-1111-'));
  try {
    const file = join(directory, 'open-issues.json');
    writeFileSync(file, JSON.stringify(issues));
    const env = { ...process.env, DEEP_OPEN_ISSUES: file };
    delete env.NODE_OPTIONS;
    delete env.NODE_TEST_CONTEXT;
    const run = spawnSync(process.execPath, ['scripts/design-links.mjs'], { cwd: CHECKOUT, env, encoding: 'utf8', timeout: BOUND_MS, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024 });
    if (run.error) throw new Error(`INCONCLUSIVE: node scripts/design-links.mjs didn't run to its end (bounded at ${BOUND_MS / 1000} s): ${run.error.message}`);
    if (run.signal) throw new Error(`INCONCLUSIVE: node scripts/design-links.mjs was killed by ${run.signal}`);
    const lines = `${run.stdout}\n${run.stderr}`.split('\n').filter((line) => line.trim());
    const unread = lines.find((line) => /^INCONCLUSIVE\b|the open issues were not read|could not (?:read|fetch) the (?:cached )?open issues/.test(line));
    if (unread) throw new Error(`INCONCLUSIVE: the design-links check did not read the open issues it was given: ${unread.trim()}`);
    const counts = run.stdout.match(/^design links and names: (\d+) links checked from \d+ docs and (\d+) open issues\b/m);
    // No stack frame of the check's goes into a message: the proof lane places a failure by the first frame it reads.
    const output = lines.filter((line) => !/^\s*at /.test(line)).slice(0, 40).join('\n').replaceAll(CHECKOUT, '<checkout>');
    return { status: run.status, output, checked: counts && Number(counts[1]), read: counts && Number(counts[2]) };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('AC1 #1111.19901108 the design-links check passes on the twelve T0–T10 issues, having read all twelve and checked every link of theirs into docs/*.md', () => {
  const links = issueLinks();
  const planned = plannedIssues();
  const run = check([...TWELVE, ...planned]);
  assert.equal(run.status, 0, `node scripts/design-links.mjs, given the twelve T0–T10 issues as open, exits ${run.status}, not 0:\n${run.output}`);
  if (run.checked === null) throw new Error(`INCONCLUSIVE: the check exited 0 without the line that counts its links and open issues, so what it read is unknown:\n${run.output}`);
  assert.equal(run.read, TWELVE.length + planned.length, `the check passed on ${run.read} open issues, not the twelve T0–T10 issues${planned.length ? ` and the ${planned.length} that plan a name` : ''}:\n${run.output}`);
  // The same check without the twelve: what it counts less is what it checked of theirs.
  const control = check(planned);
  if (control.status !== 0 || control.checked === null) throw new Error(`INCONCLUSIVE: the check passed with the twelve issues but not without them, so their links can't be counted:\n${control.output}`);
  assert.equal(run.checked - control.checked, links.length, `the check counted ${run.checked - control.checked} links from the twelve issues into docs/*.md; the repo's link reader finds ${links.length} (${run.checked} links with the issues, ${control.checked} without)`);
});

test('AC1 #1111.19901108 docs/parallel-proof.md exists and every link to it from the twelve T0–T10 issues resolves to a heading', () => {
  const links = issueLinks().filter(({ file }) => file === PROOF);
  assert.ok(existsSync(join(CHECKOUT, PROOF)), `${PROOF} does not exist, so none of the ${links.length} links to it from the T0–T10 issues resolves`);
  const found = anchors(join(CHECKOUT, PROOF));
  const unresolved = links.filter(({ id }) => !found.get(id)).map(({ number, id }) => `#${number} → #${id}`);
  assert.deepEqual(unresolved, [], `${unresolved.length} of the ${links.length} links from the T0–T10 issues to ${PROOF} resolve to no heading of it`);
});

// A negation: a statement that holds one where it would say what is measured or met doesn't say it.
const NEGATION = /\b(?:not|never|no longer|nor|neither|rather than|instead of)\b|n't\b/;
// A word of budgets, other than in "budget window".
const BUDGET = /\bbudgets?\b(?! windows?\b)/;

/**
 * A doc's sentences outside fenced code, in lower case and as rendered: links by their text, no emphasis, code ticks or
 * quote marks, white space collapsed. Each comes with its block, the paragraph, list item, heading or table row it is in.
 */
function sentences(doc) {
  const blocks = [];
  let open = false;
  for (const { line } of [...prose(readFileSync(join(CHECKOUT, doc), 'utf8'))]) {
    if (!line.trim()) open = false;
    else if (open && !/^\s*(?:[-*+] |\d+[.)] |#{1,6} |\||>)/.test(line)) blocks[blocks.length - 1] += ` ${line.trim()}`;
    else open = Boolean(blocks.push(line.trim()));
  }
  return blocks.flatMap((raw) => {
    const block = raw.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]*>/g, '').replace(/[’‘]/g, "'").replace(/[`*"“”]|\b_+|_+\b/g, '').replace(/\s+/g, ' ').toLowerCase();
    return block.split(/(?<=[.!?;])\s+/).map((sentence) => ({ sentence, block }));
  });
}

/** Whether a sentence says something is measured in `place`: "measured", then the place, with no negation on either. */
function measuredIn(sentence, place) {
  return [...sentence.matchAll(/\bmeasured\b/g)].some(({ index }) => {
    const rest = sentence.slice(index + 'measured'.length);
    const at = rest.indexOf(place);
    return at >= 0 && !NEGATION.test(rest.slice(0, at)) && !NEGATION.test(sentence.slice(0, index).split(' ').slice(-3).join(' '));
  });
}

/** Whether a sentence states the reading rule: "in the local preflight" in a budget criterion is met by the budget window's record for the commit. */
function statesRule(sentence) {
  const rule = sentence.match(/in the local preflight\b(.*?)\bmet by\b(.*?\bcommits?\b)/);
  return Boolean(rule) && /\bcriteri(?:on|a)\b/.test(sentence) && BUDGET.test(sentence) && /\bbudget windows?\b/.test(rule[2]) && /\brecords?\b/.test(rule[2]) && !NEGATION.test(rule[1]) && !NEGATION.test(rule[2]);
}

test('AC2 #1111.893a5670 docs/parallel-proof.md states that "in the local preflight" in an existing budget criterion is met by the budget window\'s record for that commit, and nowhere that it is met another way', () => {
  assert.ok(existsSync(join(CHECKOUT, PROOF)), `${PROOF} does not exist, so it states nothing`);
  const about = sentences(PROOF).map(({ sentence }) => sentence).filter((sentence) => sentence.includes('in the local preflight') && /\bmet\b|\bmeets?\b/.test(sentence));
  assert.ok(about.some(statesRule), `no sentence of ${PROOF} says a budget criterion's "in the local preflight" is met by the budget window's record for the commit. Its sentences on what meets "in the local preflight":\n${about.join('\n') || '(none)'}`);
  assert.deepEqual(about.filter((sentence) => !statesRule(sentence)), [], `${PROOF} also says "in the local preflight" is met another way, or not met`);
});

test('AC3 #1111.9ef2c17c docs/technical-design.md no longer says budgets are measured in the local preflight', () => {
  const old = sentences(DESIGN).filter(({ sentence, block }) => BUDGET.test(block) && measuredIn(sentence, 'in the local preflight')).map(({ sentence }) => sentence);
  assert.deepEqual(old, [], `${DESIGN} still says budgets are measured in the local preflight, in ${old.length} sentence${old.length === 1 ? '' : 's'}`);
});

test('AC3 #1111.9ef2c17c docs/technical-design.md says budgets are measured in the scheduled budget window', () => {
  const all = sentences(DESIGN).filter(({ block }) => BUDGET.test(block));
  const said = all.filter(({ sentence }) => measuredIn(sentence, 'in the scheduled budget window'));
  const near = all.map(({ sentence }) => sentence).filter((sentence) => /\bmeasured\b/.test(sentence) && /local preflight|budget window/.test(sentence));
  assert.ok(said.length > 0, `no sentence of ${DESIGN} about budgets says they are measured in the scheduled budget window. Its sentences on budgets with "measured" and a preflight or a budget window:\n${near.join('\n') || '(none)'}`);
});

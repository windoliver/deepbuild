// #1111's three criteria, the blind redraft for #2047's sweep: docs/parallel-proof.md and the T0–T10 issues' links
// into it, the reading rule for "in the local preflight", the design's budget line, and the approval tag on the commit
// that changed that line. Each test reads this checkout: its docs, its design-links check, its git history and tags,
// its approval reader. Nothing is written (README: The surface).
// Run: node --test tests/acceptance/1111-redraft-2047/criteria.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { anchors, outline, prose, resolve, targets } from '../../../scripts/doc-links.mjs';
import { readApprovals } from '../../../scripts/proof-approvals.mjs';

const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const DOC = 'docs/parallel-proof.md';
const DESIGN = 'docs/technical-design.md';
// The T0–T10 issues, #1112 to #1123, as they read on 2026-11-22 (README: The T0–T10 issues).
const ISSUES = fileURLToPath(new URL('./t0-t10-issues.json', import.meta.url));
// What the design said and the issue takes out (its Scope), and the words that open that clause.
const MEASURED = 'measured on a reference Mac';
const OLD = `${MEASURED} by a benchmark in the local preflight`;

/** A markdown line as its reader sees it: links by their text, no emphasis marks or code ticks, one case, single spaces. */
const read = (text) => text.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
/** What a message quotes of an output: no line that reads as a stack frame, which the proof lane would place the failure by. */
const quoted = (text) => text.replaceAll(CHECKOUT, '<checkout>').split('\n').filter((line) => !/^\s*at /.test(line)).join('\n').trim().slice(-4000) || '(nothing)';

/** Every link from a T0–T10 issue into docs/parallel-proof.md, as the design-links check reads an issue's links. */
function issueLinks() {
  return JSON.parse(readFileSync(ISSUES, 'utf8')).flatMap(({ number, body }) => [...prose(body)].flatMap(({ line }) => targets(line))
    .map((target) => ({ number, target, link: resolve(target, null) })).filter(({ link }) => link?.file === DOC));
}

test('AC1 #1111.19901108 docs/parallel-proof.md exists, and every link from the T0–T10 issues to it resolves to a heading', () => {
  const links = issueLinks();
  assert.equal(new Set(links.map(({ number }) => number)).size, 12, `each of the 12 issues #1112 to #1123 links ${DOC}; read ${links.length} links`);
  assert.ok(existsSync(join(CHECKOUT, DOC)), `${DOC} does not exist`);
  const found = anchors(join(CHECKOUT, DOC));
  const unresolved = links.filter(({ link }) => !link.id || !found.has(link.id)).map(({ number, target }) => `#${number} ${target}`);
  assert.deepEqual(unresolved, [], `${unresolved.length} of the ${links.length} links from the T0–T10 issues to ${DOC} land on no heading of it`);
});

test('AC1 #1111.19901108 the design-links check, reading the T0–T10 issues, finds no link that lands on no heading', () => {
  const env = { ...process.env, DEEP_OPEN_ISSUES: ISSUES };
  delete env.NODE_OPTIONS;
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, ['scripts/design-links.mjs'], { cwd: CHECKOUT, env, encoding: 'utf8', timeout: 300_000, killSignal: 'SIGKILL', maxBuffer: 1 << 28 });
  if (run.error || run.signal) throw new Error(`INCONCLUSIVE: node scripts/design-links.mjs didn't run to its end: ${run.error?.message ?? run.signal}`);
  const output = `${run.stdout}${run.stderr}`;
  if (/^INCONCLUSIVE\b/m.test(output)) throw new Error(`INCONCLUSIVE: the design-links check didn't read the issues: ${quoted(output)}`);
  // With only these 12 as its open issues the check may still fail on what isn't a link (a planned name whose issue
  // isn't among them), so the test reads the count of links its verdict line gives (README: The surface).
  const failed = output.match(/^FAIL (\d+) links into docs\/\*\.md land on no heading/m);
  const passed = run.status === 0 && /\b12 open issues\b/.test(output);
  assert.ok(passed || failed, `the design-links check gave no verdict on its links (exit ${run.status}):\n${quoted(output)}`);
  assert.equal(passed ? 0 : Number(failed[1]), 0, `the design-links check finds links that land on no heading:\n${quoted(output)}`);
});

test('AC2 #1111.bded4607 docs/parallel-proof.md states, under Budget windows, that "in the local preflight" in an existing budget criterion is met by the budget window\'s record for that commit', () => {
  const file = join(CHECKOUT, DOC);
  assert.ok(existsSync(file), `${DOC} does not exist`);
  const { headings } = outline(file);
  const bytes = readFileSync(file);
  // Each section whose heading names budget windows, down to the next heading of its level or above.
  const sections = headings.flatMap((heading, at) => (/budget-windows?(?:-|$)/.test(heading.id)
    ? [bytes.subarray(heading.offset, headings.slice(at + 1).find(({ level }) => level <= heading.level)?.offset).toString()] : []));
  assert.ok(sections.length > 0, `no heading of ${DOC} names budget windows; its headings: ${headings.map(({ id }) => id).join(', ') || '(none)'}`);
  // One statement: a paragraph or a list item.
  const statements = sections.flatMap((section) => section.split(/\n\s*\n|\n(?=\s*(?:[-*+]|\d+\.)\s)/)).map(read);
  const about = statements.filter((statement) => statement.includes('in the local preflight'));
  const states = (statement) => /\bcriteri(?:on|a)\b/.test(statement) && /\b(?:met|satisfied)\b/.test(statement) && /\bbudget window/.test(statement)
    && /\brecord/.test(statement) && /\bcommit\b/.test(statement) && !/(?:\bnot|\bnever|\bno longer|n't)\s+(?:be\s+)?(?:met|satisfied)\b/.test(statement);
  assert.ok(about.some(states), `no paragraph or list item under Budget windows in ${DOC} says a criterion's "in the local preflight" is met by the budget window's record for the commit. `
    + `Those that name "in the local preflight" (${about.length}):\n${about.join('\n') || '(none)'}`);
});

test('AC3 #1111.10d60f7c docs/technical-design.md no longer says budgets are measured in the local preflight: they are measured in the scheduled budget window', () => {
  // The clause that says where: from "measured on a reference Mac" to the comma or full stop that ends it.
  const clauses = readFileSync(join(CHECKOUT, DESIGN), 'utf8').split('\n').map(read).flatMap((line) => line.split(MEASURED.toLowerCase()).slice(1).map((rest) => rest.split(/[,.]/)[0]));
  assert.ok(clauses.length > 0, `${DESIGN} has no line saying budgets are "${MEASURED}", so where they are measured can't be read`);
  assert.deepEqual(clauses.filter((clause) => clause.includes('local preflight') || !clause.includes('in the scheduled budget window')), [],
    `${DESIGN} says budgets are ${MEASURED}… somewhere other than in the scheduled budget window alone`);
});

const git = (...args) => {
  const run = spawnSync('git', ['-c', 'core.quotePath=false', ...args], { cwd: CHECKOUT, encoding: 'utf8', maxBuffer: 1 << 30 });
  if (run.error) throw new Error(`BLOCKED: git ${args.join(' ')} didn't run: ${run.error.message}`);
  return run.status === 0 ? run.stdout.trim() : null;
};

test('AC3 #1111.10d60f7c the commit that changes the design\'s budget line carries a signed approval tag under deep/approved/ naming both files, which the guard\'s approval reader verifies', () => {
  const design = git('show', `HEAD:${DESIGN}`);
  if (design === null) throw new Error(`BLOCKED: this checkout has no git history holding ${DESIGN} at HEAD, so the commit that changes it can't be found`);
  assert.ok(!design.includes(OLD), `${DESIGN} at HEAD still says "${OLD}", so no commit has changed it`);
  if (git('rev-parse', '--is-shallow-repository') !== 'false') throw new Error('BLOCKED: this checkout\'s history is cut short (a shallow clone), so the commit that changes the line can\'t be found');
  // The newest commit in HEAD's history that takes the words out of the design.
  const commit = git('log', '-1', '--format=%H', `-S${OLD}`, 'HEAD', '--', DESIGN);
  if (!commit || git('show', `${commit}:${DESIGN}`)?.includes(OLD) !== false) throw new Error(`BLOCKED: HEAD's history holds no commit that takes "${OLD}" out of ${DESIGN} (found ${commit || 'none'})`);
  const refs = (git('for-each-ref', '--format=%(refname) %(objecttype) %(*objectname)', 'refs/tags/deep/approved/') ?? '').split('\n').filter(Boolean);
  if (!refs.length) throw new Error('BLOCKED: this checkout holds no tag under deep/approved/, so whether the commit carries one can\'t be read here; fetch the tags');
  const tags = refs.filter((row) => row.endsWith(` tag ${commit}`)).map((row) => row.split(' ')[0].replace('refs/tags/', ''));
  assert.ok(tags.length > 0, `commit ${commit}, which takes the words out of ${DESIGN}, carries no annotated tag under deep/approved/ (of ${refs.length} there)`);
  // The merge base the guard read the approvers at: where the commit's branch left the line it was merged into, or the
  // commit's parent when it sits on that line itself.
  const merge = (git('rev-list', '--first-parent', '--ancestry-path', `${commit}..HEAD`) ?? '').split('\n').filter(Boolean).at(-1);
  const onto = merge ? git('rev-parse', `${merge}^1`) : null;
  const base = onto && onto !== commit ? git('merge-base', commit, onto) : git('rev-parse', `${commit}^1`);
  if (!base) throw new Error(`BLOCKED: no merge base was found for commit ${commit}, so the approvers can't be read`);
  if (spawnSync('ssh-keygen', ['-?']).error) throw new Error('BLOCKED: ssh-keygen isn\'t on PATH, so the approval reader can verify no signature');
  const approvals = readApprovals(CHECKOUT, { base, commits: [{ sha: commit }] }, null);
  const items = approvals?.get(commit) ?? [];
  const named = items.map((item) => item.split(' › ')[0]);
  assert.deepEqual([DESIGN, DOC].filter((file) => !named.includes(file)), [],
    `the approval reader, reading .deepbuild/approvers at ${base}, verifies no approval of commit ${commit} naming these files. Its tags: ${tags.join(', ')}; `
    + `the items the reader gives: ${items.join(', ') || '(none)'}; refused: ${(approvals?.refused ?? []).join('; ') || '(none)'}`);
});

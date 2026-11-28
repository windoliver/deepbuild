import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  check, CHECK, cleanup, fails, ID, lintLaneRuns, MERGE_BASE, mergeBaseFailures, mergeBaseTree, MIN, named, none, passes, placed, plainWords, plantLines, plantTemplate,
  RULES, SET, SEVEN, shown, shownDir, sourceLine, templatesOf, treeCopy, WORDS,
} from './helpers.ts';

afterAll(cleanup);
const T = 10 * MIN;
const PR_TEMPLATE = { name: 'planted_3498_look', text: 'its PR waits on you' };
const NO_ENTRY_TEMPLATE = { name: 'planted_3498_no_entry', text: 'its planted step waits on you' };
const INLINE_WHY = "const planted3498 = { rule: 'planted', state: 'flagged', lacks: 'no planted fact', match: (f: SessionFacts) => (f.gone ? { why: 'its planted step waits on you', since: f.last_seen, waits_on: 'you', facts: [f.gone] } : undefined) };";

async function unplantedCopyPasses(): Promise<void> {
  const control = await check(treeCopy());
  expect(passes(control), `the check passes an unplanted copy of this checkout, so a planted copy's failure is the plant's: ${shown(control)}`).toBe(true);
}

describe(`AC1 ${ID.base} the check on the merge base and on this change`, () => {
  it(`AC1 ${ID.base}: run on the merge base's files, the check fails, naming each of the seven sentences by its file and line with each listed word and its plain word, and the run is written out`, async () => {
    const root = mergeBaseTree();
    const ran = await check(root);
    const run = `node ${CHECK} --root <the files of ${MERGE_BASE}>\nexit ${ran.code}\n${ran.stdout}${ran.stderr}`.split(root).join('<the files of the merge base>');
    const out = join(shownDir(), 'merge-base-check.txt');
    writeFileSync(out, run);
    console.log(`AC1: the check's run on the merge base's files, kept in ${out}:\n${run}`);
    expect(SEVEN.length, 'the issue lists seven sentences').toBe(7);
    none(mergeBaseFailures(ran, (s) => sourceLine(root, RULES, s.source), plainWords(root)), `the check names each of the seven sentences of ${RULES} at the merge base with its listed words: ${shown(ran)}`);
  }, T);

  it(`AC1 ${ID.base}: on this checkout the check passes, and the lint lane runs it`, async () => {
    const ran = await check();
    expect(passes(ran), `node ${CHECK} exits 0 with no FAIL line on this checkout: ${shown(ran)}`).toBe(true);
    expect(await lintLaneRuns(CHECK), `the lint lane in scripts/lanes.mjs runs node ${CHECK}`).toBe(true);
  }, T);
});

describe(`AC2 ${ID.planted} planted templates and a planted why`, () => {
  it(`AC2 ${ID.planted}: a planted template holding "PR" fails the check, naming the template and "change to look at"`, async () => {
    expect(plainWords().PR, `${WORDS} gives PR the plain word the criterion names`).toBe('change to look at');
    await unplantedCopyPasses();
    const root = treeCopy();
    plantTemplate(root, PR_TEMPLATE.name, PR_TEMPLATE.text, true);
    const ran = await check(root);
    expect(ran.code, `the check exits 1 on the planted template: ${shown(ran)}`).toBe(1);
    expect(fails(ran).some((line) => named(line, PR_TEMPLATE.name) && line.includes('change to look at')), `a FAIL line names the template ${PR_TEMPLATE.name} and "change to look at": ${shown(ran)}`).toBe(true);
  }, T);

  it(`AC2 ${ID.planted}: a planted why written inline in a rule fails the check, naming the file and line`, async () => {
    await unplantedCopyPasses();
    const root = treeCopy();
    const line = plantLines(root, RULES, [INLINE_WHY]);
    const ran = await check(root);
    expect(ran.code, `the check exits 1 on the planted why: ${shown(ran)}`).toBe(1);
    expect(fails(ran).some((l) => placed(l, RULES, line)), `a FAIL line names ${RULES}:${line}: ${shown(ran)}`).toBe(true);
  }, T);
});

describe(`AC4 ${ID.table} a template with no entry in the app's table`, () => {
  it(`AC4 ${ID.table}: a planted template with no entry in the app's table fails the check, naming the template, and the same template with its entry passes`, async () => {
    await unplantedCopyPasses();
    const withEntry = treeCopy();
    expect(Object.keys(templatesOf(withEntry)).length, `${SET} holds templates`).toBeGreaterThan(0);
    plantTemplate(withEntry, NO_ENTRY_TEMPLATE.name, NO_ENTRY_TEMPLATE.text, true);
    const held = await check(withEntry);
    expect(passes(held), `the check passes the planted template while the app's table holds hub.${NO_ENTRY_TEMPLATE.name} with its English: ${shown(held)}`).toBe(true);
    const root = treeCopy();
    plantTemplate(root, NO_ENTRY_TEMPLATE.name, NO_ENTRY_TEMPLATE.text, false);
    const ran = await check(root);
    expect(ran.code, `the check exits 1 on the template with no entry: ${shown(ran)}`).toBe(1);
    expect(fails(ran).some((line) => named(line, NO_ENTRY_TEMPLATE.name)), `a FAIL line names the template ${NO_ENTRY_TEMPLATE.name}: ${shown(ran)}`).toBe(true);
  }, T);
});

// #1802.b8a0e044: "A corpus document that lists a removed entry in `requires.preview` opens through the entry's
// migration with the same evaluated values at 20 sampled times, or the removal is refused, naming the document. A
// planted removal with no migration fails"
//
// asserts: the build `full,test-preview` (the release that still has the preview kind test.preview.blob@1) saves the
// corpus document preview-board, which lists test.preview.blob@1 in `requires.preview` and holds one item of it, b1,
// with its values at 20 sampled times, every eighth of a second from 0 s (#138's `corpus_record`); the file holds
// those 20 times, and at each of them b1's value with the box the document gives it. In the build
// `full,test-preview-removed`, whose test.preview removed the kind with a migration, the document presented from your
// shell opens with no error and a `migrated` notice naming b1, and the kit's migration part for test.preview over
// that corpus folder runs the document as a case that passes, compared at exactly those 20 times, at least one value
// at each; the module's verdict is PASS. In the planted build `full,test-preview-removed-bare`, whose test.preview
// removed the kind with no migration, the same kit run refuses the removal: the module's verdict is FAIL and a
// failure, or the failed case, names preview-board; and this criterion's check fails on that build, naming the
// document.
// Wrong programs: `test-preview-removed-bare`; the merge base, which has neither removed build (cargo refuses a
// feature the crate doesn't have).

import { expect, it } from 'vitest';
import {
  FLICKS, corpusRecord, failsNaming, isObject, kitMigration, mentions, none, obj, present, readJson, run, scenario, show, useBuilds, useEvidence, useFolder,
  type JsonObject, type ShowFeature,
} from './helpers.ts';

const bin = useBuilds(['test-preview', 'test-preview-removed', 'test-preview-removed-bare']);
const evidence = useEvidence();
const corpus = useFolder('corpus');

const MODULE = 'test.preview';
const BLOB = 'test.preview.blob@1';
/** The corpus document's name: its file is `<corpus>/preview-board.json`, and the kit's case for it carries the name. */
const NAME = 'preview-board';
const ITEM = 'b1';
const BOX = [20, 20, 40, 30];
/** The issue's number of sampled times. */
const SAMPLES = 20;
/** Every eighth of a second from 0 s, as time literals; each is a whole number of flicks. */
const TIMES = Array.from({ length: SAMPLES }, (_, k) => `${k * 0.125}s`);
const TIMES_IN_FLICKS = TIMES.map((_, k) => k * (FLICKS / 8));
const DOCUMENT: JsonObject = {
  format: 1, profile: 'board', title: 'Preview corpus', size: [320, 200],
  description: 'A board an earlier release saved: one item of a preview kind beside a plain rect.',
  requires: { modules: { [MODULE]: '^1' }, preview: [BLOB] },
  items: {
    [ITEM]: { id: ITEM, kind: BLOB, name: 'Preview blob', order: 'a0', params: { box: BOX } },
    r1: { id: 'r1', kind: 'rect@1', name: 'Plain box', order: 'a1', params: { box: [120, 20, 40, 30], paint: { fill: { role: 'muted' } } } },
  },
};

/** The release that still has the preview kind saves the corpus document, with b1's value at each of the 20 sampled times. */
function saveCorpus(): void {
  const saved = obj(readJson(corpusRecord(bin('test-preview'), evidence(), corpus(), NAME, DOCUMENT, TIMES)), 'the corpus file');
  expect(saved['times'], `the corpus file holds the ${SAMPLES} sampled times, in flicks`).toEqual(TIMES_IN_FLICKS);
  const values = obj(saved['values'], 'the corpus file\'s values');
  for (const t of TIMES_IN_FLICKS) {
    const item = obj(obj(values[String(t)], `the values recorded at ${t}`)[ITEM], `${ITEM}'s value recorded at ${t}`);
    expect(obj(item['params'], `${ITEM}'s recorded params at ${t}`)['box'], `${ITEM}'s recorded box at ${t} is the one the document gives it`).toEqual(BOX);
  }
}

/** The kit's case for the corpus document, if its migration part ran one. */
const caseOf = (cases: readonly JsonObject[]): JsonObject | undefined => cases.find((c) => c['case'] === NAME);

/**
 * The criterion's check on a build that removed the entry, over the saved corpus: the document opens through the
 * entry's migration, and gives the values recorded for it at each of its 20 sampled times. Each failure names the
 * document.
 */
function removalFailures(feature: ShowFeature): string[] {
  const failures: string[] = [];
  const [opened] = run(bin(feature), scenario(evidence(), [present(DOCUMENT)]));
  const listed = (key: string): JsonObject[] => {
    const list = opened![key];
    return Array.isArray(list) ? list.filter(isObject) : [];
  };
  const errors = listed('issues').filter((i) => i['severity'] === 'error');
  if (errors.length) failures.push(`${NAME} doesn't open in the build that removed ${BLOB}: ${show(errors)}`);
  const migrated = listed('notices').some((n) => n['code'] === 'migrated' && Array.isArray(n['ids']) && n['ids'].includes(ITEM));
  if (!migrated) failures.push(`${NAME} opens with no migrated notice naming ${ITEM}, so not through ${BLOB}'s migration: ${show(opened!['notices'] ?? null)}`);

  const kit = kitMigration(bin(feature), evidence(), MODULE, corpus());
  const ran = caseOf(kit.cases);
  if (ran === undefined) failures.push(`${NAME}: the kit's migration part for ${MODULE} ran no case for the corpus document; it ran ${show(kit.cases.map((c) => c['case']))}`);
  else {
    if (ran['verdict'] !== 'PASS') failures.push(`${NAME} doesn't give the values recorded for it: ${show(ran)}`);
    const held = ran['compared'];
    const compared: JsonObject = isObject(held) ? held : {};
    if (JSON.stringify(compared['times']) !== JSON.stringify(TIMES_IN_FLICKS)) failures.push(`${NAME} wasn't compared at its ${SAMPLES} sampled times: ${show(compared['times'] ?? null)}`);
    const count = compared['values'];
    if (typeof count !== 'number' || count < SAMPLES) failures.push(`${NAME}: fewer than one evaluated value compared at each of its ${SAMPLES} sampled times: ${show(count ?? null)}`);
  }
  if (kit.verdict !== 'PASS') failures.push(`${NAME}: with it in the corpus, the kit's verdict for ${MODULE} is ${kit.verdict}: ${show(kit.failures, 2500)}`);
  return failures;
}

it('#1802.b8a0e044 a corpus document that lists a removed entry in requires.preview opens through the entry\'s migration with the same evaluated values at 20 sampled times', () => {
  saveCorpus();
  none(removalFailures('test-preview-removed'), `${NAME} in the build that removed ${BLOB} with its migration`);
}, 1_800_000);

it('#1802.b8a0e044 a planted removal with no migration is refused, naming the document', () => {
  saveCorpus();
  none(removalFailures('test-preview-removed'), 'the removal with its migration, held to the same check first');
  const kit = kitMigration(bin('test-preview-removed-bare'), evidence(), MODULE, corpus());
  expect(kit.verdict, `the kit refuses the removal with no migration: ${show(kit.raw, 2500)}`).toBe('FAIL');
  const failed = caseOf(kit.cases);
  expect(kit.failures.some((f) => mentions(f, NAME)) || failed?.['verdict'] === 'FAIL', `the refusal names the document ${NAME}: ${show(kit.raw, 2500)}`).toBe(true);
  failsNaming(removalFailures('test-preview-removed-bare'), [NAME], 'a removal with no migration');
}, 1_800_000);

// AC3 #538.d7b350a3: With rules.item 99, a key the table lacks, the item shows the table's missing string (empty) and
// raises copy.missing naming loot, 99, rules.item and the step; with the table's keys stored in the order 4, 17, 9 and
// then sorted to 4, 9, 17, key 17 shows the same string; and a planted lookup that keeps key 17's position from the
// first order shows key 9's string after the sort and fails, naming key 17
//
// The copy document (fixtures.ts `copyDoc`) over an English `loot` of keys 4 ('You found a rusty key'), 17 (the plural
// entry) and 9 ('You found a silver ring'), its keys stored in that order (`keyedTable`, written in that order into the
// scenario's line), fed by `rules` (programs.ts `lootProgram`: item 99 at step 30, item 17 with count 12 at step 45).
// "Shows the missing string (empty)" is a frame that draws nothing: every pixel the ground's. The issue is `eval`'s at
// step 30. Then one live session: the document with the keys 4, 17, 9, `eval` at step 45; a revision of the same
// document with them sorted 4, 9, 17, `eval` at step 45; each frame's pixel hash against the caption reading key 17's
// string and key 9's, written out with no logic.
import { describe, expect, it } from 'vitest';
import { LOOT, countAt, lootProgram } from './programs.ts';
import { KEY17, SILVER, captionRef, copyDoc, formOf, keyedTable } from './fixtures.ts';
import {
  AC, DOC, TIMEOUT, at, binOf, evalCall, failsNaming, field, inked, issuesOf, names, none, pngOf, prebuild, presented, putEvidence, runShow, scenario,
  show, showCall, snapshotOf, useTemp, type JsonObject, type Planted,
} from './helpers.ts';

prebuild(['full']);
const temp = useTemp();
const D = { copy: DOC(1), ref17: DOC(2), ref9: DOC(3) };
const KEY17_TEXT = formOf(KEY17.en.other, countAt(LOOT.again));

interface Run { ev: string; missing: JsonObject; first: string; sorted: string; ref17: string; ref9: string }
function keyedRun(planted?: Planted): Run {
  const ev = temp();
  const program = lootProgram();
  putEvidence(ev, program.bytes);
  const calls: JsonObject[] = [
    showCall(D.ref17, captionRef('ref-17', KEY17_TEXT)), showCall(D.ref9, captionRef('ref-9', SILVER)), evalCall(D.ref17, 0), evalCall(D.ref9, 0),
    showCall(D.copy, copyDoc(program, keyedTable([4, 17, 9]))), evalCall(D.copy, at(LOOT.missing)), evalCall(D.copy, at(LOOT.again)),
    showCall(D.copy, copyDoc(program, keyedTable([4, 9, 17]))), evalCall(D.copy, at(LOOT.again)),
  ];
  const r = runShow(binOf(), scenario(ev, Object.values(D), calls, planted), 'AC3 the keyed table');
  presented(r[0]!, 'the caption reading key 17\'s string, with no logic');
  presented(r[1]!, 'the caption reading key 9\'s string, with no logic');
  presented(r[4]!, 'the copy document with its keys stored 4, 17, 9');
  presented(r[7]!, 'the copy document with its keys sorted 4, 9, 17');
  return {
    ev, missing: r[5]!, ref17: snapshotOf(r[2]!, 'key 17\'s caption'), ref9: snapshotOf(r[3]!, 'key 9\'s caption'),
    first: snapshotOf(r[6]!, 'the caption at step 45, keys 4, 17, 9'), sorted: snapshotOf(r[8]!, 'the caption at step 45, keys 4, 9, 17'),
  };
}
/** The judge: at step 45 (rules.item 17) both orders show key 17's string; a failure names the key the step picks. */
function orderFailures(run: Run): string[] {
  const shown = (h: string): string => (h === run.ref17 ? 'key 17\'s string' : h === run.ref9 ? 'key 9\'s string' : 'neither key 17\'s nor key 9\'s string');
  return ([['stored 4, 17, 9', run.first], ['sorted 4, 9, 17', run.sorted]] as const)
    .filter(([, h]) => h !== run.ref17)
    .map(([order, h]) => `key 17 (rules.item 17 at step ${LOOT.again}), its table's keys ${order}: shows ${shown(h)}, not ${JSON.stringify(KEY17_TEXT)}`);
}

describe(`${AC[3]} a missing key, and lookups by value`, () => {
  it(`${AC[3]} rules.item 99 shows the missing string (nothing) and raises copy.missing naming loot, 99, rules.item and the step; key 17 shows its string with the keys stored 4, 17, 9 and sorted 4, 9, 17`, () => {
    const run = keyedRun();
    const missing = snapshotOf(run.missing, 'the caption at step 30, rules.item 99');
    expect(inked(pngOf(run.ev, missing, 'the caption at step 30')), 'at step 30 the caption shows the table\'s missing string, empty: the frame draws nothing').toBe(0);
    const raised = issuesOf(run.missing).filter((i) => i['code'] === 'copy.missing');
    const naming = raised.filter((i) => names(String(field(i, 'table')), 'loot') && field(i, 'key') === 99 && names(String(field(i, 'array')), 'rules.item') && field(i, 'step') === LOOT.missing);
    expect(naming.length, `eval at step 30 raises copy.missing {table: loot, key: 99, array: rules.item, step: 30}; its issues: ${show(issuesOf(run.missing), 2500)}`).toBeGreaterThan(0);
    none(orderFailures(run), 'key 17 in both orders of the table');
  }, TIMEOUT);

  it(`${AC[3]} planted copy_keeps_first_position shows key 9's string after the sort and fails, naming key 17`, () => {
    const run = keyedRun('copy_keeps_first_position');
    expect(run.sorted, 'under the planted lookup, after the sort the caption shows key 9\'s string').toBe(run.ref9);
    failsNaming(orderFailures(run), [/key 17\b/], 'the table under copy_keeps_first_position');
  }, TIMEOUT);
});

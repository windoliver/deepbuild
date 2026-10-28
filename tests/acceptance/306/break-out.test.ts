// AC5: "Breaking out c1.bars.2 by patch makes it the writer's own item with the same ID and the values it
// was expanded with; broken_out lists it and joins c1's key; changing n to 6 re-expands the others and adds
// c1.bars.5 while c1.bars.2 keeps its values; undoing the break-out hands it back as expanded; and a planted
// re-expansion that overwrites a broken-out item fails, naming it"
//
// asserts: on the stored chart board (your layer) in the build without scene3d, your patch
// `break_out {instance: c1, item: c1.bars.2}` applies; the board then holds c1.bars.2 as your own item
// with the kind, params and at it was expanded with, c1's `broken_out` lists it, c1's expansion no longer
// writes it and c1's key differs from c2's (broken_out joins the key); your patch of n to 6 applies, c1
// expands into bars 0, 1, 3, 4 and 5, and c1.bars.2 keeps its values (`brokenOutFailures`); in a second run
// your undo of the break-out applies and c1.bars.2 is expanded again with the same values, under c2's key,
// and is no longer your item; `reexpansion_overwrites_broken_out` fails `brokenOutFailures` naming
// c1.bars.2.

import { describe, expect, it } from 'vitest';
import {
  CHART, DOC, R1, brokenOutFailures, canon, clone, derivedIds, expansionOf, failsNaming, fixture, isObject, none, obj, outcome, patch, patchId, read, readItems, run, scenario,
  sorted, strs, undo, useBuilds, useEvidence, type JsonObject,
} from './helpers.ts';

const builds = useBuilds([R1]);
const evidence = useEvidence();
const BOARD = fixture('chart-board.json');
const BREAK = patchId(21);
const SIX = patchId(22);
const UNDO = patchId(23);

const breakOut: JsonObject = { patch: BREAK, doc: DOC.a, base: 0, reason: 'take the middle bar', ops: [{ op: 'break_out', instance: 'c1', item: 'c1.bars.2' }] };
const toSix: JsonObject = { patch: SIX, doc: DOC.a, base: 1, reason: 'six bars', ops: [{ op: 'set', id: 'c1', path: 'items/c1/params/n', value: 6 }] };

/** The fields a break-out keeps: what the item was expanded with. */
const kept = (item: JsonObject): JsonObject => ({ kind: item['kind'] ?? null, params: item['params'] ?? null, at: item['at'] ?? null });

function breakThenSix(planted?: string): JsonObject[] {
  return run(builds.bin(R1), scenario(evidence(), { [DOC.a]: { panel: 'main', document: BOARD } }, [CHART], [
    read(DOC.a),
    patch(DOC.a, breakOut),
    read(DOC.a),
    patch(DOC.a, toSix),
    read(DOC.a),
  ], planted ? { planted } : {}));
}

describe('AC5 a break-out makes one derived item the writer\'s own, joins the key, survives re-expansion, and undoes', () => {
  it('AC5 break_out of c1.bars.2 makes it your item with the values it was expanded with; broken_out lists it and joins c1\'s key; n = 6 re-expands the others and keeps it', () => {
    const [before, broke, after, six, afterSix] = breakThenSix();
    const expanded = clone(expansionOf(before!, 'c1', 'revision 0').derived['c1.bars.2'] ?? {});
    expect(isObject(expanded) && Object.keys(expanded).length > 0, 'revision 0 expands c1.bars.2').toBe(true);
    expect(outcome(broke!), `the break-out applies: ${JSON.stringify(broke!['issues']).slice(0, 600)}`).toBe('applied');
    const items = readItems(after!, 'after the break-out');
    const own = obj(items['c1.bars.2'], 'c1.bars.2, now your item');
    expect(canon(kept(own)), 'c1.bars.2 keeps the kind, params and at it was expanded with').toBe(canon(kept(expanded)));
    expect(strs(obj(items['c1'], 'c1')['broken_out'], 'c1.broken_out'), 'c1.broken_out lists it').toEqual(['c1.bars.2']);
    const c1 = expansionOf(after!, 'c1', 'after the break-out');
    expect(sorted(Object.keys(c1.derived)), 'c1 no longer writes c1.bars.2').toEqual(['c1.bars.0', 'c1.bars.1', 'c1.bars.3', 'c1.bars.4']);
    expect(c1.key, 'broken_out joins c1\'s key, so it no longer shares c2\'s').not.toBe(expansionOf(after!, 'c2').key);
    expect(outcome(six!), `n = 6 applies: ${JSON.stringify(six!['issues']).slice(0, 600)}`).toBe('applied');
    const c1Six = expansionOf(afterSix!, 'c1', 'with n = 6');
    expect(sorted(Object.keys(c1Six.derived)), 'n = 6 re-expands the others and adds c1.bars.5').toEqual(['c1.bars.0', 'c1.bars.1', 'c1.bars.3', 'c1.bars.4', 'c1.bars.5']);
    none(brokenOutFailures(readItems(afterSix!, 'with n = 6'), c1Six, 'c1.bars.2', expanded), 'the broken-out item after the re-expansion');
  });

  it('AC5 undoing the break-out hands c1.bars.2 back as expanded, with the same values, under c2\'s key', () => {
    const [before, broke, undone, after] = run(builds.bin(R1), scenario(evidence(), { [DOC.a]: { panel: 'main', document: BOARD } }, [CHART], [
      read(DOC.a),
      patch(DOC.a, breakOut),
      undo(DOC.a, UNDO, BREAK),
      read(DOC.a),
    ]));
    const expanded = clone(expansionOf(before!, 'c1', 'revision 0').derived['c1.bars.2'] ?? {});
    expect(outcome(broke!), 'the break-out applies').toBe('applied');
    expect(outcome(undone!), `the undo of the break-out applies: ${JSON.stringify(undone!['issues']).slice(0, 600)}`).toBe('applied');
    const items = readItems(after!, 'after the undo');
    expect(items['c1.bars.2'], 'c1.bars.2 is no longer your own item').toBeUndefined();
    const brokenOut = obj(items['c1'], 'c1')['broken_out'];
    expect(brokenOut === undefined || (Array.isArray(brokenOut) && brokenOut.length === 0), `c1.broken_out is empty or gone: ${JSON.stringify(brokenOut)}`).toBe(true);
    const c1 = expansionOf(after!, 'c1', 'after the undo');
    expect(sorted(Object.keys(c1.derived)), 'c1 writes all five bars again').toEqual(derivedIds('c1', 'bars', 5));
    expect(canon(kept(c1.derived['c1.bars.2']!)), 'c1.bars.2 is expanded with the same values as before').toBe(canon(kept(expanded)));
    expect(c1.key, 'c1 shares c2\'s key again').toBe(expansionOf(after!, 'c2').key);
  });

  it('AC5 a planted re-expansion that overwrites the broken-out item fails this check, naming it', () => {
    const [before, , , , afterSix] = breakThenSix('reexpansion_overwrites_broken_out');
    const expanded = clone(expansionOf(before!, 'c1', 'revision 0').derived['c1.bars.2'] ?? {});
    const items = isObject(afterSix!['document']) ? readItems(afterSix!, 'with n = 6 under the planted re-expansion') : {};
    const c1 = expansionOf(afterSix!, 'c1', 'with n = 6 under the planted re-expansion');
    failsNaming(brokenOutFailures(items, c1, 'c1.bars.2', expanded), ['c1.bars.2'], 'the re-expansion that overwrites a broken-out item');
  });
});

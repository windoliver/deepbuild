// AC1 #3236.184c874e: "A fixture scatter of 12 rows with x in seconds from 0 to 11 and y in metres from 2 to 40, one
// row missing y, gives its node the value: 11 rows drawn, x seconds 0 to 11, y metres 2 to 40, 1 missing. A planted
// document whose agent typed a value for the node is refused, naming the item"
//
// The fixture scatter (fixtures.ts `scatterDoc`: 12 rows, x in seconds 0 to 11, y in metres, row 5's y a NaN), shown
// by the agent's `deep_show` and read by `see`: the node `scatter` carries `value`, the text the core computed at check
// (README: The node's value), judged by its parts: 11 drawn before the columns; x with its unit `seconds` and 0 to 11; y
// with `metres`, 2 to 40 and 1 missing. The planted document is the same scatter whose agent typed that very value as
// the item's `value`: the check refuses it with an error at `items/scatter/value`, naming the item.
// Wrong programs: no value on the node; a value typed by the agent and kept; the scale's domain (0 to 12, 0 to 60) for
// the drawn extent; the missing row counted as drawn.
import { describe, expect, it } from 'vitest';
import { DOC, SCATTER, scatterDoc } from './fixtures.ts';
import {
  AC, Script, TIMEOUT, binOf, issuesOf, namesItem, nodeOf, none, prebuild, presented, runShow, scatterValueFailures, scenario, seenOf, show, useTemp,
} from './helpers.ts';

prebuild();
const temp = useTemp();
const D = DOC(1);
/** The value as the issue gives it, which the planted document's agent types. */
const TYPED = '11 rows drawn, x seconds 0 to 11, y metres 2 to 40, 1 missing';

describe(`${AC[1]} a mark set's node carries the value the core computes at check, and a typed value is refused`, () => {
  it(`${AC[1]} the fixture scatter's node has the value: 11 rows drawn, x seconds 0 to 11, y metres 2 to 40, 1 missing`, () => {
    const s = new Script();
    s.present(D, scatterDoc(D));
    const seen = s.see();
    const r = runShow(binOf(), scenario(temp(), [D], s.calls), 'AC1 the fixture scatter');
    presented(r[0]!, 'the fixture scatter, one row missing y');
    none(scatterValueFailures(nodeOf(seenOf(r[seen]!, 'see'), SCATTER), [2, 40], 'the scatter\'s node'), 'the scatter\'s node value');
  }, TIMEOUT);

  it(`${AC[1]} planted document: the agent typed a value for the node; the check refuses it, naming the item`, () => {
    const s = new Script();
    s.present(D, scatterDoc(D, { typedValue: TYPED }));
    const r = runShow(binOf(), scenario(temp(), [D], s.calls), 'AC1 the planted document with a typed value');
    const reply = r[0]!;
    expect(reply['outcome'], `the document whose agent typed the node's value is refused: ${show(reply['issues'] ?? reply, 2000)}`).not.toBe('presented');
    const naming = issuesOf(reply).filter((i) => i['severity'] === 'error' && namesItem(i, SCATTER) && String(i['path'] ?? '').startsWith(`items/${SCATTER}/value`));
    expect(naming.length, `an error at items/${SCATTER}/value names the item ${SCATTER}; the issues: ${show(issuesOf(reply), 2000)}`).toBeGreaterThan(0);
  }, TIMEOUT);
});

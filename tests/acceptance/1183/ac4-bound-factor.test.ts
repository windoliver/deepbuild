// #1183.162053d0 (AC4): "A disclosure template reading "drawn {factor}× larger than real" shows 200,000 from the
// document. A planted one typed as "200,000×" fails honest numbers, naming the item."
//
// Fixtures (helpers.ts, electronFigure). The electron figure's disclosure `disclosure`, an overlay.text@1 whose template
// is "drawn {factor}× larger than real" and which the driver `swing`'s `exaggerate {factor: 200000, disclose:
// disclosure}` names, so its slot `{factor}` is that factor. The planted twin `typed` has the template "drawn 200,000×
// larger than real": the same words with the factor typed in.
//
// asserts:
//   - the figure's honest-numbers row PASSes with nothing raised, and its `numbers` (every number the document shows,
//     with what it traces to) holds the number the disclosure shows, 200,000 (written with or without group marks),
//     traced to the driver: a string in its `source` is `swing` or starts `drivers/swing`;
//   - the twin's row FAILs with an error naming disclosure (its code isn't read; README: Codes).
// Wrong programs it fails: the base (an overlay's numbers aren't listed, a typed overlay passes); a template that shows
// its slot's name or another value; a check that reads only text@1 items.
import { describe, it } from 'vitest';
import {
  AC, FACTOR, TIMEOUT, brief, docId, electronFigure, errorNaming, isObject, judge, mentions, namesItem, none, passFailures, strings, useFolders,
  useShow, type Row,
} from './helpers.ts';

const bin = useShow();
const folder = useFolders();

/** The disclosure's number in the row's `numbers`: 200,000, traced to the driver swing. */
function shownFailures(row: Row | undefined): string[] {
  if (!row) return ['the electron figure has no honest-numbers row'];
  const numbers = Array.isArray(row.raw['numbers']) ? row.raw['numbers'].filter(isObject) : [];
  const own = numbers.filter((n) => namesItem(n['item'], 'disclosure'));
  const shown = own.filter((n) => typeof n['text'] === 'string' && Number(n['text'].replace(/[,   ]/g, '')) === FACTOR);
  if (!shown.length) return [`the row's numbers list no ${FACTOR.toLocaleString('en')} shown by disclosure: its entries are ${brief(own)} (all numbers: ${brief(numbers, 800)})`];
  const traced = shown.some((n) => strings(n['source']).some((s) => s === 'swing' || s.startsWith('drivers/swing')));
  return traced ? [] : [`the 200,000 disclosure shows doesn't trace to the driver swing's factor: ${brief(shown)}`];
}

describe(`${AC[4]} a disclosure's factor is bound, never typed`, () => {
  it(`${AC[4]} the template "drawn {factor}× larger than real" shows 200,000 from the document; typed as "200,000×" it fails honest numbers naming the overlay`, () => {
    const figs = [electronFigure(docId(1), 'none'), electronFigure(docId(2), 'typed')];
    const { judged } = judge(bin(), folder(), figs);
    const bound = judged[figs[0]!.name]?.row;
    const typed = judged[figs[1]!.name]?.row;
    none([
      ...passFailures(bound, 'the disclosure with a bound factor'),
      ...shownFailures(bound),
      ...errorNaming(typed, (i) => mentions(i, 'disclosure'), 'the overlay disclosure', 'the disclosure with the factor typed'),
    ], 'the disclosure\'s factor');
  }, TIMEOUT);
});

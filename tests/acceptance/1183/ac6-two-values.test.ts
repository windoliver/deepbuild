// #1183.285af30a (AC6): "In an assembly with `shown_at: 0.25`, a driver that maps a logic output in metres to a drawn
// offset of 0.25 × the output + 0.05 m passes, since the check reads the ratio at two values of the output; a planted
// check that reads it at one value refuses that driver and fails, naming the item; and the check's record over these
// fixtures is the same bytes on two runs."
//
// Fixtures (helpers.ts). The socket pop-up (`shown_at: 0.25`) with the driver `push` set to `0.25 * d + 0.05`, d the
// logic output `reach.depth` in metres (0.4 at every step, drawn 0.15 m). Worked out: at two values of d the drawn
// offset changes by 0.25 for each metre, ratio 0.25 = shown_at, declared; read at one value v it is (0.25 v + 0.05) ÷ v,
// 0.375 at the output's 0.4 m and above 0.25 at every v > 0, so a one-value reading refuses it. "These fixtures" is
// every figure of this suite's record: the electron figure and its undeclared twin, the socket at a quarter, at real
// size and with the 5 cm offset, and the gauge, so the record compared holds passing, refused and unchecked mappings.
//
// asserts:
//   - the offset driver's honest-numbers row PASSes with nothing raised; its `lengths` record holds drivers/push on plug
//     as `pass` at ratio 0.25;
//   - two `deep-show run` processes judging the six figures, same inputs, write the same bytes, each verdict's row
//     holding a `lengths` record with at least one entry;
//   - with `planted: length_ratio_one_value` (the check reads each mapping's ratio at one value of its output), that
//     row fails this pass check, a failure naming plug.
// Wrong programs it fails: the base; the planted one-value reading; a record that orders its entries by a hash map's
// seed or carries a time or a path of the run.
import { describe, expect, it } from 'vitest';
import {
  AC, PUSH, QUARTER, TIMEOUT, brief, docId, electronFigure, entryFailures, failsNaming, gaugeFigure, judge, lengthsOf, none, passFailures,
  socketFigure, useFolders, useShow, type Fig,
} from './helpers.ts';

const bin = useShow();
const folder = useFolders();
/** The planted check (README: Planted programs). */
const ONE_VALUE = 'length_ratio_one_value';
const offset = (): Fig => socketFigure(docId(1), PUSH.offset);
/** Its subject's words don't hold the item's ID, so a failure names `plug` only where the check's own output does. */
const WHAT = 'the offset driver (a quarter plus 5 cm)';

describe(`${AC[6]} the ratio is read at two values of the output`, () => {
  it(`${AC[6]} at shown_at 0.25 a driver drawing 0.25 × the output + 0.05 m passes, and the check's record over every fixture is the same bytes on two runs`, () => {
    const figs: Fig[] = [
      offset(), electronFigure(docId(2), 'none'), electronFigure(docId(3), 'undeclared'),
      socketFigure(docId(4), PUSH.quarter), socketFigure(docId(5), PUSH.real), gaugeFigure(docId(6)),
    ];
    const evidence = folder();
    const first = judge(bin(), evidence, figs);
    const second = judge(bin(), evidence, figs);
    const row = first.judged[figs[0]!.name]?.row;
    const failures = [...passFailures(row, WHAT), ...entryFailures(row, 'push', 'plug', 'pass', QUARTER, WHAT)];
    for (const f of figs) {
      const lengths = lengthsOf(first.judged[f.name]?.row);
      if (!lengths?.length) failures.push(`the verdict on ${f.name} holds no \`lengths\` record with an entry: ${brief(first.judged[f.name]?.row?.raw, 600)}`);
    }
    none(failures, 'the offset driver and the record');
    expect(second.stdout === first.stdout, `the two runs' bytes differ: first ${first.stdout.length} bytes, second ${second.stdout.length}`).toBe(true);
  }, TIMEOUT);

  it(`${AC[6]} a planted check that reads the ratio at one value refuses the offset driver and fails, naming the plug`, () => {
    const fig = offset();
    const row = judge(bin(), folder(), [fig], { planted: ONE_VALUE }).judged[fig.name]?.row;
    failsNaming(passFailures(row, WHAT), ['plug'], `the planted ${ONE_VALUE}`);
  }, TIMEOUT);
});

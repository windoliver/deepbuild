// #1183.c8624e05 (AC2): "In an assembly with `shown_at: 0.25`, a driver mapping a 0.4 m logic output to a 0.1 m drawn
// offset passes with no `exaggerate`. One mapping it to 0.4 m is refused, naming the item and the ratios 1 and 0.25."
//
// Fixtures (helpers.ts, socketFigure). The socket pop-up: in assembly `popup` (`shown_at: 0.25`) the socket and the plug
// `plug`, whose z the driver `push` sets from `reach.depth`, a logic output in metres that is 0.4 at every step.
// Worked out: `0.25 * d` draws 0.4 m as 0.1 m, ratio 0.25 = shown_at, declared; `d` draws it as 0.4 m, ratio 1, which
// is neither shown_at nor shown_at × a factor (it declares none).
//
// asserts:
//   - `0.25 * d`: the honest-numbers row PASSes with nothing raised; its `lengths` record holds drivers/push on plug as
//     `pass` at ratio 0.25;
//   - `d`: the row FAILs with a length.ratio_undeclared error naming plug, with ratio 1 and expected 0.25; the record
//     holds drivers/push on plug as `refused` at ratio 1.
// Wrong programs it fails: the base; a check that expects ratio 1 whatever shown_at says (refuses the quarter); one that
// reads shown_at as real ÷ drawn (refuses the quarter, expects 4).
import { describe, it } from 'vitest';
import { AC, PUSH, QUARTER, TIMEOUT, docId, entryFailures, judge, none, passFailures, refusedWith, socketFigure, useFolders, useShow } from './helpers.ts';

const bin = useShow();
const folder = useFolders();

describe(`${AC[2]} a pop-up drawn at a quarter of real size`, () => {
  it(`${AC[2]} at shown_at 0.25 a 0.4 m output drawn as 0.1 m passes with no exaggerate; drawn as 0.4 m it is refused naming the plug and the ratios 1 and 0.25`, () => {
    const figs = [socketFigure(docId(1), PUSH.quarter), socketFigure(docId(2), PUSH.real)];
    const { judged } = judge(bin(), folder(), figs);
    const quarter = judged[figs[0]!.name]?.row;
    const real = judged[figs[1]!.name]?.row;
    none([
      ...passFailures(quarter, 'the plug drawn at a quarter'),
      ...entryFailures(quarter, 'push', 'plug', 'pass', QUARTER, 'the plug drawn at a quarter'),
      ...refusedWith(real, 'plug', 1, QUARTER, 'the plug drawn at real size'),
      ...entryFailures(real, 'push', 'plug', 'refused', 1, 'the plug drawn at real size'),
    ], 'a pop-up drawn at a quarter of real size');
  }, TIMEOUT);
});

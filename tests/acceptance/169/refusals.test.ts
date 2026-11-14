// AC2 #169.2418fae7: "A slider sampled 65 times, a document with a status binding, and a piece with 65 states are each
// refused, naming the control, the binding or the controls that multiply"
//
// asserts, through `deep-show run` (README: The surface under test), each export into a fresh folder:
//   - the dial (a slider `dial` that moves a dot) exported with `video.page.sample: {control: dial, count: 65}` is
//     refused, its reply naming `dial`, nothing written;
//   - the plate whose fill the status binding `lamp_status` reads from the agent's verdict (shown from the agent's
//     tree, whose record holds the verdict: #162's world) is refused, its reply naming `lamp_status`, nothing written;
//     the same plate unbound exports, so a refusal of every plate fails the test;
//   - the grid (choices `ctl_rows` of 5 options and `ctl_cols` of 13, each moving one block: 65 states) is refused,
//     its reply naming both controls, nothing written.
// Wrong programs: the merge base, whose refusal (`unknown_target`) names none of these; an export that refuses every
// document fails at the unbound plate.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, BINDING, DOC, FULL, GRID, TIMEOUT, dialDoc, gridDoc, mentions, pageExport, pageReceiptOf, present, presented, refusedUnwritten, runShow,
  scenarioOf, show, statusDoc, useShow, useTemp, type JsonObject,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();

/** One run: the document shown (from the agent's tree with `agent`), then its page export into a fresh folder. */
function exportOnce(doc: string, document: JsonObject, what: string, o: { agent?: boolean; page?: JsonObject } = {}): { reply: JsonObject; out: string } {
  const out = join(temp(), 'page');
  const r = runShow(shows(FULL), scenarioOf({ evidence: temp(), docs: [doc], calls: [present(doc, document, { agent: o.agent ?? false }), pageExport(doc, out, o.page ? { page: o.page } : {})] }), what);
  presented(r[0], what);
  return { reply: r[1]!, out };
}

describe(`${AC[2]} a slider sampled 65 times, a status binding and a piece of 65 states are each refused, naming what`, () => {
  it(`${AC[2]} the dial sampled 65 times is refused, naming the control dial, and nothing is written`, () => {
    const { reply, out } = exportOnce(DOC.dial, dialDoc(), 'the dial sampled 65 times', { page: { sample: { control: 'dial', count: 65 } } });
    refusedUnwritten(reply, out, 'the dial sampled 65 times');
    expect(mentions(reply, 'dial'), `the refusal names the control dial: ${show(reply)}`).toBe(true);
  }, TIMEOUT);

  it(`${AC[2]} the plate with the status binding ${BINDING} is refused, naming the binding, and nothing is written; the unbound plate exports`, () => {
    const bound = exportOnce(DOC.status, statusDoc(true), 'the plate with a status binding', { agent: true });
    refusedUnwritten(bound.reply, bound.out, 'the plate with a status binding');
    expect(mentions(bound.reply, BINDING), `the refusal names the binding ${BINDING}: ${show(bound.reply)}`).toBe(true);
    const plain = exportOnce(DOC.plain, statusDoc(false), 'the unbound plate', { agent: true });
    pageReceiptOf(plain.reply, 'the unbound plate');
  }, TIMEOUT);

  it(`${AC[2]} the grid of 5 × 13 places, 65 states, is refused, naming both controls that multiply, and nothing is written`, () => {
    const { reply, out } = exportOnce(DOC.grid, gridDoc(), 'the grid of 65 states');
    refusedUnwritten(reply, out, 'the grid of 65 states');
    for (const c of [GRID.rows, GRID.cols]) expect(mentions(reply, c), `the refusal names the control ${c}: ${show(reply)}`).toBe(true);
  }, TIMEOUT);
});

// Criterion 7: "A bound value reading throughput over the last hour equals the count of sink records in that window at 20
// sampled times. A planted label typed as "46" fails honest numbers (#406), naming the item."
//
// Through `deep-show run` (#393's scenario; ../535/helpers.ts, imported unchanged) and `deep-logic first_party` and
// `playback` (README: The surface). The warehouse document (warehouse.ts) shows the readout `rate`: a text counter whose
// source is a driver reading `wh.thru[6]`, throughput in all over the window (README: Readings: "a bound value"). At 20
// sampled steps, 18,000 + 900j (model times 3,600.2 s to 7,020.2 s, every one past the first hour), `eval` gives the text
// the frame draws, and `playback` of the same logic item in deep-logic gives the sink records at that step: the count of
// records whose out time lies in [now − 3,600, now) must be the number the readout shows. The ring of 1,024 records holds
// every one of the window's (checked: its oldest record is older than the window, or it isn't full). The planted label:
// the same document with the readout's text typed as "46" is refused by honest numbers, `number_unsourced` naming `rate`,
// while the counter's document raises no such issue. The wrong programs this fails on: a throughput over another window
// or in other units, one stale by a step, a readout of the wrong element, and a check blind to a typed number.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, arr, logicBin, num, obj, onHost, prebuild as prebuildLogic, show, str, type JsonObject } from '../190/helpers.ts';
import { at, binOf, issuesOf, namesItem, prebuild, presented, putEvidence, runShow, scenario, showCall, useTemp } from '../535/helpers.ts';
import { AC, INTERFACE, carry, layout, processLib } from './helpers.ts';
import { warehouseProgram, warehouseWrites } from './programs.ts';
import { WAREHOUSE } from './scenes.ts';
import { ALL, DOC, LOGIC, READOUT, SPAN_STEPS, warehouseAtlas, warehouseDoc } from './warehouse.ts';

prebuildLogic(() => { logicBin(); });
prebuild(['full']);
const temp = useTemp();

/** The 20 sampled steps, all past the first hour of the model and inside the span. */
const SAMPLES = Array.from({ length: 20 }, (_, j) => 18_000 + 900 * j);
const WINDOW = 3600;

function setup() {
  const L = processLib();
  const writes = warehouseWrites(WAREHOUSE);
  const program = warehouseProgram(WAREHOUSE, INTERFACE, layout(writes));
  const ev = temp();
  putEvidence(ev, program.bytes);
  putEvidence(ev, Buffer.from(L.assets[L.ref.asset]!, 'base64'));
  const atlas = putEvidence(ev, warehouseAtlas());
  return { L, writes, program, ev, atlas };
}

describe(`${AC[7]} the warehouse's throughput readout, and a typed number`, () => {
  it(`${AC[7]} a bound value reading throughput over the last hour equals the count of sink records in that window at 20 sampled times`, () => {
    expect([SAMPLES.length, SAMPLES[0]! * WAREHOUSE.tick >= WINDOW, SAMPLES.at(-1)! < SPAN_STEPS], 'twenty steps, each past the model\'s first hour, inside the span').toEqual([20, true, true]);
    const { L, writes, program, ev, atlas } = setup();
    const id = DOC(1);
    const doc = warehouseDoc({ id, program, atlas, ref: L.ref, writes });
    const replies = runShow(binOf(), scenario(ev, [id], [showCall(id, doc), ...SAMPLES.map((k) => ({ call: 'eval', doc: id, t: at(k), texts: true }))]), 'the warehouse');
    presented(replies[0]!, 'the warehouse');
    expect(issuesOf(replies[0]!).filter((i) => i['code'] === 'number_unsourced'), 'the readout reads its number from the model: honest numbers raises nothing').toEqual([]);

    // The same logic item in deep-logic: its records at each sampled step.
    const logicItem = obj(obj(doc['items'], 'items')[LOGIC], LOGIC);
    const piece: JsonObject = { seed: doc['seed']!, items: { [LOGIC]: { kind: 'logic@1', params: logicItem['params']! } }, assets: carry({ ...L.assets }, program) };
    const [played] = onHost([{ call: 'playback', piece, steps: SAMPLES.at(-1)! + 1, at: SAMPLES }]);
    expect(played!['ok'], `playback of the warehouse's logic item: ${show(played)}`).toBe(true);
    const byStep = new Map(arr(played!['arrays'], 'playback.arrays').map((x) => { const o = obj(x, 'a step'); return [num(o['step'], 'step'), obj(o['arrays'], 'arrays')]; }));

    const rows = SAMPLES.map((k, j) => {
      const a = byStep.get(k)!;
      const now = num(arr(a[`${LOGIC}.clock`], 'clock')[0], 'clock[0]');
      const n = num(arr(a[`${LOGIC}.rec_n`], 'rec_n')[0], 'rec_n[0]');
      const ring = arr(a[`${LOGIC}.rec_t`], 'rec_t').map((x) => num(x, 'rec_t')).slice(0, Math.min(n, WAREHOUSE.ring));
      // In ticks, as the library keeps time (README: Time): records out at ticks [c − 18,000, c), c the ticks run.
      const tick = (t: number): number => Math.round(t / WAREHOUSE.tick), c = tick(now), from = c - tick(WINDOW);
      const count = ring.filter((t) => tick(t) >= from && tick(t) < c).length;
      const complete = n <= WAREHOUSE.ring || Math.min(...ring.map(tick)) < from;
      const thru = num(arr(a[`${LOGIC}.thru`], 'thru')[ALL], `thru[${ALL}]`);
      const reply = replies[1 + j]!;
      expect(reply['outcome'], `the frame at step ${k} is evaluated: ${show(reply)}`).toBe('evaluated');
      const text = str(obj(reply['texts'], `texts at step ${k}`)[READOUT], `the readout's text at step ${k}`);
      return { k, now, count, complete, thru, text, shown: Number(text.replace(/[\s  ,]/g, '')) };
    });
    console.log(`${AC[7]} the readout against the records: ${rows.map((r) => `${r.k}: ${r.text} / ${r.count}`).join(', ')}`);
    expect(rows.filter((r) => !r.complete).map((r) => r.k), 'the ring holds every record of each window').toEqual([]);
    expect(rows.filter((r) => r.shown !== r.count || Math.abs(r.thru - r.count) > 1e-9).map((r) => `step ${r.k} (${r.now} s): shows "${r.text}", thru ${r.thru}, ${r.count} records in the last hour`), 'at each sampled time the readout shows the count of sink records in the last hour').toEqual([]);
    expect(new Set(rows.map((r) => r.count)).size, 'the counts change over the samples, so a readout stuck at one value fails').toBeGreaterThan(1);
  }, TIMEOUT);

  it(`${AC[7]} a planted label typed as "46" fails honest numbers, naming the item`, () => {
    const { L, writes, program, ev, atlas } = setup();
    const [real, typed] = [DOC(2), DOC(3)];
    const replies = runShow(binOf(), scenario(ev, [real, typed], [
      showCall(real, warehouseDoc({ id: real, program, atlas, ref: L.ref, writes })),
      showCall(typed, warehouseDoc({ id: typed, program, atlas, ref: L.ref, writes, typed: '46' })),
    ]), 'the warehouse and its typed twin');
    expect(issuesOf(replies[0]!).filter((i) => i['code'] === 'number_unsourced'), 'the warehouse with its readout raises no number_unsourced').toEqual([]);
    const found = issuesOf(replies[1]!).filter((i) => i['code'] === 'number_unsourced');
    expect(found.some((i) => namesItem(i, READOUT)), `the typed "46" fails honest numbers, naming ${READOUT}: ${show(issuesOf(replies[1]!) as never)}`).toBe(true);
  }, TIMEOUT);
});

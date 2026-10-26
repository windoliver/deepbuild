// #382.ad26ea13: A document whose look maps fail to a different red than its host's, drawn on a return card, shows
// its status binding in the card look's fail color under one legend, and the status distance its data colors keep is
// the card look's.
// The document's own look maps fail to a cooler crimson 0.12 OKLab from the card's fail (#bf232b). Drawn on a return
// card (`host`, kind return_card, the card's look as `look`, the document's as `doc_look`) with its lamp's badge bound
// to a verdict in state fail: the status report says the host's look applies at the card's distance, the one mark
// reports and draws (the most common pixel inside its bounds) the card's fail color, and the legend names fail once,
// in the card's color, with no entry in the document's red. Then the distance: a lamp 0.08 from the card's fail
// (0.12 from the document's own) is accepted when the document is drawn on its own (`view3d` with its look) and
// refused on the card naming `lamp` and `fail`. At the base there is no host call; `--planted host_keeps_document_look`
// draws the card with the document's own status map and distance.
import { describe, expect, it } from 'vitest';
import {
  DISTANCE, STATES, STATUS, VERDICT, alongL, answered, toward, deltaEOk, distanceRefusal, film, frameAt, framesOf, fromHex, hex, look3, mode, readPng, requireGpu,
  run1, statusOf, useBin, useOut, writeJson, type JsonObject, type Rgb, type Startup,
} from './helpers.ts';

const bins = useBin();
const out = useOut();

const CARD_FAIL = fromHex(STATUS.fail);
/** The document's own fail red: 0.12 OKLab from the card's, a cooler crimson (moved along [0.3, 0, −1]: a little lighter, well away from yellow). */
const DOC_FAIL = toward(CARD_FAIL, 0.12, [0.3, 0, -1]);
const SAFE: Record<string, Rgb> = { block: [32, 192, 176], crate: [64, 128, 255], floor: [172, 172, 172] };
const docLook = (lamp: Rgb): JsonObject => look3('doc-382', { lamp, ...SAFE }, { status: { fail: hex(DOC_FAIL) } });
const CARD_LOOK: JsonObject = look3('card-382', {});
/** A lamp 0.12 lighter than the card's fail: clear of both reds and of every other status color. */
const CLEAR = alongL(CARD_FAIL, 0.12);
/** A lamp 0.08 lighter than the card's fail: inside the card's distance (and nearer fail than any other status color), 0.12 from the document's own red. */
const CLASH = alongL(CARD_FAIL, 0.08);

function onCard(startup: Startup): string[] {
  const bin = bins.bin();
  const path = writeJson(out(), 'doc.json', film('doc-382', { binding: true }));
  const reply = answered(run1(bin, out(), { call: 'host', kind: 'return_card', look: CARD_LOOK, size: [480, 360], doc: path, doc_look: docLook(CLEAR), states: { [VERDICT]: 'fail' }, frames: 1, targets: ['final'], capture: [0] }, startup), 'the document on a return card');
  const status = statusOf(reply, 'the document on a return card');
  const failures: string[] = [];
  if (!status.shows) failures.push('status.shows is false on a return card');
  if (status.look !== 'host') failures.push(`status.look is ${status.look}, not host`);
  if (status.distance === null || Math.abs(status.distance - DISTANCE) > 1e-9) failures.push(`the status distance is ${status.distance}, not the card look's ${DISTANCE}`);
  if (status.marks.length !== 1) failures.push(`${status.marks.length} marks, not the one binding`);
  const image = readPng(out(), frameAt(framesOf(reply, 'host'), 0, 'the card').final, 'frame 0\'s final frame');
  for (const m of status.marks) {
    if (m.state !== 'fail') failures.push(`the mark is in state ${m.state}, not fail`);
    if (hex(m.color) !== STATUS.fail) failures.push(`the mark reports ${hex(m.color)}, not the card look's fail ${STATUS.fail} (the document's own is ${hex(DOC_FAIL)})`);
    const inside = mode(image, (x, y) => x >= m.bounds[0] + 1 && x < m.bounds[0] + m.bounds[2] - 1 && y >= m.bounds[1] + 1 && y < m.bounds[1] + m.bounds[3] - 1);
    if (hex(inside.color) !== STATUS.fail) failures.push(`the mark's most common pixel is ${hex(inside.color)}, not the card look's fail ${STATUS.fail}`);
  }
  // One legend: each state at most once, every entry in the card's colors, fail among them.
  const seen = new Map<string, number>();
  for (const e of status.legend) seen.set(e.state, (seen.get(e.state) ?? 0) + 1);
  for (const [s, n] of seen) if (n > 1) failures.push(`the legend names ${s} ${n} times`);
  if (!seen.has('fail')) failures.push(`the legend has no fail entry (entries: ${status.legend.map((e) => e.state).join(', ') || 'none'})`);
  for (const e of status.legend) {
    if (!STATES.includes(e.state)) failures.push(`legend entry ${e.state} is not a state`);
    else if (hex(e.color) !== STATUS[e.state]) failures.push(`legend entry ${e.state} is ${hex(e.color)}, not the card look's ${STATUS[e.state]}`);
    if (deltaEOk(e.color, DOC_FAIL) < 0.01) failures.push(`legend entry ${e.state} shows the document's own red ${hex(DOC_FAIL)}`);
  }
  return failures;
}

describe('#382.ad26ea13 a document with its own fail red, on a return card, takes the card\'s fail color, legend and distance', () => {
  it('#382.ad26ea13 the two reds and the two lamps sit where the test needs them, by this suite\'s OKLab math', () => {
    expect(Math.abs(deltaEOk(DOC_FAIL, CARD_FAIL) - 0.12)).toBeLessThanOrEqual(0.0025);
    expect(deltaEOk(CLEAR, CARD_FAIL), 'the clear lamp keeps the card\'s distance').toBeGreaterThanOrEqual(DISTANCE + 0.01);
    expect(deltaEOk(CLEAR, DOC_FAIL), 'the clear lamp keeps the document\'s distance').toBeGreaterThanOrEqual(DISTANCE + 0.01);
    expect(deltaEOk(CLASH, CARD_FAIL), 'the clashing lamp is inside the card\'s distance').toBeLessThanOrEqual(DISTANCE - 0.01);
    expect(deltaEOk(CLASH, DOC_FAIL), 'the clashing lamp is outside the document\'s own distance').toBeGreaterThanOrEqual(DISTANCE + 0.01);
    for (const s of STATES) if (s !== 'fail') expect(deltaEOk(CLASH, fromHex(STATUS[s])), `the clashing lamp is farther from ${s} than from fail, so the refusal names fail`).toBeGreaterThanOrEqual(DISTANCE + 0.01);
    for (const s of STATES) expect(deltaEOk(CLEAR, fromHex(STATUS[s])), `the clear lamp keeps the distance from ${s}`).toBeGreaterThanOrEqual(DISTANCE + 0.01);
    for (const s of STATES) if (s !== 'fail') expect(deltaEOk(DOC_FAIL, fromHex(STATUS[s])), `the document's red is its own, ${DISTANCE} from ${s}`).toBeGreaterThanOrEqual(DISTANCE);
  });

  it('#382.ad26ea13 on the card the binding shows in the card look\'s fail color under one legend at the card\'s distance', () => {
    requireGpu();
    const failures = onCard({});
    expect(failures, failures.join('\n')).toEqual([]);
  }, 1_800_000);

  it('#382.ad26ea13 a planted host that keeps the document\'s own look fails, naming the mark\'s color', () => {
    requireGpu();
    const failures = onCard({ planted: 'host_keeps_document_look' });
    expect(failures.some((f) => /not the card look's fail/.test(f)), `the mutant draws the document's red: ${failures.join('\n')}`).toBe(true);
  }, 1_800_000);

  it('#382.ad26ea13 the data distance is the card\'s: a lamp 0.08 from the card\'s fail passes alone and is refused on the card', () => {
    requireGpu();
    const bin = bins.bin();
    const path = writeJson(out(), 'doc.json', film('doc-382', { binding: true }));
    const alone = run1(bin, out(), { call: 'view3d', doc: path, look: docLook(CLASH), size: [480, 360], states: { [VERDICT]: 'fail' } });
    answered(alone, 'the document drawn on its own, under its own look');
    expect(statusOf(alone, 'the document alone').shows, 'status can show in the document alone').toBe(true);
    const card = run1(bin, out(), { call: 'host', kind: 'return_card', look: CARD_LOOK, size: [480, 360], doc: path, doc_look: docLook(CLASH), states: { [VERDICT]: 'fail' }, frames: 1 });
    expect(distanceRefusal(card, 'lamp', 'fail', 'the document on a return card'), '').toEqual([]);
  }, 1_800_000);
});

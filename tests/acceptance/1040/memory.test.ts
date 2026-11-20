// AC8 #1040.fc164908: "A logic item whose momentary buttons A and B each set a private flag in its memory and write
// nothing, and whose Reveal press writes that flag to a readout, exports the paths A then release and B then release,
// which end at the same step with equal controls, globals and arrays, as two states whose Reveal successors show A and
// B, each still decoding to the raw frame hash the app renders at the end of that path; a page that keys logic by its
// step hash alone merges the two and fails this fixture"
//
// The piece (helpers.ts `memoryDoc`): momentary buttons A and B (`btn_a`, `btn_b`) and `reveal` (presses), read by the logic item
// `mem`, which keeps a private flag in memory and writes only `shown` on reveal; two marks show A or B.
// asserts:
//   - the fixture, in the app (deep-show's `logic` on each path, 180 steps): after A pressed and released and after B
//     pressed and released, mem's step hash at the last step is the same, and its full-state hashes at the last
//     checkpoint both runs share past the release differ; the app's stills (png_seq at 2.5 s) of the two ends are equal
//     and of their reveals differ;
//   - the piece exported as a page (#169's, 320 × 180 at 30 fps): from its start, A's press then release and B's press
//     then release (README: Momentary buttons) lead to two different states with equal controls; reveal from each leads
//     to two different states; and the four stills each decode to the raw frame hash of the app's still at the end of
//     its path;
//   - the planted `page_keys_logic_by_step_hash` (a logic item keyed by its step hash alone) merges the two ends and
//     fails this judgement, naming mem.
// Wrong programs: the merge base (its page lists no press, so no path A then release exists); the planted page.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FULL, MEMORY, REVEAL, TIMEOUT, appLogic, appStills, exportPage, failsNaming, follow, memoryDoc, none, pageExported, pressAndRelease, pressThenRelease,
  stillHash, useShow, useTemp, type JsonObject,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const PLANTED = 'page_keys_logic_by_step_hash';
const STEPS = 180;
const PATHS: Record<string, JsonObject[]> = {
  'A then release': pressAndRelease('btn_a'),
  'B then release': pressAndRelease('btn_b'),
  'A then release, then reveal': [...pressAndRelease('btn_a'), REVEAL],
  'B then release, then reveal': [...pressAndRelease('btn_b'), REVEAL],
};

let fixture: Map<string, string> | null = null;
/** The app's stills at the end of each path, once the fixture holds. */
function app(): Map<string, string> {
  if (fixture) return fixture;
  const evidence = temp();
  const doc = memoryDoc(evidence);
  const a = appLogic(shows(FULL), evidence, doc, MEMORY.logic, PATHS['A then release']!, STEPS, 'A then release');
  const b = appLogic(shows(FULL), evidence, doc, MEMORY.logic, PATHS['B then release']!, STEPS, 'B then release');
  expect(a.hashes[STEPS - 1], `the fixture: after A then release and B then release, ${MEMORY.logic}'s step hash at step ${STEPS} is the same (equal globals, arrays and occurrences)`).toBe(b.hashes[STEPS - 1]);
  const common = a.checkpoints.filter((c) => c.step > 60 && b.checkpoints.some((d) => d.step === c.step)).pop();
  expect(common, `the fixture: both runs hold a checkpoint past the release (A's at ${a.checkpoints.map((c) => c.step).join(', ')})`).toBeTruthy();
  expect(common!.hash, `the fixture: at step ${common!.step} their full-state hashes differ, by the flag in ${MEMORY.logic}'s memory`).not.toBe(b.checkpoints.find((d) => d.step === common!.step)!.hash);
  const stills = appStills(shows(FULL), evidence, doc, Object.entries(PATHS).map(([name, track]) => ({ name, track, range: { still: { t: '2.5s' } } })),
    { size: MEMORY.size, rate: MEMORY.rate }, temp(), 'the memory piece');
  expect(stills.get('A then release'), 'the fixture: the two ends draw alike').toBe(stills.get('B then release'));
  expect(stills.get('A then release, then reveal'), 'the fixture: their reveals draw apart').not.toBe(stills.get('B then release, then reveal'));
  fixture = stills;
  return stills;
}

/** What is wrong with the memory piece's page, following its manifest from its start. */
function pageFailures(planted?: string): string[] {
  const stills = app();
  const what = planted ? `the memory piece's page (planted ${planted})` : "the memory piece's page";
  const evidence = temp();
  const out = join(temp(), 'page');
  const m = pageExported(exportPage(shows(FULL), evidence, memoryDoc(evidence), out, { size: MEMORY.size, rate: MEMORY.rate }, what, planted), out, what);
  const a = pressThenRelease(m, m.start, 'btn_a');
  const b = pressThenRelease(m, m.start, 'btn_b');
  if (!a || !b) return [`${what}: no momentary press then release of ${a ? 'B' : 'A'} from its start ${m.start} (edges: ${m.edges.map((e) => `${e.from}-${e.control}->${e.to}`).slice(0, 12).join(', ')})`];
  const f: string[] = [];
  if (a.released === b.released) f.push(`${what}: A then release and B then release lead to one state ${a.released}: the page merges two states whose logic item ${MEMORY.logic}'s memory differs`);
  const [ca, cb] = [m.byId.get(a.released)!.controls, m.byId.get(b.released)!.controls];
  if (JSON.stringify(ca) !== JSON.stringify(cb)) f.push(`${what}: the two ends hold the controls ${JSON.stringify(ca)} and ${JSON.stringify(cb)}, not equal ones`);
  const [ra, rb] = [follow(m, a.released, 'reveal'), follow(m, b.released, 'reveal')];
  if (ra === null || rb === null) return [...f, `${what}: no edge reveal from ${ra === null ? a.released : b.released}`];
  if (ra === rb) f.push(`${what}: reveal leads to one state ${ra} after either path, so the successors don't show A and B apart, though ${MEMORY.logic}'s memory differs`);
  const ends: [string, string][] = [['A then release', a.released], ['B then release', b.released], ['A then release, then reveal', ra], ['B then release, then reveal', rb]];
  for (const [name, id] of ends) {
    const got = stillHash(out, m.byId.get(id)!.still, `${what}: state ${id}`);
    if (got !== stills.get(name)) f.push(`${what}: state ${id}, the end of ${name}, has a still that decodes to ${got}; the app renders ${String(stills.get(name))} there (${MEMORY.logic})`);
  }
  return f;
}

describe(`${AC[8]} a logic item's private flag keeps two pictures alike apart as two states`, () => {
  it(`${AC[8]} A then release and B then release end as two states with equal controls whose reveals show A and B, each still the app's at the end of its path`, () => {
    none(pageFailures(), "the memory piece's page");
  }, TIMEOUT);

  it(`${AC[8]} a planted page that keys logic by its step hash alone (${PLANTED}) merges the two and fails, naming ${MEMORY.logic}`, () => {
    failsNaming(pageFailures(PLANTED), MEMORY.logic, `the page keyed by ${MEMORY.logic}'s step hash alone`);
  }, TIMEOUT);
});

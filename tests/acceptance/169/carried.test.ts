// AC6 #169.a87c5184: "In a build without the logic and physics modules, a test canvas module whose checkpoint, held in
// the core's carried-state list, differs between two paths that end on the same picture and the same controls exports
// two states whose successors differ, each still decoding to the raw frame hash the app renders at the end of that
// path; a planted page that keys states by the picture and the controls alone merges the two and fails this fixture,
// naming the module"
//
// The build: `full,test-leave-out-logic,test-leave-out-physics,test-page-latch` (README: Cargo features). The latch
// figure (helpers.ts `latchDoc`) and its test canvas module test.latch (README: The test canvas module): from the start
// (knob off, reveal off), the path knob on, knob off ends on the same picture and the same controls with the latch's
// checkpoint set; revealing the latch tells the two apart.
//
// asserts:
//   - the build's sealed modules hold test.latch and neither logic nor physics;
//   - the fixture: the app's stills (png_seq still exports at 2 s on each path's input track, their raw frame hashes)
//     at the end of the empty path and of knob on, knob off are equal, and those after revealing the latch on each
//     differ; the app's carried-state list (`eval` with `carried: true`, README) at the two ends differs, in rows
//     owned by test.latch alone, which is the module a failure names;
//   - the page, following its manifest's edges: knob on then knob off from the start leads to a state that isn't the
//     start, with the same controls; reveal on from each of the two leads to two different states; and the stills of
//     the start, of that state and of their two successors each decode (BGRA8, BLAKE3) to the raw frame hash of the
//     app's still at the end of its path.
// The planted `page_keys_by_picture` (the scenario's `planted`: the page keys states by the picture and the controls
// alone) merges the two and fails, naming test.latch.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, LATCH, NO_LOGIC_NO_PHYSICS, TIMEOUT, appStills, arr, entry, failsNaming, fl, follow, isObject, latchDoc, manifestOf, none, obj, pageExport,
  pageReceiptOf, present, presented, runShow, scenarioOf, show, stillHash, str, useShow, useTemp, type JsonObject, type Path,
} from './helpers.ts';

const shows = useShow([NO_LOGIC_NO_PHYSICS]);
const temp = useTemp();

const KNOB_ON_OFF = [entry(0.5, 'knob', 'on', 0), entry(1.0, 'knob', 'off', 0)];
const REVEAL = entry(1.5, 'reveal', 'on', 0);
/** The two paths, and each with the latch revealed after it: names → input tracks. */
const PATHS = {
  start: [] as JsonObject[],
  'knob on, knob off': KNOB_ON_OFF,
  'start, then reveal': [REVEAL],
  'knob on, knob off, then reveal': [...KNOB_ON_OFF, REVEAL],
};
type Name = keyof typeof PATHS;
const NAMES = Object.keys(PATHS) as Name[];

let fixture: { stills: Map<string, string>; differing: string[] } | null = null;
/** The app's stills at the end of each path, and the owners whose carried-state rows differ at the ends of the two. */
function app(): { stills: Map<string, string>; differing: string[] } {
  if (!fixture) {
    const doc = latchDoc();
    const paths: Path[] = NAMES.map((name) => ({ name, track: PATHS[name], range: { still: { t: '2s' } } }));
    const stills = appStills(shows(NO_LOGIC_NO_PHYSICS), { evidence: temp(), doc: DOC.latch, document: doc }, paths, { size: LATCH.size, rate: LATCH.rate }, temp(), 'the latch figure');
    expect(stills.get('start'), 'the fixture: the two paths end on the same picture').toBe(stills.get('knob on, knob off'));
    expect(stills.get('start, then reveal'), 'the fixture: revealing the latch after each path draws apart').not.toBe(stills.get('knob on, knob off, then reveal'));
    const evals = (['start', 'knob on, knob off'] as Name[]).map((name): JsonObject => ({ call: 'eval', doc: DOC.latch, t: fl(2), track: PATHS[name], carried: true }));
    const r = runShow(shows(NO_LOGIC_NO_PHYSICS), scenarioOf({ evidence: temp(), docs: [DOC.latch], calls: [present(DOC.latch, doc), ...evals] }), "the latch figure's carried state");
    presented(r[0], 'the latch figure');
    const rows = (k: number): Map<string, string> => new Map(arr(obj(r[k], `eval at the end of path ${k}`)['carried'], `eval at the end of path ${k}: carried`).map((v, i) => {
      const o = obj(v, `carried[${i}]`);
      return [`${str(o['owner'], `carried[${i}].owner`)}\u0000${str(o['key'], `carried[${i}].key`)}`, str(o['hash'], `carried[${i}].hash`)];
    }));
    const [a, b] = [rows(1), rows(2)];
    const differing = [...new Set([...a.keys(), ...b.keys()].filter((k) => a.get(k) !== b.get(k)).map((k) => k.split('\u0000')[0]!))].sort();
    expect(differing, `the fixture: the app's carried-state list at the ends of the two paths differs in ${LATCH.module}'s rows alone: ${show([...a], 600)} against ${show([...b], 600)}`).toEqual([LATCH.module]);
    fixture = { stills, differing };
  }
  return fixture;
}

/** What is wrong with the latch figure's page, following its manifest from the start. */
function pageFailures(planted?: string): string[] {
  const { stills, differing } = app();
  const what = planted ? `the latch figure's page (planted ${planted})` : "the latch figure's page";
  const out = join(temp(), 'page');
  const r = runShow(shows(NO_LOGIC_NO_PHYSICS), scenarioOf({ evidence: temp(), docs: [DOC.latch], calls: [present(DOC.latch, latchDoc()), pageExport(DOC.latch, out, { size: LATCH.size, rate: LATCH.rate })], ...(planted ? { planted } : {}) }), what);
  presented(r[0], `${what}: the figure`);
  pageReceiptOf(r[1], what);
  const m = manifestOf(out, what);
  const module = differing.join(', ');
  const start = m.start;
  const on = follow(m, start, 'knob', 'on');
  const back = on === null ? null : follow(m, on, 'knob', 'off');
  if (back === null) return [`${what}: no edges knob on, then knob off, from its start ${start}`];
  const f: string[] = [];
  if (back === start) f.push(`${what}: knob on, knob off leads back to the start state ${start}: the page merges two states whose ${module} checkpoint differs`);
  if (JSON.stringify(m.byId.get(back)!.controls) !== JSON.stringify(m.byId.get(start)!.controls)) f.push(`${what}: the end of knob on, knob off holds the controls ${JSON.stringify(m.byId.get(back)!.controls)}, not the start's ${JSON.stringify(m.byId.get(start)!.controls)}`);
  const [afterStart, afterBack] = [follow(m, start, 'reveal', 'on'), follow(m, back, 'reveal', 'on')];
  if (afterStart === null || afterBack === null) return [...f, `${what}: no edge reveal on from ${afterStart === null ? start : back}`];
  if (afterStart === afterBack) f.push(`${what}: reveal on leads to the same state ${afterStart} after either path, so the successors of the two ends don't differ, though their ${module} checkpoint does`);
  const ends: [Name, string][] = [['start', start], ['knob on, knob off', back], ['start, then reveal', afterStart], ['knob on, knob off, then reveal', afterBack]];
  for (const [name, id] of ends) {
    const got = stillHash(out, m.byId.get(id)!.still, `${what}: state ${id}`);
    if (got !== stills.get(name)) f.push(`${what}: state ${id}, the end of ${name}, has a still that decodes to ${got}, the app renders ${String(stills.get(name))} there (${module})`);
  }
  return f;
}

describe(`${AC[6]} without logic and physics, a test module's checkpoint keeps two pictures alike apart as two states`, () => {
  it(`${AC[6]} the build without the logic and physics modules seals ${LATCH.module} and neither of them`, () => {
    const [reply] = runShow(shows(NO_LOGIC_NO_PHYSICS), scenarioOf({ evidence: temp(), docs: [], calls: [{ call: 'registry' }] }), 'the build\'s registry');
    const modules = arr(obj(reply, 'registry')['modules'], 'registry: modules').map((m) => (typeof m === 'string' ? m : isObject(m) ? String(m['name'] ?? '') : ''));
    expect(modules, `the build seals ${LATCH.module}`).toContain(LATCH.module);
    expect(modules.filter((m) => m === 'logic' || m === 'physics'), 'the build seals neither the logic nor the physics module').toEqual([]);
  }, TIMEOUT);

  it(`${AC[6]} the two ends are two states whose successors differ, each still equal to the app's at the end of its path`, () => {
    none(pageFailures(), "the latch figure's page");
  }, TIMEOUT);

  it(`${AC[6]} a planted page that keys states by the picture and the controls alone (page_keys_by_picture) merges the two and fails, naming ${LATCH.module}`, () => {
    failsNaming(pageFailures('page_keys_by_picture'), LATCH.module, 'the page keyed by the picture and the controls alone');
  }, TIMEOUT);
});

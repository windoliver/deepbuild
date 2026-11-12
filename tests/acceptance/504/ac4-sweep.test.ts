// #504.9b99950d: "A control swept across its range in a fixture replays identically from the input track, and the
// sweep finds a planted overlap that appears only below one setting"
//
// The fixture (`tongs()` below), a figure in metres, +Y up: a 0.2 m plate (assembly `frame`, the root), the bar
// `left` fixed on it over x −0.05 to 0, and the bar `right` in the assembly `jaw`, which slides on +X by its `value`.
// The slider `pitch` (0.004 to 0.02 m, default 0.012) sets the jaw's value to pitch − 0.012 through the driver
// `spread`, so the right bar spans x from pitch − 0.008 to pitch + 0.042: it passes into the left bar only below a
// pitch of 8 mm (as the design's lazy tongs did), 4 mm deep at the range's low end, and touches nothing at rest.
//
// asserts:
//   - the replay (`deep-motion eval`): an input track sweeps the pitch across its range, 0.004 to 0.02 m in 1 mm
//     steps, one entry every 0.1 s; the frames 0.05 s after each entry, evaluated in order, in reverse and in a
//     seeded shuffle, give every item's evaluated JSON identical at each time, and the right bar's x is its rest plus
//     pitch − 0.012 within 1e-12 m. The planted `assembly_value_from_previous_frame` (eval `planted`: an assembly's
//     value steps from the value the previous evaluated frame left) fails, naming a time;
//   - the sweep (`deep-show run`, #403's claim and `verdict`, #405's `geometry.audit` row): a definition auditing the
//     fixture with `scope: figure` and `sweeps: {pitch: 5}` FAILs, with a geometry.overlap error naming exactly the two
//     bars at `sweep: {control: pitch, value}` below 0.007 (past the 1 mm tolerance), and every error and warning is
//     such an overlap. The planted `sweep_poses_assemblies_at_rest` (the scenario's `planted`: the sweep steps the
//     control but poses every assembly at its rest value) passes it, so it fails this check, naming the bars.
import { describe, it } from 'vitest';
import {
  ALPHA, TIMEOUT, arr, box, brief, claimId, docId, entry, envelope, evalLines, failsNaming, fl, framesOf, isObject, itemPos, none, obj, presented,
  reqId, runShow, scenarioOf, agentShow, useBins, useFolders, type JsonObject, type V3,
} from './helpers.ts';

/** The criterion's ID: `#504.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#504.9b99950d';

const bin = useBins(['motion', 'show']);
const folder = useFolders();

const RIGHT_REST: V3 = [0.029, 0.02, 0];
function tongs(): JsonObject {
  return envelope('tongs', 'figure', [1280, 720], [
    { id: 'cam', kind: 'camera@1', params: { projection: 'perspective', target: [0, 0.02, 0], orbit: { azimuth: 0, elevation: 30, distance: 0.4 }, fov: 40 } },
    box('plate', [0, 0.005, 0], [0.2, 0.01, 0.06], 'muted', { parent: 'frame' }),
    box('left', [-0.025, 0.02, 0], [0.05, 0.02, 0.02], 'ink', { parent: 'frame' }),
    box('right', RIGHT_REST, [0.05, 0.02, 0.02], 'accent', { parent: 'jaw' }),
  ], {
    requires: { modules: { scene3d: '^1', motion: '^1', input: '^1' } },
    transport: { span: '2s', frame_rate: [60, 1] },
    assemblies: {
      frame: { parent: null, at: { pos: [0, 0, 0] }, apart: [0, 0, 0], order: 0, value: 0 },
      jaw: { parent: 'frame', at: { pos: [0, 0, 0] }, motion: { kind: 'slide', axis: [1, 0, 0], range: [-0.008, 0.008] }, apart: [0, 0, 0], order: 1, value: 0 },
    },
    controls: { pitch: { kind: 'slider', class: 'document', label: 'Pitch', role: 'slider', range: [0.004, 0.02], default: 0.012, increment: 0.001 } },
    drivers: { spread: { target: 'assemblies/jaw/value', expr: 'p - 0.012', vars: { p: 'controls/pitch/value' } } },
  });
}

// ---- The replay

const PITCHES = Array.from({ length: 17 }, (_, k) => Math.round((0.004 + 0.001 * k) * 1e6) / 1e6);
const TRACK = PITCHES.map((p, k) => entry(0.1 * (k + 1), 'pitch', p));
const TIMES = PITCHES.map((_, k) => fl(0.1 * (k + 1) + 0.05));
/** A seeded order (mulberry32), so a failing run replays. */
function shuffled<T>(list: readonly T[], seed: number): T[] {
  let a = seed >>> 0;
  const rand = (): number => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j]!, out[i]!]; }
  return out;
}

function replayFailures(planted?: string): string[] {
  const orders = [TIMES, [...TIMES].reverse(), shuffled(TIMES, 504)];
  const answers = evalLines(bin('motion'), orders.map((times) => ({ doc: tongs(), times, track: TRACK, ...(planted ? { planted } : {}) })));
  const byTime = orders.map((times, i) => new Map(framesOf(answers[i]!, times, `the sweep's replay, order ${i}`).map((f) => [f.t, f])));
  const failures: string[] = [];
  TIMES.forEach((t, k) => {
    const [a, b, c] = byTime.map((m) => m.get(t)!);
    for (const [other, name] of [[b!, 'in reverse'], [c!, 'shuffled']] as const) {
      if (JSON.stringify(other.items) !== JSON.stringify(a!.items)) failures.push(`the frame at ${t} flicks evaluated ${name} differs from the same frame played in order: ${brief(other.items, 400)} against ${brief(a!.items, 400)}`);
    }
    const x = itemPos(a!, 'right', `the replay at ${t} flicks`)[0];
    const want = RIGHT_REST[0] + PITCHES[k]! - 0.012;
    if (Math.abs(x - want) > 1e-12) failures.push(`the frame at ${t} flicks puts the right bar at x ${x}, not ${want} for the pitch ${PITCHES[k]} its entry recorded`);
  });
  return failures;
}

// ---- The sweep

const DOC = docId(41);
const CLAIM = claimId(41);
const REQ = reqId(41);
const AUDIT: JsonObject = { kind: 'geometry.audit', scope: 'figure', tolerance: { sunk: 0.001, touch: 0.001, land: 0.001 }, sweeps: { pitch: 5 }, support: { floating: ['plate'] } };

function sweepFailures(planted?: string): string[] {
  const replies = runShow(bin('show'), scenarioOf({
    evidence: folder(), panels: { main: [0, 0, 1280, 720] }, docs: { [DOC]: { panel: 'main' } },
    claims: { [CLAIM]: { session: ALPHA.id, deliverables: [DOC], requirements: [{ id: REQ, check: AUDIT }] } },
    calls: [agentShow(DOC, tongs()), { call: 'verdict', claim: CLAIM }], ...(planted ? { planted } : {}),
  }), `the sweep${planted ? ` (planted ${planted})` : ''}`);
  presented(replies[0]!, 'the tongs');
  const rows = arr(obj(replies[1], 'the verdict')['requirements'], 'the verdict: requirements').filter(isObject);
  const row = rows.find((r) => r['id'] === REQ);
  if (!row) return [`the verdict has no row for the sweep's requirement: ${brief(replies[1]!)}`];
  const failures: string[] = [];
  if (row['result'] !== 'FAIL') failures.push(`the sweep of the pitch is ${String(row['result'])}, not FAIL: ${brief(row)}`);
  const field = (i: JsonObject, k: string): JsonObject[string] | undefined => (k in i ? i[k] : isObject(i['actual']) ? i['actual'][k] : undefined);
  const raised = arr(row['issues'] ?? [], 'the row: issues').filter(isObject).filter((i) => i['severity'] === 'error' || i['severity'] === 'warning');
  const isFound = (i: JsonObject): boolean => {
    const ids = arr(field(i, 'ids') ?? [], 'ids').map((s) => String(s).split('#')[0]).sort();
    const sweep = field(i, 'sweep');
    const value = isObject(sweep) ? sweep['value'] : undefined;
    return i['code'] === 'geometry.overlap' && i['severity'] === 'error' && ids.join() === 'left,right' && isObject(sweep) && sweep['control'] === 'pitch' && typeof value === 'number' && value >= 0.004 - 1e-12 && value < 0.007;
  };
  if (!raised.some(isFound)) failures.push(`the sweep finds no geometry.overlap error naming the bars left and right at a pitch below 0.007: ${brief(raised)}`);
  for (const i of raised.filter((x) => !isFound(x))) failures.push(`the sweep raises ${String(i['code'])} (${String(i['severity'])}), not the bars' overlap below 8 mm: ${brief(i, 600)}`);
  return failures;
}

describe(`${ID} a control swept across its range replays identically from the input track, and the sweep finds the overlap below one setting`, () => {
  it(`${ID} the pitch swept across its range on the input track replays identically in any order, the jaw where each entry puts it; a planted value that steps from the previous frame fails, naming a time`, () => {
    none(replayFailures(), 'the sweep replays identically from the input track');
    failsNaming(replayFailures('assembly_value_from_previous_frame'), ['flicks'], 'the planted value that steps from the previous frame');
  }, TIMEOUT);

  it(`${ID} the definition's sweep of the pitch fails, naming the two bars and a pitch below 8 mm; a planted sweep that poses the assemblies at rest passes it, naming the bars`, () => {
    none(sweepFailures(), 'the sweep finds the overlap below 8 mm');
    failsNaming(sweepFailures('sweep_poses_assemblies_at_rest'), ['left and right'], 'the planted sweep that poses the assemblies at rest');
  }, TIMEOUT);
});

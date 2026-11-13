// #504.86e6ed7d: "With a stages control whose three stages target the lamp, the sofa and the window, a click on the
// lamp appends one entry and makes the lamp stage current without selecting the lamp or opening its panel; Tab then
// Enter on the sofa appends the sofa's entry; the accessibility tree lists three buttons named by the stage labels;
// and a click on the wall appends nothing"
//
// The fixture (`room()` below): a 3D room in metres seen from the front through an orthographic camera (target
// (0, 1.25, 0), the eye on +Z, 8 m across an 800 × 450 panel): a floor, the back wall, the window on it, the lamp and
// the sofa. The document-class stages control `room` (label "Room tour", role group, default `window`) has the stages
// lamp, sofa and window, labelled Lamp, Sofa and Window, each with a stage shot holding the room's own pose (so the
// view never moves under the pointer), and `targets: {lamp: lamp, sofa: sofa, window: window}`. Click points are the
// lamp's and a bare stretch of the wall's centres, projected through the camera the panel's scope reports. The
// scenario runs on #383's virtual clock (every call at its `at`), the inputs 0.1 to 0.4 s apart.
//
// asserts, through `deep-show run` (#383's `input` and `scope`, #376's `see`, #493's `eval` with `film`):
//   - a click on the lamp (down, up): the two inputs append exactly one entry between them, `{control: room, value:
//     lamp, writer: you}` (`input`'s `appended`); after it the scope selects nothing and opens no panel (`selection`
//     empty, `details` null); the document evaluated after that entry, before the next, has its camera on `lamp-shot`
//     (`film.cameras.cam.shot`), the lamp stage's shot;
//   - Tab, pressed as many times as puts the scope's `focus` on the sofa (found in a first run, at most 8), then
//     Return (the scope's name for the Enter key): the Tabs append nothing, the Return exactly one entry `{control:
//     room, value: sofa, writer: you}`; evaluated after it the camera is on `sofa-shot`;
//   - `see`: exactly three nodes with role button named by the stage labels, Lamp, Sofa and Window, one each;
//   - a click on the wall, away from the window: no entry.
// The planted `pick_selects_item` (the scenario's `planted`: a pick on a target also selects the item and opens its
// panel, as a click on any item does) fails, naming the selection.
import { describe, expect, it } from 'vitest';
import {
  FLICKS, TIMEOUT, arr, box, brief, cross, docId, dot, envelope, failsNaming, fl, isObject, none, num, obj, present, presented, rad, runShow, scenarioOf,
  sub, unit, useBins, useFolders, v3, type JsonObject, type JsonValue, type V3,
} from './helpers.ts';

/** The criterion's ID: `#504.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#504.86e6ed7d';

const bin = useBins(['show']);
const folder = useFolders();

const DOC = docId(61);
const PANEL: [number, number, number, number] = [0, 0, 800, 450];
const POSE: JsonObject = { target: [0, 1.25, 0], orbit: { azimuth: 0, elevation: 0, distance: 10 }, view_width: 8 };
const LABELS: Record<string, string> = { lamp: 'Lamp', sofa: 'Sofa', window: 'Window' };
/** Each item's centre in metres; the wall's is a bare stretch of it, left of the window and above the sofa. */
const CENTRES: Record<string, V3> = { lamp: [-2.6, 0.7, -0.8], sofa: [-0.3, 0.4, -0.6], window: [2.2, 1.6, -1.42], wall: [1.0, 2.2, -1.5] };

function room(): JsonObject {
  const stages: JsonObject = {};
  const shots: JsonObject = {};
  for (const [id, label] of Object.entries(LABELS)) {
    stages[id] = { label, shot: `${id}-shot` };
    shots[`${id}-shot`] = { camera: 'cam', move: 'hold', ...POSE };
  }
  return envelope('room', 'figure', [800, 450], [
    { id: 'cam', kind: 'camera@1', params: { projection: 'orthographic', ...POSE } },
    box('floor', [0, -0.05, 0], [8, 0.1, 3], 'muted'),
    box('wall', [0, 1.25, -1.5], [8, 2.5, 0.1], 'raised'),
    box('window', CENTRES['window']!, [1.2, 0.8, 0.05], 'accent'),
    box('lamp', CENTRES['lamp']!, [0.4, 1.4, 0.4], 'ink'),
    box('sofa', CENTRES['sofa']!, [2.0, 0.8, 0.8], 'session_readout'),
  ], {
    requires: { modules: { scene3d: '^1', motion: '^1', input: '^1' } },
    transport: { span: '60s', frame_rate: [60, 1] },
    controls: { room: { kind: 'stages', class: 'document', label: 'Room tour', role: 'group', default: 'window', stages, targets: { lamp: 'lamp', sofa: 'sofa', window: 'window' } } },
    shots,
  });
}

/** A point in the room projected into the panel through the camera the scope reports (Camera camera@1's projector: the
 * field of view spans the wider side, an orthographic view width the panel's width). */
function screenOf(camera: JsonObject, rect: number[], p: V3): [number, number] {
  const position = v3(camera['position'], 'scope camera.position');
  const forward = unit(sub(v3(camera['target'], 'scope camera.target'), position));
  const right = unit(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const d = sub(p, position);
  const [x, y, z] = [dot(d, right), dot(d, up), dot(d, forward)];
  const [w, h] = [rect[2]!, rect[3]!];
  const fov = typeof camera['fov'] === 'number' ? camera['fov'] : 0;
  const s = fov > 0 ? Math.max(w, h) / 2 / Math.tan(rad(fov) / 2) / z : w / num(camera['view_width'], 'scope camera.view_width');
  return [rect[0]! + w / 2 + x * s, rect[1]! + h / 2 - y * s];
}

/** The calls of one run on the virtual clock, each at its `at`. */
class Calls {
  readonly list: JsonObject[] = [];
  private t = fl(1);
  private add(c: JsonObject, gapMs: number): void { this.t += Math.round((gapMs * FLICKS) / 1000); this.list.push({ ...c, at: this.t }); }
  constructor() { this.list.push(present(DOC, room(), this.t)); this.scope(); }
  scope(): void { this.add({ call: 'scope', panel: 'main' }, 50); }
  input(event: JsonObject, gapMs: number): void { this.add({ call: 'input', panel: 'main', event }, gapMs); }
  click(p: [number, number]): void { this.input({ type: 'down', pos: p }, 400); this.input({ type: 'up', pos: p }, 60); }
  key(key: string): void { this.input({ type: 'key', key }, 200); }
  see(): void { this.add({ call: 'see', panel: 'main' }, 50); }
  eval(t: number): void { this.add({ call: 'eval', doc: DOC, t, film: true }, 50); }
}
const CLOCK: JsonObject = { refresh_hz: 60, lead: 0, check: 0 };
const run = (c: Calls, what: string, planted?: string): JsonObject[] =>
  runShow(bin('show'), scenarioOf({ evidence: folder(), panels: { main: PANEL }, docs: { [DOC]: { panel: 'main' } }, clock: CLOCK, calls: c.list, ...(planted ? { planted } : {}) }), what);

interface Entry { t: JsonValue | undefined; control: JsonValue | undefined; value: JsonValue | undefined; writer: JsonValue | undefined }
/** The entries an input appended to the document's input track (`input`'s `appended`). */
function appended(reply: JsonObject, what: string): Entry[] {
  return arr(reply['appended'], `${what}: appended`).map((e, i) => { const o = obj(e, `${what}: appended[${i}]`); return { t: o['t'], control: o['control'], value: o['value'], writer: o['writer'] }; });
}
const isEntry = (list: Entry[], value: string): boolean => list.length === 1 && list[0]!.control === 'room' && list[0]!.value === value && list[0]!.writer === 'you';
const listed = (list: Entry[]): string => brief(list.map((e) => ({ control: e.control ?? null, value: e.value ?? null, writer: e.writer ?? null, t: e.t ?? null })));
const stateOf = (reply: JsonObject, what: string): JsonObject => obj(reply['state'], `${what}: state`);

/** The scope's camera and rect after presenting, and the click points of the lamp and the wall. */
function points(): { lamp: [number, number]; wall: [number, number] } {
  const r = run(new Calls(), 'the room, presented');
  presented(r[0]!, 'the room');
  const s = stateOf(r[1]!, 'the scope');
  const camera = obj(s['camera'], 'the scope: camera');
  const rect = arr(s['rect'], 'the scope: rect').map((v) => num(v, 'rect'));
  const p = { lamp: screenOf(camera, rect, CENTRES['lamp']!), wall: screenOf(camera, rect, CENTRES['wall']!) };
  for (const [name, q] of Object.entries(p)) expect(q[0] > rect[0]! && q[0] < rect[0]! + rect[2]! && q[1] > rect[1]! && q[1] < rect[1]! + rect[3]!, `the ${name} projects into the panel: ${brief(q)}`).toBe(true);
  return p;
}

/** How many Tabs after the lamp's click put the scope's `focus` on the sofa, within 8. */
function tabsToSofa(lamp: [number, number]): number {
  const c = new Calls();
  c.click(lamp);
  for (let k = 0; k < 8; k++) { c.key('Tab'); c.scope(); }
  const r = run(c, 'Tab after the lamp');
  const foci = Array.from({ length: 8 }, (_, k) => stateOf(r[5 + 2 * k]!, `the scope after Tab ${k + 1}`)['focus'] ?? null);
  const k = foci.findIndex((f) => f === 'sofa');
  expect(k, `Tab puts the scope's focus on the sofa within 8 presses; the focus after each: ${brief(foci)}`).toBeGreaterThanOrEqual(0);
  return k + 1;
}

/** The criterion's run: the lamp's click, Tabs to the sofa and Return, the wall's click and `see`; then, run again with
 * a frame evaluated after each entry, the stage each makes current. */
function pickFailures(p: { lamp: [number, number]; wall: [number, number] }, tabs: number, planted?: string): string[] {
  const what = planted ? `the planted picks (${planted})` : 'the picks';
  const calls = (): Calls => {
    const c = new Calls();
    c.click(p.lamp); c.scope();
    for (let k = 0; k < tabs; k++) c.key('Tab');
    c.key('Return'); c.click(p.wall); c.see();
    return c;
  };
  const r = run(calls(), what, planted);
  presented(r[0]!, `${what}: the room`);
  const failures: string[] = [];
  const lamp = [...appended(r[2]!, "the lamp's press"), ...appended(r[3]!, "the lamp's release")];
  if (!isEntry(lamp, 'lamp')) failures.push(`${what}: the click on the lamp appends ${listed(lamp)}, not one entry {control: room, value: lamp, writer: you}`);
  const s = stateOf(r[4]!, 'the scope after the lamp');
  const selection = arr(s['selection'], 'the scope: selection');
  if (selection.length) failures.push(`${what}: the click on the lamp leaves the selection ${brief(selection)}, not empty`);
  if (s['details'] !== null && s['details'] !== undefined) failures.push(`${what}: the click on the lamp opens the panel of ${brief(s['details'])}`);
  const tabbed = r.slice(5, 5 + tabs).flatMap((x, k) => appended(x, `Tab ${k + 1}`));
  if (tabbed.length) failures.push(`${what}: Tab appends ${listed(tabbed)}; moving the focus appends nothing`);
  const sofa = appended(r[5 + tabs]!, 'Return on the sofa');
  if (!isEntry(sofa, 'sofa')) failures.push(`${what}: Return on the sofa appends ${listed(sofa)}, not one entry {control: room, value: sofa, writer: you}`);
  const wall = [...appended(r[6 + tabs]!, "the wall's press"), ...appended(r[7 + tabs]!, "the wall's release")];
  if (wall.length) failures.push(`${what}: the click on the wall appends ${listed(wall)}`);
  const tree = arr(obj(r[8 + tabs], 'see')['tree'], 'see: tree').filter(isObject);
  const named = tree.filter((n) => n['role'] === 'button').map((n) => String(n['name'])).filter((b) => Object.values(LABELS).includes(b)).sort();
  if (JSON.stringify(named) !== JSON.stringify(['Lamp', 'Sofa', 'Window'])) failures.push(`${what}: the accessibility tree's buttons named by the stage labels are ${brief(named)}, not Lamp, Sofa and Window once each`);
  // The stage each entry makes current: the document's camera on that stage's shot, in a frame after the entry.
  const [tl, ts] = [lamp[0]?.t, sofa[0]?.t];
  if (isEntry(lamp, 'lamp') && isEntry(sofa, 'sofa') && typeof tl === 'number' && typeof ts === 'number' && ts > tl) {
    const c = calls();
    c.eval(tl + Math.min(fl(0.9), Math.floor((ts - tl) / 2)));
    c.eval(ts + fl(0.9));
    const e = run(c, `${what}, then a frame after each entry`, planted).slice(-2);
    ['lamp', 'sofa'].forEach((stage, k) => {
      const cameras = obj(obj(e[k], `the frame after the ${stage} entry`)['film'], `the frame after the ${stage} entry: film`)['cameras'];
      const cam = isObject(cameras) ? cameras['cam'] : undefined;
      const shot = isObject(cam) ? cam['shot'] : undefined;
      if (shot !== `${stage}-shot`) failures.push(`${what}: after the ${stage} entry the camera is on ${brief(shot ?? null)}, not the ${stage} stage's shot ${stage}-shot`);
    });
  } else {
    failures.push(`${what}: the lamp's and the sofa's entries carry no increasing flick times (${brief(tl ?? null)}, ${brief(ts ?? null)}), so no frame after each can show its stage current`);
  }
  return failures;
}

describe(`${ID} a stages control picks its stage from the scene by click and by keyboard, as buttons, and nothing else`, () => {
  it(`${ID} a click on the lamp appends one entry and makes the lamp current, selecting nothing; Tab then Enter on the sofa appends its entry; three buttons named Lamp, Sofa and Window; the wall appends nothing; a planted pick that selects fails, naming the selection`, () => {
    const p = points();
    const tabs = tabsToSofa(p.lamp);
    none(pickFailures(p, tabs), 'the picks from the scene');
    failsNaming(pickFailures(p, tabs, 'pick_selects_item'), ['selection'], 'the planted pick that also selects the item');
  }, TIMEOUT);
});

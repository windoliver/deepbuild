// AC6 #2053.a3831a78: "Every fixture of #2031 and every 2D fixture already in the repo, none of which names a `normal`,
// draws a frame byte-identical to the merge base"
//
// The merge base is `git merge-base HEAD origin/main` (else `main`); its tree is exported and its own
// `deep-canvas-render` and `deep-gpu` built there by #2031's `useMergeBase` (kept under
// `<target>/acceptance-2031-base`), the checkout's as every file here builds them. The fixtures:
//   - "every fixture of #2031": the documents #2031's suite draws, rebuilt here from its helpers with the values its
//     tests write (its tests build them in code; no file holds them): `lit-falloff` (AC1), `lit-a`, `lit-b` and
//     `lit-both` (AC2), `lit-default` (AC3), `lit-interface` with its verdict pinned `pass` (AC4), `lit-drift` (AC5),
//     `lights-sixteen` (AC6's accepted document) and `lit-budget` (AC8's lit side), and each one's twin with the group's
//     `light` removed where #2031's tests draw that twin (AC3, AC4, AC8);
//   - "every 2D fixture already in the repo": every file under a `fixtures/parity/2d/` folder in the merge base's tree,
//     as #2031's AC7 reads them (its `parityFixtures`), leaving out and printing any that names a `light`'s `height` or
//     an image's `normal`.
// Each is drawn with the same inputs by both sides at 0 and 1 s, by every surface #2031's AC7 compares (its
// `framesOf`): `raster` (Vello CPU), `window2d` and `layers` by GPUI, the GPU layer and Vello CPU, with each layer's draw
// path. Each picture must be byte-identical (the same SHA-256 of its PNG) to the merge base's and a refusal the same
// refusal. A fixture the merge base draws no picture of can't be judged: the test then fails INCONCLUSIVE, naming it,
// after every other comparison holds (README: Readings).
// Wrong programs: a page read where there is none (a default flat page that moves a pixel), a height read by an image
// with no page, a lit pass changed for every lit group, a draw path moved for lit layers.
import { mkdirSync } from 'node:fs';
import { describe, it } from 'vitest';
import {
  AC, framesOf, group, inconclusive, item, keyed, LOOK, none, parityFixtures, rect, requireMetal, unlitTwin, useBin, useDir, useMergeBase, WHITE,
  type JsonObject,
} from './helpers.ts';
import { doc, light, type Light } from '../2031/helpers.ts';

const ID = AC[6];
const head = { canvas: useBin('deep-canvas-render'), gpu: useBin('deep-gpu') };
const base = useMergeBase();
const dir = useDir();

/** #2031's documents, with the states each is drawn under. */
function fixtures2031(): { name: string; doc: JsonObject; states: JsonObject }[] {
  const plain = (name: string, d: JsonObject, states: JsonObject = {}): { name: string; doc: JsonObject; states: JsonObject } => ({ name: `#2031 ${name}`, doc: d, states });
  const sheet = (id: string, size: [number, number], lit: JsonObject, extra: JsonObject[] = [], envelope: JsonObject = {}): JsonObject =>
    doc(id, size, [group('lamps', 'a0', lit), rect('sheet', 'a1', [0, 0, ...size], 'lamps'), ...extra], envelope);
  const e = 625 / 1024;
  const pairs: Light[][] = [[{ at: [68.5, 64.5], energy: e, range: 100 }], [{ at: [188.5, 64.5], energy: e, range: 100 }], [{ at: [68.5, 64.5], energy: e, range: 100 }, { at: [188.5, 64.5], energy: e, range: 100 }]];
  const roles = [WHITE, 'accent', 'focus'];
  const driftChannels: JsonObject = {};
  const drift: Light[] = Array.from({ length: 8 }, (_, k) => {
    const at = `items/lamps/params/light/lights/${k}`;
    driftChannels[`light-${k}-x`] = keyed(`${at}/at/0`, [[0, 20 + 40 * k], [6, 300 - 40 * k]]);
    driftChannels[`light-${k}-y`] = keyed(`${at}/at/1`, [[0, 30 + 15 * k], [6, 150 - 10 * k]]);
    driftChannels[`light-${k}-energy`] = keyed(`${at}/energy`, [[0, 0.2 + 0.05 * k], [3, 0.9 - 0.05 * k], [6, 0.3]]);
    return { at: [20 + 40 * k, 30 + 15 * k], energy: 0.2 + 0.05 * k, range: 90 };
  });
  const verdict = 'verdict:01JB2031000000000000000001';
  const lighting = doc('lit-interface', [480, 200], [
    group('lamps', 'a0', { ambient: 0.25, lights: [] }),
    item('badge', 'rect@1', 'a1', { box: [24, 24, 120, 40] }, { parent: 'lamps' }),
    item('label', 'text@1', 'a2', { text: 'Menu', font: 'body', size: 24, box: { w: 140, h: 40 }, autosize: 'none', paint: { fill: { role: 'accent' } }, unlit: true }, { parent: 'lamps', at: { pos: [24, 120, 0] } }),
    rect('sheet', 'a3', [200, 120, 120, 56], 'lamps'),
    item('swatch', 'rect@1', 'a4', { box: [360, 136, 96, 40], paint: { fill: { gradient: { kind: 'linear', stops: [{ at: 0, role: WHITE }, { at: 0.5, role: 'accent' }, { at: 1, role: 'focus' }] } } } }),
  ], { status_bindings: { 'badge-state': { target: 'items/badge/params/paint/fill', source: verdict } } });
  const budgetLights: Light[] = Array.from({ length: 16 }, (_, k) => ({ at: [240 + 480 * (k % 4), 135 + 270 * Math.floor(k / 4)], energy: 0.5, range: 400 }));
  const budget = doc('lit-budget', [1920, 1080], [
    group('lamps', 'a0', { lights: budgetLights.map((l, k) => light(l, roles[k % roles.length])) }),
    rect('sheet', 'a1', [0, 0, 1920, 1080], 'lamps'),
    item('tick', 'rect@1', 'a2', { box: [0, 0, 8, 8], paint: { fill: { role: 'accent' } } }),
  ], { transport: { span: '2s' }, channels: { 'tick-x': keyed('items/tick/params/box/0', [[0, 0], [2, 1900]]) } });
  const sixteen = doc('lights-sixteen', [320, 180], [
    group('lamps', 'a0', { ambient: 0.25, lights: Array.from({ length: 16 }, (_, k) => light({ at: [10 + 18 * k, 90], energy: 0.5, range: 60 })) }),
    rect('sheet', 'a1', [0, 0, 320, 180], 'lamps'),
    group('tray', 'a2', undefined, { parent: 'lamps' }),
    rect('chip', 'a3', [20, 20, 40, 40], 'tray', 'accent'),
  ]);
  const fallen = sheet('lit-default', [160, 96], {});
  return [
    plain('lit-falloff', sheet('lit-falloff', [512, 512], { ambient: 0, lights: [light({ at: [256, 256], energy: 1, range: 200 })] })),
    ...pairs.map((ls, i) => plain(['lit-a', 'lit-b', 'lit-both'][i]!, sheet(['lit-a', 'lit-b', 'lit-both'][i]!, [256, 128], { ambient: 0, lights: ls.map((l) => light(l)) }))),
    plain('lit-default', fallen), plain('lit-default with its light removed', unlitTwin(fallen, 'lamps')),
    plain('lit-interface', lighting, { [verdict]: 'pass' }), plain('lit-interface with its light removed', unlitTwin(lighting, 'lamps'), { [verdict]: 'pass' }),
    plain('lit-drift', sheet('lit-drift', [320, 180], { ambient: 0.1, lights: drift.map((l, k) => light(l, roles[k % roles.length])) }, [], { transport: { span: '6s' }, channels: driftChannels })),
    plain('lights-sixteen', sixteen),
    plain('lit-budget', budget), plain('lit-budget with its light removed', unlitTwin(budget, 'lamps')),
  ];
}
/** Whether a document names an image's `normal` or a light's `height`. */
const namesPage = (d: JsonObject): boolean => Object.values((d['items'] ?? {}) as Record<string, { params?: { normal?: unknown; light?: { lights?: { height?: unknown }[] } } }>)
  .some((i) => i.params?.normal !== undefined || (Array.isArray(i.params?.light?.lights) && i.params!.light!.lights!.some((l) => l?.height !== undefined)));

describe(`${ID} every fixture of #2031 and every 2D fixture already in the repo draws as at the merge base`, () => {
  it(`${ID} each fixture's frames are byte-identical to the merge base's`, () => {
    requireMetal();
    const { rev, src, canvas, gpu } = base();
    const { fixtures: parity, lit } = parityFixtures(src, rev, dir());
    const store = `${dir()}/empty-store`;
    const ours = fixtures2031().map((f) => ({ path: f.name, doc: f.doc, store, inputs: { look: LOOK, states: f.states, readings: {} } }));
    const all = [...ours, ...parity];
    const paged = all.filter((f) => namesPage(f.doc));
    // #2031's reader leaves out a parity fixture that names a light; at this suite's base none does, and one that does
    // is printed here, not judged.
    if (lit.length) console.log(`${ID}: parity fixtures naming a light, left out by #2031's reader: ${lit.join(', ')}`);
    if (paged.length) console.log(`${ID}: left out, naming a normal or a height: ${paged.map((f) => f.path).join(', ')}`);
    const fixtures = all.filter((f) => !namesPage(f.doc));
    mkdirSync(store, { recursive: true });
    const before = framesOf(canvas, gpu, fixtures, `${dir()}/base`);
    const after = framesOf(head.canvas(), head.gpu(), fixtures, `${dir()}/head`);
    const failures = [...new Set([...before.keys(), ...after.keys()])].flatMap((k) => (before.get(k) === after.get(k) ? [] : [`${k}: ${after.get(k) ?? 'missing'} where the merge base has ${before.get(k) ?? 'nothing'}`]));
    console.log(`${ID}: ${fixtures.length} fixtures (${ours.length} of #2031's), ${before.size} frames and paths compared with the merge base ${rev.slice(0, 12)}; ${failures.length} differ`);
    none(failures, `frames that differ from the merge base ${rev.slice(0, 12)}'s`);
    const undrawn = fixtures.filter((f) => ![...before.entries()].some(([k, v]) => k.startsWith(`${f.path} at `) && v.startsWith('png ')));
    if (undrawn.length) inconclusive(`the merge base draws no picture of ${undrawn.map((f) => f.path).join(', ')}, so its frame can't be compared`);
  });
});

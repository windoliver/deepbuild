// AC5 #226.58ad6172: "The seal finds no edge from scene3d to data: a build with scene3d and without the data module
// seals, scene3d's interface digest is the same with the data module in the build and without it, and a document with
// `axes3d@1` on the build without data is refused with `module_missing`, naming data"
//
// Two builds of deep-show: `full`, and `full,test-leave-out-data` (#489's test build without the data module).
// The first test: the build without data starts, its seal taking the set (exit 0), with scene3d and without data; in
// the full build deep://registries lists `mod.axes@1` in the core's `modifier@1`, filled by data (so the full build's
// data module holds this issue's work and the comparison below sees it), and the build without data lists none;
// deep://schedule names scene3d@1 in both, data@1 in the full build only, and scene3d@1's digest is the same string in
// both. The second test: on the build without data, a revision holding `axes3d@1` (and a point carrying mod.axes@1) is
// refused with an error issue on the axes item (its ids or path) of code `module_missing` that names data (the scales
// are the data module's too, and the base already refuses them so), and no error on the axes item has another code;
// the full build presents the same revision, skipping no item as an unknown kind (the control).
// Wrong programs: the base (axes3d@1 unknown in both builds: skipped with a notice, no module_missing; no mod.axes@1
// entry); scene3d registering axes3d@1 or reading the data module (its digest moves without data, or the build
// without data refuses to seal); axes3d@1 refused another way than module_missing, or with module_missing naming
// scene3d.
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, agentDoc, arr, axesDoc, brief, docId, isObject, mentions, obj, pointOnAxes, presented, refusedWith, runShow, sealed, show, str,
  useBins, useOut, type JsonObject,
} from './helpers.ts';

const ID = AC[5];
const NAME = `AC5 ${ID}`;
const bin = useBins(['deep-show', 'deep-show-no-data']);
const out = useOut();

/** The `modifier@1` registry's entries in a `registries` reply (#200), each with the module that fills it. */
function modifierEntries(reply: JsonObject, what: string): { name: string; module: string }[] {
  const all = arr(reply['registries'], `${what}: registries`).filter(isObject);
  const r = all.find((x) => x['name'] === 'modifier@1');
  expect(r, `${what}: deep://registries lists the core's modifier@1`).toBeDefined();
  return arr(r!['entries'] ?? [], `${what}: modifier@1 entries`).filter(isObject).map((e) => ({ name: String(e['name']), module: String(e['module'] ?? '') }));
}
const digestOf = (reply: JsonObject, iface: string, what: string): string =>
  str(obj(obj(reply['interfaces'], `${what}: deep://schedule interfaces`)[iface], `${what}: interfaces["${iface}"]`)['digest'], `${what}: ${iface}'s digest`);

describe(`${NAME} scene3d has no edge to the data module`, () => {
  it(`${NAME} a build with scene3d and without data seals, and scene3d's interface digest is the same with the data module in the build and without it`, () => {
    const modules = sealed(bin('deep-show-no-data'), 'the build without data');
    expect(modules, 'the build without data holds scene3d').toContain('scene3d');
    expect(modules, 'the build without data holds no data module').not.toContain('data');
    expect(sealed(bin('deep-show'), 'the full build'), 'the full build holds the data module').toContain('data');
    const [fullRegistries, fullSchedule] = runShow(bin('deep-show'), out(), [], [{ call: 'registries' }, { call: 'schedule' }]);
    const [bareRegistries, bareSchedule] = runShow(bin('deep-show-no-data'), out(), [], [{ call: 'registries' }, { call: 'schedule' }]);
    const axesMod = modifierEntries(fullRegistries!, 'the full build').filter((e) => e.name === 'mod.axes@1');
    expect(axesMod.map((e) => e.module), 'the full build\'s data module fills mod.axes@1 in the core\'s modifier@1').toEqual(['data']);
    expect(modifierEntries(bareRegistries!, 'the build without data').filter((e) => e.name === 'mod.axes@1'), 'without data no module fills mod.axes@1').toEqual([]);
    const ifaces = (r: JsonObject, what: string): string[] => Object.keys(obj(r['interfaces'], `${what}: deep://schedule interfaces`));
    expect(ifaces(fullSchedule!, 'the full build'), 'the full build names data@1').toContain('data@1');
    expect(ifaces(bareSchedule!, 'the build without data'), 'the build without data names no data@1').not.toContain('data@1');
    expect(digestOf(bareSchedule!, 'scene3d@1', 'the build without data'), 'scene3d@1\'s interface digest without the data module equals the full build\'s')
      .toBe(digestOf(fullSchedule!, 'scene3d@1', 'the full build'));
  }, TIMEOUT);

  it(`${NAME} a document with axes3d@1 on the build without data is refused with module_missing, naming data`, () => {
    const doc = agentDoc(axesDoc('needs-data-226', [640, 360], { pt: pointOnAxes([2, 3, 1]) }));
    const d = docId(1);
    const [refused] = runShow(bin('deep-show-no-data'), out(), [d], [show(d, doc)]);
    const errs = refusedWith(refused!, 'axes3d@1 on the build without data');
    // The scales are the data module's too, so the issue must name the axes item itself, not only a scale.
    const onAxes = (e: (typeof errs)[number]): boolean => {
      const ids = Array.isArray(e.raw['ids']) ? e.raw['ids'].map(String) : [];
      const path = typeof e.raw['path'] === 'string' ? e.raw['path'] : '';
      return ids.includes('axes') || path === 'items/axes' || path.startsWith('items/axes/');
    };
    expect(errs.filter((e) => e.code === 'module_missing' && mentions(e.raw, 'data') && onAxes(e)).length, `an error issue on the axes item is module_missing, naming data: ${errs.map((e) => brief(e.raw, 600)).join('; ')}`).toBeGreaterThan(0);
    const other = errs.filter((e) => e.code !== 'module_missing' && onAxes(e));
    expect(other.map((e) => brief(e.raw, 600)), 'no error naming the axes has another code').toEqual([]);
    const [shown] = runShow(bin('deep-show'), out(), [d], [show(d, doc)]);
    presented(shown!, 'the same document on the full build');
  }, TIMEOUT);
});

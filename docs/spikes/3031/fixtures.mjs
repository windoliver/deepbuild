// Spike #3031's one fixture of its own: #1903's every-pass scene with the five passes the issue's Scope adds. Run
// from the checkout root: `node docs/spikes/3031/fixtures.mjs`. It writes, beside itself, `fixtures/every-pass-plus.json`
// (the scene, with a depth of field effect and a pane of glass added) and `fixtures/every-pass-plus.look.json`
// (#1903's look, with motion blur by velocity, ao and the local tone map added). Nothing of #1903's scene or look is
// changed, only added to. The six class fixtures are read where they are, `benchmarks/canvas/<class>.json`, under
// the perf lane's look, `tests/acceptance/379/fixtures/look.json`.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (...path) => JSON.parse(readFileSync(join(root, ...path), 'utf8'));

// The scene #1903's evidence drew, and #2189's copy of it: the same document.
const scene = read('docs', 'evidence', '1903', 'envelope.json').scene;
const copy = read('tests', 'acceptance', '2189', 'fixtures', 'every-pass.json');
if (JSON.stringify(scene) !== JSON.stringify(copy)) throw Error("#2189's copy of the every-pass scene is not #1903's scene");

export const ADDED_ITEMS = {
  // Effect: dof, focused on the camera's target, 14 m off; the rest are the effect's defaults.
  dof: { kind: 'effect@1', params: { kind: 'dof', dof: { focus: 14 } } },
  // Glass: a material that transmits, and a pane of it between the boxes and the crowd's far edge.
  glass_mat: { kind: 'material@1', params: { base_color: [1, 1, 1, 1], metallic: 0, roughness: 0.05, transmission: 1, ior: 1.5 } },
  pane: { kind: 'mark.box@1', params: { size: [1.6, 1.2, 0.1] }, at: { pos: [0, 0.9, 5.5] }, material: 'glass_mat' },
};
export const ADDED_LOOK = {
  // Motion blur: velocity, the look's ao at its defaults, and the local tone map as the perf lane's stage sets it.
  motion_blur: { method: 'velocity', shutter_angle: 180 },
  ao: { radius: 0.5, strength: 1, samples: 8, resolution: 'half' },
  local: { strength: 0.5 },
};

const items = { ...scene.items };
let k = Object.keys(items).length;
for (const [id, item] of Object.entries(ADDED_ITEMS)) {
  if (items[id]) throw Error(`the every-pass scene already has an item ${id}`);
  items[id] = { ...item, id, name: id, order: `a${String(k++).padStart(3, '0')}` };
}
const plus = {
  ...scene,
  title: 'The envelope scene, with five passes added',
  description: "#1903's every-pass scene with depth of field, motion blur, glass, ao and the local tone map added (#3031).",
  items,
};
const look = read('tests', 'acceptance', '1903', 'fixtures', 'look.json');
for (const key of Object.keys(ADDED_LOOK)) if (key in look) throw Error(`#1903's look already sets ${key}`);

mkdirSync(join(here, 'fixtures'), { recursive: true });
writeFileSync(join(here, 'fixtures', 'every-pass-plus.json'), `${JSON.stringify(plus, null, 2)}\n`);
writeFileSync(join(here, 'fixtures', 'every-pass-plus.look.json'), `${JSON.stringify({ ...look, id: 'scene-3031', ...ADDED_LOOK }, null, 2)}\n`);
console.log(`wrote fixtures/every-pass-plus.json (${Object.keys(items).length} items, ${plus.size.join(' × ')}) and its look`);

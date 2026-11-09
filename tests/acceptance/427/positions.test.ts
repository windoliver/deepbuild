// AC2 #427.341d687d: In bounds mode, a 1 m cube whose channel moves it from (0, 0, 0) m at 0 s to (2, 0, 0) m at 1 s
// reads its box at (2, 0, 0) m at 1 s within 1e-6 and draws it from x = 1.5 to 2.5 m; in lights and cameras, a spot
// parented 1 m above the cube's center reads its world position at 1 s as (2, 1, 0) m; and the UV checker on a 2 × 1 m
// plate whose uv0 runs in meters draws 16 × 8 cells, 8 per uv0 unit. A planted bounds mode that reads the cube's
// authored position, a planted lights mode that reads the spot's local position and a planted checker that fits 8 × 8
// cells to each surface each fail, naming the item.
//
// `deep-show run`: the agent shows the scene (rev 1), then asks for bounds, lights_cameras and uv_checker at t = 1 s.
// The plate is a glTF mesh (mesh.asset@1) the test writes into the evidence store: 2 × 1 m in the XY plane, uv0 in
// metres from its corner, so u runs 0–2 and v 0–1.
import { describe, it } from 'vitest';
import {
  AC, type JsonObject, box, camera, channel, drew, failsNaming, far, fmt, gltf, meshAsset, mode, none, plate, requireMetal, rowsOf,
  runShow, scenario, scene, seed, show, sun, useBuilds, useDir, vec3, type V3,
} from './helpers.ts';

const ID = AC[2];
const bin = useBuilds(['deep-show']);
const dir = useDir();
const CALLS = ['bounds', 'lights_cameras', 'uv_checker'].map((m) => mode(m, { t: '1s' }));

function replies(planted?: string): JsonObject[] {
  const evidence = dir();
  const plateSha = seed(evidence, gltf(plate(2, 1, 2, 1)));
  const doc = scene('Sliding cube', {
    cam: camera([1, 0, 0], 10),
    cube: box([0, 0, 0]),
    spot: { kind: 'light.spot@1', params: { power: 800, inner: 15, outer: 30 }, parent: 'cube', at: { pos: [0, 1, 0], rot: [-90, 0, 0] } },
    plate: meshAsset(plateSha, [0, -2, 0]),
    key: sun(),
  }, { transport: { span: '2s' }, channels: { slide: channel('items/cube/at/pos/0', [[0, 0], [1, 2]]) } });
  return runShow(bin('deep-show'), scenario(evidence, [show(doc), ...CALLS]), planted).slice(1);
}

/** The failures against the criterion, each naming its item. */
function problems([bounds, lights, checker]: JsonObject[]): string[] {
  const p: string[] = [];
  const one = (rows: JsonObject[], id: string, what: string): JsonObject | null => {
    const r = rowsOf(rows, id, what);
    if (r.length !== 1) { p.push(`${id}: ${r.length} ${what} rows drawn, not 1`); return null; }
    return r[0]!;
  };
  const b = one(drew(bounds!, 'bounds at 1 s').rows, 'cube', 'box');
  if (b) {
    const min = vec3(b['min']); const max = vec3(b['max']);
    const center: V3 | null = min && max ? [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2] : null;
    if (far(vec3(b['pos']), [2, 0, 0]) || far(center, [2, 0, 0])) p.push(`cube: its box at 1 s reads at ${fmt(vec3(b['pos']))}, centred at ${fmt(center)}, not (2, 0, 0) m`);
    if (!min || !max || Math.abs(min[0] - 1.5) > 1e-6 || Math.abs(max[0] - 2.5) > 1e-6) p.push(`cube: its box at 1 s is drawn from x = ${min?.[0]} to ${max?.[0]} m, not 1.5 to 2.5 m`);
  }
  const s = one(drew(lights!, 'lights and cameras at 1 s').rows, 'spot', 'light');
  if (s && far(vec3(s['pos']), [2, 1, 0])) p.push(`spot: its world position at 1 s reads ${fmt(vec3(s['pos']))}, not (2, 1, 0) m`);
  const c = one(drew(checker!, 'the UV checker').rows, 'plate', 'checker');
  if (c && (JSON.stringify(c['cells']) !== '[16,8]' || c['per_unit'] !== 8)) p.push(`plate: the checker draws ${JSON.stringify(c['cells'])} cells at ${JSON.stringify(c['per_unit'])} per uv0 unit, not [16, 8] at 8`);
  return p;
}

describe(`${ID} bounds, lights and cameras and the UV checker read the evaluated scene at t`, () => {
  it(`${ID} the cube's box at 1 s is at (2, 0, 0) m from x 1.5 to 2.5, the spot at (2, 1, 0) m, and the plate's checker 16 × 8 cells`, () => {
    requireMetal();
    none(problems(replies()), 'the three modes at 1 s');
  }, 900_000);

  it(`${ID} an authored-position bounds mode, a local-position lights mode and a fitted checker each fail, naming the item`, () => {
    requireMetal();
    failsNaming(problems(replies('bounds_authored_position')), ['cube'], 'planted bounds_authored_position');
    failsNaming(problems(replies('lights_local_position')), ['spot'], 'planted lights_local_position');
    failsNaming(problems(replies('checker_fits_surface')), ['plate'], 'planted checker_fits_surface');
  }, 1_800_000);
});

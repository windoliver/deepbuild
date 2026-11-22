// AC5 #2215.8e4252d8: Nothing else moves: every corpus document without both features on one material keeps its frame
// hashes in raster.
//
// "Both features" are `transmission` above 0 and `anisotropy.strength` other than 0 on one `material@1` (#2215's
// Scope). The corpus (README: The corpus) is four documents, none with both on one material: the checkout's castle
// (`packs/examples/castle.json`, #422's broad scene: 65 lights, a sky with its environment and fog, clouds, recipes),
// a lobe gallery built here with #428's helpers (sixteen materials under an environment sky, a shadowed sun and two
// point lights, with transmission and anisotropy each on materials of their own), #428's frosted panes (transmission
// at roughness 0, 0.3 and 0.6, no anisotropy) and #428's brushed ball (anisotropy at strength 1, no transmission).
// Each is drawn in raster by `deep-gpu`'s `view3d` call, frame 0, with the `final` and `linear` targets, and the
// SHA-256s the reply names them by are held to those recorded at the base `eb3be2014` on one Mac (`hashes.json`).
// Test 1: every member keeps both hashes; each failure names its member. Test 2: the guard bites: under the base's
// `--planted transmission_ignores_roughness` (#428's), which changes how a rough transmissive part draws, the same
// comparison fails naming `frosted-panes` and no other member.
// Off the recording's machine model or macOS version, or when a member's inputs aren't the recorded ones, both read
// INCONCLUSIVE, never PASS or FAIL (#422's convention for goldens). With no `hashes.json` both read BLOCKED, and test 1
// writes the candidate it drew (README: How the hashes were recorded).
// Wrong programs: a raster change that moves any pixel of a document without both features on one material, in the
// linear target or the final one: a pipeline, buffer layout or branch the receipt's change brings to every
// transmissive part, every anisotropic part, or every document holding both features on separate materials.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CASTLE, CASTLE_LOOK, CASTLE_PACKS, castle } from '../422/helpers.ts';
import {
  DARK_SKY, PLAIN_LOOK, REPO, SHOW_SKY, SPHERE_SIZE, ball, blocked, box, camera, failsNaming, inconclusive, isObject, look, material, none,
  pointLight, requireMetal, runGpu, sessionDoc, sha256, shown, sphereDoc, sun, unlit, useDir, useGpu, view3dCall, writeJson, type GpuPlanted,
  type JsonObject,
} from '../428/helpers.ts';

const ID = 'AC5 #2215.8e4252d8';
const HERE = dirname(fileURLToPath(import.meta.url));
const RECORDED = join(HERE, 'hashes.json');
/** Where a run with no `hashes.json` writes the hashes it drew, with each member's final PNG to look at. */
const CANDIDATE = join(REPO, 'target', 'acceptance', '2215-redraft-ac5');
/** The base program that changes how one member draws: a rough transmissive part's blur read at mip 0 (#428). */
const PLANT: GpuPlanted = 'transmission_ignores_roughness';
const PLANTED_MEMBER = 'frosted-panes';
const bin = useGpu();
const dir = useDir();

// ---------------------------------------------------------------------------------------------------
// The corpus

/** A member: how `view3d` draws it, and what its frames depend on besides the renderer. */
interface Member {
  name: string;
  /** The `view3d` call, given the run's folder to write a generated document into. */
  call: (out: string) => JsonObject;
  /** The document's `material@1` params, to check that none carries both features. */
  materials: () => JsonObject[];
  /** SHA-256 of everything the frames read besides the program: the document, its look, size, packs and call fields. */
  input: () => string;
}
const drawn = (call: JsonObject): JsonObject => ({ ...call, receipt: true });
const callFields = (call: JsonObject): JsonObject => Object.fromEntries(Object.entries(call).filter(([k]) => k !== 'doc' && k !== 'packs'));
const materialsOf = (doc: JsonObject): JsonObject[] =>
  Object.values(doc['items'] as JsonObject).filter((i): i is JsonObject => isObject(i) && i['kind'] === 'material@1').map((i) => (isObject(i['params']) ? i['params'] : {}));
function generated(name: string, doc: () => JsonObject, drawnIn: JsonObject, size: [number, number]): Member {
  const call = (path: string): JsonObject => drawn(view3dCall({ doc: path, look: drawnIn, size, targets: ['final', 'linear'] }));
  return {
    name, call: (out) => call(writeJson(out, name, doc())), materials: () => materialsOf(doc()),
    input: () => sha256(JSON.stringify({ doc: doc(), call: callFields(call('')) })),
  };
}

/** #422's castle as the checkout holds it, its look and its recipes' pack; frame 0 at its own size, 30 fps. */
function castleMember(): Member {
  const call = (): JsonObject => { const c = castle(); return drawn(view3dCall({ doc: c.doc, look: c.look, size: c.size, fps: 30, targets: ['final', 'linear'], packs: CASTLE_PACKS })); };
  const packFiles = (p: string): string[] => readdirSync(p, { recursive: true, encoding: 'utf8' }).map((f) => join(p, f)).filter((f) => statSync(f).isFile()).map((f) => f.slice(REPO.length + 1));
  const files = (): string[] => [CASTLE, CASTLE_LOOK, ...CASTLE_PACKS.flatMap(packFiles)].sort();
  return {
    name: 'castle', call,
    materials: () => materialsOf(JSON.parse(readFileSync(join(REPO, CASTLE), 'utf8')) as JsonObject),
    input: () => sha256(JSON.stringify({ files: files().map((f) => [f, sha256(readFileSync(join(REPO, f)))]), call: callFields(call()) })),
  };
}

/** Sixteen materials on balls under an environment sky, a shadowed sun and two point lights, before a patterned wall. */
const GALLERY_SIZE: [number, number] = [960, 540];
const GALLERY: Record<string, JsonObject> = {
  plastic: { base_color: [0.8, 0.15, 0.1, 1], roughness: 0.4 },
  copper: { base_color: [0.95, 0.64, 0.54, 1], metallic: 1, roughness: 0.3 },
  lacquer: { base_color: [0.1, 0.25, 0.8, 1], roughness: 0.5, coat: 1, coat_roughness: 0.05 },
  velvet: { base_color: [0.3, 0.05, 0.35, 1], roughness: 0.8, sheen: { weight: 1, color: [1, 0.8, 0.9, 1], roughness: 0.4 } },
  leaf: { base_color: [0.2, 0.6, 0.1, 1], translucency: { kind: 'thin', amount: 0.7 } },
  wax: { base_color: [0.9, 0.85, 0.7, 1], translucency: { kind: 'wrap', amount: 1, wrap: 0.5 } },
  film: { base_color: [0.05, 0.05, 0.05, 1], roughness: 0.15, iridescence: { weight: 1, ior: 1.3, thickness: 450 } },
  tinted: { base_color: [0.6, 0.6, 0.6, 1], roughness: 0.3, specular_color: [1, 0.5, 0.2] },
  clay: { base_color: [0.7, 0.45, 0.3, 1], roughness: 1, diffuse_roughness: 1 },
  sign: { base_color: [0.9, 0.9, 0.2, 1], roughness: 0.4, retroreflection: 0.8 },
  paint: { base_color: [0.4, 0.02, 0.02, 1], coat: 1, coat_roughness: 0.3, pattern_seed: 2215, flakes: { weight: 0.6, size: 0.004, tilt: 15, color: [1, 1, 1, 1] } },
  ember: { base_color: [0.1, 0.1, 0.1, 1], emission: [1, 0.6, 0.2, 1], emission_strength: 4 },
  // Anisotropy without transmission, turned and negative; transmission without anisotropy, and at strength 0.
  brushed: { base_color: [0.9, 0.9, 0.92, 1], metallic: 1, roughness: 0.25, anisotropy: { strength: 0.7, rotation: 30 } },
  satin: { base_color: [0.8, 0.8, 0.8, 1], roughness: 0.3, transmission: 0, anisotropy: { strength: -0.6 } },
  glass: { base_color: [1, 1, 1, 1], roughness: 0, transmission: 1, ior: 1.5, dispersion: 0.5, absorption: { thickness: 0.66, attenuation: { color: [0.6, 0.9, 0.8], distance: 0.5 } } },
  clear: { base_color: [1, 1, 1, 1], roughness: 0, transmission: 1, ior: 1.45, anisotropy: { strength: 0, rotation: 45 } },
};
function galleryDoc(): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: camera([0, 2.2, 8], [0, 0.3, -0.2], 50), sky: SHOW_SKY,
    sun: { kind: 'light.sun@1', params: { illuminance: 2, color: [1, 0.95, 0.9], shadow: true }, at: { rot: [-45, 30, 0] } },
    lamp_left: pointLight(800, [-2, 2, 2]), lamp_right: pointLight(400, [2.5, 1.5, 1]),
    ground: material({ base_color: [0.3, 0.3, 0.3, 1], roughness: 0.7 }), floor: box([10, 0.1, 6], [0, -0.05, 0], 'ground'),
    stone: material({ base_color: [0.35, 0.3, 0.28, 1], roughness: 0.9, pattern: 'stone_courses' }), wall: box([10, 4, 0.1], [0, 2, -2], 'stone'),
  };
  Object.entries(GALLERY).forEach(([id, params], i) => {
    items[id] = material(params);
    items[`ball_${id}`] = ball(0.33, [-2.8 + 0.8 * (i % 8), 0.35, i < 8 ? 0.6 : -0.6], id);
  });
  return sessionDoc('lobe-gallery-2215', GALLERY_SIZE, items);
}

/** #428 AC3's frosted panes (its `panesDoc(true)`): three transmissive panes over a black-to-white edge, no light. */
const PANE_SIZE: [number, number] = [512, 512];
function panesDoc(): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: camera([0, 0, 1.5], [0, 0, 0], 40), sky: DARK_SKY, black: unlit([0, 0, 0]), white: unlit([1, 1, 1]),
    left: box([2, 4, 0.01], [-1, 0, -0.505], 'black'), right: box([2, 4, 0.01], [1, 0, -0.505], 'white'),
  };
  for (const p of [{ id: 'frost_000', r: 0, y: 0.15 }, { id: 'frost_030', r: 0.3, y: 0 }, { id: 'frost_060', r: 0.6, y: -0.15 }]) {
    items[p.id] = { kind: 'material@1', params: { base_color: [1, 1, 1, 1], metallic: 0, roughness: p.r, transmission: 1, ior: 1.5, absorption: { thickness: 0 } } };
    items[`pane_${p.id}`] = box([0.6, 0.12, 0.002], [0, p.y, 0], p.id);
  }
  return sessionDoc('panes-428', PANE_SIZE, items);
}

/** #428 AC1's brushed ball: white metal at roughness 0.2, anisotropy strength 1, under a sun behind the camera. */
const brushedDoc = (): JsonObject =>
  sphereDoc('brushed', { base_color: [1, 1, 1, 1], metallic: 1, roughness: 0.2, anisotropy: { strength: 1 } }, DARK_SKY, sun(Math.PI, [0, 0, 0]));

const CORPUS: Member[] = [
  castleMember(),
  generated('lobe-gallery', galleryDoc, look('filmic', -1.5), GALLERY_SIZE),
  generated(PLANTED_MEMBER, panesDoc, PLAIN_LOOK, PANE_SIZE),
  generated('brushed-ball', brushedDoc, PLAIN_LOOK, SPHERE_SIZE),
];

const transmits = (m: JsonObject): boolean => typeof m['transmission'] === 'number' && m['transmission'] > 0;
const stretches = (m: JsonObject): boolean => {
  const s = isObject(m['anisotropy']) ? m['anisotropy']['strength'] : undefined;
  return typeof s === 'number' && s !== 0;
};
/** The corpus is what the README says: no member with both features on one material; one with transmission alone,
 * one with anisotropy alone, and one with both on separate materials. */
function corpusHolds(): void {
  const of = CORPUS.map((m) => ({ name: m.name, mats: m.materials() }));
  for (const { name, mats } of of) expect(mats.filter((m) => transmits(m) && stretches(m)).map(shown), `${name}: no material@1 has transmission above 0 and anisotropy.strength other than 0`).toEqual([]);
  const has = (name: string, f: (m: JsonObject) => boolean): boolean => of.find((o) => o.name === name)!.mats.some(f);
  expect(has(PLANTED_MEMBER, transmits) && !has(PLANTED_MEMBER, stretches), `${PLANTED_MEMBER} has transmission and no anisotropy`).toBe(true);
  expect(has('brushed-ball', stretches) && !has('brushed-ball', transmits), 'brushed-ball has anisotropy and no transmission').toBe(true);
  expect(has('lobe-gallery', stretches) && has('lobe-gallery', transmits), 'lobe-gallery has both features, on separate materials').toBe(true);
}

// ---------------------------------------------------------------------------------------------------
// The recording and the machine

interface Hashes { final: string; linear: string }
interface Recorded { recorded: { commit: string; model: string; macos: string }; members: Record<string, Hashes & { input: string }> }
const run = (cmd: string, args: string[]): string => { try { return execFileSync(cmd, args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return '(unknown)'; } };
const machine = (): { model: string; macos: string } => ({ model: run('sysctl', ['-n', 'hw.model']), macos: run('sw_vers', ['-productVersion']) });

/** The recorded hashes, judged usable here: BLOCKED when absent, INCONCLUSIVE on another machine or other inputs. */
function recorded(): Recorded {
  if (!existsSync(RECORDED)) blocked(`no recorded hashes at ${RECORDED.slice(REPO.length + 1)}`, 'record them at the base on one Mac (README: How the hashes were recorded)');
  const r = JSON.parse(readFileSync(RECORDED, 'utf8')) as Recorded;
  const here = machine();
  if (here.model !== r.recorded.model || here.macos !== r.recorded.macos) {
    inconclusive(`the hashes were recorded on ${r.recorded.model} under macOS ${r.recorded.macos}; this is ${here.model} under macOS ${here.macos}, where the same program may draw other bytes`);
  }
  const moved = CORPUS.filter((m) => r.members[m.name]?.input !== m.input()).map((m) => m.name);
  if (moved.length) inconclusive(`the inputs of ${moved.join(', ')} aren't the recorded ones (document, look, packs or call), so their frames can't be held to the base's`);
  expect(Object.keys(r.members).sort(), 'hashes.json records exactly the corpus').toEqual(CORPUS.map((m) => m.name).sort());
  return r;
}

// ---------------------------------------------------------------------------------------------------
// Drawing and comparing

/** Each member drawn once, frame 0, in one `deep-gpu run`: its targets' names, checked against their files' SHA-256s. */
function draw(planted?: GpuPlanted): { out: string; frames: Map<string, Hashes>; failures: string[] } {
  const out = dir();
  const replies = runGpu(bin(), out, CORPUS.map((m) => m.call(out)), planted);
  const frames = new Map<string, Hashes>(); const failures: string[] = [];
  CORPUS.forEach((m, i) => {
    const reply = replies[i]!;
    if (reply['code'] === 'unsupported_platform') inconclusive(`${m.name}: view3d reports unsupported_platform`);
    if (reply['code'] !== undefined) { failures.push(`${m.name}: view3d refused it: ${shown(reply)}`); return; }
    const f = (Array.isArray(reply['frames']) ? reply['frames'] : []).find((x): x is JsonObject => isObject(x) && x['frame'] === 0);
    if (!f) { failures.push(`${m.name}: no frame 0 in the reply: ${shown(reply)}`); return; }
    const named = (target: 'final' | 'linear', ext: string): string => {
      const h = f[target];
      if (typeof h !== 'string' || !/^[0-9a-f]{64}$/.test(h)) { failures.push(`${m.name}: frame 0 names no ${target} target: ${shown(h)}`); return ''; }
      const file = join(out, `${h}.${ext}`);
      if (!existsSync(file) || sha256(readFileSync(file)) !== h) failures.push(`${m.name}: the ${target} file ${h}.${ext} is missing or doesn't hash to its name`);
      return h;
    };
    frames.set(m.name, { final: named('final', 'png'), linear: named('linear', 'f32') });
  });
  return { out, frames, failures };
}
/** Each member's two hashes against the recorded ones; each failure starts with the member's name. */
function compare(r: Recorded, planted?: GpuPlanted): string[] {
  const { frames, failures } = draw(planted);
  for (const m of CORPUS) {
    const got = frames.get(m.name); const want = r.members[m.name]!;
    if (!got) continue;
    console.log(`${ID}${planted ? ` (--planted ${planted})` : ''}: ${m.name}: final ${got.final.slice(0, 16)}, linear ${got.linear.slice(0, 16)}: ${got.final === want.final && got.linear === want.linear ? 'as recorded' : 'MOVED'}`);
    for (const t of ['final', 'linear'] as const) if (got[t] !== want[t]) failures.push(`${m.name}: its ${t} target hashes ${got[t]}, where the base drew ${want[t]}`);
  }
  return failures;
}

describe(`${ID} documents without both features on one material keep their raster frame hashes`, () => {
  it(`${ID} the castle, the lobe gallery, the frosted panes and the brushed ball each keep the final and linear hashes recorded at the base`, () => {
    requireMetal();
    corpusHolds();
    if (!existsSync(RECORDED)) {
      // The recording: this run's hashes and pictures, written beside the checkout for a person to look at and copy.
      const { out, frames, failures } = draw();
      none(failures, 'the corpus drawn for the recording');
      mkdirSync(CANDIDATE, { recursive: true });
      const members = Object.fromEntries(CORPUS.map((m) => [m.name, { input: m.input(), ...frames.get(m.name)! }]));
      for (const m of CORPUS) copyFileSync(join(out, `${frames.get(m.name)!.final}.png`), join(CANDIDATE, `${m.name}.png`));
      writeFileSync(join(CANDIDATE, 'hashes.json'), `${JSON.stringify({ criterion: '#2215.8e4252d8', recorded: { commit: run('git', ['rev-parse', 'HEAD']), ...machine(), when: new Date().toISOString() }, members }, null, 2)}\n`);
      for (const [name, h] of Object.entries(members)) console.log(`${ID} (recording): ${name}: final ${h.final}, linear ${h.linear}`);
    }
    none(compare(recorded()), 'the corpus against the hashes recorded at the base');
  }, 3_600_000);

  it(`${ID} the guard bites: under --planted ${PLANT}, which changes how a rough transmissive part draws, the comparison fails naming ${PLANTED_MEMBER} and no other member`, () => {
    requireMetal();
    corpusHolds();
    const failures = compare(recorded(), PLANT);
    for (const f of failures) console.log(`${ID} (--planted ${PLANT}): the comparison fails: ${f}`);
    failsNaming(failures, [PLANTED_MEMBER], `--planted ${PLANT}`);
    expect(failures.filter((f) => !f.startsWith(`${PLANTED_MEMBER}:`)), `--planted ${PLANT}: no member but ${PLANTED_MEMBER} moves`).toEqual([]);
  }, 3_600_000);
});

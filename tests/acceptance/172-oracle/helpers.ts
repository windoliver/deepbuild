// The #172 Oracle lane's tools: the #172 suite's (../172/helpers.ts: deep-show, deep-physics, the web export, the
// served bundle and headless Chrome with WebGPU read through probe()), reused as they stand so both lanes ask the same
// programs the same way; the upstream physics engine's test scenes as our world documents in a scene, under upstream's
// defaults as #2010's and #2012's Oracle lanes write them (../2010-oracle/helpers.ts, ../2012-oracle/helpers.ts: 60 Hz,
// 4 solver iterations as substeps, gravity (0, −9.81, 0), average combine, friction 0.5, density 1, a checkpoint ring
// wide enough never to double its spacing); and the pinned upstream files, read from the oracle checkout.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect } from 'vitest';
import { box, upstreamScene } from '../2010-oracle/helpers.ts';
import { portabilityScene } from '../2012-oracle/helpers.ts';
import {
  REPO, arr, blocked, camera, int, markBox, obj, physics, present, presented, runShow, scenarioOf, sceneDoc, show, str, trackEntry,
  type JsonObject, type Probe, type Tab,
} from '../172/helpers.ts';

export * from '../172/helpers.ts';

/** The criterion the Oracle page links upstream tests for. */
export const CRITERION = 'AC1 #172.36bfe3c1';

// ---------------------------------------------------------------------------------------------------
// The pinned upstream files (README: Sources), read in place from the oracle checkout.

/** Where the oracle checkout is: `DEEP_ORACLES` (the folder holding `vendor/`), else a sibling worktree of the `doneright` branch. */
export const ORACLES = process.env['DEEP_ORACLES'] ? resolve(process.env['DEEP_ORACLES']) : resolve(REPO, '..', 'deep-oracles', 'doneright', 'oracles');
export const PINNED = {
  snapshot_portability: { rel: 'rapier-3406750a38/crates/rapier3d/tests/snapshot_portability.rs', sha256: '96ac7c887c03bc4199ff0d33c3e62ddd47b2637ee89343fc60100863d7637bd6' },
  parallel_path_parity: { rel: 'rapier-3406750a38/crates/rapier3d/tests/parallel_path_parity.rs', sha256: '2492334a405f627e71032e9dea8db722574b5cc469116a991a55a8d4f6604b97' },
} as const;
/** The pinned file is there and is the one this port was written from; missing is BLOCKED with the one thing to do. */
export function pinned(name: keyof typeof PINNED): string {
  const { rel, sha256 } = PINNED[name];
  const path = join(ORACLES, 'vendor', rel);
  if (!existsSync(path)) {
    blocked(`the pinned upstream file vendor/${rel} is missing at ${path}. Unblock: check out branch doneright of DeepBuildAI/deepbuild as a worktree (git fetch origin doneright && git worktree add ../deep-oracles origin/doneright) or set DEEP_ORACLES to the folder that holds vendor/, then rerun`);
  }
  const text = readFileSync(path, 'utf8');
  expect(createHash('sha256').update(text).digest('hex'), `vendor/${rel} is the file pinned at commit 3406750a38 that this port re-expresses`).toBe(sha256);
  return text;
}

// ---------------------------------------------------------------------------------------------------
// The scenes

/** The world's ID in each scene. */
export const WORLD_ID = 'lab';
const scene = (id: string, title: string, span: string, world: JsonObject, items: Record<string, JsonObject> = {}, extra: JsonObject = {}): JsonObject =>
  sceneDoc(id, title, span, { cam: camera([0, 12, 30], [0, 2, 0]), marker: markBox([0.2, 0.2, 0.2], [0, 12, 0]), ...items }, {
    requires: { modules: { scene3d: '^1' } }, worlds: { [WORLD_ID]: world }, ...extra,
  });

/** snapshot_portability's mixed scene (#2012's Oracle port: its multibody chain left out), 60 steps, a deep
 * checkpoint every 60 steps, as the world `lab` of a scene of 1 s. */
export const PORTABILITY_STEPS = 60;
export const portabilityDoc = (id: string): JsonObject => scene(id, 'The portability scene', '1s', portabilityScene());

/**
 * parallel_path_parity's run, re-expressed (README: Upstream's tests as ours): a 30 × 0.5 × 30 ground with its top at
 * y 0; a 14 × 2 × 14 pile of unit boxes on a 1.05 m pitch, jittered as upstream's, at Rapier's defaults (they settle and
 * sleep); and ten clusters of twelve unit boxes, cluster r's box i at upstream's place for round r (x (i mod 4) × 1.1 −
 * 2.2 + a, row ⌊i ÷ 4⌋ 1.1 m apart, z (b mod 3) − 1.5, with a = (7r + 13i) × 0.011 and b = (11r + 5i) × 0.017), its
 * lowest row at 6 + 4r m rather than 6 (our document can't add a body mid-run), held at rest on a frictionless
 * kinematic trapdoor that the scene's channel slides 40 m aside at step 220 + 40r, when the press `drop_r` launches each
 * of its boxes at upstream's sideways kick (a mod 1.5 − 0.75, 0, b mod 1.5 − 0.75) m/s. The clusters never sleep. 620
 * steps, upstream's 220 + 10 × 40, a deep checkpoint every 20.
 */
export const PARITY_STEPS = 620;
export const ROUNDS = 10;
const dropAt = (r: number): number => 220 + 40 * r;
export function parityDoc(id: string): { doc: JsonObject; track: JsonObject[] } {
  const bodies: JsonObject = { ground: { kind: 'static', shapes: [{ shape: 'ground', contact_material: 'plain' }], pose: { pos: [0, -0.5, 0] } } };
  for (let i = 0; i < 14; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 14; k++) {
    const jitter = (i * 0.013 + k * 0.017) % 0.05;
    bodies[`box_${String(i).padStart(2, '0')}_${j}_${String(k).padStart(2, '0')}`] = { kind: 'dynamic', shapes: [{ shape: 'cube', contact_material: 'plain' }], pose: { pos: [i * 1.05 - 7 + jitter, j * 1.05 + 0.55, k * 1.05 - 7 - jitter] } };
  }
  const inputs: JsonObject = {}; const controls: JsonObject = {}; const channels: JsonObject = {}; const items: Record<string, JsonObject> = {};
  for (let r = 0; r < ROUNDS; r++) {
    const h = 6 + 4 * r;
    const door = `door_${r}`;
    bodies[door] = { kind: 'kinematic', shapes: [{ shape: 'door', contact_material: 'glass' }], pose: { pos: [0.6, h - 0.6, 0] }, follow: `items/${door}/at/pos` };
    items[door] = markBox([8, 0.2, 5], [0.6, h - 0.6, 0]);
    channels[door] = { target: `items/${door}/at/pos`, type: 'vec3', keys: { k0: { t: '0f', value: [0.6, h - 0.6, 0], interp: 'hold' }, k1: { t: `${dropAt(r)}f`, value: [40.6, h - 0.6, 0], interp: 'hold' } } };
    controls[`drop_${r}`] = { kind: 'press', class: 'document', label: `Drop ${r}`, role: 'button' };
    for (let i = 0; i < 12; i++) {
      const a = (r * 7 + i * 13) * 0.011; const b = (r * 11 + i * 5) * 0.017;
      const id2 = `cl_${r}_${String(i).padStart(2, '0')}`;
      bodies[id2] = { kind: 'dynamic', shapes: [{ shape: 'cube', contact_material: 'plain' }], sleep: false, pose: { pos: [(i % 4) * 1.1 - 2.2 + a, h + Math.floor(i / 4) * 1.1, (b % 3) - 1.5] } };
      inputs[`kick_${id2}`] = { kind: 'launch', targets: [id2], on: { control: `drop_${r}`, each: 'entry' }, data: { linear: [(a % 1.5) - 0.75, 0, (b % 1.5) - 0.75] } };
    }
  }
  const world = upstreamScene({
    capacity: { bodies: 1024, shapes: 1024, joints: 64, contacts: 16384, particles: 0 },
    contact_materials: { plain: { friction: 0.5, restitution: 0, density: 1 }, glass: { friction: 0, restitution: 0, density: 1 } },
    shapes: { ground: box([30, 0.5, 30]), cube: box([0.5, 0.5, 0.5]), door: box([4, 0.1, 2.5]) },
    bodies, inputs,
  }, 20);
  const doc = scene(id, 'The parity scene', '10.4s', world, items, { controls, channels });
  return { doc, track: Array.from({ length: ROUNDS }, (_, r) => trackEntry(dropAt(r), `drop_${r}`, 1)) };
}

// ---------------------------------------------------------------------------------------------------
// The app's record of a scene's world, and the player's against it

export interface WorldRecord { hashes: string[]; checkpoints: { step: number; hash: string }[] }
/** deep-show's `physics_bake` of the scene's world on `track` (its step hashes and kept entries), and deep-physics's bake
 * of the same scene and world on those entries with `checkpoints: true`, whose step hashes must be the same. */
export function worldRecord(bin: string, evidence: string, document: JsonObject, track: JsonObject[], steps: number, what: string): WorldRecord {
  const doc = String(document['id']);
  const r = runShow(bin, scenarioOf({ evidence, docs: [doc], calls: [present(doc, document), { call: 'physics_bake', doc, world: WORLD_ID, track }] }), `${what}: the app`);
  presented(r[0], what);
  const baked = obj(r[1], `${what}: physics_bake`);
  expect(baked['ok'], `${what}: physics_bake answers: ${show(baked)}`).toBe(true);
  const hashes = arr(baked['step_hashes'], `${what}: step_hashes`).map((h, i) => str(h, `${what}: step_hashes[${i}]`));
  expect(hashes.length, `${what}: the bake holds at least ${steps + 1} step hashes`).toBeGreaterThanOrEqual(steps + 1);
  const kept = arr(baked['inputs'], `${what}: inputs`).map((v, i) => { const o = obj(v, `${what}: inputs[${i}]`); return { step: o['step'] ?? null, kind: o['kind'] ?? null, target: o['target'] ?? null, ...(o['data'] === undefined ? {} : { data: o['data'] }) } as JsonObject; });
  const [deep] = physics([{ call: 'bake', scene: document, world: WORLD_ID, steps: hashes.length - 1, frame_rate: [60, 1], track: kept, read: [], checkpoints: true }]);
  const d = obj(deep, `${what}: deep-physics's bake`);
  expect(arr(d['step_hashes'], `${what}: deep-physics step_hashes`), `${what}: deep-physics's bake of the scene's world is physics_bake's, step for step`).toEqual(hashes);
  const checkpoints = arr(d['checkpoints'], `${what}: checkpoints`).map((v, i) => { const c = obj(v, `${what}: checkpoints[${i}]`); return { step: int(c['step'], 'step'), hash: str(c['deep_hash'], 'deep_hash') }; });
  return { hashes, checkpoints };
}
/** Upstream's assertion on our output: the player's world, seeked step by step from 1 to `steps`, gives the golden's
 * (the app's) step hash at every step, and at `steps` every checkpoint's full-state hash; the first differing step is
 * named. */
export async function playerFailures(tab: Tab, app: WorldRecord, steps: number, what: string): Promise<string[]> {
  const f: string[] = [];
  let p: Probe | null = null;
  for (let k = 1; k <= steps; k++) {
    p = await tab.seekStep(k, `${what}, step ${k}`);
    if (p.step_hash[WORLD_ID] !== app.hashes[k]) { f.push(`${what}: step ${k} hashes ${String(p.step_hash[WORLD_ID])} in the player, ${app.hashes[k]} in the app (the first step that differs)`); break; }
  }
  if (p) {
    const want = app.checkpoints.filter((c) => c.step <= steps);
    const got = new Map((p.checkpoint_hashes[WORLD_ID] ?? []).map((c) => [c.step, c.hash]));
    if (!want.length) f.push(`${what}: the app's bake took no checkpoint by step ${steps}`);
    for (const c of want) if (got.get(c.step) !== c.hash) f.push(`${what}: the full-state hash at checkpoint step ${c.step} is ${String(got.get(c.step) ?? 'missing')} in the player, ${c.hash} in the app`);
  }
  return f;
}

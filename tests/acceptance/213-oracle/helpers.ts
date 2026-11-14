// Test-side tools for the #213 Oracle lane (README): the #213 suite's own (../213/helpers.ts, fixtures.ts and
// programs.ts, imported read only), so both lanes build and ask `deep-show run` the same way, plus what the ported
// cases need: a world of the scene a case casts into, the batch of ray requests asked through physics.cast@1 by the
// suite's `caster` program, and each answer's first hit read back from the step that reads it.

import { expect } from 'vitest';
import {
  DOC, arr, int, logicCall, num, obj, presented, runShow, scenario, sceneDoc, showCall, showSteps, type Handles, type JsonObject,
  type LogicItem, type Vec3,
} from '../213/helpers.ts';
import { castParams, probeHandles } from '../213/fixtures.ts';
import { caster, casterWrites, requestsOf } from '../213/programs.ts';

export * from '../213/helpers.ts';
export { probeHandles };

export const STONE: JsonObject = { stone: { friction: 0.5, restitution: 0, density: 1000 } };
/** A scene over 2 s listing one world, `id`, and the logic items given. */
export const oneWorldScene = (evidence: string, title: string, id: string, w: JsonObject, logic: Record<string, LogicItem>): JsonObject =>
  sceneDoc(evidence, { title, span: '2s', worlds: { [id]: w }, logic });

export interface Ray { groups: number; max: number; from: Vec3; dir: Vec3 }
export interface FirstHit { n: number; id: number; distance: number; point: Vec3; normal: Vec3 }
/**
 * Casts `rays` into world `id` of the scene `make` builds, through physics.cast@1: the suite's `caster` asks them in
 * batches of `m` at steps 1, 2, …, and reads each batch's answers at the step after it asked. Returns each ray's
 * first hit as its step read it, in the rays' order, and the handles.
 */
export function cast(bin: string, evidence: string, make: (logic: Record<string, LogicItem>) => JsonObject, id: string, rays: Ray[], m: number, what: string): { hits: FirstHit[]; handles: Handles } {
  const handles = probeHandles(bin, evidence, make, what);
  const w = handles.worlds[id];
  expect(w, `${what}: handles name world ${id}`).toBeDefined();
  const batches = Math.ceil(rays.length / m);
  const padded = [...rays, ...Array.from({ length: batches * m - rays.length }, () => rays[0]!)];
  const program = caster(requestsOf(padded.map((r) => ({ world: w!, ...r }))), m, batches, `${id}_${rays.length}`);
  const doc = DOC(91);
  const steps = batches + 2;
  const scene = make({ caster: { program, params: castParams(m, { writes: casterWrites(m) as unknown as JsonObject, budget: { fuel: 3_000_000 } }) } });
  const [shown, ran] = runShow(bin, scenario(evidence, [doc], [showCall(doc, scene), logicCall(doc, steps)]), what);
  presented(shown, what);
  const records = showSteps(ran, steps, what);
  const hits: FirstHit[] = rays.map((_, r) => {
    const b = Math.floor(r / m);
    const i = r % m;
    const s = records[b + 2]!;
    const a = obj(s['arrays'], `${what}: step ${b + 2}'s arrays`);
    const v3 = (path: string): Vec3 => arr(arr(a[path], `${what}: ${path}`)[i], `${what}: ${path}[${i}]`).map((x, j) => num(x, `${what}: ${path}[${i}][${j}]`)) as Vec3;
    return {
      n: int(arr(a['caster.n'], `${what}: caster.n`)[i], `${what}: caster.n[${i}]`), id: int(arr(a['caster.id'], `${what}: caster.id`)[i], `${what}: caster.id[${i}]`),
      distance: num(arr(a['caster.dist'], `${what}: caster.dist`)[i], `${what}: caster.dist[${i}]`), point: v3('caster.point'), normal: v3('caster.normal'),
    };
  });
  return { hits, handles };
}

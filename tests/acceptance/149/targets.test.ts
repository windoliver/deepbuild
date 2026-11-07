// AC6 #149.9ffe6b6a: A pass reading a collection's pressure target sees only that collection's items, and a read of
// another writer's collection is refused naming it.
//
// `main` holds two strokes at different pressures, one in collection `crayon`; another writer's layer holds a third, in
// collection `theirs`. A composed pass in a group of `main` writes the pressure target's red channel to its output, so
// `main`'s f32 file shows what the pass read: 0.6 on the collection's stroke, 0 everywhere else, within 1/255. Pressure
// comes from the line (Effect and GPU operator: collection targets). The twin reads `theirs` from `main`: the call is
// refused, and the refusal names `theirs`.
//
// Wrong programs: a target drawn from the whole layer (the other stroke's 0.9 shows); a target drawn from the frame (the
// other writer's stroke shows); a read across writers allowed, or refused without naming the collection.
import { describe, expect, it } from 'vitest';
import { AC, at, figure, layerFloats, layersCall, look, mark, requireMetal, runGpu, shown, useDir, useGpu, type JsonObject } from './helpers.ts';

const ID = AC[6];
const bin = useGpu();
const dir = useDir();
const [W, H] = [240, 160] as const;
const OURS = 0.6; const OTHER = 0.9;

const LOOK = look({
  id: 'targets-149',
  lines: { line: { kind: 'exact', width: 2 }, soft: { kind: 'exact', width: 24, pressure: OURS }, hard: { kind: 'exact', width: 24, pressure: OTHER } },
});
/** A pass writing the target's red to r, g and b at alpha 1, in the group of #430's form. */
const probe = (collection: string): JsonObject => mark('probe', 'gpu.pass@1', 'z0', {
  origin: 'composed', about: 'Reads a collection target for the #149 test.',
  inputs: { src: { type: 'texture', from: { texture: { target: { collection, output: 'pressure', resolution: 'full', mips: false } } } } },
  steps: {
    uv: { op: 'screen_uv@1' }, c: { op: 'sample@1', args: { tex: 'src', uv: 'uv', lod: 0 } }, r: { op: 'split@1', args: { x: 'c', pick: 'x' } },
    out: { op: 'compose@1', args: { x: 'r', y: 'r', z: 'r', w: 1 } },
  },
  outputs: { color: 'out', blend: 'replace' }, resolution: 'full', cost: { ns_per_px: 1 }, fallback: 'look',
});
const stroke = (id: string, y: number, line: string, order: string, extra: JsonObject = {}): JsonObject =>
  mark(id, 'path@1', order, { d: `M 20 ${y} L 220 ${y}`, paint: { stroke: { role: 'ink', line } } }, extra);
function doc(reads: string): JsonObject {
  return figure('targets-149', [W, H], {
    ours: stroke('ours', 40, 'soft', 'a0'),
    mine: stroke('mine', 80, 'hard', 'a1'),
    theirs: stroke('theirs', 120, 'hard', 'a0', { layer: 'other' }),
    medium: mark('medium', 'group@1', 'a2', { passes: [{ op: 'probe', params: {}, grow: 0 }] }),
    cover: mark('cover', 'rect@1', 'a3', { box: [0, 0, W, H], paint: { fill: { role: 'ground' } } }, { parent: 'medium' }),
    probe: probe(reads),
  }, {
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a1' }, other: { writer: 'agent-b', title: 'Other', order: 'a2' } },
    collections: { crayon: { members: ['ours'] }, theirs: { members: ['theirs'] } },
  });
}

describe(`${ID} a collection's own targets`, () => {
  it(`${ID} a pass reading a collection's pressure target sees only that collection's items`, () => {
    requireMetal();
    const out = dir();
    const [reply] = runGpu(bin(), out, [layersCall(doc('crayon'), LOOK)]);
    const layer = layerFloats(out, reply!, 'main', [W, H], 'the probe');
    const read = (x: number, y: number): number => at(layer, x, y, 0);
    expect(Math.abs(read(120, 40) - OURS), `the collection's stroke reads pressure ${OURS}, got ${read(120, 40)}`).toBeLessThanOrEqual(1 / 255);
    expect(Math.abs(read(120, 80)), `a stroke of the same writer outside the collection isn't in the target, got ${read(120, 80)}`).toBeLessThanOrEqual(1 / 255);
    expect(Math.abs(read(120, 120)), `another writer's stroke isn't in the target, got ${read(120, 120)}`).toBeLessThanOrEqual(1 / 255);
    expect(Math.abs(read(120, 60)), `the page between strokes reads 0, got ${read(120, 60)}`).toBeLessThanOrEqual(1 / 255);
  });

  it(`${ID} a read of another writer's collection is refused, naming it`, () => {
    requireMetal();
    const [reply] = runGpu(bin(), dir(), [layersCall(doc('theirs'), LOOK)]);
    expect(reply!['code'], `the draw is refused, not drawn: ${shown(reply)}`).toBeDefined();
    expect(JSON.stringify(reply), 'the refusal names the collection').toContain('theirs');
    expect(reply!['layers'], 'nothing is drawn').toBeUndefined();
  });
});

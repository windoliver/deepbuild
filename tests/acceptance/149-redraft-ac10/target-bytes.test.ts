// AC10 #149.affd8de8, clause "a collection target costs no more than its declared bytes" (README: Reading). One writer
// layer at 1920 x 1080 holds a collection `c`; a group's `gpu.pass@1` reads c's pressure target at half resolution,
// rgba16float, no mips. `layers` answers `target_costs` with the device's own count; it may pass the declared 960 x 540
// x 8 B only by the device's padding (1%, the meter's own tolerance), so a target held at full size or at rgba32float
// fails. The declared bytes are computed here from the declaration, never read from the reply.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO, answered, arr, layersCall, obj, requireMetal, runGpu, shown, useDir, useGpu, type JsonObject } from '../430/helpers.ts';

const bin = useGpu();
const dir = useDir();
const look = { ...(JSON.parse(readFileSync(join(REPO, 'crates/deep-canvas-marks/looks/clean.json'), 'utf8')) as JsonObject), basis: 'drawing' };
const item = (id: string, kind: string, order: string, params: JsonObject, extra: JsonObject = {}): JsonObject => ({ id, kind, layer: 'main', name: id, order, params, ...extra });
const rect = (id: string, order: string, box: number[], role: string, extra: JsonObject = {}): JsonObject => item(id, 'rect@1', order, { box, paint: { fill: { role } } }, extra);
const target = { collection: 'c', output: 'pressure', resolution: 'half', mips: false };
const doc: JsonObject = {
  format: 1, id: 'target-bytes-149', profile: 'figure', title: 'target bytes', description: 'A #149 AC10 acceptance fixture.', size: [1920, 1080],
  transport: { span: '4s' }, requires: { modules: { effects: '^1' } }, budget: { class: 'figure' },
  layers: { main: { writer: 'agent-a', title: 'Main', order: 'a1' } }, collections: { c: { members: ['w'] } },
  items: {
    w: rect('w', 'a0', [100, 100, 800, 600], 'ink'),
    g: item('g', 'group@1', 'a1', { passes: [{ op: 'p', params: {}, grow: 0 }] }),
    m: rect('m', 'a2', [1000, 200, 600, 500], 'accent', { parent: 'g' }),
    p: item('p', 'gpu.pass@1', 'z0', {
      origin: 'composed', about: 'Reads the collection pressure.', inputs: { src: { type: 'texture', from: { texture: { target } } } },
      steps: { uv: { op: 'screen_uv@1' }, c: { op: 'sample@1', args: { tex: 'src', uv: 'uv', lod: 0 } }, out: { op: 'mul@1', args: { a: 'c', b: [1, 1, 1, 1] } } },
      outputs: { color: 'out', blend: 'replace' }, resolution: 'full', cost: { ns_per_px: 1 }, fallback: 'look',
    }),
  },
};
const DECLARED = (1920 / 2) * (1080 / 2) * 8; // half resolution, rgba16float (8 B a texel), one level

describe('AC10 #149.affd8de8: a collection target costs no more than its declared bytes', () => {
  it("reports the device's count of c.pressure within its declaration", () => {
    requireMetal();
    const reply = answered(runGpu(bin(), dir(), [layersCall(doc, look, { float: true, target_costs: true })])[0]!, 'layers');
    const rows = arr(reply['target_costs'], 'target_costs').map((r, i) => obj(r, `target_costs[${i}]`));
    const row = rows.find((r) => r['collection'] === 'c' && r['output'] === 'pressure');
    expect(row, `a target_costs row for c.pressure; the reply lists ${shown(rows)}`).toBeDefined();
    expect([row!['width'], row!['height'], row!['format']], 'the target is half of 1920 x 1080 in rgba16float').toEqual([960, 540, 'rgba16float']);
    expect([false, 1], `no mips: ${shown(row!['mips'])}`).toContain(row!['mips']);
    expect(row!['declared_bytes'], 'its declared bytes are 960 x 540 x 8').toBe(DECLARED);
    const bytes = row!['bytes'] as number;
    expect(bytes, `the device's own count is a number: ${shown(row!['bytes'])}`).toBeGreaterThan(0);
    expect(bytes, `${bytes} B counted for ${DECLARED} B declared (limit ${Math.floor(DECLARED * 1.01)})`).toBeLessThanOrEqual(DECLARED * 1.01);
  });
});

import { describe, expect, it } from 'vitest';
import { AC, LANE, laneShown, plant, runLane, useScratch, type Lane } from './helpers.ts';

const scratch = useScratch();

const UNFIXTURED_WGSL = [
  'struct Out { @builtin(position) at: vec4<f32>, @location(0) shade: f32 };',
  '@vertex',
  'fn vs_unfixtured(@builtin(vertex_index) v: u32) -> Out {',
  '    let corner = vec2<f32>(f32(v & 1u), f32(v >> 1u));',
  '    return Out(vec4<f32>(corner * 2.0 - 1.0, 0.0, 1.0), corner.x);',
  '}',
  '@fragment',
  'fn fs_unfixtured(in: Out) -> @location(0) vec4<f32> {',
  '    return vec4<f32>(in.shade, 0.25, 0.5, 1.0);',
  '}',
  '',
].join('\n');

function plantedFileFailsTheLane(path: string): void {
  const before = runLane(scratch());
  expect(before.status, `the scratch copy passes the lane before the plant: ${laneShown(before)}`).toBe(0);
  const remove = plant(scratch(), { [path]: UNFIXTURED_WGSL });
  let lane: Lane;
  try { lane = runLane(scratch()); } finally { remove(); }
  expect(lane.status, `${LANE} fails with ${path} planted: ${laneShown(lane)}`).toBe(1);
  expect(lane.failLines.some((l) => l.includes(path)), `a FAIL line names ${path}: ${laneShown(lane)}`).toBe(true);
  expect(lane.failLines.filter((l) => !l.includes(path)), `every FAIL line names the planted file and no other: ${laneShown(lane)}`).toEqual([]);
}

describe(`${AC[1]} every WGSL file under the two crates has an analytic fixture and a planted twin; a file with neither fails the lane, naming the file`, () => {
  it(`${AC[1]} the lane passes the checkout as it is, where every WGSL file and string it finds has an analytic fixture and a planted twin`, () => {
    const lane = runLane();
    expect(lane.status, `${LANE} exits 0 on the checkout: ${laneShown(lane)}`).toBe(0);
    expect(lane.failLines, `${LANE} names no file on the checkout: ${laneShown(lane)}`).toEqual([]);
    expect(lane.passLine, `${LANE} prints its PASS line: ${laneShown(lane)}`).toBe(true);
  }, 600_000);

  it(`${AC[1]} a WGSL file planted under crates/deep-effects-render with no fixture or twin fails the lane, naming the file`, () => {
    plantedFileFailsTheLane('crates/deep-effects-render/src/unfixtured_1428.wgsl');
  }, 1_800_000);

  it(`${AC[1]} a WGSL file planted under crates/deep-gpu-layer with no fixture or twin fails the lane, naming the file`, () => {
    plantedFileFailsTheLane('crates/deep-gpu-layer/src/unfixtured_1428.wgsl');
  }, 1_800_000);
});

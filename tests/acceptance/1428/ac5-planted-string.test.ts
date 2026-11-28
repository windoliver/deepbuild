import { describe, expect, it } from 'vitest';
import { AC, LANE, laneShown, plant, runLane, useScratch, type Lane } from './helpers.ts';

const scratch = useScratch();

const CRATE = 'crates/deep-planted-1428';
const MANIFEST = [
  '[package]',
  'name = "deep-planted-1428"',
  'version = "0.0.0"',
  'edition = "2021"',
  'publish = false',
  '',
].join('\n');

const RAW_STRING_PASS = [
  'pub const UNFIXTURED_PASS: &str = r#"',
  'struct Out { @builtin(position) at: vec4<f32>, @location(0) uv: vec2<f32> };',
  '@vertex',
  'fn vs_planted(@builtin(vertex_index) v: u32) -> Out {',
  '    let uv = vec2<f32>(f32(v & 1u), f32(v >> 1u));',
  '    return Out(vec4<f32>(uv * 2.0 - 1.0, 0.0, 1.0), uv);',
  '}',
  '@fragment',
  'fn fs_planted(in: Out) -> @location(0) vec4<f32> {',
  '    return vec4<f32>(in.uv, 0.75, 1.0);',
  '}',
  '"#;',
  '',
].join('\n');

const QUOTED_STRING_KERNEL = [
  'pub const UNFIXTURED_KERNEL: &str = "@group(0) @binding(0) var<storage, read_write> cells: array<u32>;\\n\\',
  '@compute @workgroup_size(64)\\n\\',
  'fn planted_kernel(@builtin(global_invocation_id) id: vec3<u32>) {\\n\\',
  '    cells[id.x] = id.x * 3u;\\n\\',
  '}\\n";',
  '',
].join('\n');

function plantedStringFailsTheLane(files: Record<string, string>, named: string): void {
  const before = runLane(scratch());
  expect(before.status, `the scratch copy passes the lane before the plant: ${laneShown(before)}`).toBe(0);
  const remove = plant(scratch(), files);
  let lane: Lane;
  try { lane = runLane(scratch()); } finally { remove(); }
  expect(lane.status, `${LANE} fails with ${named} planted: ${laneShown(lane)}`).toBe(1);
  expect(lane.failLines.some((l) => l.includes(named)), `a FAIL line names ${named}: ${laneShown(lane)}`).toBe(true);
  expect(lane.failLines.filter((l) => !l.includes(named)), `every FAIL line names the planted file and no other: ${laneShown(lane)}`).toEqual([]);
}

describe(`${AC[5]} a planted WGSL string in a test crate with no fixture fails the lane, naming the file`, () => {
  it(`${AC[5]} a vertex and fragment pass held in a raw Rust string in a test crate's src/lib.rs, with no fixture, fails the lane, naming that file`, () => {
    plantedStringFailsTheLane({ [`${CRATE}/Cargo.toml`]: MANIFEST, [`${CRATE}/src/lib.rs`]: RAW_STRING_PASS }, `${CRATE}/src/lib.rs`);
  }, 1_800_000);

  it(`${AC[5]} a compute kernel held in an ordinary quoted Rust string in a test crate's src/kernel.rs, with no fixture, fails the lane, naming that file`, () => {
    plantedStringFailsTheLane({ [`${CRATE}/Cargo.toml`]: MANIFEST, [`${CRATE}/src/lib.rs`]: 'pub mod kernel;\n', [`${CRATE}/src/kernel.rs`]: QUOTED_STRING_KERNEL }, `${CRATE}/src/kernel.rs`);
  }, 1_800_000);
});

// AC4 #431.a1c2e028: Targets cost only when read: a figure whose effects and operators read neither velocity nor
// emission allocates neither, by the meter's GPU memory count, which matches the device's sizes; reading both at
// 1920 × 1080 adds 8,294,400 B and 16,588,800 B; and a planted core that builds both for every frame adds 24,883,200 B
// to the first figure and fails, naming the targets.
//
// #379's `live` call with `report: ["memory"]`: one session of a 1920 × 1080 figure (budget class figure: three boxes
// under a sun), its writer's meter count read after the last of 3 frames. Each `writers[]` row gains `targets` (README:
// The surface under test): one row per core target the writer's views hold, `{session, target, bytes, device_bytes}`,
// `bytes` what the meter counts and `device_bytes` the size the device reports for it. The first figure's pass `reader`
// reads only the color target; the second's pass reads color, velocity and emission. "Matches the device's sizes" is
// each target row within 1% of its device size (#379's reading of a count that matches the device); the issue's own
// numbers are held exactly: velocity 1920 × 1080 × 4 B (rg16float) and emission × 8 B (rgba16float), and the second
// figure's count is the first's plus their sum, 24,883,200 B.
// Wrong program (planted `builds_unread_targets`): the core builds velocity and emission for every frame, read or not,
// so the first figure holds both and its count grows by 24,883,200 B; the check fails naming them.
import { describe, expect, it } from 'vitest';
import {
  AC, DARK_SKY, PLAIN_LOOK, WRITER, asItem, box, coreTarget, material, num, obj, objs, passOp, payload, requireGpu, run1, sceneDoc, str, useBin,
  useOut, writeJson, type JsonObject, type Planted, type Size,
} from './helpers.ts';

const bin = useBin();
const out = useOut();
const SIZE: Size = [1920, 1080];
const VELOCITY_B = 8_294_400;
const EMISSION_B = 16_588_800;

function figure(reads: 'color' | 'all'): JsonObject {
  const inputs: JsonObject = reads === 'color' ? { src: coreTarget('color') } : { src: coreTarget('color'), vel: coreTarget('velocity'), em: coreTarget('emission') };
  const steps: JsonObject = reads === 'color'
    ? { uv: { op: 'screen_uv@1', args: {} }, out: { op: 'sample@1', args: { tex: 'src', uv: 'uv', lod: 0 } } }
    : {
      uv: { op: 'screen_uv@1', args: {} }, c: { op: 'sample@1', args: { tex: 'src', uv: 'uv', lod: 0 } },
      v: { op: 'sample@1', args: { tex: 'vel', uv: 'uv', lod: 0 } }, e: { op: 'sample@1', args: { tex: 'em', uv: 'uv', lod: 0 } },
      ve: { op: 'add@1', args: { a: 'v', b: 'e' } }, z: { op: 'mul@1', args: { a: 've', b: 0 } }, out: { op: 'add@1', args: { a: 'c', b: 'z' } },
    };
  return sceneDoc(`figure-${reads}-431`, SIZE, {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: [0, 2, 7], target: [0, 0, 0], fov: 40, near: 0.1, far: 100 } },
    sky: DARK_SKY, sun: { kind: 'light.sun@1', params: { illuminance: 3, color: [1, 1, 1], shadow: false }, at: { rot: [-40, 30, 0] } },
    grey: material({ base_color: [0.6, 0.6, 0.6, 1], roughness: 0.5 }),
    b0: box([1, 1, 1], [-2, 0, 0], { material: 'grey' }), b1: box([1, 1, 1], [0, 0, 0], { material: 'grey' }), b2: box([1, 1, 1], [2, 0, 0], { material: 'grey' }),
    reader: asItem(passOp('reader', inputs, steps, 'out', { resolution: 'half' })),
  }, 'figure');
}

interface TargetRow { target: string; bytes: number; device_bytes: number | null }
interface Count { count: number; targets: TargetRow[] }
function countOf(reads: 'color' | 'all', planted?: Planted): Count {
  const dir = out();
  const doc = writeJson(dir, `figure-${reads}.json`, payload(figure(reads)));
  const reply = run1(bin(), dir, { call: 'live', look: PLAIN_LOOK, fps: 60, frames: 3, sessions: [{ session: 's-fig', writer: WRITER, doc, size: SIZE }], report: ['memory'] }, planted);
  expect(reply['code'], `the live call was answered: ${JSON.stringify(reply).slice(0, 800)}`).toBeUndefined();
  const session = objs(reply['sessions'], 'sessions').find((s) => s['session'] === 's-fig');
  expect(session?.['state'], `the figure is live, not refused: ${JSON.stringify(session?.['issues'] ?? []).slice(0, 800)}`).toBe('live');
  const frames = objs(reply['frames'], 'frames');
  const last = frames[frames.length - 1]!;
  const view = objs(last['views'], 'the last frame\'s views').find((v) => v['session'] === 's-fig');
  expect(view?.['internal_scale'], 'the figure draws at 1920 × 1080: internal scale 1 (#379)').toBe(1);
  const writer = objs(last['writers'], 'the last frame\'s writers').find((w) => w['writer'] === WRITER);
  expect(writer, `the meter counts ${WRITER}`).toBeDefined();
  const targets = objs(obj(writer, 'writer')['targets'], 'the writer\'s target rows').map((t, i): TargetRow => ({
    target: str(t['target'], `targets[${i}].target`), bytes: num(t['bytes'], `targets[${i}].bytes`),
    device_bytes: typeof t['device_bytes'] === 'number' ? t['device_bytes'] : null,
  }));
  const count = num(writer!['count_bytes'], 'count_bytes');
  console.log(`${AC[4]} ${reads}${planted ? ` (${planted})` : ''}: count ${count} B; targets ${targets.map((t) => `${t.target} ${t.bytes} (device ${t.device_bytes})`).join(', ')}`);
  return { count, targets };
}
/** Whether each target row matches the device's size for it, within 1%. */
const mismatched = (c: Count): string[] => c.targets.filter((t) => t.device_bytes === null || Math.abs(t.bytes - t.device_bytes) > 0.01 * t.device_bytes)
  .map((t) => `the ${t.target} target counts ${t.bytes} B against the device's ${t.device_bytes ?? 'unread'} B`);
/** The first figure's problems: a velocity or emission target it holds, named. */
const unread = (c: Count): string[] => c.targets.filter((t) => t.target === 'velocity' || t.target === 'emission')
  .map((t) => `the figure reads no ${t.target} but the meter counts a ${t.target} target of ${t.bytes} B`);

describe(`${AC[4]} the velocity and emission targets cost only when read`, () => {
  it(`${AC[4]} a figure that reads neither allocates neither; reading both at 1920 × 1080 adds 8,294,400 B and 16,588,800 B; each count matches the device's size`, () => {
    requireGpu();
    const neither = countOf('color');
    const both = countOf('all');
    const problems = [...unread(neither), ...mismatched(neither), ...mismatched(both)];
    expect(neither.targets.some((t) => t.target === 'color'), 'the count lists the figure\'s color target, so it sees the view').toBe(true);
    const rows = (name: string): TargetRow[] => both.targets.filter((t) => t.target === name);
    if (rows('velocity').length !== 1 || rows('velocity')[0]!.bytes !== VELOCITY_B) problems.push(`reading velocity counts ${JSON.stringify(rows('velocity'))}, not one target of 8,294,400 B`);
    if (rows('emission').length !== 1 || rows('emission')[0]!.bytes !== EMISSION_B) problems.push(`reading emission counts ${JSON.stringify(rows('emission'))}, not one target of 16,588,800 B`);
    if (both.count - neither.count !== VELOCITY_B + EMISSION_B) problems.push(`reading both adds ${both.count - neither.count} B to the count, not 24,883,200 B`);
    expect(problems).toEqual([]);
  }, 1_800_000);
  it(`${AC[4]} a planted core that builds both every frame (--planted builds_unread_targets) adds 24,883,200 B to the first figure and fails, naming the targets`, () => {
    requireGpu();
    const shipped = countOf('color');
    const planted = countOf('color', 'builds_unread_targets');
    expect(planted.count - shipped.count, 'the planted core adds 24,883,200 B to the figure that reads neither').toBe(VELOCITY_B + EMISSION_B);
    const problems = unread(planted).join('\n');
    expect(problems, 'the check fails naming the velocity target').toMatch(/no velocity/);
    expect(problems, 'the check fails naming the emission target').toMatch(/no emission/);
  }, 1_800_000);
});

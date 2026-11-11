// The envelope's counts on the noop lane (`envelope_counts`, `test-meter` build, wgpu's noop backend):
//
// #1903.26bdf7d3: Over the 60 s orbit of `separate-items`, counted on the noop lane, the first frame encodes each
// batch once and every later frame creates 0 bind groups, 0 buffers and 0 pipelines. A planted renderer that makes
// one bind group per item per frame creates 4,000 in the second frame and fails, naming the count and the frame.
//
// #1903.6598323c: Over the orbit with no item changing, each frame after the first uploads at most 1 KB, and a patch
// that moves one item uploads at most 256 bytes more in its frame. A planted renderer that uploads every item's
// transform each frame uploads at least 256,000 bytes (4,000 × 64) and fails, naming the bytes.
//
// #1903.fbd78805: At check, `separate-items` creates the same number of pipelines as a twin fixture with 40 items over
// the same 12 feature sets. A planted warm-up keyed by item instead of by feature set creates 100 times as many and
// fails, naming both counts.
//
// `separate-items` is 4,000 separate boxes over 400 looks sharing 12 feature sets, all in view of a camera orbiting
// once over 60 s; its twin is its first 40 boxes, one look each, over the same 12 feature sets. The orbit is 3,600
// frames at 60 fps, frame 0 the first. The patch moves item-0000 half a metre at frame 1,800 (30 s). The planted
// renderers run a 1 s orbit, since each fails at frame 1; the pipelines at check need no orbit, so those runs are 1 s
// too, each in a process of its own, so neither finds the other's pipelines made. The wrong programs are
// `--planted bind_group_per_item`, `uploads_every_transform` and `warms_per_item`.
import { describe, expect, it } from 'vitest';
import {
  SEPARATE, countsCall, countsOf, itemId, itemPos, run, separateItemsDoc, set, useBuild, useOut, writeDoc,
  type Counts, type Planted,
} from './helpers.ts';

const bin = useBuild();
const out = useOut();
const ID_ENCODE = '#1903.26bdf7d3';
const ID_UPLOAD = '#1903.6598323c';
const ID_WARM = '#1903.fbd78805';
const ORBIT_S = 60;
const FRAMES = ORBIT_S * 60;
const SHORT_S = 1;
const KB = 1024;
const MOVE_MAX = 256;
const PATCH_FRAME = 1800;
const EVERY_TRANSFORM = SEPARATE.items * 64;

interface OrbitSpec { planted?: Planted; items?: number; moveAt?: number }
/** `separate-items` (or its first `items` boxes) counted over a `seconds` orbit; with `moveAt`, item-0000 moved then. */
function orbit(seconds: number, spec: OrbitSpec = {}): Counts {
  const dir = out();
  const n = spec.items ?? SEPARATE.items;
  const path = writeDoc(dir, `separate-items-${n}`, separateItemsDoc(n));
  const p = itemPos(0);
  const patches = spec.moveAt === undefined ? undefined : [{ frame: spec.moveAt, ops: [set(itemId(0), 'at/pos', [p[0] + 0.5, p[1], p[2]])] }];
  const [reply] = run(bin(), dir, [countsCall(path, seconds, patches)], spec.planted ? { planted: spec.planted } : {});
  const what = `${n === SEPARATE.items ? 'separate-items' : `its ${n}-item twin`} over ${seconds} s`;
  return countsOf(reply!, `${what}${spec.moveAt === undefined ? '' : `, item-0000 moved at frame ${spec.moveAt}`}${spec.planted ? `, planted ${spec.planted}` : ''}`);
}

/** The unchanged 60 s orbit, played once and shared by the encode and upload criteria's tests. */
let unchanged: Counts | null = null;
function cleanOrbit(): Counts {
  unchanged ??= orbit(ORBIT_S);
  return unchanged;
}

/** #1903.26bdf7d3's check: frame 0 encodes each batch once, covering every item; every later frame creates nothing. */
function encodeProblems(c: Counts): string[] {
  const out: string[] = [];
  const first = c.frames[0];
  if (!first || first.frame !== 0) return ['the orbit has no frame 0'];
  if (first.encoded.length === 0) out.push('frame 0 encodes no batch');
  const names = first.encoded.map((b) => b.batch);
  const twice = names.find((n, i) => names.indexOf(n) !== i);
  if (twice !== undefined) out.push(`frame 0 encodes the batch ${twice} more than once`);
  const drawn = new Set(first.encoded.flatMap((b) => b.items));
  const missing = Array.from({ length: SEPARATE.items }, (_, i) => itemId(i)).filter((id) => !drawn.has(id));
  if (missing.length > 0) out.push(`frame 0's batches leave ${missing.length} items out, ${missing.slice(0, 3).join(', ')} first`);
  for (const [key, label] of [['bind_groups', 'bind groups'], ['buffers', 'buffers'], ['pipelines', 'pipelines']] as const) {
    const f = c.frames.slice(1).find((x) => x[key] !== 0);
    if (f) out.push(`frame ${f.frame}${f.frame === 1 ? ', the second frame,' : ''} creates ${f[key]} ${label}; every frame after the first creates 0`);
  }
  return out;
}

/** #1903.6598323c's check on an unchanged orbit: every frame after the first uploads at most 1 KB. */
function uploadProblems(c: Counts): string[] {
  const f = c.frames.slice(1).find((x) => x.uploaded_bytes > KB);
  return f ? [`frame ${f.frame} uploads ${f.uploaded_bytes} bytes with no item changing, over 1 KB (${KB} bytes)`] : [];
}

/** #1903.fbd78805's check: the same pipelines at check for 4,000 items as for 40 over the same 12 feature sets, at least one per set. */
function warmProblems(all: Counts, twin: Counts): string[] {
  const out: string[] = [];
  if (all.warmup !== twin.warmup) out.push(`at check separate-items creates ${all.warmup} pipelines and its 40-item twin ${twin.warmup}, over the same 12 feature sets`);
  if (twin.warmup < SEPARATE.featureSets) out.push(`at check the 40-item twin creates ${twin.warmup} pipelines, fewer than its ${SEPARATE.featureSets} feature sets`);
  return out;
}

describe(`${ID_ENCODE} the first frame encodes each batch once, and no later frame creates anything`, () => {
  it(`${ID_ENCODE} over the 60 s orbit of separate-items on the noop lane, frame 0 encodes each batch once and every later frame creates 0 bind groups, 0 buffers and 0 pipelines`, () => {
    const c = cleanOrbit();
    expect(c.frames.length, 'a row for each of the orbit\'s 3,600 frames').toBe(FRAMES);
    expect(c.frames.map((f) => f.frame), 'frames 0 … 3599 in order').toEqual(Array.from({ length: FRAMES }, (_, i) => i));
    expect(encodeProblems(c), 'each batch once in frame 0, nothing created after').toEqual([]);
  }, 1_800_000);

  it(`${ID_ENCODE} planted bind_group_per_item creates 4,000 bind groups in the second frame and fails, naming the count and the frame`, () => {
    const c = orbit(SHORT_S, { planted: 'bind_group_per_item' });
    const second = c.frames[1];
    expect(second?.frame, 'the second frame is frame 1').toBe(1);
    expect(second!.bind_groups, 'one bind group per item').toBeGreaterThanOrEqual(SEPARATE.items);
    expect(encodeProblems(c).join('\n'), 'naming frame 1 and the count').toMatch(new RegExp(`\\bframe 1\\b[^\\n]*\\b${second!.bind_groups} bind groups\\b`));
  }, 1_800_000);
});

describe(`${ID_UPLOAD} an unchanged orbit uploads almost nothing, and a move only its own bytes`, () => {
  it(`${ID_UPLOAD} over the orbit with no item changing each frame after the first uploads at most 1 KB, and a patch that moves one item uploads at most 256 bytes more in its frame`, () => {
    const clean = cleanOrbit();
    expect(clean.frames.length, 'the 60 s orbit').toBe(FRAMES);
    expect(uploadProblems(clean), 'at most 1 KB a frame after the first').toEqual([]);
    const moved = orbit(ORBIT_S, { moveAt: PATCH_FRAME });
    const at = moved.frames.find((f) => f.frame === PATCH_FRAME);
    const before = clean.frames.find((f) => f.frame === PATCH_FRAME);
    expect(at, `the moved orbit has frame ${PATCH_FRAME}`).toBeDefined();
    const more = at!.uploaded_bytes - before!.uploaded_bytes;
    expect(more, `frame ${PATCH_FRAME}, the move's, uploads ${at!.uploaded_bytes} bytes against the unchanged orbit's ${before!.uploaded_bytes}: the move reaches the GPU`).toBeGreaterThan(0);
    expect(more, `frame ${PATCH_FRAME} uploads ${more} bytes more than the unchanged orbit's, at most 256`).toBeLessThanOrEqual(MOVE_MAX);
  }, 1_800_000);

  it(`${ID_UPLOAD} planted uploads_every_transform uploads at least 256,000 bytes a frame and fails, naming the bytes`, () => {
    const c = orbit(SHORT_S, { planted: 'uploads_every_transform' });
    const second = c.frames[1];
    expect(second?.frame, 'frame 1').toBe(1);
    expect(second!.uploaded_bytes, 'every item\'s transform, 4,000 × 64 bytes').toBeGreaterThanOrEqual(EVERY_TRANSFORM);
    expect(uploadProblems(c).join('\n'), 'naming the bytes').toMatch(new RegExp(`\\bframe 1 uploads ${second!.uploaded_bytes} bytes\\b`));
  }, 1_800_000);
});

describe(`${ID_WARM} warm-up keyed by feature set, not by item`, () => {
  it(`${ID_WARM} at check separate-items creates as many pipelines as its 40-item twin over the same 12 feature sets`, () => {
    const all = orbit(SHORT_S);
    const twin = orbit(SHORT_S, { items: SEPARATE.twin });
    expect(warmProblems(all, twin), 'the same pipelines at check, at least one per feature set').toEqual([]);
  }, 1_800_000);

  it(`${ID_WARM} planted warms_per_item creates 100 times as many for 4,000 items as for 40 and fails, naming both counts`, () => {
    const all = orbit(SHORT_S, { planted: 'warms_per_item' });
    const twin = orbit(SHORT_S, { planted: 'warms_per_item', items: SEPARATE.twin });
    expect(all.warmup, 'a pipeline per item at least').toBeGreaterThanOrEqual(SEPARATE.items);
    const problems = warmProblems(all, twin);
    expect(problems.length, 'it fails the criterion').toBeGreaterThan(0);
    expect(problems.join('\n'), 'naming both counts').toMatch(new RegExp(`\\b${all.warmup} pipelines\\b[^\\n]*\\b${twin.warmup}\\b`));
  }, 1_800_000);
});

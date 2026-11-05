// AC3 #425.4c1317b2: Inside a band margin the two bands' complementary masks cover every pixel exactly once in the
// color, depth, shadow and object-ID passes, and the blend level is the same integer on every machine for the same
// view.
//
// The band sweep (README: The fixtures; its sun casts, so a shadow pass draws). Its frames inside the ball's margin
// report an integer blend level; at the one nearest half, a fresh session writes the ball's two band masks as each of
// the four passes evaluates them: every pixel (and shadow texel) is kept by exactly one band, the color, depth and
// object-ID passes key the same pixels alike, and the less detailed band keeps level ÷ of of them. "Every machine":
// the CPU computes the level from the canonical view, so the same sweep on the noop backend (no GPU work at all) and
// at internal scale 0.5 reports the same integer at every frame. Planted: masks keyed per band (overlaps and holes),
// and a blend level computed in f32 on the GPU.
//
// Blind redraft of ../masks.test.ts (redraft/README: D1): as the original, word for word, except that the band
// sweep's document comes from ./helpers.ts, whose dolly keys are time literals the base's grammar accepts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, BAND_SIZE, BAND_SWEEP, LOOK, failsNaming, frameAt, framesOf, none, requireMetal, runGpu, sha256, useBuilds, useDir, view3dCall,
  writeJson, type Blend, type Frame3, type GpuPlanted,
} from '../helpers.ts';
import { bandDoc } from './helpers.ts';

const ID = AC[3];
const bin = useBuilds(['default']);
const dir = useDir();
const PASSES = ['color', 'depth', 'shadow', 'ids'] as const;

const blendOf = (f: Frame3): Blend | null | undefined => f.lod?.find((r) => r.item === 'ball')?.blend;
const sweepCall = (doc: string, extra: object = {}) => view3dCall({ doc, look: LOOK, size: BAND_SIZE, from: 0, frames: BAND_SWEEP.last + 1, lod: true, ...extra });

/** Margin frames report an integer blend level 0 … of; frames outside one report none. */
function blendProblems(play: Frame3[]): string[] {
  const out: string[] = [];
  let inside = 0;
  for (const f of play) {
    const row = f.lod?.find((r) => r.item === 'ball');
    if (!row) { out.push(`frame ${f.frame} reports no lod row for the ball`); continue; }
    if (row.bands.length === 2) {
      inside++;
      const b = row.blend;
      if (!b || !Number.isInteger(b.level) || !Number.isInteger(b.of) || b.of < 2 || b.level < 0 || b.level > b.of) out.push(`frame ${f.frame} is inside the margin with blend ${JSON.stringify(b)}, not an integer level of an integer count`);
    } else if (row.blend !== null) out.push(`frame ${f.frame} draws one band but reports blend ${JSON.stringify(row.blend)}`);
  }
  if (inside === 0) out.push('no frame of the sweep is inside the ball\'s band margin');
  return out;
}

/** The ball's masks at one margin frame, in each pass: exactly one band at every pixel, alike in the passes that share
 * the view's pixels, the less detailed band keeping level ÷ of of them within 0.05. */
function maskProblems(out: string, f: Frame3, b: Blend): string[] {
  const problems: string[] = [];
  const rows = (f.masks ?? []).filter((m) => m.item === 'ball');
  const bytes = new Map<string, Buffer>();
  for (const pass of PASSES) {
    const m = rows.find((r) => r.pass === pass);
    if (!m) { problems.push(`pass ${pass}: frame ${f.frame} wrote no mask for the ball`); continue; }
    const file = readFileSync(join(out, `${m.file}.u8`));
    if (sha256(file) !== m.file || file.length !== m.size[0] * m.size[1]) { problems.push(`pass ${pass}: its mask file isn't ${m.size[0]} × ${m.size[1]} bytes named by its SHA-256`); continue; }
    if (pass !== 'shadow' && (m.size[0] !== BAND_SIZE[0] || m.size[1] !== BAND_SIZE[1])) problems.push(`pass ${pass}: its mask is ${m.size.join(' × ')}, not the view's ${BAND_SIZE.join(' × ')}`);
    bytes.set(pass, file);
    let neither = 0; let both = 0; let lower = 0;
    for (const v of file) { if ((v & 3) === 0) neither++; else if ((v & 3) === 3) both++; else if (v === 2) lower++; }
    if (neither + both > 0) problems.push(`pass ${pass}: ${neither} pixels kept by neither band and ${both} by both, of ${file.length}`);
    const share = lower / file.length;
    if (Math.abs(share - b.level / b.of) > 0.05) problems.push(`pass ${pass}: the less detailed band keeps ${share.toFixed(3)} of the pixels, not the blend level's ${b.level} ÷ ${b.of}`);
  }
  for (const pass of ['depth', 'ids'] as const) {
    const a = bytes.get('color'); const c = bytes.get(pass);
    if (a && c && !a.equals(c)) problems.push(`pass ${pass}: its mask keys the view's pixels otherwise than the color pass's`);
  }
  return problems;
}

/** The same view gives the same integer on the noop backend and at internal scale 0.5 as on this GPU at scale 1. */
function sameInteger(gpu: Frame3[], other: Frame3[], how: string): string[] {
  const out: string[] = [];
  for (const f of gpu) {
    const o = other.find((x) => x.frame === f.frame);
    if (JSON.stringify(blendOf(f) ?? null) !== JSON.stringify((o && blendOf(o)) ?? null)) out.push(`frame ${f.frame}: blend ${JSON.stringify(blendOf(f) ?? null)} here, ${JSON.stringify((o && blendOf(o)) ?? null)} ${how}`);
  }
  return out;
}

interface Run { out: string; play: Frame3[]; issues: string[]; shot: Frame3; blend: Blend; noop: Frame3[]; half: Frame3[] }
function run(planted?: GpuPlanted): Run {
  requireMetal();
  const out = dir();
  const doc = writeJson(out, 'bands', bandDoc());
  const startup = planted ? { planted } : {};
  const [p, h] = runGpu(bin('default'), out, [sweepCall(doc), sweepCall(doc, { surface: { internal_scale: 0.5 } })], startup);
  const play = framesOf(p!, 'the sweep'); const half = framesOf(h!, 'the sweep at internal scale 0.5');
  const issues = blendProblems(play);
  const margin = play.filter((f) => blendOf(f));
  if (margin.length === 0) expect.fail(`no frame of the sweep reports a blend level:\n  ${issues.slice(0, 20).join('\n  ')}`);
  const pick = margin.reduce((a, f) => (Math.abs(blendOf(f)!.level / blendOf(f)!.of - 0.5) < Math.abs(blendOf(a)!.level / blendOf(a)!.of - 0.5) ? f : a));
  const [s] = runGpu(bin('default'), out, [view3dCall({ doc, look: LOOK, size: BAND_SIZE, from: pick.frame, frames: 1, capture: [pick.frame], lod: true, masks: true })], startup);
  const shot = frameAt(framesOf(s!, `the seek to frame ${pick.frame}`), pick.frame, `the seek to frame ${pick.frame}`);
  const [n] = runGpu(bin('default'), out, [sweepCall(doc)], { ...startup, backend: 'noop' });
  return { out, play, issues, shot, blend: blendOf(pick)!, noop: framesOf(n!, 'the sweep on the noop backend'), half };
}

describe(`${ID} complementary masks inside a band margin, and one blend level on every machine`, () => {
  it(`${ID} inside the margin the two bands' masks cover every pixel exactly once in the color, depth, shadow and object-ID passes, and the blend level is the same integer without the GPU and at another scale`, () => {
    const r = run();
    none(r.issues, 'the margin frames\' blend levels');
    expect(blendOf(r.shot), `the seek to frame ${r.shot.frame} reports the sweep's blend level`).toEqual(r.blend);
    none(maskProblems(r.out, r.shot, r.blend), `the ball's masks at frame ${r.shot.frame}`);
    none([...sameInteger(r.play, r.noop, 'on the noop backend'), ...sameInteger(r.play, r.half, 'at internal scale 0.5')], 'the blend level is the CPU\'s, the same for the same view');
  }, 1_800_000);

  it(`${ID} masks keyed per band, and a blend level computed in f32 on the GPU, each fail, naming the pass or the frame`, () => {
    const masks = run('band_masks_independent');
    failsNaming(maskProblems(masks.out, masks.shot, masks.blend), ['pass '], '--planted band_masks_independent');
    const gpu = run('blend_level_on_gpu');
    failsNaming([...gpu.issues, ...sameInteger(gpu.play, gpu.noop, 'on the noop backend'), ...sameInteger(gpu.play, gpu.half, 'at internal scale 0.5')], ['frame '], '--planted blend_level_on_gpu');
  }, 1_800_000);
});

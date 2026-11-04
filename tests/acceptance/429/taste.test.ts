// #429.49543705: shown to you: screenshots of the pass operator tinting a frame, a material operator and a composed
// compute operator, taken by the check run from the renderer's own output, are attached to the PR and shown to you
// in the session. Whether they look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never
// PASS, and no criterion above reads a picture to judge it.
//
// The test takes the three screenshots from `view3d`'s final target (the renderer's own output, a PNG named by its
// SHA-256): the figure with the tint pass, a box shaded by a material operator (base color |object normal|), and
// the figure under a pass that shows a composed compute operator's storage as grey stripes. It keeps them in
// DEEPBUILD_EVIDENCE_DIR (else a temporary folder) and prints their paths, for the PR and the session. The taste call
// is a file you record, named by DEEPBUILD_TASTE_429: {"criterion": "#429.49543705", "by": "you", "screenshots":
// [sha256 × 3], "call": "looks_right" | "looks_wrong"}. With no record, or one made on other screenshots, the test
// fails as INCONCLUSIVE; looks_wrong fails it. No other test in this suite reads a picture to judge it.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOOK, SHA, asItem, box, camera, compute, figure, frameOf, inconclusive, pass, requireGpu, run1, sceneDoc, tint, useBins, useOut, view3dFrames, writeJson, type JsonObject } from './helpers.ts';

const bins = useBins();
const out = useOut();
const SIZE: [number, number] = [640, 360];

const NORMALS: JsonObject = {
  id: 'normals', kind: 'material', origin: 'composed', about: 'Base color |object normal|.', inputs: {},
  steps: { n: { op: 'normal@1', args: { space: 'object' } }, a: { op: 'abs@1', args: { x: 'n' } } }, outputs: { base_color: 'a' }, cost: { ns_per_px: 50 },
};
const FIELD = compute('field', { e: { op: 'element@1', args: {} }, w: { op: 'write@1', args: { buf: 'out', i: 'e', v: 'e' } } });
const STRIPES = pass('stripes', {
  px: { op: 'pixel@1', args: {} },
  pxx: { op: 'split@1', args: { x: 'px', pick: 'x' } },
  n: { op: 'const@1', args: { value: 64, type: 'u32' } },
  i: { op: 'rem@1', args: { a: 'pxx', b: 'n' } },
  v: { op: 'read@1', args: { buf: 'field', i: 'i' } },
  f: { op: 'convert@1', args: { x: 'v', to: 'f32' } },
  g: { op: 'div@1', args: { a: 'f', b: 64 } },
  out: { op: 'compose@1', args: { x: 'g', y: 'g', z: 'g', w: 1 } },
}, { inputs: { field: { type: 'u32', count: 64, from: { storage: { op: 'field', output: 'out' } } } } });

describe('#429.49543705 one taste call on the renderer\'s own screenshots', () => {
  it('#429.49543705 the three screenshots are taken from the renderer\'s output, and the recorded taste call says they look right', () => {
    requireGpu();
    const dir = out();
    const docs = [
      figure('taste-tint-429', { tint: asItem(tint()) }, { size: SIZE }),
      sceneDoc('taste-material-429', { cam: camera([2.5, 2, 3.5]), normals: asItem(NORMALS), m: { kind: 'material@1', params: { op: 'normals' } }, b: box([0, 0, 0], { material: 'm' }) }, { size: SIZE }),
      figure('taste-compute-429', { field: asItem(FIELD), stripes: asItem(STRIPES) }, { size: SIZE }),
    ];
    const keep = process.env['DEEPBUILD_EVIDENCE_DIR'] ?? join(tmpdir(), 'deep-429-taste');
    mkdirSync(keep, { recursive: true });
    const shots = docs.map((d, k) => {
      const f = frameOf(view3dFrames(run1(bins.bin(), dir, { call: 'view3d', doc: writeJson(dir, `taste-${k}.json`, d), look: LOOK, size: SIZE, fps: 60, frames: 1, targets: ['final'], capture: [0] }), String(d['id'])), 0, String(d['id']));
      expect(f.final, `${String(d['id'])}: the final target is written, named by its SHA-256`).toMatch(SHA);
      const kept = join(keep, `${String(d['id'])}-${f.final!}.png`);
      copyFileSync(join(dir, `${f.final!}.png`), kept);
      console.log(`screenshot for the taste call: ${kept}`);
      return f.final!;
    });
    const path = process.env['DEEPBUILD_TASTE_429'];
    if (!path || !existsSync(path)) inconclusive(`no taste call is recorded on these screenshots (${shots.join(', ')}); record yours in a file named by DEEPBUILD_TASTE_429`);
    const record = JSON.parse(readFileSync(path, 'utf8')) as { criterion?: string; by?: string; screenshots?: string[]; call?: string };
    if (record.criterion !== '#429.49543705' || record.by !== 'you' || JSON.stringify([...(record.screenshots ?? [])].sort()) !== JSON.stringify([...shots].sort())) {
      inconclusive(`the recorded taste call at ${path} isn't yours on these three screenshots (${shots.join(', ')})`);
    }
    expect(record.call, 'your taste call').toBe('looks_right');
  }, 1_800_000);
});

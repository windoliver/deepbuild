// AC7 #419.06b9bdd4: With `at_rest: settle`, a hover, a selection outline change and an overlay readout's text change
// continue the sample count, and the settled frame's pixels before overlays equal the 16-sample export by hash; a
// planted settle that resets on every presented frame never reaches 16 samples under a moving pointer and fails.
//
// The still scene with an `overlay.text@1` readout (helpers: `stillDoc(true)`), samples {live: 1, export: 16,
// at_rest: settle}. The live view runs 48 frames at rest under viewer-only input (README: Assumed surfaces 4): the
// pointer moves every frame from frame 1; the hover goes to `block` at frame 3, to nothing at 10 and to `ball` at 25;
// the selection becomes [block] at frame 5 and [] at 28; the readout's text changes at frames 7, 12 and 30. From frame
// to frame the reported sample count never falls; it reaches {drawn: 16, settling: false}, and every later frame
// keeps it; and that settled frame's `scene` target (the frame before overlays, outlines and hover marks: README:
// Assumed surfaces 6) has the hash of the 16-sample export's `scene` target. `--planted settle_resets_each_frame`
// restarts the count on every presented frame: under the moving pointer it never reaches 16 samples, and the check
// fails, saying so.
import { describe, it } from 'vitest';
import {
  AC, STILL_SIZE, failsNaming, framesOf, look, none, requireMetal, runGpu, stillDoc, useDir, useGpu, view3dCall, writeJson, type GpuPlanted,
  type Viewer,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();
const FRAMES = 48;
const LOOK = look({ live: 1, export: 16, atRest: 'settle', filter: 'blackman_harris', filterPx: 1.5 });
const EVENTS: Record<number, Omit<Viewer, 'frame'>> = {
  3: { hover: 'block' }, 5: { selection: ['block'] }, 7: { readout: { item: 'readout', text: 'x = 1' } }, 10: { hover: null },
  12: { readout: { item: 'readout', text: 'x = 2' } }, 25: { hover: 'ball' }, 28: { selection: [] }, 30: { readout: { item: 'readout', text: 'x = 3' } },
};
const VIEWER: Viewer[] = Array.from({ length: FRAMES - 1 }, (_, i) => ({ frame: i + 1, pointer: [40 + 4 * (i + 1), 60] as [number, number], ...EVENTS[i + 1] }));
const said = (n: number): string => `frame ${n} (${Object.keys({ pointer: 1, ...EVENTS[n] }).join(', ')})`;

function problems(out: string, planted?: GpuPlanted): string[] {
  const doc = writeJson(out, 'still', stillDoc(true));
  const [exp, live] = runGpu(bin(), out, [
    view3dCall({ doc, look: LOOK, size: STILL_SIZE, class: 'export', frames: 1, targets: ['scene'] }),
    view3dCall({ doc, look: LOOK, size: STILL_SIZE, class: 'live', frames: FRAMES, targets: ['scene'], viewer: VIEWER }),
  ], planted).map((r, i) => framesOf(r, i ? 'the live view' : 'the export'));
  const failures: string[] = [];
  const s = live!.map((f) => f.samples);
  if (s.some((x) => x === null)) return [`a live frame reports no samples {drawn, settling}`];
  const drawn = s.map((x) => x!);
  console.log(`${AC[7]}: live samples by frame: ${drawn.map((x) => `${x.drawn}${x.settling ? 's' : ''}`).join(' ')}`);
  const k = drawn.findIndex((x) => !x.settling && x.drawn === 16);
  if (k < 0) return [`the live view never reached 16 samples in ${FRAMES} frames under the moving pointer (most ${Math.max(...drawn.map((x) => x.drawn))})`];
  for (let n = 1; n <= k; n++) if (drawn[n]!.drawn < drawn[n - 1]!.drawn) failures.push(`${said(n)}: the sample count fell from ${drawn[n - 1]!.drawn} to ${drawn[n]!.drawn}`);
  for (let n = k + 1; n < FRAMES; n++) if (drawn[n]!.settling || drawn[n]!.drawn !== 16) failures.push(`${said(n)}: settling restarted after the frame settled (${drawn[n]!.drawn} samples)`);
  if (live![k]!.scene !== exp![0]!.scene) failures.push(`the settled frame ${k}'s pixels before overlays (${live![k]!.scene}) differ from the 16-sample export's (${exp![0]!.scene})`);
  return failures;
}

describe(`${AC[7]} viewer-only changes never restart the settle`, () => {
  it(`${AC[7]} a hover, a selection outline and readout text changes under a moving pointer continue the count to 16, and the settled frame before overlays is the export's by hash`, () => {
    requireMetal();
    none(problems(dir()), 'the settle under viewer-only input');
  }, 1_800_000);

  it(`${AC[7]} the planted settle that resets on every presented frame never reaches 16 samples under the moving pointer and fails`, () => {
    requireMetal();
    failsNaming(problems(dir(), 'settle_resets_each_frame'), ['never reached 16 samples'], '--planted settle_resets_each_frame');
  }, 1_800_000);
});

// AC8 #419.ef726005: A camera tracking a car across a 1920 × 1080 view at 600 px/s, at 24 fps with a 180° shutter and
// 16 samples, over a still background of 1 px white vertical lines on black: at t = 2 s the car's pixels equal the
// same frame without blur within 1 code value, and each background line spreads into a band 12.5 ± 1 px wide holding
// its summed linear energy within 1%, seeked or played; a planted sampler that holds the camera at the frame's time
// leaves the lines 1 px wide and streaks the car, and fails, naming the car.
//
// The car (helpers: `carDoc`): an orthographic camera at 100 px/m keyed, with its target, along x at 6 m/s, tracking a
// red unlit 4 × 1.5 m car keyed the same way, over 50 still 0.01 m (1 px) white unlit lines every 0.64 m (64 px). Frame
// 48 (t = 2 s) is exported with motion blur by samples at 16 samples, 180° (12.5 px of camera travel per shutter), both
// played from frame 0 and opened by a seek, and with blur off. On each blurred frame: every whole pixel of the car
// (x 760–1159, y 465–614) is within 1 code value of the unblurred frame in every channel of the final target; and on
// rows 100, 300, 800 and 1000, each line whose ±16 px window lies in the view (lines 20–49) has, in linear luminance,
// a band width √(12 σ²) (helpers: `bandWidth`, a lone 1 px line reads 1) of 12.5 ± 1 px and a summed energy within 1%
// of the same window's in the unblurred frame, where the line reads one pixel of energy 1 (the fixture's own check).
// `--planted sampler_holds_camera` evaluates the camera at the frame's time in every sample: the lines stay 1 px wide
// and the car smears 6 px each way, so the check fails, a failure naming `car`.
import { describe, it } from 'vitest';
import {
  AC, CAR, CAR_PIXELS, CAR_SIZE, bandWidth, blur, carDoc, carLineColumn, failsNaming, frameAt, framesOf, look, lum, none, px, readLinear,
  readPng, requireMetal, runGpu, useDir, useGpu, view3dCall, writeJson, type GpuPlanted, type Image, type Linear, type ViewFrame,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();
const ROWS = [100, 300, 800, 1000];
const HALF = 16;
const LINES = Array.from({ length: CAR.lines }, (_, k) => k).filter((k) => { const c = Math.floor(carLineColumn(k)); return c - HALF >= 0 && c + HALF < CAR_SIZE[0]; });

interface Drawn { final: Image; linear: Linear }
function judge(name: string, b: Drawn, n: Drawn): string[] {
  const failures: string[] = [];
  let off = 0; let first = '';
  for (let y = CAR_PIXELS.y0; y < CAR_PIXELS.y1; y++) for (let x = CAR_PIXELS.x0; x < CAR_PIXELS.x1; x++) {
    const p = px(b.final, x, y); const q = px(n.final, x, y);
    const d = Math.max(...[0, 1, 2].map((c) => Math.abs(p[c]! - q[c]!)));
    if (d > 1) { off++; if (!first) first = `(${x}, ${y}) by ${d}`; }
  }
  if (off) failures.push(`car (${name}): ${off} of its pixels differ from the frame without blur by more than 1 code value, the first at ${first}`);
  const widths: number[] = [];
  for (const y of ROWS) for (const k of LINES) {
    const c = Math.floor(carLineColumn(k));
    const window = (l: Linear): number[] => Array.from({ length: 2 * HALF + 1 }, (_, i) => lum(l.at(c - HALF + i, y)));
    const wb = bandWidth(window(b.linear)); const wn = bandWidth(window(n.linear));
    widths.push(wb.width);
    if (Math.abs(wn.sum - 1) > 0.02 || wn.width > 1.5) { failures.push(`line ${k} at (${c}, ${y}) (${name}): the unblurred line isn't one pixel of energy 1 (energy ${wn.sum.toFixed(3)}, width ${wn.width.toFixed(2)})`); continue; }
    if (Math.abs(wb.width - 12.5) > 1) failures.push(`line ${k} at (${c}, ${y}) (${name}): band ${wb.width.toFixed(2)} px wide, not 12.5 ± 1`);
    if (Math.abs(wb.sum - wn.sum) > 0.01 * wn.sum) failures.push(`line ${k} at (${c}, ${y}) (${name}): band energy ${wb.sum.toFixed(4)} against ${wn.sum.toFixed(4)} unblurred, off by more than 1%`);
  }
  console.log(`${AC[8]}: ${name}: car pixels off ${off}; band widths ${Math.min(...widths).toFixed(2)}–${Math.max(...widths).toFixed(2)} px over ${widths.length} lines × rows`);
  return failures;
}

function problems(out: string, planted?: GpuPlanted, play = true): string[] {
  const doc = writeJson(out, 'car', carDoc());
  const at = (on: boolean, from: number, frames: number) => view3dCall({
    doc, look: look({ motionBlur: on ? blur('samples', 16) : 'none' }), size: CAR_SIZE, class: 'export', fps: CAR.fps, from, frames, capture: [CAR.frame], targets: ['final', 'linear'],
  });
  const replies = runGpu(bin(), out, [at(false, CAR.frame, 1), at(true, CAR.frame, 1), ...(play ? [at(true, 0, CAR.frame + 1)] : [])], planted);
  const drawn = replies.map((r, i): Drawn => {
    const f: ViewFrame = frameAt(framesOf(r, `call ${i}`), CAR.frame, `call ${i}`);
    return { final: readPng(out, f.final, `call ${i}'s final target`), linear: readLinear(out, f, CAR_SIZE, `call ${i}`) };
  });
  return [...judge('seeked', drawn[1]!, drawn[0]!), ...(play ? judge('played', drawn[2]!, drawn[0]!) : [])];
}

describe(`${AC[8]} a tracking camera keeps its subject sharp while the background streaks`, () => {
  it(`${AC[8]} at t = 2 s, seeked and played, the car equals its unblurred pixels within 1 code and every background line is a 12.5 ± 1 px band holding its energy within 1%`, () => {
    requireMetal();
    none(problems(dir()), 'the tracked car over its lines');
  }, 1_800_000);

  it(`${AC[8]} the planted sampler that holds the camera at the frame's time leaves the lines 1 px wide and streaks the car, and fails, naming the car`, () => {
    requireMetal();
    failsNaming(problems(dir(), 'sampler_holds_camera', false), ['car (seeked)', 'not 12.5 ± 1'], '--planted sampler_holds_camera');
  }, 1_800_000);
});

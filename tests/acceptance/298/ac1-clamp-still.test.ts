// AC1: "On a 1920 × 1080 view with a 48 px safe margin, a 48 px square overlay with `clamp` whose anchor projects to
// (2400, 540) draws centered at (1848, 540) with `edge` 1 and `edge_angle` 0, and one projecting to (960, −300) draws at
// (960, 72) with `edge_angle` 270; one projecting to (2400, −300) draws at (1762.3, 72), where the ray from the center
// meets the inset frame's top, with `edge_angle` 329.7, and a planted clamp that clamps each axis on its own draws it at
// (1848, 72) and fails, naming the frame; an anchor behind the camera and to its left draws on the left edge, and a
// planted clamp that doesn't mirror behind-camera anchors draws it on the right edge and fails, naming the frame"
//
// The fixture (helpers.ts: clampDoc, still): five posts and a 48 px square tag on each post's top, `hide: "clamp"`,
// through the still camera at 1920 × 1080 with `safe: 48`. The posts' tops project to (2400, 540) (`east`), (960, −300)
// (`north`), (2400, −300) (`corner`) and (1110, 740) (`near`, inside the safe frame); `rear` stands 3 m behind the
// camera, 6 m to its left and 1 m above its axis.
//
// asserts, through `view3d`'s `overlays` rows (README: the `overlays` rows), frame 0:
//   - `tag-east` draws centered at (1848, 540) with `edge` 1 and `edge_angle` 0; `tag-north` at (960, 72) with 270;
//     `tag-corner` at (1762.29, 72) with 329.74: each within 0.05 px and 0.05° of the rule's own value, which the test
//     first holds to the issue's numbers; `edge_angle` in [0, 360);
//   - `tag-rear` draws on the left side, at (72, 392) with `edge` 1 and `edge_angle` 189.46: its projection mirrored
//     through the center, (−960, 220), then the same ray;
//   - `tag-near` draws centered on its anchor's projection, (1110, 740), with `edge` 0: the fixture's tags center on
//     their anchors, as the base places them;
//   - `--planted clamp_each_axis`: the same check fails, a failure naming the frame, `tag-corner` and (1848, 72);
//   - `--planted clamp_unmirrored_behind`: it fails, a failure naming the frame, `tag-rear` and the right side.
// Wrong programs: the base (a tag draws at its anchor's projection wherever that is, and hides behind the camera); a
// clamp of each axis on its own; one that clamps to the safe frame, forgetting the half size; one that takes the
// behind-camera projection as it falls; an angle counted counter-clockwise or from −180.
import { describe, expect, it } from 'vitest';
import {
  MARKERS, MARKER_NAMES, SAFE, TAG, angleOff, clampDoc, failsNaming, framesOf, none, requireGpu, rowsOf, runGpu, sidesOf, stillCam, tagId, tagRule,
  toScreen, useBins, useDir, view3d, writeJson, xy, TIMEOUT, type Frame, type GpuPlanted, type Marker,
} from './helpers.ts';

/** This criterion's ID: `#298.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs: criterionId). */
const ID = 'AC1 #298.febe6b8e';

const bin = useBins(['deep-gpu']);
const dir = useDir();
const SIZE: [number, number] = [1920, 1080];
const CAM = stillCam(SIZE);
/** The inset frame's sides: the safe margin plus the tag's half size. */
const REACH = SAFE + TAG / 2;
const side = (centre: readonly [number, number]): string => { const s = sidesOf(centre, SIZE, REACH); return s.length ? `, on the inset frame's ${s.join(' and ')} side` : ''; };

/** The fixture's own numbers against the issue's: they hold whatever the program does. */
function guards(): void {
  const projects = (m: Marker, x: number, y: number): void => {
    const p = toScreen(CAM, MARKERS[m]);
    expect(p.depth > 0 && Math.hypot(p.x - x, p.y - y) < 1e-6, `the fixture: ${m}'s top projects to (${x}, ${y}), got ${xy([p.x, p.y], 6)}`).toBe(true);
  };
  projects('east', 2400, 540); projects('north', 960, -300); projects('corner', 2400, -300); projects('near', 1110, 740);
  const rear = toScreen(CAM, MARKERS.rear);
  expect(rear.depth, 'the fixture: rear stands behind the camera').toBeLessThan(0);
  expect(MARKERS.rear[0], "the fixture: rear stands to the camera's left (the camera looks down −Z, so its left is −X)").toBeLessThan(0);
  // The issue's values, to the digit it prints: the rule reproduces them.
  const issue: [Marker, [number, number], number][] = [['east', [1848, 540], 0], ['north', [960, 72], 270], ['corner', [1762.3, 72], 329.7]];
  for (const [m, centre, angle] of issue) {
    const r = tagRule(m, CAM);
    expect(Math.abs(r.centre[0] - centre[0]) <= 0.05 && Math.abs(r.centre[1] - centre[1]) <= 0.05, `the rule puts tag-${m} at ${xy(centre, 1)}, got ${xy(r.centre, 4)}`).toBe(true);
    expect(r.edge === 1 && angleOff(r.angle, angle) <= 0.05, `the rule gives tag-${m} edge 1 and edge_angle ${angle}, got ${r.edge} and ${r.angle.toFixed(4)}`).toBe(true);
  }
  const r = tagRule('rear', CAM);
  expect(r.edge === 1 && sidesOf(r.centre, SIZE, REACH).join() === 'left', `the rule puts tag-rear on the left side, got ${xy(r.centre, 4)}`).toBe(true);
  expect(tagRule('near', CAM).edge, 'the rule leaves tag-near unclamped').toBe(0);
}

/** Frame 0's rows against the rule. Every failure names the frame and the overlay with its own frame. */
function judge(f: Frame | undefined): string[] {
  const at = `frame 0 (${SIZE[0]} × ${SIZE[1]}, safe ${SAFE})`;
  if (!f) return [`${at}: the reply holds no frame`];
  const rows = rowsOf(f);
  if (!rows) return [`${at}: the reply reports no overlays`];
  const failures: string[] = [];
  for (const m of MARKER_NAMES) {
    const want = tagRule(m, CAM);
    const who = `${at}: overlay ${tagId(m)} (its frame ${tagId(m)}-frame)`;
    const where = `${xy(want.centre)}${side(want.centre)}`;
    const row = rows.get(tagId(m));
    if (!row) { failures.push(`${who} has no row; it draws centered at ${where}`); continue; }
    if (!row.at) { failures.push(`${who} isn't drawn; it draws centered at ${where}`); continue; }
    const centre: [number, number] = [row.at[0] + TAG / 2, row.at[1] + TAG / 2];
    if (Math.abs(centre[0] - want.centre[0]) > 0.05 || Math.abs(centre[1] - want.centre[1]) > 0.05) failures.push(`${who} draws centered at ${xy(centre)}${side(centre)}, not at ${where}`);
    if (row.edge !== want.edge) failures.push(`${who} reports edge ${String(row.edge)}, not ${want.edge}`);
    if (want.edge === 1 && (row.angle === null || row.angle < 0 || row.angle >= 360 || angleOff(row.angle, want.angle) > 0.05)) failures.push(`${who} reports edge_angle ${String(row.angle)}, not ${want.angle.toFixed(2)}`);
  }
  return failures;
}

function run(planted?: GpuPlanted): string[] {
  const out = dir();
  const [reply] = runGpu(bin('deep-gpu'), out, [view3d({ doc: writeJson(out, 'still', clampDoc({ motion: 'still' })), size: SIZE, fps: 5, frames: 1 })], planted);
  return judge(framesOf(reply!, `the clamp fixture${planted ? ` under ${planted}` : ''}`).find((f) => f.frame === 0));
}

describe(`${ID} where a clamped overlay draws, and which way it points`, () => {
  it(`${ID} tags whose anchors project to (2400, 540), (960, −300) and (2400, −300) draw centered at (1848, 540), (960, 72) and (1762.3, 72) with edge 1 and edge_angle 0, 270 and 329.7, and one behind the camera and to its left draws on the left edge`, () => {
    requireGpu();
    guards();
    none(run(), 'the clamp fixture at 1920 × 1080');
  }, TIMEOUT);

  it(`${ID} the planted clamps fail, naming the frame: each axis on its own draws the corner tag at (1848, 72), and no mirror draws the tag behind the camera on the right edge`, () => {
    requireGpu();
    guards();
    failsNaming(run('clamp_each_axis'), [/^frame 0 /, /overlay tag-corner /, /draws centered at \(1848\.00, 72\.00\)/], 'the clamp of each axis on its own');
    failsNaming(run('clamp_unmirrored_behind'), [/^frame 0 /, /overlay tag-rear /, /draws centered at \([\d.]+, [\d.]+\), on the inset frame's right side/], "the clamp that doesn't mirror behind-camera anchors");
  }, TIMEOUT);
});

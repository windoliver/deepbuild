// AC5: "A leader on a clamped overlay draws nothing while `edge` is 1 and returns when the anchor comes back into the
// safe frame; a planted leader that keeps drawing crosses the frame and fails, naming the overlay"
//
// The fixture (helpers.ts: leaderDoc): 960 × 540 px, `safe: 24`, the still camera. The post `mate` slides out past the
// frame's right side and back over 4 s; its tag `tag` (48 px square, `hide: "clamp"`) is anchored to the post's top and
// carries a leader to the post's middle, 50 px below the anchor's projection. 21 frames at 5 a second: the anchor
// projects inside the safe frame at frames 0 to 4 and 16 to 20 and outside it at frames 5 to 15. The twin document is
// the same without the leader.
//
// asserts, through `view3d`, both documents played in one run, at each of the 21 frames:
//   - the tag's `edge` is 1 exactly where the rule clamps it (frames 5 to 15), else 0;
//   - while `edge` is 1 the tag's row carries `leader: null`, and the frame has the pixel hash of the same frame
//     without the leader: the leader draws nothing;
//   - while the anchor is inside the safe frame, before it leaves and after it comes back, the row's leader ends
//     within 0.5 px of the post's middle as the camera projects it then, and the frame's pixel hash differs from the
//     frame without the leader: the leader draws;
//   - `--planted leader_draws_while_clamped`: the same check fails, a failure naming `tag` and a leader that crosses
//     the frame.
// Guards on the fixture: every frame's anchor is at least 2 px clear of the readings the design leaves open, and from
// frame 6 to 14 the leader's far end lies off the frame, so a leader drawn then crosses the frame's edge.
// Wrong programs: the base (`hide` takes only off_frame and never, so the tag with its leader is refused); a leader
// that keeps drawing from the edge to its part; one that never comes back; one that hides by the leader's own end.
import { describe, expect, it } from 'vitest';
import {
  LEADER, STILL, TAG, clampRule, clearOf, failsNaming, fmt, frameSeconds, framesOf, leaderDoc, mateX, none, requireGpu, rowsOf, runGpu, toScreen,
  useBins, useDir, view3d, writeJson, xy, TIMEOUT, type Cam, type Frame, type GpuPlanted, type Placed,
} from './helpers.ts';

/** This criterion's ID: `#298.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs: criterionId). */
const ID = 'AC5 #298.1903184f';

const bin = useBins(['deep-gpu']);
const dir = useDir();
const [W, H] = LEADER.size;
const CAM: Cam = { kind: 'perspective', position: STILL.position, target: STILL.target, fov: STILL.fov, size: LEADER.size };
const FRAMES = Array.from({ length: LEADER.frames }, (_, n) => n);
/** The tag by the rule at frame n: its anchor is the post's top, 1 m above the post's middle. */
const ruleAt = (n: number): Placed => clampRule(LEADER.size, LEADER.safe, TAG / 2, 0, toScreen(CAM, [mateX(n), 1, 0]));
/** Where the leader ends at frame n: the post's middle. */
const endAt = (n: number): [number, number] => { const p = toScreen(CAM, [mateX(n), 0, 0]); return [p.x, p.y]; };
const offFrame = (p: readonly [number, number]): boolean => p[0] < 0 || p[0] > W || p[1] < 0 || p[1] > H;

/** The fixture's own numbers: they hold whatever the program does. */
function guards(): void {
  const clamped = FRAMES.filter((n) => ruleAt(n).edge === 1);
  expect(clamped, 'the fixture: the anchor projects outside the safe frame at frames 5 to 15').toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  for (const n of FRAMES) expect(clearOf(ruleAt(n), TAG / 2), `the fixture: frame ${n}'s anchor is clear of the readings the design leaves open`).toBeGreaterThanOrEqual(2);
  expect(FRAMES.filter((n) => offFrame(endAt(n))), "the fixture: the leader's far end lies off the frame from frame 6 to 14").toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14]);
}

/** The tag with its leader against the rule and against the twin without one. Every failure names the frame and the overlay. */
function judge(withLeader: Frame[], without: Frame[]): string[] {
  const failures: string[] = [];
  const bare = new Map(without.map((f) => [f.frame, f]));
  for (const f of withLeader) {
    const want = ruleAt(f.frame);
    const at = `frame ${f.frame} (${fmt(frameSeconds(f.frame, LEADER.fps), 1)} s): overlay tag`;
    const row = rowsOf(f)?.get('tag');
    if (!row) { failures.push(`${at} has no row in the frame's overlays`); continue; }
    if (row.edge !== want.edge) failures.push(`${at} reports edge ${String(row.edge)}, not ${want.edge}: its anchor projects toward ${xy(want.toward)}, ${want.edge ? 'outside' : 'inside'} the safe frame`);
    const hash = f.raw['pixel_hash']; const bareHash = bare.get(f.frame)?.raw['pixel_hash'];
    if (typeof hash !== 'string' || typeof bareHash !== 'string') { failures.push(`${at}: no pixel hash (with its leader ${String(hash)}, without ${String(bareHash)})`); continue; }
    const end = endAt(f.frame);
    if (want.edge === 1) {
      if (row.leader) failures.push(`${at} is clamped (edge 1) and its leader draws, to ${xy(row.leader.to)}${offFrame(row.leader.to) ? ', off the frame: the leader crosses the frame' : ''}`);
      else if (row.leader === undefined) failures.push(`${at} is clamped (edge 1) and its row has no leader member; a leader that hides is null`);
      if (hash !== bareHash) failures.push(`${at} is clamped (edge 1) and its frame hashes ${hash}, not ${bareHash} as the same frame without the leader does: the leader draws${offFrame(end) ? ' toward its part off the frame: it crosses the frame' : ''}`);
    } else {
      if (!row.leader) failures.push(`${at}: its anchor is inside the safe frame and its leader ${row.leader === null ? 'hides' : 'is missing from its row'}; it ends at ${xy(end)}`);
      else if (Math.hypot(row.leader.to[0] - end[0], row.leader.to[1] - end[1]) > 0.5) failures.push(`${at}: its leader ends at ${xy(row.leader.to)}, not at its part's projection ${xy(end)}`);
      if (hash === bareHash) failures.push(`${at}: its anchor is inside the safe frame and its frame hashes as the same frame without the leader does: the leader doesn't draw`);
    }
  }
  return failures;
}

function run(planted?: GpuPlanted): string[] {
  const out = dir();
  const call = (name: string, leader: boolean) => view3d({ doc: writeJson(out, name, leaderDoc(leader)), size: LEADER.size, fps: LEADER.fps, frames: LEADER.frames });
  const [a, b] = runGpu(bin('deep-gpu'), out, [call('leader', true), call('bare', false)], planted);
  const withLeader = framesOf(a!, 'the tag with its leader');
  const without = framesOf(b!, 'the tag without a leader');
  expect(withLeader.map((f) => f.frame), 'the run with the leader draws frames 0 to 20').toEqual(FRAMES);
  expect(without.map((f) => f.frame), 'the run without the leader draws frames 0 to 20').toEqual(FRAMES);
  return judge(withLeader, without);
}

describe(`${ID} a leader hides while its overlay is clamped`, () => {
  it(`${ID} the leader on a clamped overlay draws nothing while edge is 1 and returns when the anchor comes back into the safe frame`, () => {
    requireGpu();
    guards();
    none(run(), "the tag's leader while its post slides out of the frame and back");
  }, TIMEOUT);

  it(`${ID} the planted leader that keeps drawing crosses the frame and fails, naming the overlay`, () => {
    requireGpu();
    guards();
    failsNaming(run('leader_draws_while_clamped'), [/overlay tag is clamped \(edge 1\)/, /crosses the frame/], 'the leader that keeps drawing while its overlay is clamped');
  }, TIMEOUT);
});

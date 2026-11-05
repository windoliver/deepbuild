// AC5 #425.f5321458: A showpiece that stepped down for frame health stays down while its view is unchanged, even with
// headroom, and climbs again once the camera moves or you raise it.
//
// `test-meter` build; the ladder runs on the stub meter, the noop backend and the virtual clock, so this runs on every
// platform. A showpiece whose view stays still (a channel slides one box, so every frame draws) is charged 5 ms of its
// 10 ms for frames 1–150, 12 ms for 151–180, then 5 ms again: it climbs to scale_1_moving at 120, steps back to base
// for frame health by 180, and holds there through frame 420 with 240 frames of headroom. Then either the camera moves
// at frame 421 (your orbit, a `camera` event), and it climbs again for headroom by 120 frames later, or you raise it at
// 421 (a `rung` event), and it is at scale_1_moving from then on, reason you. Planted: a frame-health drop that climbs
// again after 120 frames of headroom whether the view changed or not.
import { describe, it } from 'vitest';
import {
  AC, failsNaming, liveCall, liveOf, none, runGpu, said, showpiece, useBuilds, useDir, writeJson,
  type Charge, type GpuPlanted, type Live, type LiveEvent,
} from './helpers.ts';

const ID = AC[5];
const bin = useBuilds(['test-meter']);
const dir = useDir();
const CHARGES: Charge[] = [{ from: 1, to: 150, gpu_ms: 5 }, { from: 151, to: 180, gpu_ms: 12 }, { from: 181, gpu_ms: 5 }];
const MOVE = 421;

function live(event: LiveEvent, frames: number, planted?: GpuPlanted): Live {
  const out = dir();
  const doc = writeJson(out, 'still', showpiece(false));
  const [r] = runGpu(bin('test-meter'), out, [liveCall({ doc, frames, charges: CHARGES, events: [event] })], { backend: 'noop', ...(planted ? { planted } : {}) });
  return liveOf(r!, 'the live call');
}

/** Up at 120, down for frame health by 180, held at base with headroom until frame 421, then up again: for headroom
 * within 121 frames of the camera's move, or at once for you. */
function holdProblems(l: Live, by: 'camera' | 'you'): string[] {
  const out: string[] = [];
  const [up, down, again, ...rest] = l.changes;
  if (!up || up.frame !== 120 || up.from !== 'base' || up.to !== 'scale_1_moving' || up.reason !== 'headroom') return [`frame 120 should climb base → scale_1_moving for headroom; the first change is ${up ? said(up) : 'missing'}`];
  if (!down || down.frame < 151 || down.frame > 180 || down.from !== 'scale_1_moving' || down.to !== 'base' || down.reason !== 'frame_health') return [`by frame 180 it should step scale_1_moving → base for frame health; the next change is ${down ? said(down) : 'missing'}`];
  if (!again) return [`after frame ${MOVE} it never climbed again`];
  if (again.frame < MOVE) out.push(`it climbed again at frame ${again.frame} with its view unchanged and no one raising it: ${said(again)}`);
  else if (by === 'camera' && (again.frame > MOVE + 121 || again.from !== 'base' || again.to !== 'scale_1_moving' || again.reason !== 'headroom')) out.push(`after the camera moved at frame ${MOVE} it should climb base → scale_1_moving for headroom within 121 frames; it moved ${said(again)}`);
  else if (by === 'you' && (again.frame !== MOVE || again.to !== 'scale_1_moving' || again.reason !== 'you')) out.push(`your raise at frame ${MOVE} should take it to scale_1_moving, reason you; it moved ${said(again)}`);
  for (const c of rest) out.push(`an unexpected change, ${said(c)}`);
  for (const v of l.views) {
    if (v.frame >= down.effective && v.frame < Math.min(MOVE, again.effective) && v.rung !== 'base') out.push(`frame ${v.frame} drew at ${v.rung} with its view unchanged after the drop, not base`);
    if (again.frame >= MOVE && v.frame >= again.effective && v.rung !== 'scale_1_moving') out.push(`frame ${v.frame} drew at ${v.rung} after it climbed again, not scale_1_moving`);
  }
  return out;
}

describe(`${ID} a frame-health drop holds until the view changes or you raise it`, () => {
  it(`${ID} after stepping down for frame health the showpiece stays down with headroom and a still view, and climbs again once the camera moves or you raise it`, () => {
    none(holdProblems(live({ frame: MOVE, camera: { session: 's', azimuth: 10 } }, 560), 'camera'), 'held until the camera moved');
    none(holdProblems(live({ frame: MOVE, rung: { session: 's', to: 'scale_1_moving' } }, 460), 'you'), 'held until you raised it');
  }, 1_800_000);

  it(`${ID} a drop that climbs again without a view change fails, naming the frame`, () => {
    const l = live({ frame: MOVE, camera: { session: 's', azimuth: 10 } }, 560, 'reclimbs_without_view_change');
    failsNaming(holdProblems(l, 'camera'), ['with its view unchanged'], '--planted reclimbs_without_view_change');
  }, 1_800_000);
});

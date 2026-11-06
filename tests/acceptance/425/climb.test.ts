// AC4 #425.96e311e5: With a stub meter that reports half of the showpiece class's frame time free on this machine, a
// showpiece's live view climbs from render scale 0.5 to 1 after 120 frames of headroom and steps back down within 30
// frames once the headroom is gone; a render-back snapshot and an export of the same revision are byte-identical
// whether or not the live view climbed.
//
// `test-meter` build on Metal. A showpiece whose camera orbits (so its view moves and draws at the class's render
// scale while moving, 0.5) is charged 5 ms of its 10 ms a frame by the stub meter, then 12 ms from frame 151: it
// climbs base → scale_1_moving for headroom at frame 120, draws at scale 1 until it steps back to base for frame health
// by frame 180, then at 0.5 again. Render-backs and exports of its frame 10 asked while it was climbed (frame 140, and
// frame 245 of a run that climbed on to samples_4_moving at 240), after it stepped down (frame 190), in a run that never
// climbed (charged 12 ms throughout) and by a fresh process with no live session all draw at the base rung, byte for
// byte the same. Planted: a climb that never steps down, and canonical renders drawn at the live rung.
import { describe, it } from 'vitest';
import {
  AC, CLIMB, canonicalEvents, failsNaming, freshCanonical, liveCall, liveOf, none, requireMetal, runGpu, said, showpiece, useBuilds, useDir,
  writeJson, canonicalOf, type Canonical, type Charge, type GpuPlanted, type Live, type LiveEvent, type Purpose,
} from './helpers.ts';

const ID = AC[4];
const bin = useBuilds(['test-meter']);
const dir = useDir();

function live(charges: Charge[], frames: number, events: LiveEvent[], planted?: GpuPlanted): { live: Live; fresh: Canonical[] } {
  requireMetal();
  const out = dir();
  const doc = writeJson(out, 'showpiece', showpiece(true));
  const [r] = runGpu(bin('test-meter'), out, [liveCall({ doc, frames, charges, events })], planted ? { planted } : {});
  const fresh = runGpu(bin('test-meter'), out, (['render_back', 'export'] as Purpose[]).map((p) => freshCanonical(doc, p)));
  return { live: liveOf(r!, 'the live call'), fresh: fresh.map((c, i) => canonicalOf(c, `a fresh process's canonical render ${i}`)) };
}

/** Climbed at 120 for headroom, down to base for frame health by 180, nothing else; scale 0.5, then 1, then 0.5. */
function climbProblems(l: Live): string[] {
  const out: string[] = [];
  const up = l.changes.find((c) => c.to === 'scale_1_moving' && c.reason === 'headroom');
  const down = l.changes.find((c) => c.from === 'scale_1_moving' && c.reason === 'frame_health');
  if (!up) return [`no climb to scale_1_moving for headroom by frame 190; the changes: ${l.changes.map(said).join('; ') || 'none'}`];
  if (up.frame !== 120 || up.from !== 'base') out.push(`the climb is ${said(up)}, not base → scale_1_moving after 120 frames of headroom (frame 120)`);
  if (up.effective > 150) out.push(`the climb took effect at frame ${up.effective}, after the headroom ended at frame 150`);
  if (!down) out.push(`no step down for frame health by frame 180, 30 frames after the headroom went at frame 151; the changes: ${l.changes.map(said).join('; ')}`);
  else if (down.frame < 151 || down.frame > 180 || down.to !== 'base') out.push(`the step down is ${said(down)}, not scale_1_moving → base within 30 frames of frame 151 (by frame 180)`);
  for (const c of l.changes) if (c !== up && c !== down) out.push(`an unexpected change, ${said(c)}`);
  for (const v of l.views) {
    const want = v.frame < up.effective ? 0.5 : down && v.frame >= down.effective ? 0.5 : 1;
    if (v.internal_scale !== want) out.push(`frame ${v.frame} drew at render scale ${v.internal_scale} (rung ${v.rung}), not ${want}`);
  }
  return out;
}

/** Each canonical render draws at the base rung, and each purpose's renders are the same bytes as the fresh process's,
 * whatever the live view's rung was when it was asked. */
function canonicalProblems(runs: Live[], fresh: Canonical[]): string[] {
  const out: string[] = [];
  for (const purpose of ['render_back', 'export']) {
    const ref = fresh.find((c) => c.purpose === purpose);
    if (!ref || ref.pixel_hash === null) { out.push(`the fresh process drew no ${purpose} pixels`); continue; }
    for (const l of runs) {
      for (const c of l.canonicals.filter((x) => x.purpose === purpose)) {
        const rung = l.views.find((v) => v.frame === c.frame)?.rung ?? 'unknown';
        if (c.rung !== 'base') out.push(`${purpose} asked at frame ${c.frame}, the live view at ${rung}, drew at rung ${c.rung}, not base`);
        if (c.pixel_hash !== ref.pixel_hash) out.push(`${purpose} asked at frame ${c.frame}, the live view at ${rung}, has pixels ${c.pixel_hash}, not the fresh process's ${ref.pixel_hash}`);
      }
    }
  }
  return out;
}

const HEADROOM_THEN_NONE: Charge[] = [{ from: 1, to: 150, gpu_ms: 5 }, { from: 151, gpu_ms: 12 }];

describe(`${ID} the live view climbs with headroom and steps back down; canonical renders never climb`, () => {
  it(`${ID} half the showpiece's frame time free climbs it from render scale 0.5 to 1 after 120 frames and back within 30 once the headroom is gone, its render-back and export the same bytes either way`, () => {
    const events = [...canonicalEvents(140), ...canonicalEvents(190)];
    const r = live(HEADROOM_THEN_NONE, 190, events);
    none(climbProblems(r.live), 'the climb and the step down');
    none(canonicalProblems([r.live], r.fresh), 'render-backs and exports while climbed and after');
    const never = live(HEADROOM_THEN_NONE, 190, events, 'climb_never_steps_down');
    failsNaming(climbProblems(never.live), ['frame 180'], '--planted climb_never_steps_down');
  }, 1_800_000);

  it(`${ID} a render-back and an export asked while the view has climbed on to 4 samples equal those of a view that never climbed and of a fresh process`, () => {
    const climbed = live([{ from: 1, gpu_ms: 5 }], 250, canonicalEvents(245));
    const order: string[] = [];
    const want = [{ frame: 120, from: 'base', to: 'scale_1_moving' }, { frame: 240, from: 'scale_1_moving', to: 'samples_4_moving' }];
    want.forEach((w, i) => {
      const c = climbed.live.changes[i];
      if (!c || c.frame !== w.frame || c.from !== w.from || c.to !== w.to || c.reason !== 'headroom') order.push(`frame ${w.frame} should climb ${w.from} → ${w.to} for headroom; change ${i} is ${c ? said(c) : 'missing'}`);
    });
    none(order, 'the live view climbs rung by rung, 120 frames apart');
    const flat = live([{ from: 1, gpu_ms: 12 }], 250, canonicalEvents(245));
    none(flat.live.changes.filter((c) => (CLIMB as readonly string[]).includes(c.to)).map((c) => `the view with no headroom climbed: ${said(c)}`), 'the control never climbs');
    none(canonicalProblems([climbed.live, flat.live], climbed.fresh), 'render-backs and exports whether or not the view climbed');
    const planted = live([{ from: 1, gpu_ms: 5 }], 250, canonicalEvents(245), 'canonical_climbs');
    failsNaming(canonicalProblems([planted.live], climbed.fresh), ['samples_4_moving'], '--planted canonical_climbs');
  }, 1_800_000);
});

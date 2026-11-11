// #2016.dd1c9e69 AC1, its last clause: "… and seeking equals playing by pixel hash"
//
// The swaying field (fixtures/field.json) played from frame 0 to 96 at 8 fps in one `view3d` call, and sought in
// fresh `deep-gpu run` processes that open the field at frame 17, 45 and 96 (`from`, #380) and draw that frame first.
// Each sought frame's pixel hash equals the played frame's on this machine. Guards: the three played frames differ
// (the field moves under a still camera, so a frame drawn for another time shows), and every frame, played or
// sought, reports each tree's gust term in `sway` (README: The surface under test), so the frames compared are the
// GPU sway's, not the base's CPU deform. Every failure is listed together, guards and comparisons alike. Metal only:
// INCONCLUSIVE off macOS.

import { describe, expect, it } from 'vitest';
import { FPS, LAST, requireMetal, trees, useBuild, useOut, view3d, writeField, type Frame } from './helpers.ts';

const AC = '#2016.dd1c9e69 AC1';
const bin = useBuild();
const out = useOut();
/** Frames sought: 2.125 s, 5.625 s and 12 s. */
const SOUGHT = [17, 45, LAST];

/** Where a run's frames don't all report each tree's gust term in `sway` (the GPU sway didn't draw them), one line saying so; else none. */
function notTheGpuSway(frames: Frame[], ids: string[], what: string): string[] {
  const gaps = frames.flatMap((f) => {
    if (f.sway === null) return [`frame ${f.frame} has no \`sway\``];
    const missing = ids.filter((id) => typeof f.sway!.get(id)?.gust !== 'number');
    return missing.length ? [`frame ${f.frame} reports no gust term for ${missing.length} trees (${missing[0]} first)`] : [];
  });
  return gaps.length ? [`${what}: ${gaps.length} of ${frames.length} frames aren't shown to be the GPU sway's, each tree's gust term reported in \`sway\` (${gaps[0]} first)`] : [];
}

describe(`${AC}: the swaying field, seek against play`, () => {
  it(`${AC} (seek equals play): seeking to frames ${SOUGHT.join(', ')} equals playing to them by pixel hash`, () => {
    requireMetal();
    const ids = trees().map((t) => t.id);
    const doc = writeField(out(), true);
    const played = view3d(bin(), out(), doc, 0, LAST + 1, ids, 'the swaying field, played');
    const hashes = SOUGHT.map((n) => played[n]!.pixelHash);
    for (const [i, n] of SOUGHT.entries()) expect(hashes[i], `the played frame ${n} has a pixel hash`).toMatch(/^[0-9a-f]+$/);
    const problems = notTheGpuSway(played, ids, 'played');
    if (new Set(hashes).size !== SOUGHT.length) problems.push(`played frames ${SOUGHT.join(', ')} don't all differ (${hashes.map((h) => h?.slice(0, 12)).join(', ')}), so the field doesn't move and a frame drawn for another time wouldn't show`);
    for (const [i, n] of SOUGHT.entries()) {
      const sought = view3d(bin(), out(), doc, n, 1, ids, `the swaying field, sought to frame ${n}`);
      problems.push(...notTheGpuSway(sought, ids, `sought to frame ${n}`));
      if (sought[0]!.pixelHash !== hashes[i]) problems.push(`seeking to frame ${n} (${n / FPS} s) draws ${sought[0]!.pixelHash?.slice(0, 16)}, playing to it ${hashes[i]?.slice(0, 16)}`);
    }
    expect(problems, `${AC}: seeking equals playing by pixel hash, on this machine, on frames the GPU sway drew`).toEqual([]);
  }, 1_800_000);
});

// AC2: "At 390 × 844 and 1920 × 1080, every clamped overlay's box lies inside the safe area at 20 sampled times of a
// flythrough; a planted clamp to the frame instead of the safe area puts one under the inset and fails, naming the
// overlay"
//
// The fixture (helpers.ts: clampDoc, fly): the clamp fixture's five posts and tags, `safe: 48`, with the camera flown
// past the posts over 4 s and turned to look back (FLY). One document drawn at both sizes; `tag-north` asks
// `clamp_inset: 16`. The 20 sampled times are frames 0 to 19 at 5 frames a second.
//
// asserts, through `view3d`'s `overlays` rows at each size, at each of the 20 frames, for each of the five tags:
//   - the tag has a row and draws (`at` is not null): a clamped overlay stays on the frame's edge, it never hides;
//   - its box, 48 px square from `at`, lies inside the safe area, x from 48 to W − 48 and y from 48 to H − 48, within
//     0.01 px; `tag-north`, where the rule clamps it, keeps 16 px more ("more space inside the safe area");
//   - `--planted clamp_to_frame`: the same check fails, a failure naming a tag and the safe area it leaves.
// Guards on the fixture, from its own numbers: at both sizes every sampled pair of a post and a time is at least 2 px
// clear of the two readings the design leaves open (README: What couldn't be tested), no post's top comes within 0.4 m
// of the camera's plane, and at each size at least 30 pairs are clamped, 6 put the anchor behind the camera, 8 leave
// the tag on its anchor, and the clamped tags reach all four sides.
// Wrong programs: the base (a tag draws at its anchor's projection, off the frame, and hides behind the camera); a
// clamp to the frame; a clamp to the safe frame that forgets the tag's half size; a clamp worked out for one size.
import { describe, expect, it } from 'vitest';
import {
  FLY, INSET, MARKERS, MARKER_NAMES, SAFE, TAG, clampDoc, clearOf, failsNaming, flyCam, fmt, frameSeconds, framesOf, none, requireGpu, rowsOf, runGpu,
  sidesOf, tagId, tagRule, toScreen, useBins, useDir, view3d, writeJson, xy, TIMEOUT, type GpuPlanted, type JsonObject, type Placed,
} from './helpers.ts';

/** This criterion's ID: `#298.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs: criterionId). */
const ID = 'AC2 #298.ef87b0b5';

const bin = useBins(['deep-gpu']);
const dir = useDir();
const SIZES: [number, number][] = [[390, 844], [1920, 1080]];
const FRAMES = Array.from({ length: FLY.frames }, (_, n) => n);

/** The fixture's own numbers: they hold whatever the program does. */
function guards(): void {
  expect(FRAMES.length, 'the fixture: 20 sampled times').toBe(20);
  for (const size of SIZES) {
    const at = `the fixture at ${size[0]} × ${size[1]}`;
    let clamped = 0; let behind = 0; let onAnchor = 0;
    const sides = new Set<string>();
    for (const n of FRAMES) {
      const cam = flyCam(n, size);
      for (const m of MARKER_NAMES) {
        const inset = INSET[m] ?? 0;
        const r = tagRule(m, cam, inset);
        expect(Math.abs(toScreen(cam, MARKERS[m]).depth), `${at}, frame ${n}: ${m}'s top is clear of the camera's plane`).toBeGreaterThanOrEqual(0.4);
        expect(clearOf(r, TAG / 2 + inset), `${at}, frame ${n}: ${m}'s anchor is clear of the readings the design leaves open (${r.edge ? 'outside the safe frame' : 'its box inside the safe area'})`).toBeGreaterThanOrEqual(2);
        if (r.behind) behind++;
        if (r.edge === 1) { clamped++; sidesOf(r.centre, size, SAFE + inset + TAG / 2).forEach((s) => sides.add(s)); } else onAnchor++;
      }
    }
    expect(clamped, `${at}: at least 30 pairs of a tag and a time are clamped`).toBeGreaterThanOrEqual(30);
    expect(behind, `${at}: at least 6 pairs put the anchor behind the camera`).toBeGreaterThanOrEqual(6);
    expect(onAnchor, `${at}: at least 8 pairs leave the tag on its anchor`).toBeGreaterThanOrEqual(8);
    expect([...sides].sort(), `${at}: the clamped tags reach all four sides`).toEqual(['bottom', 'left', 'right', 'top']);
  }
}

/** One size's rows against the safe area. Every failure names the size, the frame and the overlay. */
function judge(reply: JsonObject, size: [number, number]): string[] {
  const [w, h] = size;
  const frames = framesOf(reply, `the flythrough at ${w} × ${h}`);
  expect(frames.map((f) => f.frame), `the flythrough at ${w} × ${h} draws frames 0 to 19`).toEqual(FRAMES);
  const failures: string[] = [];
  for (const f of frames) {
    const at = `${w} × ${h}, frame ${f.frame} (${fmt(frameSeconds(f.frame, FLY.fps), 1)} s)`;
    const rows = rowsOf(f);
    if (!rows) { failures.push(`${at}: the reply reports no overlays`); continue; }
    for (const m of MARKER_NAMES) {
      const inset = INSET[m] ?? 0;
      const want: Placed = tagRule(m, flyCam(f.frame, size), inset);
      const row = rows.get(tagId(m));
      if (!row) { failures.push(`${at}: overlay ${tagId(m)} has no row`); continue; }
      if (!row.at) { failures.push(`${at}: overlay ${tagId(m)} isn't drawn; its anchor points toward ${xy(want.toward)}${want.behind ? ', behind the camera' : ''}, and a clamped overlay never hides`); continue; }
      const keep = SAFE + (want.edge === 1 ? inset : 0);
      const over = Math.max(keep - row.at[0], row.at[0] + TAG - (w - keep), keep - row.at[1], row.at[1] + TAG - (h - keep));
      if (over > 0.01) {
        failures.push(`${at}: overlay ${tagId(m)}'s box, ${xy(row.at)} to ${xy([row.at[0] + TAG, row.at[1] + TAG])}, leaves the safe area${keep > SAFE ? ` less its clamp_inset of ${inset} px` : ''} (${keep} to ${w - keep} by ${keep} to ${h - keep}) by ${fmt(over)} px: it lies under the inset`);
      }
    }
  }
  return failures;
}

function run(planted?: GpuPlanted): string[] {
  const out = dir();
  const doc = writeJson(out, 'fly', clampDoc({ motion: 'fly' }));
  const replies = runGpu(bin('deep-gpu'), out, SIZES.map((size) => view3d({ doc, size, fps: FLY.fps, frames: FLY.frames })), planted);
  return SIZES.flatMap((size, k) => judge(replies[k]!, size));
}

describe(`${ID} clamped overlays keep to the safe area through a flythrough, at a phone's size and a desktop's`, () => {
  it(`${ID} at 390 × 844 and 1920 × 1080 every clamped overlay's box lies inside the safe area at the flythrough's 20 sampled times`, () => {
    requireGpu();
    guards();
    none(run(), 'the clamped tags through the flythrough');
  }, TIMEOUT);

  it(`${ID} the planted clamp to the frame puts a tag under the inset and fails, naming the overlay`, () => {
    requireGpu();
    guards();
    failsNaming(run('clamp_to_frame'), [/overlay tag-(east|north|corner|rear|near)'s box/, /leaves the safe area/, /under the inset/], 'the clamp to the frame instead of the safe area');
  }, TIMEOUT);
});

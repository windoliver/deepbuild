// Criterion 4: a replica recording with mask: [{label: "Email"}] over a run that scrolls the email field by 200 px has,
// in every recorded frame including those mid-scroll, every pixel inside the field's box equal to the fill role, and its
// actions list holds one entry per action with each click's point inside the clicked element's box (README: Criterion 4).
//
// The run is recorded twice in two fresh replicas on the virtual clock, once masked and once with no mask, so frame k of
// one is frame k of the other but for the mask. The fixture paints its field in a green nothing else draws, so the
// unmasked frames show where the field really is in each frame, independently of what the recorder says its box was.
// The field's bounds before and after the scroll, and Save's bounds before its click, come from `see`. The judge
// (helpers.ts, maskProblems and actionProblems) also runs on the real recording made wrong three ways, and on small
// synthetic recordings with each fault the criterion names, which needs no replica.
import { afterEach, describe, expect, it } from 'vitest';
import {
  Drive, FPS, FRAME_FLICKS, ID, INK, FIELD, PANEL, SCALE, SCROLL_PX, actionProblems, cleanup, launch, maskProblems, must, readFrames, requireMacos,
  type Box, type Frame, type Obj, type Recording,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const EMAIL = { label: 'Email' };
const boundsOf = async (drive: Drive, replica: string, locator: Obj): Promise<Box> => {
  const s = await must(drive, { call: 'see', replica, locator, see: { scope: 'locator', include: ['roles', 'bounds'] } });
  expect(Array.isArray(s.snapshot?.tree?.bounds), `see of ${JSON.stringify(locator)} answers its bounds`).toBe(true);
  return s.snapshot.tree.bounds as Box;
};

async function record(mask: Obj[]): Promise<{ stop: Obj; start: Box; end: Box; save: Box; replies: Obj[] }> {
  const drive = await Drive.start();
  const replica = await launch(drive, { from: 'fixture', panel: PANEL.form, clock: 'virtual', scale: SCALE, theme: 'light' });
  const start = await boundsOf(drive, replica, EMAIL);
  await must(drive, { call: 'record', replica, record: { action: 'start', fps: FPS, marks: 'per_action', mask, mask_kind: 'fill' } });
  const replies = [
    await must(drive, { call: 'act', replica, locator: EMAIL, act: { kind: 'click' } }),
    await must(drive, { call: 'act', replica, locator: EMAIL, act: { kind: 'type', text: 'ada@example.com' } }),
    await must(drive, { call: 'act', replica, locator: { text: 'Email' }, act: { kind: 'scroll', dx: 0, dy: SCROLL_PX } }),
  ];
  await must(drive, { call: 'wait_for', replica, wait_for: { state: 'settled' } });
  const save = await boundsOf(drive, replica, { role: 'button', name: 'Save' });
  replies.push(await must(drive, { call: 'act', replica, locator: { role: 'button', name: 'Save' }, act: { kind: 'click' } }));
  const stop = await must(drive, { call: 'record', replica, record: { action: 'stop' } });
  const end = await boundsOf(drive, replica, EMAIL);
  await must(drive, { call: 'close', replica });
  await drive.stop();
  return { stop, start, end, save, replies };
}

describe(`${ID.mask} a recording masked at {label: "Email"} over a 200 px scroll fills the field's box with the ink role in every frame, and lists every action`, () => {
  it(`${ID.mask} every recorded frame, mid-scroll ones included, fills the field's box with the fill role and shows no pixel of the field; each click's point lies in its element's box`, async () => {
    requireMacos();
    const masked = await record([EMAIL]);
    const plain = await record([]);
    expect(masked.stop.sha256, 'the recording is a video by hash').toMatch(/^[0-9a-f]{64}$/);
    expect(masked.start[1] - masked.end[1], `see puts the field ${SCROLL_PX} px higher after the scroll, at ${SCALE}x`).toBe(SCROLL_PX * SCALE);
    const problems = maskProblems(readFrames(masked.stop), readFrames(plain.stop), { start: masked.start, end: masked.end, scrollPx: SCROLL_PX, scale: SCALE });
    expect(problems).toEqual([]);
    expect(actionProblems(masked.stop.actions, [{ kind: 'click', box: masked.start }, { kind: 'type' }, { kind: 'scroll' }, { kind: 'click', box: masked.save }])).toEqual([]);
    // The judge on this real recording made wrong: frames dropped mid-scroll, the mask a frame behind, no mask at all.
    const real = readFrames(masked.stop);
    const plainFrames = readFrames(plain.stop);
    const lo = Math.min(masked.start[1], masked.end[1]), hi = Math.max(masked.start[1], masked.end[1]);
    const opts = { start: masked.start, end: masked.end, scrollPx: SCROLL_PX, scale: SCALE };
    const skipped: Recording = { ...real, frames: real.frames.filter((f) => !(f.masks[0]![1] > lo && f.masks[0]![1] < hi)) };
    expect(maskProblems(skipped, plainFrames, opts).join('\n'), 'a recorder that skips mid-scroll frames fails').toMatch(/missing or extra|mid-scroll|frames and the unmasked/);
    const behind: Recording = { ...real, frames: real.frames.map((f, k) => ({ ...f, masks: real.frames[Math.max(0, k - 1)]!.masks })) };
    expect(maskProblems(behind, plainFrames, opts).join('\n'), 'a mask a frame behind the scroll fails').toMatch(/aren't the fill role|outside the masked box/);
    const bare: Recording = { ...real, frames: plainFrames.frames.map((f, k) => ({ ...f, masks: real.frames[k]!.masks })) };
    expect(maskProblems(bare, plainFrames, opts).join('\n'), 'frames with nothing masked fail').toMatch(/show in the masked recording/);
    const lost = [...masked.stop.actions as Obj[]];
    lost.splice(2, 1);
    expect(actionProblems(lost, [{ kind: 'click', box: masked.start }, { kind: 'type' }, { kind: 'scroll' }, { kind: 'click', box: masked.save }]).join('\n'), 'an actions list missing the scroll fails').toMatch(/3 entries for 4 actions/);
  }, 900_000);
});

// ---------------------------------------------------------------------------------------------------
// The judge on synthetic recordings: a 40 x 60 frame, the field a 10 x 6 green box scrolled from y 40 to y 20 (10 px at 2x)
// over five frames at 30 fps. The right recording passes; each wrong one fails, named.

const W = 40, H = 60;
const start: Box = [5, 40, 10, 6], end: Box = [5, 20, 10, 6];
const ys = [40, 35, 30, 25, 20];
function image(y: number, fieldColor: number[] | null): Frame['image'] {
  const rgba = new Uint8Array(W * H * 4).fill(255);
  for (let i = 0; i < W * 2; i++) { rgba[i * 4] = 10; } // a mark of the app's own at the top
  if (fieldColor) for (let yy = y; yy < y + 6; yy++) for (let x = 5; x < 15; x++) { const o = (yy * W + x) * 4; rgba[o] = fieldColor[0]!; rgba[o + 1] = fieldColor[1]!; rgba[o + 2] = fieldColor[2]!; rgba[o + 3] = fieldColor[3] ?? 255; }
  return { width: W, height: H, rgba };
}
const frames = (color: number[] | null, masks: (y: number, k: number) => Box[], at: (y: number, k: number) => number = (y) => y): Frame[] =>
  ys.map((y, k) => ({ t: k * FRAME_FLICKS, image: image(at(y, k), color), masks: masks(y, k) }));
const unmasked: Recording = { frames: frames([...FIELD], () => []), fill: [] };
const right: Recording = { frames: frames(INK, (y) => [[5, y, 10, 6]]), fill: [...INK] };
const opts = { start, end, scrollPx: 10, scale: 2 };

describe('criterion 4\'s judge, on synthetic recordings (no replica; it passes at the base)', () => {
  it('passes the right recording and fails each wrong one, naming its fault', () => {
    expect(maskProblems(right, unmasked, opts)).toEqual([]);
    const skipped: Recording = { ...right, frames: right.frames.filter((_, k) => k === 0 || k === 4) };
    expect(maskProblems(skipped, { ...unmasked, frames: unmasked.frames.filter((_, k) => k === 0 || k === 4) }, opts).join('\n'), 'skips mid-scroll frames').toMatch(/missing or extra/);
    const behind: Recording = { ...right, frames: frames(INK, (_, k) => [[5, ys[Math.max(0, k - 1)]!, 10, 6]]) };
    expect(maskProblems(behind, unmasked, opts).join('\n'), 'masks where the field was a frame before').toMatch(/aren't the fill role/);
    // The field drawn where it is, and the ink where it was before the scroll.
    const stuck: Recording = {
      frames: ys.map((y, k) => {
        const img = image(y, [...FIELD]);
        for (let yy = 40; yy < 46; yy++) for (let x = 5; x < 15; x++) img.rgba.set(INK, (yy * W + x) * 4);
        return { t: k * FRAME_FLICKS, image: img, masks: [[5, 40, 10, 6] as Box] };
      }),
      fill: [...INK],
    };
    expect(maskProblems(stuck, unmasked, opts).join('\n'), 'keeps the box it had before the scroll').toMatch(/show in the masked recording/);
    const grey: Recording = { frames: frames([128, 128, 128, 255], (y) => [[5, y, 10, 6]]), fill: [128, 128, 128, 255] };
    expect(maskProblems(grey, unmasked, opts).join('\n'), 'fills with another colour').toMatch(/not the look's ink role/);
    const leaky: Recording = { ...right, frames: right.frames.map((f, k) => k === 2 ? { ...f, image: image(ys[2]!, [...FIELD]) } : f) };
    expect(maskProblems(leaky, unmasked, opts).join('\n'), 'misses one frame').toMatch(/frame 2 .*show in the masked recording/);
    const noScroll: Recording = { frames: frames(INK, () => [[5, 40, 10, 6]], () => 40), fill: [...INK] };
    expect(maskProblems(noScroll, { frames: frames([...FIELD], () => [], () => 40), fill: [] }, opts).join('\n'), 'a run that never scrolled').toMatch(/after the scroll|mid-scroll/);
  });

  it('passes an actions list with one entry per action and each click in its box, and fails one missing an entry or clicking outside', () => {
    const save: Box = [100, 200, 160, 56];
    const actions = [
      { t: 0, kind: 'click', point: [10, 43], box: start, locator: { label: 'Email' } },
      { t: 5, kind: 'type', point: [10, 43], box: start, locator: { label: 'Email' } },
      { t: 9, kind: 'scroll', point: [6, 30], box: [5, 30, 20, 8], locator: { text: 'Email' } },
      { t: 20, kind: 'click', point: [180, 228], box: save, locator: { role: 'button', name: 'Save' } },
    ];
    const expected = [{ kind: 'click', box: start }, { kind: 'type' }, { kind: 'scroll' }, { kind: 'click', box: save }];
    expect(actionProblems(actions, expected)).toEqual([]);
    expect(actionProblems(actions.slice(0, 3), expected).join('\n')).toMatch(/3 entries for 4 actions/);
    expect(actionProblems(actions.map((a, i) => (i === 3 ? { ...a, point: [99, 228] } : a)), expected).join('\n')).toMatch(/outside the clicked element's box/);
    expect(actionProblems(actions.map((a, i) => (i === 0 ? { ...a, box: [5, 41, 10, 6] } : a)), expected).join('\n')).toMatch(/isn't the clicked element's bounds/);
  });
});

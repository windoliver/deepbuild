// AC13 #499.d5826069: With the item out of view for 3 s: 0 decodes, 0 frames armed by it and 0 wakeups from it. Back
// in view, the frame shown equals the source frame at `t`.
//
// Through `deep-canvas-render idle` (#854's window on the real clock, with #1487's `view.rect`) and this suite's
// `pans` and `store`: a board holds a still card and the recording (README: Fixtures) as an image@1 drawn 1:1, so the
// live view decodes it at its source size. The window opens on the recording, which plays; at 1 s a pan shows only the
// card; at 4 s a pan brings the recording back; the run ends at 5 s. In the 3 s out of view (`views[1]`, from the
// frame the pan out presented to the pan back), the window must draw nothing (the card is still, so any frame is the
// recording's), the player must send no decode, and, on a reference Mac, the process must make no wakeup. The first
// frame shown after the pan back must be the source frame at its own `t`, by decoded-planes hash against ffmpeg's
// decode, and `t` must have run on while the item was away. A warm-up run, then five runs in one process; the
// wakeups are judged by #854's rule over the five. The criterion names no wrong program; the base fails it.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, LOOK, REC, REC_TIMELINE, TIMEOUT, asset, blocked, documentOf, fl, frameAt, idleRuns, judgeFive, nameFrame, putStore, recordingMp4, rect,
  referenceFrames, secs, sha256, useBinary, useTemp, videoItem, type IdleRun, type Rect,
} from './helpers.ts';

const renderBin = useBinary('deep-canvas-render');
const temp = useTemp('out-of-view');

/** Shows the recording whole (its box is [900, 300, 320, 240]); nothing else. */
const V_VIDEO: Rect = [800, 200, 640, 360];
/** Shows the card only; the recording's box is 260 u to its right. */
const V_CARD: Rect = [0, 0, 640, 360];

let cached: { runs: IdleRun[]; hashes: string[] } | string | undefined;
function runs(): { runs: IdleRun[]; hashes: string[] } {
  if (cached === undefined) {
    const dir = temp();
    const path = join(dir, 'recording.mp4');
    recordingMp4(path);
    const hashes = referenceFrames(path, REC.w, REC.h, REC.count).map((b) => sha256(b));
    const store = join(dir, 'store');
    const sha = putStore(store, readFileSync(path));
    const doc = documentOf('out-of-view', 'board', [1440, 600], [rect('card', [40, 40, 400, 240], 'muted'), videoItem('rec', sha, [900, 300, REC.w, REC.h])], { rec: asset(sha) }, {}, { span: '10s' });
    const line = { doc, look: LOOK, view: { zoom: 1, theme: 'light', rect: V_VIDEO }, seconds: 5, store, pans: [{ at_ms: 1000, rect: V_CARD }, { at_ms: 4000, rect: V_VIDEO }] };
    const got = idleRuns(renderBin(), line, 'idle with the recording panned away');
    cached = typeof got === 'string' ? got : { runs: got, hashes };
  }
  if (typeof cached === 'string') blocked(cached);
  return cached;
}

/** What is wrong with one run's 3 s out of view and its return, wakeups aside. */
function runFailures(r: IdleRun, hashes: string[], n: number): string[] {
  const f: string[] = [];
  const at = `run ${n}`;
  if (r.views.length !== 3) return [`${at}: ${r.views.length} views, not the opening view and the two pans`];
  const [, away, back] = r.views as [IdleRun['views'][number], IdleRun['views'][number], IdleRun['views'][number]];
  if (away.rect.join(',') !== V_CARD.join(',')) f.push(`${at}: the second view is ${JSON.stringify(away.rect)}, not the card's`);
  if (away.to_ms - away.from_ms < 2950) f.push(`${at}: the recording was out of view for only ${(away.to_ms - away.from_ms).toFixed(0)} ms`);
  const p = r.players.get('rec');
  if (!p) return [...f, `${at}: the player rec isn't reported`];
  const before = p.shown.filter((s) => s.at_ms < away.from_ms);
  if (before.length < 20) f.push(`${at}: the recording showed only ${before.length} frames in view before the pan, so it wasn't playing`);
  if (away.frames !== 0) f.push(`${at}: ${away.frames} frames were armed and drawn while the recording was out of view`);
  const decodes = p.decodes.filter((d) => d.at_ms > away.from_ms && d.at_ms < away.to_ms);
  if (decodes.length) f.push(`${at}: ${decodes.length} decodes while out of view, the first of source frame ${decodes[0]!.frame} at ${decodes[0]!.at_ms.toFixed(1)} ms`);
  const shownAway = p.shown.filter((s) => s.at_ms > away.from_ms && s.at_ms < away.to_ms);
  if (shownAway.length) f.push(`${at}: ${shownAway.length} frames shown while out of view`);
  const ret = p.shown.find((s) => s.at_ms >= back.from_ms);
  if (!ret) return [...f, `${at}: no frame shown after the recording came back into view`];
  if (ret.planes === null) return [...f, `${at}: the first frame back in view carries no planes hash`];
  const want = frameAt(REC_TIMELINE, ret.t);
  if (ret.planes !== hashes[want]) f.push(`${at}: back in view at t = ${ret.t} flicks (${secs(ret.t)}) the item shows ${nameFrame(hashes, ret.planes)}, not source frame ${want}, the frame at t`);
  const last = before[before.length - 1];
  if (last && ret.t - last.t < fl(2.9)) f.push(`${at}: t moved only ${secs(ret.t - last.t)} while the recording was away for 3 s`);
  return f;
}

describe(`${AC[13]} a video out of view stops decoding and, back in view, shows the source frame at t`, () => {
  it(`${AC[13]} out of view for 3 s the recording arms no frame and sends no decode; back in view the frame shown is the source frame at its t, in each of five runs`, () => {
    const { runs: list, hashes } = runs();
    const failures = list.flatMap((r, i) => runFailures(r, hashes, i + 1));
    expect(failures, 'out of view: 0 frames armed and 0 decodes; back in view: the source frame at t').toEqual([]);
  }, TIMEOUT);

  it(`${AC[13]} on a reference Mac the process makes 0 wakeups while the recording is out of view`, () => {
    const { runs: list } = runs();
    // A wakeup count means something only for a window that drew nothing out of view.
    expect(list.map((r) => r.views[1]?.frames), 'every run drew 0 frames out of view').toEqual([0, 0, 0, 0, 0]);
    const wakeups = list.map((r) => r.views[1]?.wakeups ?? Number.NaN);
    const reading = `wakeups out of view ${wakeups.join(', ')} over five runs`;
    console.log(`${AC[13]} ${reading}`);
    judgeFive(wakeups.map((w, i) => (w === 0 ? null : `run ${i + 1} made ${w} wakeups out of view`)), reading);
  }, TIMEOUT);
});

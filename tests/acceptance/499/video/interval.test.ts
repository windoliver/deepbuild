// AC7 #499.035a05de: On a 30 fps MP4 with time base 1/15360 and on a variable-rate screen recording whose frame 10
// lasts three nominal frames, an image item shows the frame whose presentation interval holds the source time,
// checked at each frame's own time, one flick before it and 200 seeded times, by decoded-frame hash against an
// accurate seek; a planted lookup by ⌊t × frame_rate⌋ fails on the variable-rate file, naming the frame.
//
// Through `deep-show run`: each fixture (#498's two recipes) is placed as an image@1 at start 0, in 0, rate 1 on a
// board, so source time is t; `eval` at each time gives the `video` block's planes hash, compared with ffmpeg's
// accurate decode of every frame. The expected frame is computed here in integers: the last frame k with
// pts_k × 705,600,000 ≤ t × den (frame 0 before the first frame's time). A frame's own time is the first flick at or
// after its presentation time, so on the first fixture, whose ticks are 45,937.5 flicks, "one flick before" lies in the
// previous frame. The wrong program is `planted: "lookup_floors_frame_rate"`.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, CFR30, DOC, TIMEOUT, VFR, asset, cfr30, documentOf, endFlick, evalCall, evaluated, frameAt, nameFrame, ownFlick, present,
  presented, probeFixture, putEvidence, referenceFrames, runShow, scenario, screenVfr, secs, seededFlicks, sha256, shownOf, useBinary,
  useTemp, videoItem, type JsonObject, type Timeline,
} from './helpers.ts';

const showBin = useBinary('deep-show');
const temp = useTemp('interval');

interface Fixture { name: string; doc: string; tl: Timeline; tb: string; sha: string; hashes: string[]; times: number[] }

/** Each frame's own time, the flick before it (when not before 0), and 200 seeded times in the stream's span. */
function timesOf(tl: Timeline, seed: number): number[] {
  const own = tl.ticks.map((_, k) => ownFlick(tl, k));
  const all = [...own, ...own.map((t) => t - 1).filter((t) => t >= 0), ...seededFlicks(seed, 200, 0, endFlick(tl))];
  return [...new Set(all)].sort((a, b) => a - b);
}

function make(evidence: string): Fixture[] {
  const dir = temp();
  const list = [
    { name: 'the 30 fps MP4', doc: DOC.a, tl: CFR30, tb: '1/15360', path: join(dir, 'cfr30-tb15360.mp4'), recipe: cfr30, seed: 499_007 },
    { name: 'the screen recording', doc: DOC.b, tl: VFR, tb: '1/600', path: join(dir, 'screen-recording-vfr.mov'), recipe: screenVfr, seed: 499_070 },
  ];
  return list.map((f) => {
    f.recipe(f.path);
    const p = probeFixture(f.path);
    expect(p.tb, `fixture ${f.path}: ffprobe's time base (the recipe broke if not)`).toBe(f.tb);
    expect(p.pts, `fixture ${f.path}: ffprobe's presentation times (the recipe broke if not)`).toEqual(f.tl.ticks);
    const hashes = referenceFrames(f.path, 320, 240, f.tl.ticks.length).map((b) => sha256(b));
    expect(new Set(hashes).size, `fixture ${f.path}: every frame decodes to different planes`).toBe(hashes.length);
    return { name: f.name, doc: f.doc, tl: f.tl, tb: f.tb, sha: putEvidence(evidence, readFileSync(f.path)), hashes, times: timesOf(f.tl, f.seed) };
  });
}

/** Per fixture, every time the item shows another frame than the one whose interval holds t, in time order. */
function check(evidence: string, fixtures: Fixture[], planted?: string): string[][] {
  const calls: JsonObject[] = [];
  for (const f of fixtures) {
    calls.push(present(f.doc, documentOf(`interval-${f.tb.replace('/', '-')}`, 'board', [320, 240], [videoItem('rec', f.sha, [0, 0, 320, 240])], { rec: asset(f.sha) }, {}, { span: '3s' })));
    calls.push(...f.times.map((t) => evalCall(f.doc, t)));
  }
  const replies = runShow(showBin(), scenario(evidence, calls, planted), planted ? `planted ${planted}` : 'the two recordings');
  let i = 0;
  return fixtures.map((f) => {
    presented(replies[i++]!, `the board with ${f.name}`);
    const bad: string[] = [];
    for (const t of f.times) {
      const got = shownOf(evaluated(replies[i++]!, `${f.name}: eval at ${t}`), 'rec', `${f.name}: eval at ${t} flicks`).planes;
      const want = frameAt(f.tl, t);
      if (got !== f.hashes[want]) bad.push(`${f.name}: at ${t} flicks (${secs(t)}) the item shows ${nameFrame(f.hashes, got)}, not source frame ${want}, whose interval holds that time`);
    }
    return bad;
  });
}

describe(`${AC[7]} a video's frame at t is the one whose presentation interval holds the source time, in the stream's own time base`, () => {
  it(`${AC[7]} at each frame's own time, one flick before it and 200 seeded times, both files show the frame whose interval holds t by decoded-frame hash; a lookup by ⌊t × frame_rate⌋ fails on the variable-rate file, naming frame 10`, () => {
    const evidence = temp();
    const fixtures = make(evidence);
    const [cfr, vfr] = check(evidence, fixtures);
    expect(cfr, 'the 30 fps MP4 at time base 1/15360').toEqual([]);
    expect(vfr, 'the screen recording whose frame 10 lasts three frames').toEqual([]);
    // The wrong program: frame = ⌊source time × the stream's nominal frame rate⌋. After 110/600 s it reads frame 11
    // while frame 10 still shows; the first time it is wrong lies in frame 10's interval.
    const [, wrong] = check(evidence, fixtures, 'lookup_floors_frame_rate');
    expect(wrong!.length, 'the planted lookup fails on the variable-rate file').toBeGreaterThan(0);
    expect(wrong![0], `the planted lookup's first failure names frame 10; got ${JSON.stringify(wrong!.slice(0, 3))}`).toMatch(/^the screen recording: at \d+ flicks .* not source frame 10,/);
  }, TIMEOUT);
});

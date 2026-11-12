// Criterion 4 (no upstream test): "A piece with span open, a logic item and a recorded track of 10 minutes plays live
// past any authored end, seeks anywhere in the 10 minutes played, and a seek past the last step played lands on it;
// with loop wrap it's refused at check, naming loop; a video export with no range is refused, naming span open, while
// one over the recorded track's range exports 10 minutes; and a planted transport that reads open as a span of 0 stops
// play at the start and fails"
//
// Live play through `deep-logic view` with `span: "open"` and `frame`'s `play` and `seek` (README: deep-logic): the
// piece is the turn game (programs.ts) at 60 Hz on a fixed clock, its recorded track the 40 moves, the last at 600 s.
// Play runs one second a frame for 600 s; 20 seeded whole seconds below 600 are sought in a seeded order and must land
// there with playing's full-state hash; a seek to 700 s, past the last step played (step 36,000 at 600 s), must land at
// 600 s. The document half goes through deep-show (README: The export document), which seals no logic module, so its
// document is a figure with `transport.span: open`: `deep show` with `loop: wrap` is refused with an error issue at
// `transport/loop`; an export with no range is refused with code `span_open`; one over the recorded track's range,
// [0, its last entry at 600 s], exports 600 s, 4,800 frames at 8 fps. deep-show is built only after the live legs pass.
// `open_span_reads_zero` reads an open span as a span of 0.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, FIGURE, FLICKS, TIMEOUT, arr, failsNaming, fmt, int, issuesOf, live, logicBin, none, obj, openFigure, openView, piece, prebuild, present, runShow, secs, seeded, show, showScenario,
  type JsonObject, type Planted,
} from './helpers.ts';
import { CONTROLS, fortyMoves, turnItem } from './programs.ts';

prebuild(() => { logicBin(); });

const ID = 'game';
const SEED = 545_04;
const MOVES = fortyMoves();
/** The recorded track's last entry: 600 s. */
const END = 600;
const TRACK_END = MOVES[MOVES.length - 1]!.t;
/** 20 seeded whole seconds in the 10 minutes played. */
const SEEKS: number[] = (() => {
  const r = seeded(545_41);
  const out = new Set<number>();
  while (out.size < 20) out.add(Math.floor(r() * END));
  return [...out];
})();
const game = (): JsonObject => piece({ seed: SEED, controls: CONTROLS, items: { [ID]: turnItem('fixed') } });

interface Shown { t: number; deep: string }
interface OpenRun { played: Shown[]; seeks: Shown[]; past: Shown }
/** Plays the piece live with an open span for 600 s, a second a frame, then seeks to the 20 seconds and to 700 s. */
async function playOpen(planted: Planted[] = []): Promise<OpenRun> {
  const l = live(planted);
  try {
    const v = await openView(l, game(), MOVES, 'open');
    const shown = (f: Awaited<ReturnType<typeof v.frame>>): Shown => ({ t: f.landed.t, deep: f.landed.deep_hash[ID]! });
    const played = [shown(await v.frame())];
    for (let s = 1; s <= END; s++) played.push(shown(await v.frame({ play: 1 })));
    const seeks: Shown[] = [];
    for (const s of SEEKS) seeks.push(shown(await v.frame({ seek: s })));
    return { played, seeks, past: shown(await v.frame({ seek: 700 })) };
  } finally { l.stop(); }
}
/** The criterion's live rules over a run, each failure naming the time. */
function judgeOpen(r: OpenRun): string[] {
  const failures: string[] = [];
  const stop = r.played.findIndex((p, s) => p.t !== s * FLICKS);
  if (stop >= 0) failures.push(r.played[stop]!.t < stop * FLICKS ? `play stopped at ${secs(r.played[stop]!.t)}, short of ${fmt(stop)} s` : `play reached ${secs(r.played[stop]!.t)}, not ${fmt(stop)} s`);
  SEEKS.forEach((s, i) => {
    const got = r.seeks[i]!;
    if (got.t !== s * FLICKS) failures.push(`the seek to ${s} s landed at ${secs(got.t)}`);
    else if (got.deep !== r.played[s]!.deep) failures.push(`the seek to ${s} s shows full-state hash ${got.deep}, playing showed ${r.played[s]!.deep}`);
  });
  if (r.past.t !== END * FLICKS) failures.push(`a seek to 700 s, past the last step played, landed at ${secs(r.past.t)}, not on it at 600 s`);
  else if (r.past.deep !== r.played[END]!.deep) failures.push(`a seek to 700 s landed at 600 s with full-state hash ${r.past.deep}, playing showed ${r.played[END]!.deep}`);
  return failures;
}

describe(`${AC[4]} an open span plays live with no end, seeks only what was played, and an export takes a finite range`, () => {
  it(`${AC[4]} a piece with span open, a logic item and a 10-minute recorded track plays past any authored end, seeks anywhere in what was played and lands a seek past it on the last step played; loop wrap is refused naming loop; an export with no range is refused naming span open, and one over the track's range exports 10 minutes`, async () => {
    expect(TRACK_END, 'the recorded track\'s last entry is at 600 s').toBe(END * FLICKS);
    none(judgeOpen(await playOpen()), 'live play with an open span');

    const evidence = mkdtempSync(join(tmpdir(), 'deep-545-evidence-'));
    const out = mkdtempSync(join(tmpdir(), 'deep-545-export-'));
    try {
      const exportCall = (name: string, extra: JsonObject = {}): JsonObject =>
        ({ call: 'export', doc: DOC.b, out: join(out, name), video: { codec: 'h264' }, audio: { sample_rate: 8000 }, size: FIGURE.size, ...extra });
      const [wrap, open, whole, track] = runShow(showScenario(evidence, [
        present(DOC.a, openFigure('wrap')),
        present(DOC.b, openFigure()),
        exportCall('whole.mp4'),
        exportCall('track.mp4', { range: [0, TRACK_END] }),
      ]), 'the figure with an open span');
      expect(wrap!['outcome'], `the figure with span open and loop wrap is refused at check: ${show(wrap)}`).toBe('refused');
      const loop = issuesOf(wrap!, 'the refusal').filter((i) => i.severity === 'error' && i.path === 'transport/loop');
      expect(loop.length, `an error issue names loop (transport/loop): ${show(wrap!['issues'])}`).toBeGreaterThan(0);
      expect(open!['outcome'], `the figure with span open and no loop is presented: ${show(open)}`).toBe('presented');
      expect([whole!['outcome'], whole!['code']], `the export with no range is refused, naming span open: ${show(whole)}`).toEqual(['refused', 'span_open']);
      expect(existsSync(join(out, 'whole.mp4')), 'and writes no file').toBe(false);
      expect(track!['outcome'], `the export over the recorded track's range is exported: ${show(track)}`).toBe('exported');
      const receipt = obj(track!['receipt'], 'its receipt');
      expect(int(receipt['duration'], 'receipt.duration'), 'it lasts 10 minutes: 600 s in flicks').toBe(END * FLICKS);
      expect(arr(receipt['frame_hashes'], 'receipt.frame_hashes').length, '4,800 frames at 8 fps').toBe(END * FIGURE.rate[0]);
      expect(existsSync(join(out, 'track.mp4')), 'the file is written').toBe(true);
    } finally {
      rmSync(evidence, { recursive: true, force: true });
      rmSync(out, { recursive: true, force: true });
    }
  }, TIMEOUT);

  it(`${AC[4]} a planted transport that reads open as a span of 0 (open_span_reads_zero) stops play at the start and fails`, async () => {
    none(judgeOpen(await playOpen()), 'the real transport');
    const planted = await playOpen(['open_span_reads_zero']);
    expect(planted.played.every((p) => p.t === 0), 'the planted transport holds the playhead at 0 s').toBe(true);
    failsNaming(judgeOpen(planted), /^play stopped at 0 s, short of 1 s$/, 'the planted transport');
  }, TIMEOUT);
});

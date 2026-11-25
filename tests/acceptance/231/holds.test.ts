// AC1 #231.ceba88e3: "A film holding still for 30 s, with no time reader in view, counts exactly 1 draw and 1 hash for
// the hold in the export and 1 more of each in export.fidelity's redraw, with no frame read back, the same as a 1 s
// hold, and its delivery still decodes to 1,800 frames at 60 fps and passes export.fidelity"
// AC2 #231.c9318808: "A planted reuse across a changed reading or status binding fails, naming the frame"
// AC6 #231.69ce6ea8: "A 30 s hold exported at 60 fps counts 1 draw with no time reader in view, 720 draws with grain at
// 24 fps and 1,800 with a particle item, and ten sampled frames of each equal seek renders at the same times by pixel
// hash on the same machine; a planted reuse that ignores `valid_until` freezes the grain and fails, naming the first
// frame"
//
// Through `deep-show run`'s `export` (README: `export`): the reply's `work` (the export's work counters), the
// receipt's `reused_frames`, `frame_hashes`, `fidelity` and `handoff`, the delivered MP4 read here, and a still export
// as the seek render of a frame. The films are small (320 × 180) and made at test time (README: Fixtures). The 30 s
// hold's delivery is exported once and read by criteria 1 and 6. Counts hold on any machine. A film a planted program
// may draw wrongly is exported as a draft, so the suite's own judge reads its frames and the delivery's decode can't
// stop it first. Wrong programs: the merge base (it draws and hashes all 1,800 frames, and its reply holds no `work`
// and its receipt no `reused_frames`); `reuse_across_readings`; `reuse_ignores_valid_until`.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, BY_SURFACE, CHANGES, DOC, DRAFT, FULL, READINGS, RECORD, TOOLS, blocked, count, countFailures, countedOf, exportCall, failsNaming, handoffOf, hexes, holdFilm,
  kitLaws, lawOf, none, obj, particleFilm, present, presented, readbackFailures, readingsFilm, receiptOf, runShow, sameWorkFailures, sampleFrames, scenario,
  seekFailures, seekRenders, useFileTemp, useShow, useTemp, videoTrack, type JsonObject, type Planted,
} from './helpers.ts';

const show = useShow();
const temp = useTemp();
const kept = useFileTemp();

const FRAMES = 1800;
/** Ten sampled frames of a 30 s hold: the first, the last frame of the first grain pattern (2), the first frame of
 * the second (3: 3/60 s is past 1/24 s), the last, and six seeded. */
const SAMPLES = sampleFrames(FRAMES, 10, [0, 2, 3, FRAMES - 1]);

/** The 30 s hold and the 1 s hold, each delivered as H.264 with AAC by one process; made once for the file. */
let made: { long: JsonObject; short: JsonObject; out: string } | undefined;
function holds(): { long: JsonObject; short: JsonObject; out: string } {
  if (made) return made;
  const evidence = kept(); const dir = kept();
  const out = join(dir, 'hold-30s.mp4');
  const replies = runShow(show(FULL), scenario(evidence, [
    present(DOC.a, holdFilm(evidence, 30).document), present(DOC.b, holdFilm(evidence, 1).document),
    exportCall(DOC.a, out), exportCall(DOC.b, join(dir, 'hold-1s.mp4')),
  ]), 'the 30 s hold and the 1 s hold, delivered');
  presented(replies[0], 'the 30 s hold'); presented(replies[1], 'the 1 s hold');
  made = { long: replies[2]!, short: replies[3]!, out };
  return made;
}

describe(`${AC[1]} a held span costs one frame's draw and hash whatever its length, and its delivery still holds every frame`, () => {
  it(`${AC[1]} the 30 s hold's delivery counts 1 draw and 1 hash and 1 more of each in export.fidelity's redraw, as the 1 s hold's does, and decodes to 1,800 frames at 60 fps past export.fidelity`, () => {
    const { long, short, out } = holds();
    const what = 'the 30 s hold\'s delivery';
    const c = countedOf(long, what);
    const d = countedOf(short, 'the 1 s hold\'s delivery');
    none([
      ...countFailures(what, c, { frames: FRAMES, draws: 1, purpose: 'delivery' }),
      ...countFailures('the 1 s hold\'s delivery', d, { frames: 60, draws: 1, purpose: 'delivery' }),
      ...sameWorkFailures('the 30 s hold', c.work, 'the 1 s hold', d.work),
    ], 'a 30 s hold costs one draw and one hash, one more of each for export.fidelity, the same as a 1 s hold');
    expect(new Set(c.hashes).size, 'all 1,800 frames of the hold carry the one drawn frame\'s hash').toBe(1);
    const r = receiptOf(long, what);
    // Frames handed over as GPU surfaces are never read back; a copy through memory is the design's fallback, whose
    // own readback the next test leaves out by exporting through a tool that takes surfaces.
    if (handoffOf(r, what) === 'surface') expect(c.work.frames_read_back, `${what}, handed over as GPU surfaces: work.frames_read_back`).toBe(0);
    // The delivery still holds every frame: export.fidelity read 1,800 from the file, and the file's own track says so.
    expect(r.rate, `${what}: the receipt's frame rate`).toEqual([60, 1]);
    expect(count(obj(r.raw['fidelity'], `${what}: receipt.fidelity`)['frames'], `${what}: receipt.fidelity.frames`), `${what}: export.fidelity decoded every frame of the delivery`).toBe(FRAMES);
    const track = videoTrack(out, what);
    expect(track.samples, `${what}: the MP4's video track holds a sample for each of the 1,800 frames`).toBe(FRAMES);
    expect(track.lengths.reduce((sum, [n]) => sum + n, 0), `${what}: the track times every sample`).toBe(FRAMES);
    expect(track.lengths.filter(([, delta]) => delta * 60 !== track.timescale), `${what}: every sample lasts 1/60 s (timescale ${track.timescale})`).toEqual([]);
  });

  it(`${AC[1]} handed over as GPU surfaces, the 30 s hold is drawn and hashed once, no frame is read back, and the encode tool still takes all 1,800 frames`, () => {
    if (process.platform !== 'darwin') blocked(`the one encode tool that takes GPU surfaces, ${String(BY_SURFACE['tool'])}, is macOS's, and this is ${process.platform}`);
    const evidence = temp(); const dir = temp();
    const what = 'the 30 s hold, a draft handed over as GPU surfaces';
    const [shown, reply] = runShow(show(TOOLS), scenario(evidence, [present(DOC.a, holdFilm(evidence, 30).document), exportCall(DOC.a, join(dir, 'hold'), { ...DRAFT, ...BY_SURFACE })]), what);
    presented(shown, 'the 30 s hold');
    const c = countedOf(reply, what);
    const r = receiptOf(reply, what);
    if (handoffOf(r, what) !== 'surface') blocked(`${what}: the receipt's handoff reads copy, so no frame was handed over as a GPU surface on this machine`);
    none([...countFailures(what, c, { frames: FRAMES, draws: 1, purpose: 'draft' }), ...readbackFailures(what, c.work, 1)], what);
    // The tool's own report (#518's): the frames it took, by the hash of the slot's pixels as it read them.
    const taken = hexes(obj(obj(r.raw['encoder'], `${what}: receipt.encoder`)['report'], `${what}: receipt.encoder.report`)['frames'], `${what}: receipt.encoder.report.frames`);
    expect(taken.length, `${what}: the tool was handed every one of the 1,800 frames, the held ones as repeats of the same slot`).toBe(FRAMES);
    expect([...new Set(taken)], `${what}: every frame the tool took is the one drawn frame`).toEqual([c.hashes[0]]);
  });

  it(`${AC[1]} the export module's kit states the held-span law by the export's work counters: one draw and one hash for a held span, and in a delivery one more of each`, () => {
    const law = lawOf(kitLaws(show(FULL), temp()), 'held_span');
    expect(law.verdict, `the kit's held_span law: ${JSON.stringify(law.raw).slice(0, 600)}`).toBe('PASS');
    expect(law.counted, 'the kit\'s held_span law counted a held span as a draft and as a delivery').toEqual({ draft: { draws: 1, hashes: 1 }, delivery: { draws: 1, hashes: 1, fidelity: { draws: 1, hashes: 1 } } });
  });
});

/** The film whose reading changes at frame 40 and whose status binding changes at frame 80, exported as a draft with
 * its record's changes: what the count and the seek renders (the shipped build's, at `at`) find wrong. */
function readingsRun(at: readonly { frame: number; hash: string }[], planted?: Planted): string[] {
  const evidence = temp(); const dir = temp();
  const what = `the film whose record changes${planted ? ` (planted ${planted})` : ''}`;
  const [shown, reply] = runShow(show(FULL), scenario(evidence, [present(DOC.a, readingsFilm(evidence).document), exportCall(DOC.a, join(dir, 'readings.mp4'), { ...DRAFT, readings: READINGS })], { record: RECORD, ...(planted ? { planted } : {}) }), what);
  presented(shown, what);
  const c = countedOf(reply, what);
  return [...countFailures(what, c, { frames: CHANGES.frames, draws: 3, purpose: 'draft' }), ...seekFailures(what, c.hashes, at)];
}

describe(`${AC[2]} a reuse never crosses a changed reading or status binding`, () => {
  it(`${AC[2]} the film whose reading changes at frame 40 and whose status binding changes at frame 80 is drawn three times and equals its seek renders, and a planted reuse across the changes fails, naming frames 40 and 80`, () => {
    const around = [0, CHANGES.reading - 1, CHANGES.reading, CHANGES.reading + 1, CHANGES.status - 1, CHANGES.status, CHANGES.status + 1, CHANGES.frames - 1];
    const seeks = seekRenders(show(FULL), temp(), (e) => readingsFilm(e).document, around, 60, 'the film whose record changes', { extra: { readings: READINGS }, record: RECORD });
    const hash = (k: number): string => seeks.find((s) => s.frame === k)!.hash;
    // Not vacuous: the picture holds between the changes and differs across each.
    expect([hash(0) === hash(CHANGES.reading - 1), hash(CHANGES.reading) === hash(CHANGES.status - 1), hash(CHANGES.status) === hash(CHANGES.frames - 1)], 'the seek renders hold still before, between and after the two changes').toEqual([true, true, true]);
    expect(hash(CHANGES.reading), 'the changed reading changes the picture at frame 40').not.toBe(hash(CHANGES.reading - 1));
    expect(hash(CHANGES.status), 'the changed status binding changes the picture at frame 80').not.toBe(hash(CHANGES.status - 1));
    none(readingsRun(seeks), 'the film whose record changes: three draws, every sampled frame its seek render');
    const failures = readingsRun(seeks, 'reuse_across_readings');
    failsNaming(failures, new RegExp(`frame ${CHANGES.reading}:`), 'a reuse across the changed reading');
    failsNaming(failures, new RegExp(`frame ${CHANGES.status}:`), 'a reuse across the changed status binding');
  });
});

describe(`${AC[6]} a hold is drawn once, grain at 24 fps 720 times and a particle item every frame, each frame its seek render`, () => {
  it(`${AC[6]} a 30 s hold at 60 fps counts 1 draw with no time reader in view, 720 with grain at 24 fps and 1,800 with a particle item, and ten sampled frames of each equal seek renders at the same times`, () => {
    const bin = show(FULL);
    const still = countedOf(holds().long, 'the 30 s hold');
    const evidence = temp(); const dir = temp();
    const replies = runShow(bin, scenario(evidence, [
      present(DOC.a, holdFilm(evidence, 30, true).document), present(DOC.b, particleFilm(evidence, 30).document),
      exportCall(DOC.a, join(dir, 'grain.mp4'), DRAFT), exportCall(DOC.b, join(dir, 'particles.mp4'), DRAFT),
    ]), 'the hold under grain and the hold with a particle item, as drafts');
    presented(replies[0], 'the hold under grain'); presented(replies[1], 'the hold with a particle item');
    const grain = countedOf(replies[2], 'the 30 s hold under grain at 24 fps');
    const sparks = countedOf(replies[3], 'the 30 s hold with a particle item');
    const seen = {
      still: seekRenders(bin, temp(), (e) => holdFilm(e, 30).document, SAMPLES, 60, 'the 30 s hold'),
      grain: seekRenders(bin, temp(), (e) => holdFilm(e, 30, true).document, SAMPLES, 60, 'the 30 s hold under grain'),
      sparks: seekRenders(bin, temp(), (e) => particleFilm(e, 30).document, SAMPLES, 60, 'the 30 s hold with a particle item'),
    };
    // Not vacuous: the frames compared are there and differ when they should.
    expect(SAMPLES.length, 'ten frames are sampled').toBe(10);
    const at = (list: { frame: number; hash: string }[], k: number): string => list.find((s) => s.frame === k)!.hash;
    expect(new Set(seen.still.map((s) => s.hash)).size, 'with no time reader in view the ten seek renders are one picture').toBe(1);
    expect(at(seen.grain, 2), 'grain at 24 fps holds one pattern over frames 0 to 2 (2/60 s is before 1/24 s)').toBe(at(seen.grain, 0));
    expect(at(seen.grain, 3), 'grain at 24 fps shows a new pattern at frame 3 (3/60 s is past 1/24 s)').not.toBe(at(seen.grain, 0));
    expect(at(seen.grain, 0), 'the grain is drawn: the hold under grain isn\'t the hold without it').not.toBe(at(seen.still, 0));
    expect(new Set(seen.sparks.map((s) => s.hash)).size, 'the particle item is drawn and moves: its ten seek renders aren\'t one picture').toBeGreaterThan(1);
    none([
      ...countFailures('the 30 s hold', still, { frames: FRAMES, draws: 1, purpose: 'delivery' }),
      ...countFailures('the 30 s hold under grain at 24 fps', grain, { frames: FRAMES, draws: 720, purpose: 'draft' }),
      ...countFailures('the 30 s hold with a particle item', sparks, { frames: FRAMES, draws: FRAMES, purpose: 'draft' }),
      ...seekFailures('the 30 s hold', still.hashes, seen.still),
      ...seekFailures('the 30 s hold under grain at 24 fps', grain.hashes, seen.grain),
      ...seekFailures('the 30 s hold with a particle item', sparks.hashes, seen.sparks),
    ], 'the three 30 s holds: their draws, and ten sampled frames of each against seek renders');
  });

  it(`${AC[6]} a planted reuse that ignores valid_until freezes the grain: 720 draws aren't made, and the first frame past the first pattern, frame 3, isn't its seek render`, () => {
    const bin = show(FULL);
    const evidence = temp(); const dir = temp();
    const what = 'the 30 s hold under grain at 24 fps (planted reuse_ignores_valid_until)';
    const [shown, reply] = runShow(bin, scenario(evidence, [present(DOC.a, holdFilm(evidence, 30, true).document), exportCall(DOC.a, join(dir, 'grain.mp4'), DRAFT)], { planted: 'reuse_ignores_valid_until' }), what);
    presented(shown, 'the hold under grain');
    const grain = countedOf(reply, what);
    const seeks = seekRenders(bin, temp(), (e) => holdFilm(e, 30, true).document, SAMPLES, 60, 'the 30 s hold under grain');
    const failures = [...countFailures(what, grain, { frames: FRAMES, draws: 720, purpose: 'draft' }), ...seekFailures(what, grain.hashes, seeks)];
    failsNaming(failures, /work\.draws is [\d,]+, not 720/, 'the frozen grain');
    expect(failures.find((f) => /frame \d+:/.test(f)), `the first frame the frozen grain gets wrong is frame 3, the first past the first frame's valid_until: ${failures.slice(0, 6).join(' | ')}`).toMatch(/frame 3:/);
  });
});

// AC8 #231.6136cb61: "Every frame of each of the six fixture films' export equals a seek render at its time by frame
// hash; a planted content key without a spectrum band a bar reads reuses a frame in a hold and fails, naming it"
//
// Through `deep-show run`'s `export` (README: `export`). A fixture film is exported whole as H.264 with AAC by one
// fresh process, and each of its frames is exported alone as a still by another (helpers.ts `seekRenders`): a still is
// drawn in a fresh session at its own time with no frame before it, and its receipt's one frame hash is taken by the
// same pass as an export's. Every frame's hash in the export's receipt must be its still's. The six fixture films are
// read from tests/fixtures/films/ (Films and figures on the canvas: Six fixture films first); every one delivered is
// judged, and while fewer than six are there the test reads BLOCKED, naming the six, never a pass.
//
// The planted twin runs the same check on a film this suite makes (helpers.ts `spectrumFilm`): only its bars move,
// and only as one band of the sound's spectrum does, so the picture holds until a tone starts. A content key that
// leaves the band out is equal across the tone's start, and the reuse keeps the frame before it. The frame the
// failure must name is read from the seek renders: the first frame whose seek render differs from the one before.
// Wrong programs: the merge base draws every frame, so its frames equal their seek renders, and the fixture films'
// test stays BLOCKED there on the four films it lacks; `content_key_without_spectrum_band`.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, DRAFT, FULL, SIX, blocked, exportCall, fixtureFilms, none, present, presented, putEvidence, receiptOf, repeats, reusedOf, runShow, scenario,
  seekFailures, seekRenders, spectrumFilm, useShow, useTemp, type JsonObject, type Planted,
} from './helpers.ts';

const show = useShow();
const temp = useTemp();

describe(`${AC[8]} every frame of an export equals a seek render at its time`, () => {
  it(`${AC[8]} every frame of each of the six fixture films' export has the frame hash of a seek render at its time`, () => {
    const films = fixtureFilms();
    const failures: string[] = [];
    for (const f of films) {
      const what = `the fixture film ${f.name}`;
      const stock = (evidence: string): JsonObject => { for (const bytes of f.assets) putEvidence(evidence, bytes); return f.document; };
      const evidence = temp(); const dir = temp();
      const [shown, reply] = runShow(show(FULL), scenario(evidence, [present(DOC.a, stock(evidence)), exportCall(DOC.a, join(dir, `${f.name}.mp4`))]), `${what}: its export`);
      presented(shown, what);
      const r = receiptOf(reply, `${what}: its export`);
      if (r.hashes.length !== f.frames) failures.push(`${what}: its export holds ${r.hashes.length} frame hashes, not its ${f.frames} frames`);
      // Not vacuous: the film moves, so its frames aren't one picture.
      if (new Set(r.hashes).size < 2) failures.push(`${what}: every frame of its export has one hash, so nothing in it moves and the comparison proves nothing`);
      const seeks = seekRenders(show(FULL), temp(), stock, Array.from({ length: f.frames }, (_, k) => k), f.fps, what);
      failures.push(...seekFailures(what, r.hashes, seeks));
    }
    none(failures, `the fixture films delivered (${films.map((f) => f.name).join(', ') || 'none'}): every frame against a seek render at its time`);
    if (films.length < SIX.length) {
      blocked(`${films.length} of the six fixture films are in tests/fixtures/films/ (${films.map((f) => f.name).join(', ') || 'none'}), each of which equals its seek renders frame for frame; the criterion asks all six (${SIX.join('; ')}). Unblock: the issue that adds the other fixture films`);
    }
    expect(films.length, 'tests/fixtures/films/ holds the six fixture films and the release\'s still, nothing more').toBe(SIX.length);
  });

  it(`${AC[8]} the film whose bars read a spectrum equals its seek renders frame for frame, and a planted content key without the band reuses the frame before the tone and fails, naming the first frame the tone changes`, () => {
    const bin = show(FULL);
    const film = spectrumFilm(temp());
    const seeks = seekRenders(bin, temp(), (e) => spectrumFilm(e).document, Array.from({ length: film.frames }, (_, k) => k), film.fps, 'the spectrum film');
    const hashes = seeks.map((s) => s.hash);
    // Not vacuous: the picture holds until the tone (1 s in, frame 60), changes as it starts, and holds while it sounds.
    const first = hashes.findIndex((h, k) => k > 0 && h !== hashes[k - 1]);
    expect(first, 'the bars first move where the tone starts, within the bake\'s window of frame 60').toBeGreaterThanOrEqual(55);
    expect(first, 'the bars first move where the tone starts, within the bake\'s window of frame 60').toBeLessThanOrEqual(65);
    expect(repeats(hashes), 'the picture holds before, during and after the tone: most frames are their predecessor\'s picture').toBeGreaterThan(film.frames / 2);
    const run = (planted?: Planted): string[] => {
      const evidence = temp(); const dir = temp();
      const what = `the spectrum film${planted ? ` (planted ${planted})` : ''}`;
      const [shown, reply] = runShow(bin, scenario(evidence, [present(DOC.a, spectrumFilm(evidence).document), exportCall(DOC.a, join(dir, 'spectrum.mp4'), DRAFT)], planted ? { planted } : {}), what);
      presented(shown, what);
      const r = receiptOf(reply, what);
      const reused = reusedOf(r, what);
      // The film has holds, so some frame is reused; and a reused frame's hash is the frame's before it.
      return [...(reused > 0 ? [] : [`${what}: reused_frames is 0 in a film that holds still for most of its span`]), ...seekFailures(what, r.hashes, seeks)];
    };
    none(run(), 'the spectrum film: every frame its seek render, its holds reused');
    const failures = run('content_key_without_spectrum_band');
    expect(failures.find((f) => /frame \d+:/.test(f)) ?? '', `a content key without the band a bar reads reuses frame ${first - 1} at frame ${first}, the first frame the tone changes: ${failures.slice(0, 6).join(' | ')}`).toContain(`frame ${first}:`);
  });
});

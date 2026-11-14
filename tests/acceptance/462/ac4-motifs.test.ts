// AC4: "Playing a film with motifs leaves the document's hash unchanged; motifs hold still under reduced motion and
// never move text during a reading hold"
//
// The motif film (helpers.ts: motifFilm), a 2D film of three reeds, a title and a sill, played by `film2d` at 30 fps
// (frames 0 to 119, 4 s) under the clean look with two motifs (helpers.ts: motifLook): `sway` on the slot the reeds are
// bound to, `drift` on the slot the title is bound to (the document's `motif_slots`); a reading hold (a marker of kind
// `hold`) from 1.5 s to 3 s. Each frame's `pixel_hash` is read; nothing else in the film moves.
// - The document's hash: the film's `document` (this suite's field) names the revision hash it opened, which is the canvas
//   core's (`deep-canvas canonical`) of the document sent, and the one it holds after its last frame, which is the
//   same. Guard: the frames change (the motifs move things), and the same film under the look without motifs draws
//   frames 0, 15 and 30 alike (the motion is the motifs'). The planted `motifs_write_document` fails, naming `played`.
// - Reduced motion: the same film with `reduced_motion: true` draws all 120 frames alike, by pixel hash.
// - The reading hold: with only the title bound, the frames inside the hold (46 to 89, 1.53 s to 2.97 s) are alike,
//   while the frames before it (0 to 44) are not all alike (the title does drift outside the hold).

import { describe, expect, it } from 'vitest';
import {
  DEEP_CANVAS, MOTIF, TIMEOUT, ac, documentHashes, failsNaming, film2d, filmFrames, motifFilm, motifLook, none, requireGpu,
  revisionHash, run, useBins, useDir, type JsonObject, type Planted,
} from './helpers.ts';

const bins = useBins(['deep-gpu', DEEP_CANVAS]);
const dir = useDir();
const play = (doc: JsonObject, motifs: boolean, extra: { reduced_motion?: boolean; frames?: number } = {}): JsonObject =>
  film2d({ doc, look: motifLook(motifs), fps: MOTIF.fps, frames: extra.frames ?? MOTIF.frames, ...(extra.reduced_motion ? { reduced_motion: true } : {}) });
const distinct = (hashes: readonly string[]): number => new Set(hashes).size;

function documentProblems(planted?: Planted): string[] {
  requireGpu();
  const doc = motifFilm('all');
  const [moving, still] = run(bins.bin('deep-gpu'), dir(), [play(doc, true), play(doc, false, { frames: 31 })], planted ? { planted } : {});
  const frames = filmFrames(moving!, 'the motif film');
  const hashes = documentHashes(moving!, 'the motif film');
  const out: string[] = [];
  const sent = revisionHash(bins.bin(DEEP_CANVAS), doc);
  if (hashes.opened !== sent) out.push(`opened: the film reports ${hashes.opened.slice(0, 12)} for the document it opened, the canvas core's revision hash of the document sent is ${sent.slice(0, 12)}`);
  if (hashes.played !== hashes.opened) out.push(`played: after its last frame the film holds a document hashing ${hashes.played.slice(0, 12)}, not the ${hashes.opened.slice(0, 12)} it opened`);
  if (frames.length !== MOTIF.frames) out.push(`the film draws ${frames.length} frames, not ${MOTIF.frames}`);
  if (distinct(frames.map((f) => f.pixelHash)) < 2) out.push('every frame of the motif film is alike: no motif moves anything');
  const plain = filmFrames(still!, 'the film without motifs').filter((f) => [0, 15, 30].includes(f.frame));
  if (plain.length !== 3 || distinct(plain.map((f) => f.pixelHash)) !== 1) out.push('without motifs, frames 0, 15 and 30 differ: something but the motifs moves');
  return out;
}

describe(`${ac(4)} motifs leave the document unchanged, hold still under reduced motion and never move text during a reading hold`, () => {
  it(`${ac(4)} playing the film with motifs leaves the document's revision hash what it was when it opened`, () => {
    none(documentProblems(), 'the document through a film with motifs');
  }, TIMEOUT);

  it(`${ac(4)} (planted) motifs written into the document each frame change its hash, and fail naming played`, () => {
    const plant: Planted = 'motifs_write_document';
    failsNaming(documentProblems(plant), ['played'], `the planted ${plant}`);
  }, TIMEOUT);

  it(`${ac(4)} under reduced motion the motifs hold still: every frame of the film is alike, though played normally they move`, () => {
    requireGpu();
    const doc = motifFilm('all');
    const [normal, reduced] = run(bins.bin('deep-gpu'), dir(), [play(doc, true), play(doc, true, { reduced_motion: true })]);
    const moving = filmFrames(normal!, 'the motif film').map((f) => f.pixelHash);
    const held = filmFrames(reduced!, 'the motif film under reduced motion').map((f) => f.pixelHash);
    expect(distinct(moving), 'played normally, the motifs move the reeds and the title').toBeGreaterThan(1);
    expect(held.length, `under reduced motion the film draws its ${MOTIF.frames} frames`).toBe(MOTIF.frames);
    expect(distinct(held), `under reduced motion the ${held.length} frames hash alike (${distinct(held)} distinct hashes)`).toBe(1);
  }, TIMEOUT);

  it(`${ac(4)} a motif never moves the title during the reading hold, though it moves it before`, () => {
    requireGpu();
    const [reply] = run(bins.bin('deep-gpu'), dir(), [play(motifFilm('text'), true)]);
    const frames = filmFrames(reply!, 'the film with only its title bound');
    const hold = frames.filter((f) => f.frame >= 46 && f.frame <= 89);
    const before = frames.filter((f) => f.frame <= 44);
    expect(hold.length, 'frames 46 to 89 lie inside the reading hold (1.5 s to 3 s)').toBe(44);
    expect(distinct(before.map((f) => f.pixelHash)), 'before the hold (frames 0 to 44) the drifting title changes the frame').toBeGreaterThan(1);
    const moved = hold.filter((f) => f.pixelHash !== hold[0]!.pixelHash).map((f) => f.frame);
    expect(moved, `inside the reading hold the title stays where frame ${hold[0]!.frame} drew it; these frames differ`).toEqual([]);
  }, TIMEOUT);
});

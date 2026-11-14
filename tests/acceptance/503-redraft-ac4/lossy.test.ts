// AC4 #503.89909452, its lossy clause, by a blind redraft (README): "Each listed audio format decodes in the worker on
// macOS to PCM hashes … within −90 dBFS of FFmpeg's decode for lossy ones". Twelve fixtures, two each of MP3, AAC-LC,
// HE-AAC, Opus in Ogg, Opus in WebM and Vorbis in Ogg, are made at test time by FFmpeg's encoders; each is decoded by
// `deep-show run`'s `media_decode` and held, sample for sample, to FFmpeg's own decode of the same file: the peak
// per-sample difference at or below −90 dBFS, with the same rate, channels and length, in a decode worker that isn't
// deep-show's process, and to the same PCM hash in a second run. Four wrong programs then run through the same check,
// which must fail on each, naming the fixtures it names.

import { describe, it } from 'vitest';
import { FULL, TIMEOUT, blocked, failsNaming, none, useShow, useTemp } from '../501/helpers.ts';
import { LOSSY, about, decodeAll, fixtureTools, judgeAll, label, makeFixture, reference, type Fixture } from './helpers.ts';

/** The criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
const AC4 = 'AC4 #503.89909452';
const shows = useShow([FULL]);
const temp = useTemp();

/** The wrong programs (README: The wrong programs): each one's run must fail on the fixtures `on` picks, with a
 * sentence about each that says what `says` matches. */
const WRONG: { planted: string; on: (f: Fixture) => boolean; says: RegExp }[] = [
  { planted: 'decodes_in_app', on: () => true, says: /deep-show's own process/ },
  { planted: 'lossy_one_sample_late', on: () => true, says: /samples a channel|peak per-sample difference/ },
  { planted: 'lossy_level_off', on: () => true, says: /peak per-sample difference/ },
  { planted: 'vorbis_missing', on: (f) => f.format === 'Vorbis (Ogg)', says: /refused/ },
];

describe(`${AC4} the lossy formats decode in the worker within -90 dBFS of FFmpeg's decode`, () => {
  it(`${AC4} MP3, AAC-LC, HE-AAC, Opus in Ogg and WebM and Vorbis in Ogg each decode in a decode worker on macOS to PCM whose peak per-sample difference from FFmpeg's decode is at most -90 dBFS, at FFmpeg's rate, channels and length and to one PCM hash run to run; a decode made outside the worker, one sample late, off in level or missing Vorbis fails, naming each file`, () => {
    if (process.platform !== 'darwin') blocked(`the clause holds the decode worker on macOS, and this is ${process.platform}`);
    const tools = fixtureTools();
    const dir = temp();
    const fixtures = LOSSY.map((r) => makeFixture(tools, r, dir));
    const refs = fixtures.map((f) => reference(tools, f, dir));
    const bin = shows.bin(FULL);
    const run = (planted?: string): ReturnType<typeof judgeAll> => judgeAll(fixtures, decodeAll(bin, fixtures, temp(), temp(), planted), refs);

    const first = run();
    none(first.failures, 'every lossy fixture decodes in a decode worker within -90 dBFS of FFmpeg\'s decode');

    const again = run();
    const drift = fixtures.flatMap((f, i) => (again.pcm[i] === first.pcm[i] ? [] : [`${label(f)}: decoded to PCM ${first.pcm[i]} in one run and ${again.pcm[i]} in another`]));
    none([...again.failures, ...drift], 'a second run decodes every lossy fixture again, to the same PCM hash');

    for (const w of WRONG) {
      const wrong = run(w.planted);
      for (const f of fixtures.filter(w.on)) failsNaming(wrong.failures, about(f, w.says), `planted ${w.planted}, ${label(f)}`);
    }
  }, TIMEOUT);
});

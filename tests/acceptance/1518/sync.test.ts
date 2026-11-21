// #1518.3499b3ff: "In a recording with video, sound and picture stay in step at every cut within one frame, read from the
// export's own audio and video"
//
// The video recording (README: Fixtures): sixteen tone words over frames that each show their own number, cut at words
// 3, 6, 10 and 13: five runs, four splices, each run a sound strip and its picture. The film is exported (H.264, its
// sound PCM) and the delivered file decoded by media_decode. From the export's own sound, each tone's onset and which
// tone it is (its frequency); from its own picture, the number of the frame shown at that instant. In step within one
// frame: at every tone's onset, the first after each splice among them, the frame shown is a source frame whose span lies
// within one frame of the tone's start in the source (stepFailures). The sound plays the twelve kept tones in order, and
// the expansion has a picture for each of its five strips. The same judgment fails the planted twin, the recording with its
// picture three frames behind its sound, at every tone.
import { describe, expect, it } from 'vitest';
import {
  AC, FULL, TIMEOUT, VIDEO_KEEP, VIDEO_REMOVED, cutRow, keptOf, onsetsOf, proof, readExport, stageVideo, stepFailures, useShow, useTemp, videoFilm,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
/** The splice before the run holding `word`: 0 for the first run. */
const spliceBefore = (word: number): number => VIDEO_REMOVED.filter((r) => r < word).length;
const KEPT = [...keptOf(VIDEO_KEEP)].sort((a, b) => a - b);

function exported(late: number, what: string) {
  const bin = shows.bin(FULL);
  const evidence = temp();
  const v = stageVideo(bin, evidence, late);
  const { replies, played } = readExport(bin, evidence, videoFilm(v.sha, [v.record], VIDEO_KEEP), temp(), what);
  return { row: cutRow(replies[0]!, what), played, onsets: onsetsOf(played) };
}

describe(`${AC[5]} in a recording with video, sound and picture stay in step at every cut within one frame`, () => {
  it(`${AC[5]} cut at four words, the export's sound and picture are in step within one frame at every tone's onset, after every splice`, () => {
    const { row, played, onsets } = exported(0, 'the cut video exported');
    const failures = stepFailures(played, onsets, spliceBefore);
    proof('ac5-sync.json', { strips: row.row['strips'], derived: row.row['derived'] ?? null, channels: row.row['channels'] ?? null, onsets, frames: played.frames, failures });
    expect([row.strips.length, row.derived.length], 'five runs: five sound strips, each with its picture').toEqual([5, 5]);
    expect(onsets.map((o) => o.word), 'the export\'s sound plays the twelve kept tones in order').toEqual(KEPT);
    expect(failures, failures.join(' | ')).toEqual([]);
  }, TIMEOUT);

  it(`${AC[5]} the same judgment fails the planted twin whose picture runs three frames behind its sound, at every tone`, () => {
    const { played, onsets } = exported(3, 'the twin, its picture three frames late, cut and exported');
    const failures = stepFailures(played, onsets, spliceBefore);
    proof('ac5-twin.json', { onsets, failures });
    expect(onsets.map((o) => o.word), 'the twin\'s export plays the same twelve kept tones').toEqual(KEPT);
    expect(failures.length, `the judgment fails the twin at every tone: ${failures.join(' | ')}`).toBe(KEPT.length);
  }, TIMEOUT);
});

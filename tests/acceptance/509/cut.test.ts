// #509.d30b5b10: "A planted twin with 300 ms cut from one line FAILs naming the line and the missing words, and its
// clean twin passes"
//
// The film (README: Fixtures): two lines, `intro` ("The small red fox ran home before dark", at 0.5 s) and `outro`
// ("Then the stars came out over the hill", at 5 s), each your own recording, spoken word by word by `say` at known
// samples; in intro the word "red" sits alone in a 300 ms slot of silence. The planted twin is the same film with that
// slot, 14,400 samples, cut from intro's recording: by construction the one word it loses is "red", and outro is
// untouched. Each film is heard back through the surfaces the design names: its verdict BLOCKED with an unrun entry
// per line and scope, the real narration.transcript job on whisper-cpp@1.9.5 run on each entry's PCM through deep_job,
// the records listed in each line's asset, and the verdict again. The clean twin's transcript row PASSes; the cut
// twin's FAILs with a narration.mismatch error naming intro whose missing words hold "red", and no error names outro.
import { describe, expect, it } from 'vitest';
import {
  AC, FULL, RATE, SPEECH, TIMEOUT, assetOf, blockedUnless, cutRegion, errors, fieldOf, film, heardBack, missingOf, mismatchesOf, openWorld, proof, recorded,
  show, stage, take, useShow, withPlugin, type Take, type World,
} from './helpers.ts';

const shows = useShow([FULL]);
const INTRO = 'The small red fox ran home before dark';
const OUTRO = 'Then the stars came out over the hill';
const RED = 2;
const CUT = Math.round(0.3 * RATE);

/** The film with intro's take `introTake`, staged in the world's store, heard back. */
async function judged(w: World, introTake: Take, outroTake: Take, what: string) {
  const a = stage(w.evidence, introTake);
  const b = stage(w.evidence, outroTake);
  const doc = film({
    span: 9,
    lines: { intro: recorded('voice_intro', INTRO, 0.5), outro: recorded('voice_outro', OUTRO, 5) },
    assets: { voice_intro: assetOf(a), voice_outro: assetOf(b) },
  });
  return heardBack(shows.bin(FULL), w, doc, what);
}

describe(`${AC[1]} the 300 ms cut twin fails, naming the line and its missing words; the clean twin passes`, () => {
  it(`${AC[1]} with 300 ms cut from intro (the slot holding "red"), the transcript row FAILs with narration.mismatch naming intro and the missing word red, none naming outro; the clean twin's row PASSes`, async () => {
    const intro = take(INTRO, { slot: { word: RED, samples: CUT } });
    const red = intro.words[RED]!;
    blockedUnless(red.end - red.start <= Math.round(0.28 * RATE), `the fixture: say speaks "red" in ${red.end - red.start} samples, which must fit its 300 ms slot with silence on both sides`);
    const twin = cutRegion(intro, RED);
    expect(intro.samples.length - twin.samples.length, 'the twin is intro with exactly 300 ms (14,400 samples) cut').toBe(CUT);
    const outro = take(OUTRO);
    const w = await openWorld([]);
    await withPlugin(w, SPEECH);

    const clean = await judged(w, intro, outro, 'the clean twin');
    const cut = await judged(w, twin, outro, 'the twin with 300 ms cut from intro');
    proof('ac1-cut.json', {
      clean: { verdict: clean.verdict, transcripts: clean.transcripts }, cut: { verdict: cut.verdict, transcripts: cut.transcripts },
      cut_samples: [intro.regions[RED], CUT],
    });

    expect(clean.row['result'], `the clean twin's transcript row PASSes: ${show(clean.row, 2500)}`).toBe('PASS');
    expect(errors(clean.row, 'narration.mismatch'), 'the clean twin raises no narration.mismatch').toEqual([]);

    expect(cut.row['result'], `the cut twin's transcript row FAILs: ${show(cut.row, 2500)}`).toBe('FAIL');
    const named = mismatchesOf(cut.row, 'intro');
    expect(named.length, `a narration.mismatch error names the line intro: ${show(cut.row['issues'] ?? null, 2500)}`).toBeGreaterThan(0);
    expect(named.some((i) => missingOf(i).includes('red')), `a narration.mismatch naming intro names "red" among its missing words: ${show(named, 2500)}`).toBe(true);
    expect(errors(cut.row, 'narration.mismatch').filter((i) => fieldOf(i, 'line') !== 'intro'), 'no mismatch names a line but intro: outro was not cut').toEqual([]);
  }, TIMEOUT);
});

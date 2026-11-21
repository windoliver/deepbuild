// #1518.1dbfdc9b: "A 60 s recording with 12 marked cuts expands to strips whose heard-back words equal the kept words in
// order. The same list on a fixture whose times are shifted by 150 ms still gives every kept word. A planted recipe that
// cuts on the raw times there loses a syllable, and `cut.heard` fails naming the word"
//
// The take (README: Fixtures): twelve sentences, 81 words, spoken word by word by `say` and laid at known samples in a
// 60 s recording; the keep list leaves out the bracketed word of each sentence, twelve marked cuts, each an inserted word
// between two kept ones. Its words record is written from where each word was put; the shifted fixture is the same
// recording with every stated start and end 150 ms late. Three films: the cut on the true record, the cut on the shifted
// record, and the planted cut_on_raw_times on the shifted record. First, before any transcriber runs, each film's row
// and first verdict: 12 removed, 13 strips and 24 cuts on the true record; each cut.heard row BLOCKED with one
// cut.heard_unrun entry, whose PCM is the strips mixed alone (media_mix), 48 kHz, two channels, English. Then the
// fixture's own truth: the real transcriber, whisper-cpp@1.9.5 through deep_job, hears the uncut recording as its 81
// words (media_heard, normalizer@1), else the test is BLOCKED. Then each film is heard back: its entry's PCM transcribed,
// the record attached to the recording asset, and the verdict again.
// - True record: the row PASSes with no cut.word_lost or cut.word_left, and the transcript is the 69 kept words in order.
// - Shifted record: the row PASSes with no cut.word_lost.
// - Planted cut_on_raw_times on the shifted record: its cut points fall inside kept words by the true times (each word
//   after a splice starts 150 ms before its raw point); the row FAILs and a cut.word_lost names one of them, with its text.
import { describe, expect, it } from 'vitest';
import {
  AC, FULL, PLANTED, RATE, SHIFT, SPEECH, TIMEOUT, TRANSCRIBER, blockedUnless, cutKeys, expectedCuts, hear, heardAgain, issuesOf, mixedPcm, openWorld,
  proof, putEvidence, readJson, show, soundFilm, speechTake, stageWav, transcribe, transcriptText, unheard, useShow, withPlugin,
} from './helpers.ts';

const shows = useShow([FULL]);

describe(`${AC[1]} a 60 s recording with 12 marked cuts is heard back as its kept words; on times shifted 150 ms it still is; cut on the raw times it loses a word`, () => {
  it(`${AC[1]} the strips are heard back as the kept words in order; with the record 150 ms late every kept word is still heard; the planted cut_on_raw_times there FAILs cut.heard with cut.word_lost naming a word it cut into`, async () => {
    const bin = shows.bin(FULL);
    const take = speechTake();
    expect([take.samples.length, take.words.length, take.removed.length], 'the fixture: 60 s at 48 kHz, 81 words, 12 marked cuts').toEqual([60 * RATE, 81, 12]);
    const w = await openWorld();
    const exact = stageWav(w.evidence, take);
    const shifted = stageWav(w.evidence, take, SHIFT);

    const clean0 = unheard(bin, w.evidence, soundFilm(exact.sha, [exact.record], take.keep, 60), 'the recording cut on its true record');
    expect(clean0.cut.removed, 'the row lists the 12 marked words in `removed`, ascending').toEqual(take.removed);
    expect(clean0.cut.strips.length, 'the 13 runs of kept words between the 12 cuts are 13 strips').toBe(13);
    expect(cutKeys(clean0.cut.cuts), 'each marked cut is a cut out after the word before it and a cut in before the word after it').toEqual(expectedCuts(take.removed));
    expect(clean0.cut.strips.every((s) => s.asset === exact.sha), 'every strip plays the recording by its SHA-256').toBe(true);
    const mix = mixedPcm(bin, w.evidence, clean0.cut.strips, 'the clean cut\'s strips mixed alone');
    expect([clean0.entry.pcm, clean0.entry.sample_rate, clean0.entry.channels, clean0.entry.locale], 'cut.heard hears the strips mixed alone, 48 kHz, two channels, in English')
      .toEqual([mix.sha, RATE, 2, 'en']);
    const moved0 = unheard(bin, w.evidence, soundFilm(shifted.sha, [shifted.record], take.keep, 60), 'the recording cut on its record shifted 150 ms');
    const raw0 = unheard(bin, w.evidence, soundFilm(shifted.sha, [shifted.record], take.keep, 60), 'the planted recipe on the shifted record', PLANTED.raw);
    const chopped = new Map<number, string>();
    for (const c of raw0.cut.cuts) {
      const t = take.words[c.word];
      if (t && t.start < c.sample && c.sample < t.end) chopped.set(c.word, t.text);
    }
    expect(chopped.size, `the planted recipe cuts at the raw points, 150 ms inside the words after its cuts: ${show(raw0.cut.cuts.map((c) => c.entry), 1500)}`).toBeGreaterThan(0);

    putEvidence(w.evidence, exact.pcm);
    await withPlugin(w, SPEECH);
    const source = await transcribe(w, { line: 'the uncut recording', scope: 'source', pcm: exact.pcmSha, sample_rate: RATE, channels: 1, locale: 'en', raw: {} }, []);
    const sourceText = transcriptText(readJson(w.evidence, source.record, 'the uncut recording\'s transcript'), 'the uncut recording');
    const [whole] = hear(bin, w.evidence, [{ expected: take.text, heard: sourceText }], 'the uncut recording heard');
    blockedUnless(whole!.match, `the fixture: ${TRANSCRIBER} hears the uncut recording as its ${take.words.length} words, but missing ${JSON.stringify(whole!.missing)}, extra ${JSON.stringify(whole!.extra)}, wrong ${JSON.stringify(whole!.wrong)} in ${JSON.stringify(sourceText)}`);

    const clean = await heardAgain(bin, w, clean0);
    const [kept] = hear(bin, w.evidence, [{ expected: take.keptText, heard: transcriptText(clean.transcript, 'the clean cut') }], 'the clean cut heard');
    const moved = await heardAgain(bin, w, moved0);
    const raw = await heardAgain(bin, w, raw0);
    proof('ac1-heard.json', {
      words: take.words, removed: take.removed, source: sourceText,
      clean: { cuts: clean.cut.cuts.map((c) => c.entry), entry: clean.entry.raw, mix, transcript: clean.transcript['text'], row: clean.row },
      shifted: { cuts: moved.cut.cuts.map((c) => c.entry), transcript: moved.transcript['text'], row: moved.row },
      planted: { cuts: raw.cut.cuts.map((c) => c.entry), chopped: [...chopped], transcript: raw.transcript['text'], row: raw.row },
    });

    expect(clean.row['result'], `the clean cut's cut.heard row PASSes: ${show(clean.row, 2500)}`).toBe('PASS');
    expect([...issuesOf(clean.row, 'cut.word_lost'), ...issuesOf(clean.row, 'cut.word_left')].map((i) => i.raw), 'no kept word is lost and no removed word left').toEqual([]);
    expect(kept!.match, `the heard-back words equal the kept words in order: missing ${JSON.stringify(kept!.missing)}, extra ${JSON.stringify(kept!.extra)}, wrong ${JSON.stringify(kept!.wrong)} in ${JSON.stringify(clean.transcript['text'])}`).toBe(true);

    expect(moved.row['result'], `with the record shifted 150 ms the cut.heard row still PASSes: ${show(moved.row, 2500)}`).toBe('PASS');
    expect(issuesOf(moved.row, 'cut.word_lost').map((i) => i.raw), 'with the record shifted 150 ms every kept word is still heard').toEqual([]);

    expect(raw.row['result'], `the planted recipe's cut.heard row FAILs: ${show(raw.row, 2500)}`).toBe('FAIL');
    const lost = issuesOf(raw.row, 'cut.word_lost');
    expect(lost.some((l) => l.word !== null && chopped.get(l.word) === l.text), `a cut.word_lost names a word the planted cuts fell inside, by index and text (cut into: ${JSON.stringify([...chopped])}): ${show(lost.map((l) => l.raw), 2000)}`).toBe(true);
  }, TIMEOUT);
});

// #1518.1dbfdc9b, blind redraft: "A 60 s recording with 12 marked cuts expands to strips whose heard-back words equal the
// kept words in order. The same list on a fixture whose times are shifted by 150 ms still gives every kept word. A planted
// recipe that cuts on the raw times there loses a syllable, and `cut.heard` fails naming the word"
//
// The fixture is the first draft's 60 s take (README: Fixture): twelve sentences, 81 words spoken one by one by macOS
// `say` and laid at known samples, the bracketed word of each sentence left out by the keep list (twelve marked cuts);
// its words record written from where each word was put, and a copy stating every word 150 ms late. Three films: the cut
// on the true record, the same list on the shifted record, and the planted cut_on_raw_times there. Each is presented and
// read before any hub starts: its strips, its first verdict's cut.heard row BLOCKED with one cut.heard_unrun entry whose
// PCM is its strips mixed alone, and, for the planted one, the kept words its strips cut into by the true times. Then the
// real transcriber hears the uncut recording (the fixture's own truth, else BLOCKED) and each cut result, and the
// verdicts are taken again. Each transcript is read against the words it should hold by this job's reading, which sets
// aside a heard word that no word of the recording reads as, the transcriber's own addition, and never a word of the
// recording (README: Readings).
import { describe, expect, it } from 'vitest';
import { AC, PLANTED, RATE, SHIFT, issuesOf, keptOf, mixedPcm, playedAs, soundFilm, speechTake, stageWav, transcriptText } from '../1518/helpers.ts';
import { FULL, SPEECH, TIMEOUT, TRANSCRIBER, TRANSCRIPT, blockedUnless, hear, putEvidence, readJson, show, transcribe, useShow, withPlugin } from '../509/helpers.ts';
import { heardBack, openFolders, proof, readHeard, startWorld, unheard, type Reading } from './helpers.ts';

const shows = useShow([FULL]);

describe(`${AC[1]} a 60 s recording with 12 marked cuts is heard back as its kept words, on its true times and on times 150 ms late; the planted cut on the raw times loses a word, which cut.heard names`, () => {
  it(`${AC[1]} the strips are heard back as the kept words in order; on the record shifted 150 ms every kept word is still heard; the planted cut_on_raw_times there cuts into kept words and cut.heard FAILs with cut.word_lost naming one`, async () => {
    // This job's reading first, on words whose outcome it states: a word no word of the recording reads as is set aside;
    // a kept word missing or heard as another, and a word of the recording heard over, are not.
    const said = new Set(['we', 'heard', 'the', 'loud', 'train']);
    const line = ['we', 'heard', 'the', 'train'];
    expect(readHeard(line, [...line, 'you'], said), 'the reading sets aside a word that was never in the recording').toEqual({ lost: [], spoken: [], added: ['you'] });
    expect(readHeard(line, ['we', 'heard', 'the', 'rain'], said), 'the reading loses a kept word heard as another').toEqual({ lost: [3], spoken: [], added: ['rain'] });
    expect(readHeard(line, ['we', 'heard', 'the', 'loud', 'train'], said), 'the reading keeps a removed word heard').toEqual({ lost: [], spoken: ['loud'], added: [] });
    expect(readHeard(line, ['heard', 'we', 'the', 'train'], said).lost, 'the reading loses a word heard out of order').toHaveLength(1);

    const bin = shows.bin(FULL);
    const take = speechTake();
    expect([take.samples.length, take.words.length, take.removed.length], 'the fixture: 60 s at 48 kHz, 81 words, 12 marked cuts').toEqual([60 * RATE, 81, 12]);
    const kept = [...keptOf(take.keep)].sort((a, b) => a - b);
    const f = openFolders();
    const exact = stageWav(f.evidence, take);
    const late = stageWav(f.evidence, take, SHIFT);

    // The three cuts, presented and read before any hub starts.
    const clean0 = unheard(bin, f.evidence, soundFilm(exact.sha, [exact.record], take.keep, 60), 'the recording cut on its true times');
    expect(clean0.cut.removed, 'the row lists the 12 marked words in `removed`, ascending').toEqual(take.removed);
    expect(clean0.cut.strips.length, 'the 13 runs of kept words between the 12 marked cuts are 13 strips').toBe(13);
    expect(clean0.cut.strips.every((s) => s.asset === exact.sha), `every strip plays the recording by its SHA-256: ${show(clean0.cut.strips.map((s) => s.raw), 1500)}`).toBe(true);
    const moved0 = unheard(bin, f.evidence, soundFilm(late.sha, [late.record], take.keep, 60), 'the same list on the times shifted 150 ms');
    const raw0 = unheard(bin, f.evidence, soundFilm(late.sha, [late.record], take.keep, 60), 'the planted cut_on_raw_times on the times shifted 150 ms', PLANTED.raw);
    const cutInto = new Map(kept.filter((k) => playedAs(raw0.cut.strips, take.words[k]!.start, take.words[k]!.end) !== 'whole').map((k) => [k, take.words[k]!.text]));
    expect(cutInto.size, `the planted recipe loses part of a kept word: its strips leave some kept word's true samples unplayed: ${show(raw0.cut.strips.map((s) => s.raw), 1500)}`).toBeGreaterThan(0);
    const mixes: Record<string, string> = {};
    for (const u of [clean0, moved0, raw0]) {
      const mix = mixedPcm(bin, f.evidence, u.cut.strips, `${u.what}: its strips mixed alone`);
      mixes[u.what] = mix.sha;
      expect([u.entry.job, u.entry.analyzer, u.entry.pcm, u.entry.sample_rate, u.entry.channels, u.entry.locale], `${u.what}: cut.heard_unrun names the job to run on its strips mixed alone, at 48 kHz, two channels, in English (design): ${show(u.entry.raw, 800)}`)
        .toEqual([TRANSCRIPT, TRANSCRIBER, mix.sha, RATE, 2, 'en']);
    }

    // The transcriber, and the fixture's own truth: it hears the uncut recording as its 81 words in order.
    const w = await startWorld(f);
    await withPlugin(w, SPEECH);
    putEvidence(w.evidence, exact.pcm);
    const source = await transcribe(w, { line: 'the uncut recording', scope: 'source', pcm: exact.pcmSha, sample_rate: RATE, channels: 1, locale: 'en', raw: {} }, []);
    const sourceText = transcriptText(readJson(w.evidence, source.record, 'the uncut recording\'s transcript'), 'the uncut recording');
    const [whole] = hear(bin, w.evidence, [{ expected: take.text, heard: sourceText }], 'the uncut recording heard');
    const recording = new Set(whole!.expected);
    const src = readHeard(whole!.expected, whole!.heard, recording);
    const lostWords = (x: Reading, at: readonly number[]): string[] => x.lost.map((i) => `${at[i]} "${take.words[at[i]!]?.text ?? '?'}"`);
    proof('source.json', { text: take.text, heard: sourceText, tokens: whole!.heard, lost: lostWords(src, take.words.map((_, i) => i)), spoken: src.spoken, added: src.added });
    blockedUnless(whole!.expected.length === take.words.length, `the fixture: normalizer@1 reads each of the take's ${take.words.length} words as one token, but reads ${whole!.expected.length}: ${JSON.stringify(whole!.expected)}`);
    blockedUnless(src.lost.length === 0 && src.spoken.length === 0, `the fixture: ${TRANSCRIBER} hears the uncut recording as its ${take.words.length} words in order, adding no word of the recording; it lost ${JSON.stringify(lostWords(src, take.words.map((_, i) => i)))} and heard ${JSON.stringify(src.spoken)} over (added, set aside: ${JSON.stringify(src.added)}) in ${JSON.stringify(sourceText)}`);

    // Each cut result heard back, and the verdicts again.
    const clean = await heardBack(bin, w, clean0);
    const moved = await heardBack(bin, w, moved0);
    const raw = await heardBack(bin, w, raw0);
    const texts = [clean, moved, raw].map((h) => transcriptText(h.transcript, h.what));
    const tokens = hear(bin, w.evidence, texts.map((t) => ({ expected: take.text, heard: t })), 'the three cut results heard');
    const keptTokens = kept.map((k) => whole!.expected[k]!);
    const [c, m, r] = tokens.map((t) => readHeard(keptTokens, t.heard, recording)) as [Reading, Reading, Reading];
    proof('heard.json', {
      words: take.words, removed: take.removed, keep: take.keep, cutInto: [...cutInto],
      ...Object.fromEntries([clean, moved, raw].map((h, i) => {
        const x = [c, m, r][i]!;
        return [h.what, { strips: h.cut.strips.map((s) => s.raw), mix: mixes[h.what], entry: h.entry.raw, transcript: texts[i], lost: lostWords(x, kept), spoken: x.spoken, added: x.added, row: h.row }];
      })),
    });

    // The heard-back words equal the kept words in order.
    expect(clean.row['result'], `the cut's cut.heard row PASSes: ${show(clean.row, 2500)}`).toBe('PASS');
    expect([...issuesOf(clean.row, 'cut.word_lost'), ...issuesOf(clean.row, 'cut.word_left')].map((i) => i.raw), 'cut.heard names no kept word lost and no removed word left').toEqual([]);
    expect({ lost: lostWords(c, kept), spoken: c.spoken }, `the heard-back words equal the kept words in order (the transcriber's own additions set aside: ${JSON.stringify(c.added)}): ${JSON.stringify(texts[0])}`).toEqual({ lost: [], spoken: [] });

    // The same list on the times shifted 150 ms still gives every kept word.
    expect(['PASS', 'FAIL'], `with the record shifted 150 ms the cut.heard row is judged once its transcript is attached: ${show(moved.row, 2500)}`).toContain(moved.row['result']);
    expect(issuesOf(moved.row, 'cut.word_lost').map((i) => i.raw), 'with the record shifted 150 ms cut.heard names no kept word lost').toEqual([]);
    expect(lostWords(m, kept), `with the record shifted 150 ms every kept word is heard, in order: ${JSON.stringify(texts[1])}`).toEqual([]);

    // The planted recipe that cuts on the raw times there loses a syllable, and cut.heard fails naming the word.
    expect(raw.row['result'], `the planted recipe's cut.heard row FAILs: ${show(raw.row, 2500)}`).toBe('FAIL');
    expect(r.lost.length, `the planted recipe's result is heard without one of the kept words: ${JSON.stringify(texts[2])}`).toBeGreaterThan(0);
    const lost = issuesOf(raw.row, 'cut.word_lost');
    expect(lost.some((l) => l.word !== null && cutInto.get(l.word) === l.text), `a cut.word_lost names a word the planted strips cut into, by its index and text (cut into: ${JSON.stringify([...cutInto])}): ${show(lost.map((l) => l.raw), 2000)}`).toBe(true);
  }, TIMEOUT);
});

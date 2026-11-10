// AC1: "On a 10 s fixture line with known word times, the words bake places each word's start within 50 ms; a rerun is
// a cache hit with the same hash, and a planted cache that returns the old result under a new aligner version is
// refused, naming the analyzer"
//
// The line (fixtures/synth.ts wordsLine): seventeen words, each spoken alone by macOS `say`, cut at −50 dBFS and laid
// end to end at known samples, about a second of silence on each side, 10 s at 16 kHz. Through the design's surfaces
// (README: The surface): media_bake {kind: words, analyzer: charsiu-aligner@1.0.0} with no record is BLOCKED, naming
// the analyzer and the PCM's hash, and keeps the PCM; deep_job runs bake.words on charsiu-aligner@1.0.0 with that PCM
// and the line's text by hash, its output the record; media_bake with that record answers the words, each start
// within 50 ms of the line's.
// The rerun of the job is a cache hit with the same record hash and key. The planted cache is played by the test
// (README, Planted programs): it hands media_bake, asked for the words under a new aligner version,
// charsiu-aligner@1.0.1, the record charsiu-aligner@1.0.0 made, the old result; media_bake must refuse it, naming the
// analyzer asked for and the record's, and answer no words. A bake that reads any record whatever its analyzer fails.
import { describe, expect, it } from 'vitest';
import { pcmBytes, sha256, wavF32, wordsLine } from './fixtures/synth.ts';
import { AC, ALIGNER, FLICKS, JOB, MS, TIMEOUT, bakes, mustBlockForPcm, mustRecord, openWorld, proof, readings, runJob, sec, useShow, withBakes, type Bake, type Line } from './helpers.ts';

const show = useShow();
/** A new version of the aligner, under which the old record must not be read. */
const NEXT = 'charsiu-aligner@1.0.1';
const TOLERANCE = 50 * MS;
const plain = (t: unknown): string => String(t).toLowerCase().replace(/[^a-z]/g, '');

/** Each word's start against the line's, in order; each failure names its word. */
function judgeWords(got: Line[] | undefined, truth: { text: string; start: number }[]): string[] {
  if (!Array.isArray(got)) return [`the words bake answers no \`words\` list: ${JSON.stringify(got)}`];
  const f: string[] = [];
  if (got.length !== truth.length) f.push(`the words bake has ${got.length} words, the line ${truth.length}: ${JSON.stringify(got.map((g) => g?.text))}`);
  truth.forEach((t, i) => {
    const g = got[i];
    if (!g || plain(g.text) !== t.text) f.push(`word ${i + 1} "${t.text}" (known start ${sec(t.start)}): the bake's word ${i + 1} is ${JSON.stringify(g?.text)}`);
    else if (!Number.isSafeInteger(g.start)) f.push(`word ${i + 1} "${t.text}": its start is not a whole number of flicks: ${JSON.stringify(g.start)}`);
    else if (Math.abs(g.start - t.start) > TOLERANCE) f.push(`word ${i + 1} "${t.text}" starts at ${sec(g.start)}, ${((g.start - t.start) / MS).toFixed(0)} ms from its known start ${sec(t.start)} (50 ms allowed)`);
  });
  return f;
}

describe('AC1 the words bake places each word within 50 ms, a rerun hits, and an old record under a new aligner is refused', () => {
  it(`${AC[1]} the words bake of a 10 s line places each of its 17 words' starts within 50 ms; the rerun is a cache hit with the same record; the old record handed over under ${NEXT} is refused, naming the analyzer`, async () => {
    const line = wordsLine();
    const wav = wavF32(line.samples, line.rate);
    const text = new TextEncoder().encode(line.text);
    const asset = sha256(wav);
    const truth = line.words.map((w) => ({ text: w.text, start: Math.round((w.start * FLICKS) / line.rate) }));
    const w = await openWorld([wav, text]);
    const ask: Bake = { asset, kind: 'words', analyzer: ALIGNER, source: 'aligner' };
    const pcm = mustBlockForPcm(show(), w, ask, pcmBytes(line.samples), 'the line, with no record');

    await withBakes(w);
    const inputs = [{ name: 'pcm', sha256: pcm }, { name: 'text', sha256: sha256(text) }];
    const first = await mustRecord(w, JOB.words, ALIGNER, inputs, line.rate);
    const [reply] = bakes(show(), w, [{ ...ask, record: first.record }], 'the line');
    const words = readings(reply!, ask, 'the line\'s words bake').words as Line[] | undefined;
    const failures = judgeWords(words, truth);
    proof('ac1-words.json', { asset, pcm, record: first.record, job: first.run.outcome.value, truth: truth.map((t) => ({ ...t, s: sec(t.start) })), words, failures });
    expect(failures, 'each word of the line starts within 50 ms of its known start').toEqual([]);

    const again = await runJob(w, JOB.words, ALIGNER, inputs, line.rate);
    const seen = { status: again.outcome.value.status, cache: again.outcome.value.receipt?.cache, record: again.outcome.value.outputs?.bake?.sha256, key: again.outcome.value.receipt?.key };
    proof('ac1-rerun.json', again.outcome.value);
    expect(seen, `the rerun of ${JOB.words} on ${ALIGNER} with the same PCM and text is a cache hit with the same record hash and key`).toEqual({ status: 'done', cache: 'hit', record: first.record, key: first.run.outcome.value.receipt?.key });

    const [stale] = bakes(show(), w, [{ ...ask, analyzer: NEXT, record: first.record }], `the line under ${NEXT}, handed the record ${ALIGNER} made (the planted cache)`);
    const said = JSON.stringify(stale);
    proof('ac1-planted-cache.json', stale);
    expect(stale!.bake?.words, `media_bake asked for ${NEXT}'s words and handed ${ALIGNER}'s record answers no words: ${said.slice(0, 1200)}`).toBeUndefined();
    expect(said.includes(NEXT) && said.includes(ALIGNER), `media_bake refuses the old record under the new aligner, naming the analyzer asked for (${NEXT}) and the record's (${ALIGNER}): ${said.slice(0, 1200)}`).toBe(true);
  }, TIMEOUT);
});

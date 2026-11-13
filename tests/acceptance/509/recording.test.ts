// #509.b2cb3b6a: "A line with a recording of its text passes narration.transcript@1 with no speech job run and takes its
// word markers and captions from the aligner; a copy with one word cut fails, naming the line and the missing word; and a
// recording whose asset licence is unknown makes a shared export BLOCKED with one ask"
//
// The line `l1`, "Seven shiny silver salmon swim slowly upstream", at 0.5 s, is your own recording of its text, spoken
// word by word by `say`; its copy has "silver" and the gap after it cut. Both PCMs and the text are yours in the store.
// Each take's words record is the real aligner's: deep_job bake.words on charsiu-aligner@1.0.0 (deepbuild/bakes, its
// host on 8719), so its words, markers and captions come from the aligner and from nothing this suite wrote. Each film
// is heard back by the real transcriber (deepbuild/speech, its host on 8720; heardBack as in cut.test.ts); no speech
// job is ever asked for or run. The clean line's transcript row PASSes with no narration.speech_job anywhere; `time`
// resolves each word marker `@l1.word:<word>#1` to 0.5 s plus the aligner's start for that word, exactly; and the export's
// first caption starts on the frame that holds the aligner's first word (⌊a ÷ Δ⌋ · Δ at 24 fps). The copy's row FAILs
// with a narration.mismatch naming l1 with "silver" missing.
// The licence: the same film with the recording's asset under a licence that names no terms and no `shareable`
// (`{id: "LicenseRef-unknown"}`) is exported (every delivery is a shared export): BLOCKED with exactly one ask, naming
// the asset voice_l1, and nothing written. That leg needs no model: its words record is written by the test.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { captionsOf } from '../502/helpers.ts';
import {
  AC, ALIGNER, BAKES, DOC, FLICKS, FRAME, FULL, SPEECH, TIMEOUT, arr, assetOf, coded, done, film, filmRun, heardBack, int, mismatchesOf, missingOf, openWorld,
  outputOf, pcmBytes, presentedRun, proof, readJson, receiptOf, recorded, runJob, sha256, show, stage, take, timeCall, useShow, useTemp, withPlugin, words,
  cutWord, type JsonObject, type World,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const TEXT = 'Seven shiny silver salmon swim slowly upstream';
const SILVER = 2;
const T = 0.5 * FLICKS;
const exportCall = (out: string): JsonObject =>
  ({ call: 'export', doc: DOC.a, out, video: { codec: 'h264' }, audio: { codec: 'aac' }, captions: { mode: 'open', files: ['srt'] } });

/** The aligner's words record of a PCM and the line's text, by deep_job bake.words. */
async function aligned(w: World, pcm: Uint8Array, text: Uint8Array): Promise<string> {
  const run = await runJob(w, { op: 'run', kind: 'bake.words', tool: ALIGNER, params: JSON.stringify({ sample_rate: 48_000, channels: 1 }), inputs: [{ name: 'pcm', sha256: sha256(pcm) }, { name: 'text', sha256: sha256(text) }] });
  const record = outputOf(run.outcome, 'bake');
  expect(done(run.outcome) && typeof record === 'string', `deep_job runs bake.words on ${ALIGNER}, its output the words record by hash: ${run.outcome.text.slice(0, 1200)}`).toBe(true);
  return record!;
}

describe(`${AC[8]} a line with your own recording is heard back like any line, its words from the aligner; a cut copy fails; an unknown licence blocks a shared export`, () => {
  it(`${AC[8]} the recorded line passes with no speech job, its word markers and first caption from the aligner's record; the copy with "silver" cut FAILs naming l1 and silver`, async () => {
    const t = take(TEXT);
    const cut = cutWord(t, SILVER);
    const text = new TextEncoder().encode(TEXT);
    const w = await openWorld([pcmBytes(t.samples), pcmBytes(cut), text]);
    await withPlugin(w, BAKES);
    await withPlugin(w, SPEECH);
    const bin = shows.bin(FULL);
    const cleanWords = await aligned(w, pcmBytes(t.samples), text);
    const cutWords = await aligned(w, pcmBytes(cut), text);
    const docOf = (aligner: string, samples?: Float32Array): JsonObject =>
      film({ span: 6, lines: { l1: recorded('voice_l1', TEXT, 0.5) }, assets: { voice_l1: assetOf(stage(w.evidence, t, { words: aligner, ...(samples ? { samples } : {}) })) } });

    const clean = await heardBack(bin, w, docOf(cleanWords), 'the recorded line');
    const record = readJson(w.evidence, cleanWords, 'the aligner\'s words record');
    const starts = arr(record['words'], 'the aligner\'s words').map((x, k) => int((x as { start: number }).start, `the aligner's word ${k + 1}: start (flicks)`));
    const texts = TEXT.split(' ');
    expect(starts.length, 'the aligner\'s record holds the line\'s seven words').toBe(texts.length);
    const dir = temp();
    const replies = presentedRun(bin, w.evidence, clean.document, [...texts.map((x) => timeCall(`@l1.word:${x}#1`)), exportCall(join(dir, 'film.mp4'))], 'the recorded line\'s markers and captions');
    const markers = texts.map((x, k) => ({ word: x, t: replies[k]!['t'], outcome: replies[k]!['outcome'], want: T + starts[k]! }));
    const cues = captionsOf(receiptOf(replies[texts.length]!, 'the recorded line\'s export').raw, 'the recorded line\'s export').cues;
    const copy = await heardBack(bin, w, docOf(cutWords, cut), 'the copy with silver cut');
    proof('ac8-recording.json', { clean: { verdict: clean.verdict, transcripts: clean.transcripts, aligner: record, markers, cues }, cut: { verdict: copy.verdict, transcripts: copy.transcripts } });

    expect(clean.row['result'], `the recorded line's transcript row PASSes: ${show(clean.row, 2000)}`).toBe('PASS');
    expect([...coded(clean.first, 'narration.speech_job'), ...coded(clean.verdict, 'narration.speech_job')], 'no speech job is asked for: the take is the line\'s sound').toEqual([]);
    for (const m of markers) expect([m.outcome, m.t], `@l1.word:${m.word}#1 resolves to 0.5 s plus the aligner's start for ${m.word}`).toEqual(['resolved', m.want]);
    expect(cues.length, 'the export lists the line\'s captions').toBeGreaterThan(0);
    expect(cues[0]!.in, `the first caption starts on the frame that holds the aligner's first word, ${T + starts[0]!} flicks`).toBe(Math.floor((T + starts[0]!) / FRAME) * FRAME);

    expect(copy.row['result'], `the copy's transcript row FAILs: ${show(copy.row, 2000)}`).toBe('FAIL');
    expect(mismatchesOf(copy.row, 'l1').some((i) => missingOf(i).includes('silver')), `a narration.mismatch names l1 with "silver" missing: ${show(copy.row['issues'] ?? null, 2000)}`).toBe(true);
  }, TIMEOUT);

  it(`${AC[8]} with the recording's asset under a licence that is unknown, the export is BLOCKED with exactly one ask naming voice_l1, and writes nothing`, () => {
    const evidence = temp();
    const dir = temp();
    const voice = stage(evidence, take(TEXT));
    const doc = film({ span: 6, lines: { l1: recorded('voice_l1', TEXT, 0.5) }, assets: { voice_l1: assetOf(voice, { id: 'LicenseRef-unknown' }) } });
    const [, reply] = filmRun(shows.bin(FULL), evidence, doc, [exportCall(join(dir, 'film.mp4'))], 'the film whose recording has an unknown licence');
    proof('ac8-licence.json', reply);
    expect(reply!['outcome'], `the export is BLOCKED: ${show(reply, 1500)}`).toBe('blocked');
    const asks = arr(reply!['asks'], 'the BLOCKED export: asks');
    expect(asks.length, `exactly one ask: ${show(asks)}`).toBe(1);
    expect(words(asks[0]).includes('voice_l1'), `the ask names the asset voice_l1: ${show(asks[0] ?? null)}`).toBe(true);
    expect(readdirSync(dir), 'the BLOCKED export wrote nothing').toEqual([]);
  }, TIMEOUT);
});

// #509.b4d021e2: "A line whose transcription job can't run is BLOCKED, never PASS, and a polyphonic character without
// its reading in say is refused naming it"
//
// BLOCKED: one line `l1`, "Seven swans swim across the cold lake", your own recording spoken word by word by `say`. With
// no transcript record its verdict's row <claim>#narration.transcript is BLOCKED, never PASS, with one
// narration.transcript_unrun entry for each scope (line and mix) naming the job, the analyzer whisper-cpp@1.9.5, the
// PCM's hash, its rate, channels and locale; the line scope's PCM is the take's own, and the store keeps each PCM by its
// hash for the job. Then the job can't run: deepbuild/speech installed and its model host stopped, deep_job
// narration.transcript on that PCM is BLOCKED naming whisper-cpp@1.9.5, twice on one unblock ask, with no transcript;
// and the verdict stays BLOCKED.
// Refused: a line in Chinese (`locale: zh-CN`), 我们去银行取钱, holds 行, a character of zh.polyphonic@1; with no
// reading in `say` it is refused with narration.polyphonic naming the line, the character and its readings (among them
// hang and xing); with `say: 我们去银行[hang]取钱` it compiles and `time` resolves `@zh`.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FULL, SPEECH, TIMEOUT, TRANSCRIBER, TRANSCRIPT, asks, assetOf, coded, fieldOf, film, filmRun, lastPos, openWorld, outputOf, presentedRun, proof, recorded,
  rowFrom, runJob, show, stage, stopHost, take, timeCall, toneTake, unrunOf, useShow, useTemp, verdictCall, withPlugin, words, type JsonObject,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const TEXT = 'Seven swans swim across the cold lake';
const ZH = '我们去银行取钱';

describe(`${AC[5]} a line whose transcription can't run is BLOCKED, and a polyphonic character without its reading is refused`, () => {
  it(`${AC[5]} with no transcript the row is BLOCKED with an unrun entry per scope; with the model host stopped the job is BLOCKED naming ${TRANSCRIBER} on one ask, and the row stays BLOCKED, never PASS`, async () => {
    const w = await openWorld([]);
    const bin = shows.bin(FULL);
    const voice = stage(w.evidence, take(TEXT));
    const doc = film({ span: 5, lines: { l1: recorded('voice_l1', TEXT, 0.5) }, assets: { voice_l1: assetOf(voice) } });
    const [v1] = presentedRun(bin, w.evidence, doc, [verdictCall], 'the line with no transcript');
    const row = rowFrom(v1!, 'narration.transcript@1', 'the line with no transcript');
    expect(row['result'], `the transcript row is BLOCKED: ${show(row, 2000)}`).toBe('BLOCKED');
    expect(v1!['result'], 'the claim is never PASS while a transcription has not run').not.toBe('PASS');
    const unrun = unrunOf(row, 'the line with no transcript');
    expect(unrun.map((u) => `${u.line}:${u.scope}`).sort(), `one unrun entry for each of l1's scopes: ${show(unrun.map((u) => u.raw), 1500)}`).toEqual(['l1:line', 'l1:mix']);
    const own = unrun.find((u) => u.scope === 'line')!;
    expect({ pcm: own.pcm, sample_rate: own.sample_rate, channels: own.channels, locale: own.locale }, 'the line scope reads the take\'s own PCM, 48 kHz mono, in English')
      .toEqual({ pcm: voice.pcmSha, sample_rate: 48_000, channels: 1, locale: 'en' });
    for (const u of unrun) expect(existsSync(join(w.evidence, u.pcm.slice(0, 2), u.pcm.slice(2))), `the store keeps the ${u.scope} scope's PCM ${u.pcm} for the job`).toBe(true);

    await withPlugin(w, SPEECH);
    await stopHost(w, SPEECH);
    const pos = await lastPos(w);
    const args = { op: 'run', kind: TRANSCRIPT, tool: TRANSCRIBER, params: JSON.stringify({ sample_rate: 48_000, channels: 1, locale: 'en', names: [] }), inputs: [{ name: 'pcm', sha256: voice.pcmSha }] };
    const once = await runJob(w, args);
    const twice = await runJob(w, args);
    const unblocks = (await asks(w, pos)).filter((a) => a.kind === 'unblock');
    const [v2] = presentedRun(bin, w.evidence, doc, [verdictCall], 'the line after the job could not run');
    proof('ac5-blocked.json', { verdict_before: v1, job: [once.outcome.value, twice.outcome.value], unblocks: unblocks.map((a) => a.data), verdict_after: v2 });
    for (const [label, o] of [['called once', once.outcome], ['called again', twice.outcome]] as const) {
      expect(String(o.value['status']).toUpperCase(), `${TRANSCRIPT} on ${TRANSCRIBER}, its host stopped, ${label}: BLOCKED, never done: ${o.text.slice(0, 800)}`).toBe('BLOCKED');
      expect(o.text.includes(TRANSCRIBER), `${label}: the BLOCKED reply names ${TRANSCRIBER}: ${o.text.slice(0, 800)}`).toBe(true);
      expect(outputOf(o, 'transcript'), `${label}: no transcript is made`).toBeUndefined();
    }
    expect(once.outcome.value['ask'], 'both calls wait on one ask').toBe(twice.outcome.value['ask']);
    expect(unblocks.length === 1 && unblocks[0]!.text.includes(TRANSCRIBER), `one unblock ask naming ${TRANSCRIBER}: ${show(unblocks.map((a) => a.data) as unknown as JsonObject[], 1500)}`).toBe(true);
    expect(rowFrom(v2!, 'narration.transcript@1', 'the line after the job could not run')['result'], 'the transcript row stays BLOCKED, never PASS').toBe('BLOCKED');
  }, TIMEOUT);

  it(`${AC[5]} a Chinese line holding 行 with no reading in say is refused with narration.polyphonic naming the line, 行 and its readings; with 行[hang] in say it compiles`, () => {
    const run = (say: string | null, what: string): JsonObject[] => {
      const evidence = temp();
      const voice = stage(evidence, toneTake(ZH, 1.5));
      const doc = film({ span: 3, lines: { zh: recorded('voice_zh', ZH, 0.5, { locale: 'zh-CN', ...(say ? { say } : {}) }) }, assets: { voice_zh: assetOf(voice) } });
      return filmRun(shows.bin(FULL), evidence, doc, [timeCall('@zh')], what);
    };
    const bare = run(null, 'the Chinese line with no reading for 行');
    const read = run('我们去银行[hang]取钱', 'the Chinese line whose say reads 行 as hang');
    proof('ac5-polyphonic.json', { bare, read });
    const found = coded(bare, 'narration.polyphonic');
    expect(found.length, `the line is refused with narration.polyphonic: ${show(bare, 2000)}`).toBeGreaterThan(0);
    const names = (o: JsonObject): boolean => (fieldOf(o, 'line') === 'zh' || words(o).includes('"zh"')) && JSON.stringify(o).includes('行') && words(fieldOf(o, 'readings') ?? o).includes('hang') && words(fieldOf(o, 'readings') ?? o).includes('xing');
    expect(found.some(names), `narration.polyphonic names the line zh, the character 行 and its readings, hang and xing among them: ${show(found, 1500)}`).toBe(true);
    expect(bare[1]!['outcome'], 'the refused script resolves no time').not.toBe('resolved');
    expect(coded(read, 'narration.polyphonic'), `with 行[hang] in say nothing is refused: ${show(read, 1500)}`).toEqual([]);
    expect(read[1]!['outcome'], `with 行[hang] in say the script compiles and @zh resolves: ${show(read[1])}`).toBe('resolved');
  }, TIMEOUT);
});

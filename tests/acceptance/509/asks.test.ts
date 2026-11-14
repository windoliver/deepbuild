// #509.ea6d2be6: "The same (line, audio) pair never asks twice, and editing the line's text opens a new ask only if the
// new pair fails"
//
// One line `l1` whose recording says "The quick brown fox jumps over the lazy dog", word by word by `say`. Its
// transcripts are made once by the real transcriber (heardBack, as in cut.test.ts), and the audio never changes, so
// every pair below is (a text, that take's PCM). Each verdict is its own `deep-show run` on one scenario `state` folder,
// whose record.jsonl keeps the asks across runs (Check input: narration.transcript@1, the exception ask):
//   1. text "… brown box …": FAILs and asks once, the ask {kind: exception, id: <claim>/narration.transcript:l1/<text
//      sha>.<audio sha>, line, clip, expected, heard};
//   2. the same text again: FAILs, no new ask;
//   3. the text edited to what the take says: PASSes, no new ask;
//   4. the text edited to "… brown cat …": FAILs and asks once more, for the new pair;
//   5. back to "… brown box …": FAILs, no new ask (that pair was asked in 1).
// "Asks" are the exception asks the verdict lists on itself and its rows; an ask whose ID was listed before isn't new.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, CLAIM, FULL, SPEECH, TIMEOUT, assetOf, exceptionAsks, film, heardBack, judgeAgain, openWorld, proof, recorded, sha256, show, stage, take, useShow,
  withLine, withPlugin, type JsonObject,
} from './helpers.ts';

const shows = useShow([FULL]);
const SPOKEN = 'The quick brown fox jumps over the lazy dog';
const BOX = SPOKEN.replace('fox', 'box');
const CAT = SPOKEN.replace('fox', 'cat');

describe(`${AC[4]} one ask per (line, audio) pair, and a new one only for a new pair that fails`, () => {
  it(`${AC[4]} the failing pair asks once and never again across runs; the text edited to what is said passes with no ask; edited to another failing text it asks once for the new pair`, async () => {
    const w = await openWorld([]);
    await withPlugin(w, SPEECH);
    const bin = shows.bin(FULL);
    const state = join(w.tmp, 'state');
    const voice = stage(w.evidence, take(SPOKEN));
    const base = film({ span: 6, lines: { l1: recorded('voice_l1', BOX, 0.5) }, assets: { voice_l1: assetOf(voice) } });
    const first = await heardBack(bin, w, base, 'verdict 1, text "brown box"', { state });
    const heard = first.document;
    const askId = (text: string): string => `${CLAIM}/narration.transcript:l1/${sha256(new TextEncoder().encode(text))}.${voice.pcmSha}`;

    const seen = new Set<string>();
    const log: { verdict: string; text: string; result: unknown; asks: JsonObject[]; fresh: string[] }[] = [];
    const judge = (n: number, text: string, verdict: JsonObject, row: JsonObject): string[] => {
      const listed = exceptionAsks(verdict);
      const fresh = [...listed.keys()].filter((id) => !seen.has(id));
      for (const id of listed.keys()) seen.add(id);
      log.push({ verdict: `verdict ${n}`, text, result: row['result'], asks: [...listed.values()], fresh });
      return fresh;
    };
    const again = (n: number, text: string): { row: JsonObject; fresh: string[] } => {
      const j = judgeAgain(bin, w, withLine(heard, 'l1', { text }), `verdict ${n}, text ${JSON.stringify(text)}`, { state });
      return { row: j.row, fresh: judge(n, text, j.verdict, j.row) };
    };

    const v1 = judge(1, BOX, first.verdict, first.row);
    const v2 = again(2, BOX);
    const v3 = again(3, SPOKEN);
    const v4 = again(4, CAT);
    const v5 = again(5, BOX);
    proof('ac4-ask-log.json', { audio: voice.pcmSha, transcripts: first.transcripts, log });

    expect(first.row['result'], `verdict 1: the pair (box, the take) FAILs: ${show(first.row, 2000)}`).toBe('FAIL');
    expect(v1, `verdict 1 asks once, its ask's ID ${askId(BOX)}: ${show(log[0]!.asks)}`).toEqual([askId(BOX)]);
    const ask = exceptionAsks(first.verdict).get(askId(BOX))!;
    expect({ line: ask['line'], clip: ask['clip'] }, `the ask names the line and the clip, the take's PCM: ${show(ask)}`).toEqual({ line: 'l1', clip: voice.pcmSha });
    expect(typeof ask['expected'] === 'string' && typeof ask['heard'] === 'string', `the ask carries both strings, expected and heard: ${show(ask)}`).toBe(true);
    expect([v2.row['result'], v2.fresh], 'verdict 2, the same pair: FAIL, and no ask it did not already make').toEqual(['FAIL', []]);
    expect([v3.row['result'], v3.fresh], 'verdict 3, the text edited to what the take says: PASS, and no new ask').toEqual(['PASS', []]);
    expect([v4.row['result'], v4.fresh], `verdict 4, the text edited to "brown cat": FAIL, and one new ask for the new pair: ${show(log[3]!.asks)}`).toEqual(['FAIL', [askId(CAT)]]);
    expect([v5.row['result'], v5.fresh], 'verdict 5, back to "brown box", a pair already asked: FAIL, and no new ask').toEqual(['FAIL', []]);
  }, TIMEOUT);
});

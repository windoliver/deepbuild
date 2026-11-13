// AC4: "A visemes bake made from a words bake places each shape one frame before its phoneme and holds X between lines;
// a planted bake with no lead fails, naming the first shape"
//
// The words bake is AC1's: the 10 s line (fixtures/synth.ts wordsLine) through bake.words on charsiu-aligner@1.0.0,
// its record by hash. The visemes bake (README: The surface) names two lines made from that record, `l1` at 0 and `l2`
// at 12 s, with the design's frame rate 24 Hz and lead "1f", and maps each phoneme through arpabet.visemes@1. Its
// `visemes [{t, shape, line}]` are judged against the record's own phonemes, read from the evidence store: each shape
// starts one frame (1/24 s) before its phoneme, within 1 ms, mapped by the design's table (a run of phonemes with one
// shape may show it once, from the run's first); X starts at each line's last phoneme's end, within a frame, and no
// shape starts between it and the next line's first. The planted bake `visemes_no_lead` (a deep-show scenario plant,
// README: Planted programs) puts each shape at its phoneme's start and fails, its first failure naming the first shape.
import { describe, expect, it } from 'vitest';
import { pcmBytes, sha256, wavF32, wordsLine } from './fixtures/synth.ts';
import { AC, ALIGNER, FLICKS, JOB, MS, TIMEOUT, bakes, mustBlockForPcm, mustRecord, openWorld, proof, readRecord, readings, sec, useShow, withBakes, type Bake, type Line, type ShowPlant } from './helpers.ts';

const show = useShow();
/** One frame at the bake's 24 Hz: the lead "1f". */
const FRAME = FLICKS / 24;
/** arpabet.visemes@1, as Analysis bake gives it. */
const MAP: Record<string, string> = Object.fromEntries(Object.entries({
  A: 'P B M', B: 'T D K G N NG S Z SH ZH CH JH TH DH Y IY IH', C: 'EH AE AH EY HH', D: 'AA AY AW', E: 'AO ER R UH OY', F: 'UW OW W', G: 'F V', H: 'L',
}).flatMap(([shape, phonemes]) => phonemes.split(' ').map((p) => [p, shape])));

interface Lined { line: string; at: number }
interface Expected { line: string; t: number; shape: string; p: string; start: number }
interface Got { n: number; t: number; shape: string; line: unknown }

/** Each phoneme's shape, one frame before it, line by line; or the record's failure. */
function expected(record: Line, lines: Lined[]): { shapes: Expected[]; ends: number[]; wrong?: string } {
  const shapes: Expected[] = [];
  const ends: number[] = [];
  for (const l of lines) {
    let last = -1;
    for (const word of (record.words ?? []) as Line[]) {
      for (const ph of (word.phonemes ?? []) as Line[]) {
        const shape = MAP[String(ph.p)];
        if (!shape || !Number.isSafeInteger(ph.start) || !Number.isSafeInteger(ph.end)) return { shapes, ends, wrong: `the words record's word ${JSON.stringify(word.text)} holds the phoneme ${JSON.stringify(ph)}, not an ARPAbet phoneme without stress with start and end in flicks` };
        shapes.push({ line: l.line, t: l.at + ph.start - FRAME, shape, p: String(ph.p), start: l.at + ph.start });
        last = Math.max(last, ph.end);
      }
    }
    if (last < 0) return { shapes, ends, wrong: 'the words record holds no phonemes' };
    ends.push(l.at + last);
  }
  return { shapes, ends };
}

/** The visemes against the record, in order; the first failure about a shape names it. */
function judgeVisemes(answer: Line[] | undefined, record: Line, lines: Lined[]): string[] {
  if (!Array.isArray(answer)) return [`the visemes bake answers no \`visemes\` list: ${JSON.stringify(answer)}`];
  const exp = expected(record, lines);
  if (exp.wrong) return [exp.wrong];
  const f: string[] = [];
  const got: Got[] = answer.map((v, i) => ({ n: i + 1, t: Number(v?.t), shape: String(v?.shape), line: v?.line }));
  const name = (v: Got) => `shape ${v.n}, ${v.shape} at ${sec(v.t)} on ${String(v.line)}`;
  const same = (a: Expected, b: Expected | undefined) => b !== undefined && a.shape === b.shape && a.line === b.line;
  const fits = (v: Got, e: Expected) => v.shape === e.shape && v.line === e.line && Math.abs(v.t - e.t) <= MS;
  let j = 0;
  for (const v of got.filter((x) => x.shape !== 'X')) {
    while (j < exp.shapes.length && !fits(v, exp.shapes[j]!) && same(exp.shapes[j]!, exp.shapes[j - 1])) j++;
    const e = exp.shapes[j];
    if (!e) { f.push(`${name(v)}: the record has no phoneme left for it`); break; }
    if (!fits(v, e)) { f.push(`${name(v)}: its phoneme ${e.p} on ${e.line} starts at ${sec(e.start)}, so it must be ${e.shape} at ${sec(e.t)}, one frame (1/24 s) before; it lies ${((e.start - v.t) / MS).toFixed(1)} ms before the phoneme`); break; }
    j++;
  }
  if (!f.length) {
    while (j < exp.shapes.length && same(exp.shapes[j]!, exp.shapes[j - 1])) j++;
    const e = exp.shapes[j];
    if (e) f.push(`the phoneme ${e.p} on ${e.line} at ${sec(e.start)} has no shape ${e.shape} at ${sec(e.t)}`);
  }
  lines.forEach((l, k) => {
    const end = exp.ends[k]!;
    const x = got.find((v) => v.shape === 'X' && Math.abs(v.t - end) <= FRAME);
    if (!x) { f.push(`no X starts at ${l.line}'s last phoneme's end, ${sec(end)}`); return; }
    const next = exp.shapes.find((e) => e.line === lines[k + 1]?.line)?.t ?? Infinity;
    const broke = got.find((v) => v.shape !== 'X' && v.t > x.t && v.t < next);
    if (broke) f.push(`${name(broke)} breaks the X held from ${sec(x.t)} after ${l.line}${lines[k + 1] ? ` until ${lines[k + 1]!.line}'s first shape at ${sec(next)}` : ''}`);
  });
  got.forEach((v, i) => { if (i > 0 && v.t < got[i - 1]!.t) f.push(`${name(v)} comes before the shape listed ahead of it: the visemes aren't in time order`); });
  return f;
}

describe('AC4 a visemes bake leads each phoneme by a frame and holds X between lines', () => {
  it(`${AC[4]} a visemes bake of two lines from a words bake places each shape one frame before its phoneme and holds X between the lines; the planted bake visemes_no_lead fails, naming the first shape`, async () => {
    const line = wordsLine();
    const wav = wavF32(line.samples, line.rate);
    const text = new TextEncoder().encode(line.text);
    const asset = sha256(wav);
    const w = await openWorld([wav, text]);
    const words: Bake = { asset, kind: 'words', analyzer: ALIGNER, source: 'aligner' };
    const pcm = mustBlockForPcm(show(), w, words, pcmBytes(line.samples), 'the line, with no record');

    await withBakes(w);
    const { record } = await mustRecord(w, JOB.words, ALIGNER, [{ name: 'pcm', sha256: pcm }, { name: 'text', sha256: sha256(text) }], line.rate);
    const kept = readRecord(w, record);
    const lines: Lined[] = [{ line: 'l1', at: 0 }, { line: 'l2', at: 12 * FLICKS }];
    const ask: Bake = { asset, kind: 'visemes', analyzer: ALIGNER, source: 'aligner', map: 'arpabet.visemes@1', lead: '1f', rate: 24, lines: lines.map((l) => ({ ...l, words: record })) };
    const visemes = readings(bakes(show(), w, [ask], 'two lines from the words bake')[0]!, ask, 'the visemes bake').visemes as Line[] | undefined;
    const failures = judgeVisemes(visemes, kept, lines);
    proof('ac4-visemes.json', { record, phonemes: ((kept.words ?? []) as Line[]).map((x) => ({ text: x.text, phonemes: x.phonemes })), visemes, failures });
    expect(failures, 'each shape one frame before its phoneme, and X held between the lines').toEqual([]);

    const plant: ShowPlant = 'visemes_no_lead';
    const late = readings(bakes(show(), w, [ask], 'two lines from the words bake', plant)[0]!, ask, `the visemes bake (planted ${plant})`).visemes as Line[] | undefined;
    const wrong = judgeVisemes(late, kept, lines);
    proof('ac4-planted.json', { plant, visemes: late, failures: wrong });
    const first = (late ?? []).findIndex((v) => v?.shape !== 'X') + 1;
    expect(first > 0 && (wrong[0] ?? '').startsWith(`shape ${first}, `), `the planted bake ${plant} fails, its first failure naming the first shape (shape ${first}): ${JSON.stringify(wrong.slice(0, 3))}`).toBe(true);
  }, TIMEOUT);
});

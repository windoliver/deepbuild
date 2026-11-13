// #509.75b040de: "Two lines overlapping by 0.2 s are refused with `narration.overlap`, naming both and 0.2 s, and the
// `after` fix passes; a line 1.4 s past its section's end fails `narration.fit`, naming 1.4 s"
//
// Through `deep-show run`. Lines are your own recordings spoken word by word by `say` at known samples, their words
// records written from those samples (#502's shapes). Overlap: `a` at 0.5 s, "The river bends to the west", laid so its
// last word ends on a whole 10 ms; `b`, "Boats drift past the old mill", its take starting on its first word, at `t` =
// a's last word's end less 0.2 s. The script is refused with narration.overlap {lines: [a, b], overlap: 0.2 s to the
// millisecond, fix: {line: b, after: a}} (read from any reply; `time @b` resolves nothing). The fix, b with `after: a`
// and no `t`, compiles: no narration.overlap, and `@b` is 0.3 s after a's last word, within one sample. Fit: a section
// marker `s1` over [0, 3 s) and the line `c` at 1 s whose last word ends 3.4 s into its take, at 4.4 s: the export FAILs
// with narration.fit {line: c, section: s1, overrun: 1.4 s}; with s1 over [0, 5 s) the same film is delivered.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, FLICKS, FULL, RATE, SAMPLE, TIMEOUT, assetOf, coded, endingAt, fieldOf, film, filmRun, flicksOf, lit, num, proof, recorded, show, stage, take, timeCall,
  useShow, useTemp, words, type JsonObject, type JsonValue,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const A = 'The river bends to the west';
const B = 'Boats drift past the old mill';
const C = 'Every lantern on the bridge glows softly';
const TEN_MS = RATE / 100;

describe(`${AC[12]} narration.overlap refuses two lines that overlap and the after fix passes; narration.fit fails a line past its section`, () => {
  it(`${AC[12]} a and b overlapping by 0.2 s are refused with narration.overlap naming both, 0.2 s and the fix after; b with after: a compiles, 0.3 s after a`, () => {
    const bin = shows.bin(FULL);
    const raw = take(A);
    const a = endingAt(raw, Math.ceil(raw.words[raw.words.length - 1]!.end / TEN_MS) * TEN_MS);
    const b = take(B);
    expect(b.words[0]!.start, 'the fixture: b\'s take starts on its first word').toBe(0);
    const aEnd = 0.5 + a.words[a.words.length - 1]!.end / RATE;
    const run = (bLine: JsonObject, what: string): JsonObject[] => {
      const evidence = temp();
      const sa = stage(evidence, a);
      const sb = stage(evidence, b);
      const doc = film({ span: 9, lines: { a: recorded('voice_a', A, 0.5), b: bLine }, assets: { voice_a: assetOf(sa), voice_b: assetOf(sb) } });
      return filmRun(bin, evidence, doc, [timeCall('@b')], what);
    };
    const overlapping = run(recorded('voice_b', B, Number((aEnd - 0.2).toFixed(2))), 'b starting 0.2 s before a ends');
    const fixed = run(recorded('voice_b', B, null, { after: 'a' }), 'b with after: a');
    proof('ac12-overlap.json', { overlapping, fixed, a_end_s: aEnd });

    const found = coded(overlapping, 'narration.overlap');
    expect(found.length, `the script is refused with narration.overlap: ${show(overlapping, 2000)}`).toBeGreaterThan(0);
    const o = found[0]!;
    expect(fieldOf(o, 'lines'), `narration.overlap names both lines, first a then b: ${show(o)}`).toEqual(['a', 'b']);
    expect(Math.abs(num(fieldOf(o, 'overlap'), 'narration.overlap: overlap (s)') - 0.2), `the overlap is 0.2 s to the millisecond: ${show(o)}`).toBeLessThan(0.0005);
    expect(fieldOf(o, 'fix'), `the fix is after: b starts after a: ${show(o)}`).toEqual({ line: 'b', after: 'a' });
    expect(overlapping[1]!['outcome'], 'the refused script resolves no time').not.toBe('resolved');

    expect(coded(fixed, 'narration.overlap'), `with after: a nothing overlaps: ${show(fixed, 1500)}`).toEqual([]);
    expect(fixed[1]!['outcome'], `with after: a the script compiles: ${show(fixed[1])}`).toBe('resolved');
    const want = Math.round(aEnd * FLICKS) + (3 * FLICKS) / 10;
    expect(Math.abs((fixed[1]!['t'] as number) - want), `@b is 0.3 s after a's last word, ${want} flicks, within one sample`).toBeLessThanOrEqual(SAMPLE);
  }, TIMEOUT);

  it(`${AC[12]} c, whose last word ends at 4.4 s, fails narration.fit naming c, s1 and 1.4 s against a 3 s section; against a 5 s section it is delivered`, () => {
    const bin = shows.bin(FULL);
    const c = endingAt(take(C), Math.round(3.4 * RATE));
    expect(1 + flicksOf(c.words[c.words.length - 1]!.end) / FLICKS, 'the fixture: c\'s last word ends at 4.4 s').toBeCloseTo(4.4, 9);
    const run = (section: number, what: string): { reply: JsonObject; dir: string } => {
      const evidence = temp();
      const dir = temp();
      const doc = film({
        span: 6, lines: { c: recorded('voice_c', C, 1) }, assets: { voice_c: assetOf(stage(evidence, c)) },
        markers: { s1: { kind: 'section', name: 'section s1', t: '0s', span: lit(section) } },
      });
      const [presented, reply] = filmRun(bin, evidence, doc, [{ call: 'export', doc: DOC.a, out: join(dir, 'film.mp4'), video: { codec: 'h264' }, audio: { codec: 'aac' } }], what);
      expect(presented!['outcome'], `${what}: the film is presented: ${show(presented)}`).toBe('presented');
      return { reply: reply!, dir };
    };
    const short = run(3, 'c in a 3 s section');
    const long = run(5, 'c in a 5 s section');
    proof('ac12-fit.json', { short: short.reply, long: long.reply });

    expect(short.reply['outcome'], `the export FAILs: ${show(short.reply, 1500)}`).toBe('failed');
    const fit = coded(short.reply, 'narration.fit');
    expect(fit.length, `an issue narration.fit: ${show(short.reply['issues'] ?? null, 1500)}`).toBeGreaterThan(0);
    const f = fit[0]!;
    expect([fieldOf(f, 'line'), fieldOf(f, 'section')], `narration.fit names the line c and its section s1: ${show(f)}`).toEqual(['c', 's1']);
    expect(Math.abs(num(fieldOf(f, 'overrun') as JsonValue, 'narration.fit: overrun (s)') - 1.4), `the overrun is 1.4 s: ${show(f)}`).toBeLessThan(0.0005);
    expect(readdirSync(short.dir), 'the FAILed export wrote nothing').toEqual([]);
    expect(long.reply['outcome'], `in a 5 s section the line fits and the film is delivered: ${show(long.reply, 1500)}`).toBe('exported');
    expect(words(coded(long.reply, 'narration.fit')), 'and no narration.fit is raised').toBe('[]');
  }, TIMEOUT);
});

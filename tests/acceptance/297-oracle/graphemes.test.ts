// Oracle lane for AC3 #297.d2e288d8: A box sized for 10 of the widest glyph ellipsizes a 16-letter name at a grapheme
// boundary, and an entry text with no `widest` is refused at check, naming it; a planted fit check that skips entry
// texts passes the second and fails, naming the item
//
// Upstream: the segmenter's conformance run, icu4x b1cec62bb7 components/segmenter/tests/spec_test.rs:377-452
// (grapheme_break_test), over Unicode's GraphemeBreakTest.txt: a row's `÷` marks are its boundaries. Run on our code
// (README): the file lists the boundaries an ellipsis may cut at. Each row the clean look's faces draw (its body face
// and its emoji face) and the #297 rules take is committed by seat 1 to `name`, after a prefix of j letters i and a
// space (j from 0 to 20, none for j = 0), into `cut`, an entry text whose box is 80 u at 16 u; each frame's `shown` must
// be the whole entry's NFC form or the NFC form of its first k clusters, by the file's boundaries, with an ellipsis. The
// fit check, `widest` and its refusal are ours and stay in tests/acceptance/297/ac03-fit.test.ts.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, GRAPHEMES, GRAPHEMES_SHA256, Script, TIMEOUT, at, commit, drawnBy, entryText, named, none, piece, presented, putEvidence, runShow, scenario,
  seatsProgram, shownOf, takes, trackOf, useShow, useTemp, vendored,
} from './helpers.ts';

const show = useShow();
const temp = useTemp();
const D = DOC(31);
const MAX_BYTES = 64;
const BOX = 80;
const PREFIXES = 21;
const ELLIPSIS = '\u{2026}';

/** The file's rows as clusters, those the clean look's body and emoji faces draw and the #297 rules take as typed. */
function rows(): { kept: { line: number; clusters: string[] }[]; all: number } {
  const faces = [drawnBy('Inter-Regular.ttf'), drawnBy('NotoEmoji-Regular.ttf')];
  const kept: { line: number; clusters: string[] }[] = [];
  let all = 0;
  vendored(GRAPHEMES, GRAPHEMES_SHA256).split('\n').forEach((raw, n) => {
    const line = raw.replace(/#.*/, '').trim();
    if (line === '') return;
    all += 1;
    const clusters: number[][] = [];
    let current: number[] | null = null;
    for (const p of line.split(/\s+/)) {
      if (p === '\u{00f7}') { if (current) clusters.push(current); current = null; } else if (p !== '\u{00d7}') (current ??= []).push(Number.parseInt(p, 16));
    }
    if (current) clusters.push(current);
    const strs = clusters.map((c) => String.fromCodePoint(...c));
    if (takes(strs.join(''), faces, MAX_BYTES)) kept.push({ line: n + 1, clusters: strs });
  });
  return { kept, all };
}

interface Case { line: number; j: number; clusters: string[]; entry: string }
/** Every row after each prefix: the prefix's letters and its space are clusters of their own (a space breaks from what
 * follows it, GB999), then the row's. */
function cases(kept: { line: number; clusters: string[] }[]): Case[] {
  return kept.flatMap((r) => Array.from({ length: PREFIXES }, (_, j): Case => {
    const prefix = j === 0 ? [] : [...'i'.repeat(j).split(''), ' '];
    const clusters = [...prefix, ...r.clusters];
    return { line: r.line, j, clusters, entry: clusters.join('') };
  }));
}
const trimmed = (s: string): string => s.replace(/\s+\u{2026}$/u, ELLIPSIS);
/** The judge: `shown` is the whole entry's NFC form, or its first k clusters' NFC form with an ellipsis; the count of
 * cuts strictly inside the row (between two of its clusters). */
function judge(list: Case[], shown: (c: Case, k: number) => string | undefined): { failures: string[]; inside: number } {
  const failures: string[] = [];
  let inside = 0;
  list.forEach((c, k) => {
    const got = shown(c, k);
    const prefix = c.j === 0 ? 0 : c.j + 1;
    const cuts = c.clusters.map((_, n) => trimmed(`${c.clusters.slice(0, n).join('').normalize('NFC')}${ELLIPSIS}`));
    if (got === c.entry.normalize('NFC')) return;
    const at = got === undefined ? -1 : cuts.indexOf(trimmed(got));
    if (at < 0) failures.push(`GraphemeBreakTest.txt line ${c.line} after ${c.j} letters: ${named(c.entry)} shows ${got === undefined ? 'nothing it reports' : named(got)}, cut at no boundary the file gives`);
    else if (at > prefix && at < c.clusters.length) inside += 1;
  });
  return { failures, inside };
}

describe(`${AC[3]} Oracle: the entry text's ellipsis cuts at a boundary GraphemeBreakTest.txt gives`, () => {
  it(`${AC[3]} every row the clean look's faces draw, cut by the box at each of 21 prefixes, cuts at the file's boundaries, run on our entry text`, () => {
    const { kept, all } = rows();
    const list = cases(kept);
    console.log(`${AC[3]} Oracle: ${kept.length} of the file's ${all} rows (${list.length} entries), the rest drawn by no face of the clean look or refused by the #297 rules`);
    expect(kept.filter((r) => r.clusters.length > 1).length, 'the file gives rows of more than one cluster the faces draw').toBeGreaterThan(10);
    // The judge first: a cut inside a cluster fails, and the whole entry and a cut between clusters pass.
    const sample: Case = { line: 0, j: 0, clusters: ['b\u{0308}', 'c'], entry: 'b\u{0308}c' };
    expect(judge([sample], () => 'b\u{2026}').failures.length, 'the judge fails a cut inside a cluster').toBe(1);
    expect(judge([sample, sample, sample], (_, k) => ['b\u{0308}c', 'b\u{0308}\u{2026}', '\u{2026}'][k]).failures, 'the judge takes the whole and the cuts between clusters').toEqual([]);

    const ev = temp();
    const seats = seatsProgram();
    putEvidence(ev, seats.bytes);
    const s = new Script();
    s.present(D, piece('cut', seats, [entryText('cut', 1, { pos: [16, 80], order: 'a1', w: BOX, widest: 'WWW' })], { maxBytes: MAX_BYTES, span: `${Math.ceil((list.length + 60) / 60)}s` }));
    s.track(D, trackOf(list.map((c, k) => commit(k + 1, 1, c.entry))));
    const frames = list.map((_, k) => s.eval(D, at(k + 1)));
    const r = runShow(show(), scenario(ev, [D], s.calls), 'the Oracle lane: GraphemeBreakTest.txt\'s rows after each prefix, one a step');
    presented(r[0]!, 'the Oracle lane\'s piece');
    const j = judge(list, (_, k) => shownOf(r[frames[k]!]!, `the frame at step ${k + 1}`)['cut']);
    console.log(`${AC[3]} Oracle: ${j.inside} cuts fell between two clusters of a row`);
    none(j.failures, 'GraphemeBreakTest.txt run on our ellipsis');
    expect(j.inside, 'some cut falls between two clusters of a row, so the file\'s boundaries inside a row are tried').toBeGreaterThan(0);
  }, TIMEOUT);
});

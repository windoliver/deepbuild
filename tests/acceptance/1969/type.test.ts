// AC3 #1969.3ef80026: "A `type {cursor}` cue over a 12-character text item writes one key a character, in order, inside
// the cue's span, and ends with every glyph drawn and the cursor after the last; the verb passes the cue kit, and a
// planted `type` that keys the cursor one flick past the span is refused by the kit, naming the verb"
//
// Through `deep-show run` with the first-party verbs pack offered (README: The surface under test). The film, 640 × 360
// u over 4 s, names `deepbuild/verbs@1.0.0` and holds `code`, "return(a+b);" (12 characters, one glyph each) in the
// mono role at 32 u at (40, 140) with `reveal: {mode: fade, order: reading, progress: 1}`; `caret`, the text "|" in
// the mono role at the origin; `twin`, the same caret at (560, 300), which no cue moves and which gives a caret's own pen
// offset from its anchor point; and the cue list `list` with one cue, `typing`: `{kind: "type", targets: ["code"], when:
// {at: "0.5s"}, span: "2.4s", params: {cursor: "caret"}}`. The plain film holds `code` alone with no reveal.
//
// Test 1. The cue's marker `cues.typing` covers exactly [0.5 s, 2.9 s] (one target, so its span is 2.4 s), and every
// key the cue writes, on the text and on the cursor, lies inside it. One key a character, in order: the cue keys the
// text's `params/reveal/progress` (README: chosen), and at its keys' times, in order, the number of graphemes that show
// (units whose reveal has passed 0.5, by the design's schedule: 12 units, lag 0.2, w = 1 ÷ 3.2) reads 1, 2, … 12, after
// at most one key at the cue's start that shows none; between two keys it holds the earlier key's count. At the cue's
// end and 0.5 s after, the text's pixels (its line, short of the caret) equal the plain film's, every pixel within 32
// code values and 99.9% within 2, and the caret's anchor point lies after the 12th glyph (its pen plus the mono pitch)
// within 0.5 px, on the code's line (between its top and its baseline). Wrong programs: a linear write (many characters
// a key), a key per character out of order, a key past the window, a text left part drawn, a caret left at the start or
// one character short. The same run reads deep://registries: `type` is listed in cue.kind@1 with origin `first_party`
// and its kit result PASS on each of the five rules.
//
// Test 2. deep://registries' cue.kind@1 row lists a planted entry `type` (the kit's planted `type` that keys the cursor
// one flick past the span): its kit result FAIL, the rule `inside_span` FAIL, and that rule's message naming `type`.
// Wrong program: a kit that admits it, or refuses it without naming the verb.
import { describe, expect, it } from 'vitest';
import {
  AC, CUE_KINDS, KIT_RULES, TIMEOUT, VERBS_AT, arr, brief, codeDiff, cueList, docId, evalAt, expansionOf, fl, filmGlyphs,
  inconclusive, isObject, kitOf, none, num, pixel, present, presented, registryRow, runShow, scenario, showFilm, showTime, shownAt,
  snapshotOf, useBinary, useFolders, valueOf, type Image, type JsonObject,
} from './helpers.ts';

const show = useBinary('deep-show');
const folder = useFolders();

const CODE = 'return(a+b);';
const N = 12;
const SIZE = 32;
const ORIGIN: [number, number] = [40, 140];
const TWIN: [number, number] = [560, 300];
const PROGRESS = 'items/code/params/reveal/progress';
const START = fl(0.5);
const SPAN = fl(2.4);
const END = START + SPAN;

const code = (reveal: boolean): JsonObject => ({
  id: 'code', kind: 'text@1', name: 'Code', order: 'a1', at: { pos: [ORIGIN[0], ORIGIN[1], 0] },
  params: { text: CODE, font: 'mono', size: SIZE, paint: { fill: { role: 'ink' } }, ...(reveal ? { reveal: { mode: 'fade', order: 'reading', progress: 1 } } : {}) },
});
const caretParams = { text: '|', font: 'mono', size: SIZE, paint: { fill: { role: 'accent' } } };
const TYPED = showFilm('Typed', [
  code(true),
  { id: 'caret', kind: 'text@1', name: 'Caret', order: 'a2', at: { pos: [0, 0, 0] }, params: caretParams },
  { id: 'twin', kind: 'text@1', name: 'Twin', order: 'a3', at: { pos: [TWIN[0], TWIN[1], 0] }, params: caretParams },
  cueList([{ id: 'typing', kind: 'type', targets: ['code'], when: { at: '0.5s' }, span: '2.4s', params: { cursor: 'caret' } }]),
], { span: 4, packs: [VERBS_AT] });
const PLAIN = showFilm('Plain', [code(false)], { span: 4 });
const [D_TYPED, D_PLAIN] = [docId(1), docId(2)];

/** The graphemes that show at the progress an `eval` reply reads. */
function shown(reply: JsonObject, what: string): number {
  return shownAt(num(valueOf(reply, PROGRESS, what), `${what}: ${PROGRESS}`), N);
}

/** Where the typed text ends: its glyphs' pens, the mono pitch, the point after the 12th glyph and the baseline. */
function line(reply: JsonObject, what: string): { after: number; baseline: number } {
  const pens = filmGlyphs(reply, 'code', what);
  expect(pens.length, `${what}: "${CODE}" draws one glyph a character`).toBe(N);
  const pitch = pens[1]![0] - pens[0]![0];
  const uneven = pens.slice(1).some((p, i) => Math.abs(p[0] - pens[i]![0] - pitch) > 0.01);
  if (uneven || !(pitch > 0)) inconclusive(`${what}: the mono role's glyphs don't advance by one pitch (${pens.map((p) => p[0].toFixed(3)).join(', ')}), so "after the last" has no width to read`);
  return { after: pens[N - 1]![0] + pitch, baseline: pens[0]![1] };
}

/** Every pixel of the text's line, short of the caret, in the typed frame against the plain one. */
function differs(typed: Image, plain: Image, after: number, baseline: number, what: string): string[] {
  const scale = typed.width / 640;
  expect([typed.width, typed.height], `${what}: the typed and plain frames are one size`).toEqual([plain.width, plain.height]);
  let over32 = 0; let over2 = 0; let all = 0; let ink = 0;
  const ground = pixel(plain, 2, 2);
  for (let y = Math.floor((ORIGIN[1] - 4) * scale); y <= Math.ceil((baseline + 0.35 * SIZE) * scale); y++) {
    for (let x = Math.floor((ORIGIN[0] - 4) * scale); x < Math.floor((after - 2) * scale); x++) {
      const d = codeDiff(pixel(typed, x, y), pixel(plain, x, y));
      all++;
      if (d > 32) over32++;
      if (d > 2) over2++;
      if (codeDiff(pixel(plain, x, y), ground) > 64) ink++;
    }
  }
  const out: string[] = [];
  if (ink < 100) out.push(`${what}: the plain film draws only ${ink} ink pixels on the text's line, too few to compare`);
  if (over32 > 0) out.push(`${what}: ${over32} pixels of the text's line differ from the plain text's by more than 32 code values: a glyph isn't drawn whole`);
  if (over2 > all * 0.001) out.push(`${what}: ${over2} of ${all} pixels of the text's line differ from the plain text's by more than 2 code values`);
  return out;
}

describe(`${AC[3]} the type cue types a text's characters behind a cursor and passes the cue kit`, () => {
  it(`${AC[3]} a type {cursor} cue over a 12-character text writes one key a character, in order, inside the cue's span, and ends with every glyph drawn and the cursor after the last; the verb passes the cue kit`, () => {
    const [shownReply, registries] = runShow(show(), scenario(folder(), [present(D_TYPED, TYPED), { call: 'registries' }]));
    presented(shownReply!, 'the typed film');

    // The verb, listed and passing the cue kit.
    const entry = arr(registryRow(registries!, CUE_KINDS)['entries'], `${CUE_KINDS}: entries`).filter(isObject).find((e) => e['name'] === 'type');
    expect(entry, `${CUE_KINDS} lists the first-party verb type`).toBeDefined();
    const listed: string[] = [];
    if (entry!['origin'] !== 'first_party') listed.push(`type is listed with origin ${brief(entry!['origin'])}, not first_party`);
    const kit = kitOf(entry!['kit'], 'type\'s kit');
    if (kit.verdict !== 'PASS') listed.push(`type's cue kit result is ${kit.verdict}: ${brief(kit.raw, 600)}`);
    for (const rule of KIT_RULES) {
      const r = kit.rules.find((x) => x.rule === rule);
      if (r?.verdict !== 'PASS') listed.push(`type: the cue kit's rule ${rule} reads ${r ? r.verdict : 'nothing'}`);
    }
    none(listed, 'type is a first-party verb that passes the cue kit');

    // Inside the cue's span.
    const e = expansionOf(shownReply!, 'the typed film');
    const m = e.markers['cues.typing'];
    expect(m, `the expansion writes the marker cues.typing; it writes ${Object.keys(e.markers).join(', ') || 'none'}`).toBeDefined();
    expect([m!.t, m!.span], `cues.typing covers [0.5 s, 2.9 s]: it reads [${showTime(m!.t)}, + ${showTime(m!.span)}]`).toEqual([START, SPAN]);
    const own = e.channels.filter((c) => c.cue === 'typing');
    const outside = own.flatMap((c) => c.times.filter((t) => t < START || t > END).map((t) => `${c.id} on ${c.target} keys at ${showTime(t)}, outside [0.5 s, 2.9 s]`));
    none(outside, 'every key the type cue writes lies inside its span');
    const progress = own.filter((c) => c.target === PROGRESS);
    expect(progress.length, `the type cue keys the text's ${PROGRESS} (README: chosen); it writes ${own.map((c) => c.target).join(', ') || 'nothing'}`).toBeGreaterThan(0);
    const keys = [...new Set(progress.flatMap((c) => c.times))].sort((a, b) => a - b);
    const mids = keys.slice(1).map((t, j) => Math.floor((keys[j]! + t) / 2));

    const calls = [
      present(D_TYPED, TYPED), present(D_PLAIN, PLAIN),
      ...keys.map((t) => evalAt(D_TYPED, t, { paths: [PROGRESS] })),
      ...mids.map((t) => evalAt(D_TYPED, t, { paths: [PROGRESS] })),
      ...[END, END + fl(0.5)].flatMap((t) => [evalAt(D_TYPED, t, { paths: [PROGRESS], film: true, pixels: true }), evalAt(D_PLAIN, t, { pixels: true })]),
    ];
    const evidence = folder();
    const replies = runShow(show(), scenario(evidence, calls));
    presented(replies[0]!, 'the typed film'); presented(replies[1]!, 'the plain film');
    const failures: string[] = [];

    // One key a character, in order.
    const counts = keys.map((t, j) => shown(replies[2 + j]!, `the typed film at its key ${showTime(t)}`));
    const c0 = counts[0] === 0 && keys[0] === START ? 0 : 1;
    const want = Array.from({ length: N + 1 - c0 }, (_, j) => c0 + j);
    if (JSON.stringify(counts) !== JSON.stringify(want)) {
      failures.push(`at the type cue's keys (${keys.map(showTime).join(', ')}) the graphemes that show read ${counts.join(', ')}, not one more a key from ${c0} to ${N}`);
    } else {
      mids.forEach((t, j) => {
        const c = shown(replies[2 + keys.length + j]!, `the typed film at ${showTime(t)}`);
        if (c !== counts[j]) failures.push(`at ${showTime(t)}, between two keys, ${c} graphemes show, not the ${counts[j]} the earlier key shows`);
      });
    }

    // Every glyph drawn and the cursor after the last, at the cue's end and after.
    const at = 2 + keys.length + mids.length;
    [END, END + fl(0.5)].forEach((t, i) => {
      const what = `the typed film at ${showTime(t)}`;
      const typed = replies[at + 2 * i]!; const plain = replies[at + 2 * i + 1]!;
      if (shown(typed, what) !== N) failures.push(`${what}: ${shown(typed, what)} graphemes show, not all ${N}`);
      const { after, baseline } = line(typed, what);
      failures.push(...differs(snapshotOf(typed, evidence, what), snapshotOf(plain, evidence, `the plain film at ${showTime(t)}`), after, baseline, what));
      const pen = filmGlyphs(typed, 'caret', what)[0]!;
      const twin = filmGlyphs(typed, 'twin', what)[0]!;
      const point = [pen[0] - (twin[0] - TWIN[0]), pen[1] - (twin[1] - TWIN[1])] as const;
      if (!(Math.abs(point[0] - after) <= 0.5)) failures.push(`${what}: the cursor sits at x = ${point[0].toFixed(3)}, not after the last glyph at ${after.toFixed(3)} within 0.5 px`);
      if (!(point[1] >= ORIGIN[1] - 0.5 && point[1] <= baseline + 0.5)) failures.push(`${what}: the cursor sits at y = ${point[1].toFixed(3)}, off the code's line (${ORIGIN[1]} to its baseline ${baseline.toFixed(3)})`);
    });
    none(failures, 'the type cue writes one key a character in order, and ends with every glyph drawn and the cursor after the last');
  }, TIMEOUT);

  it(`${AC[3]} the cue kit refuses a planted type that keys the cursor one flick past the span, naming the verb`, () => {
    const [registries] = runShow(show(), scenario(folder(), [{ call: 'registries' }]));
    const planted = arr(registryRow(registries!, CUE_KINDS)['planted'], `${CUE_KINDS}: planted`).filter(isObject);
    const entry = planted.find((p) => p['name'] === 'type');
    expect(entry, `${CUE_KINDS} lists a planted entry type; it lists ${planted.map((p) => brief(p['name'])).join(', ') || 'none'}`).toBeDefined();
    const kit = kitOf(entry!['result'], 'the planted type\'s kit result');
    expect(kit.verdict, `the kit refuses the planted type: ${brief(kit.raw, 600)}`).toBe('FAIL');
    const rule = kit.rules.find((r) => r.rule === 'inside_span');
    expect(rule?.verdict, `the planted type fails the rule inside_span: ${brief(kit.raw, 600)}`).toBe('FAIL');
    expect(rule!.message, 'the rule\'s failure names the verb type').toMatch(/\btype\b/);
  }, TIMEOUT);
});

// AC1 #1965.1f0016ec: Switching a code item's look recolors its keywords to the new look's keyword role with no change
// to the document's hash, and a token class outside the list is refused naming it
//
// Three tests: the recolor under two looks of this suite (`code: {class → role}` added to #467's look), the same
// switch between the shipped looks (the scope's "every shipped look defines code and diff roles", kept the status
// distance), and the refusal of a class outside the list. The document is `def go(a):` / `    return a` with four
// tokens (two keywords, a function, a variable); `a` on line 1 has none, so it draws in plain. Expected colors are
// the looks' own palette entries, read from the look files' roles, never from an answer.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AC, CLASSES, CODE_A, CODE_B, ITEM, LOOK_A, LOOK_B, accepted, checkOne, codeDoc, describe as errors, drawOne, indicesOf, matching, model, naming, role, useBin, useDir, words, cell, lookCommand, rgbOf, distance, type GlyphRow, type Rgb } from './helpers.ts';
import { shown } from '../467/helpers.ts';

const ID = AC[1];
const bin = useBin('deep-canvas-render');
const dir = useDir();

const RAW = 'def go(a):\n    return a\n';
const M = model(RAW);
const at = (needle: string, nth = 0): [number, number] => {
  let from = -1;
  for (let k = 0; k <= nth; k++) from = RAW.indexOf(needle, from + 1);
  return [from, from + needle.length];
};
const [DEF, GO, RETURN] = [at('def'), at('go'), at('return')];
const A_LINE2 = RAW.lastIndexOf('a');
const TOKENS = [
  { from: DEF[0], to: DEF[1], class: 'keyword' }, { from: GO[0], to: GO[1], class: 'function' },
  { from: RETURN[0], to: RETURN[1], class: 'keyword' }, { from: A_LINE2, to: A_LINE2 + 1, class: 'variable' },
];
/** The `a` of `go(a)`: no token covers it, so it draws in plain. */
const PLAIN = RAW.indexOf('(a') + 1;

function glyphAt(glyphs: GlyphRow[], index: number, what: string): GlyphRow {
  const found = glyphs.filter((g) => g.grapheme === index);
  expect(found.length, `${what}: display grapheme ${index} ("${M.graphemes[index]?.text}") is drawn by one glyph: ${shown(found)}`).toBe(1);
  return found[0]!;
}
/** Pixels in the glyph's cell in `rgb`: ink the glyph's run was drawn in. */
const inkOf = (im: NonNullable<ReturnType<typeof drawOne>['image']>, g: GlyphRow, rgb: Rgb): number => matching(im, cell(g), rgb);

describe(`${ID} switching the look recolors the keywords`, () => {
  it(`${ID} the same document drawn in two looks draws its keywords in each look's keyword role, its hash unchanged`, () => {
    const doc = codeDoc('recolor-1965', RAW, { tokens: TOKENS });
    const before = createHash('sha256').update(JSON.stringify(doc)).digest('hex');
    const a = accepted(drawOne(bin(), dir(), doc, LOOK_A), 'in look A');
    const b = accepted(drawOne(bin(), dir(), doc, LOOK_B), 'in look B');
    expect(createHash('sha256').update(JSON.stringify(doc)).digest('hex'), 'the document is the same bytes after both draws: a look is no part of it').toBe(before);
    expect(a.shown, 'the display text is the same in both looks').toBe(b.shown);
    expect(a.shown, `the display text is the raw's display form`).toBe(M.text);

    const roles = (code: Record<string, string>): Record<'keyword' | 'function' | 'variable' | 'plain', Rgb> => ({ keyword: role(code['keyword']!), function: role(code['function']!), variable: role(code['variable']!), plain: role(code['plain']!) });
    const want = { a: roles(CODE_A), b: roles(CODE_B) };
    expect(want.a.keyword.join(), 'the two looks give keywords different roles').not.toBe(want.b.keyword.join());
    const tokens: [string, number[], 'keyword' | 'function' | 'variable'][] = [
      ['def', indicesOf(M, DEF[0], DEF[1]), 'keyword'], ['go', indicesOf(M, GO[0], GO[1]), 'function'],
      ['return', indicesOf(M, RETURN[0], RETURN[1]), 'keyword'], ['a (line 2)', indicesOf(M, A_LINE2, A_LINE2 + 1), 'variable'],
    ];
    const failures: string[] = [];
    for (const [name, indices, cls] of tokens) {
      expect(indices.length, `${name} is ${name.length} display graphemes`).toBeGreaterThan(0);
      for (const index of indices) {
        for (const [look, drawn, expected, other] of [['A', a, want.a, want.b], ['B', b, want.b, want.a]] as const) {
          const g = glyphAt(drawn.glyphs, index, `look ${look}`);
          const own = inkOf(drawn.image!, g, expected[cls]);
          const leftover = inkOf(drawn.image!, g, other[cls]);
          if (own < 3) failures.push(`look ${look}: ${name} (${cls}) glyph ${index} has ${own} px in its look's ${cls} role ${expected[cls].join(',')}`);
          if (leftover > 0) failures.push(`look ${look}: ${name} (${cls}) glyph ${index} still has ${leftover} px in the other look's ${cls} role ${other[cls].join(',')}`);
        }
      }
    }
    // The grapheme with no token draws in plain in both looks: ink, in no token class's color.
    for (const [look, drawn, expected] of [['A', a, want.a], ['B', b, want.b]] as const) {
      const g = glyphAt(drawn.glyphs, indicesOf(M, PLAIN, PLAIN + 1)[0]!, `look ${look}`);
      if (inkOf(drawn.image!, g, expected.plain) < 3) failures.push(`look ${look}: the untokened a of "(a)" is not drawn in plain ${expected.plain.join(',')}`);
      for (const c of ['keyword', 'function', 'variable'] as const) if (inkOf(drawn.image!, g, expected[c]) > 0) failures.push(`look ${look}: the untokened a is drawn in the ${c} role`);
    }
    expect(failures, `${failures.length} glyphs are not in the look's code role:\n  ${failures.join('\n  ')}`).toEqual([]);
  });

  it(`${ID} every shipped look defines code and diff roles at the status distance, and a look switch among them recolors the keywords`, () => {
    const listed = lookCommand(bin(), { list: 'shipped' });
    const ids = (listed['shipped'] as string[] | undefined) ?? [];
    expect(ids.length, `the shipped looks: ${shown(listed)}`).toBeGreaterThan(0);
    const failures: string[] = [];
    const keyword = new Map<string, Rgb>();
    for (const id of ids) {
      const answer = lookCommand(bin(), { look: id });
      const def = (answer['look'] ?? {}) as Record<string, unknown>;
      const code = def['code'] as Record<string, string> | undefined;
      const diff = def['diff'] as Record<string, string> | undefined;
      const status = Object.values((def['status'] ?? {}) as Record<string, string>).map(rgbOf);
      const minDistance = typeof def['min_distance'] === 'number' ? def['min_distance'] : 0.1;
      const themes = answer['roles'] as Record<string, Record<string, string>>;
      if (!code) failures.push(`${id}: no code roles (code: {class → role})`);
      if (!diff) failures.push(`${id}: no diff roles (diff: {added, removed, changed → role})`);
      for (const [map, names] of [[code, [...CLASSES]], [diff, ['added', 'removed', 'changed']]] as const) {
        for (const name of names) {
          const r = map?.[name];
          if (r === undefined) { if (map) failures.push(`${id}: ${name} has no role`); continue; }
          for (const theme of ['light', 'dark']) {
            const hex = themes?.[theme]?.[r];
            if (typeof hex !== 'string' || !hex.startsWith('#')) { failures.push(`${id}: ${name} names role ${r}, which isn't a color role of the ${theme} theme`); continue; }
            for (const s of status) if (distance(rgbOf(hex), s) < minDistance) failures.push(`${id}: ${name} (role ${r}, ${hex}, ${theme}) is within ${minDistance} OKLab of a status color`);
          }
        }
      }
      const kw = code?.['keyword'];
      if (kw && themes?.['light']?.[kw]?.startsWith('#')) keyword.set(id, rgbOf(themes['light'][kw]!));
    }
    expect(failures, `${failures.length} shipped-look findings:\n  ${failures.join('\n  ')}`).toEqual([]);
    // The same document under each shipped look: the keywords take that look's keyword role, and none of another's.
    const doc = codeDoc('shipped-1965', RAW, { tokens: TOKENS, ground: 'ground' });
    const kwGlyphs = indicesOf(M, DEF[0], DEF[1]);
    const miss: string[] = [];
    const drawn = new Map(ids.map((id) => [id, accepted(drawOne(bin(), dir(), doc, id), `in ${id}`)] as const));
    for (const id of ids) {
      const d = drawn.get(id)!;
      for (const index of kwGlyphs) {
        const g = glyphAt(d.glyphs, index, id);
        if (matching(d.image!, cell(g), keyword.get(id)!) < 3) miss.push(`${id}: the keyword glyph ${index} has no px in the look's keyword role ${keyword.get(id)!.join(',')}`);
        for (const other of ids) {
          if (other === id || distance(keyword.get(other)!, keyword.get(id)!) < 0.02) continue;
          if (matching(d.image!, cell(g), keyword.get(other)!) > 0) miss.push(`${id}: the keyword glyph ${index} still has px in ${other}'s keyword role`);
        }
      }
    }
    expect(miss, `${miss.length} keyword glyphs aren't in the look's keyword role:\n  ${miss.join('\n  ')}`).toEqual([]);
  });

  it(`${ID} a token class outside the list is refused naming it, and every class on the list is accepted`, () => {
    const outside = ['identifier', 'Keyword', 'status.fail'];
    const raw = RAW;
    const good = checkOne(bin(), codeDoc('classes-ok', raw, { tokens: CLASSES.map((c, k) => ({ from: k, to: k + 1, class: c })) }), LOOK_A);
    expect(good.errors.map((e) => `${e.code} ${e.ids.join(',')}`), `the ten classes of the list are all accepted: ${errors(good)}`).toEqual([]);
    const failures: string[] = [];
    for (const bad of outside) {
      const c = checkOne(bin(), codeDoc('class-bad', raw, { tokens: [{ from: 0, to: 3, class: 'keyword' }, { from: 4, to: 6, class: bad }] }), LOOK_A);
      const named = naming(c, ITEM).filter((e) => words(e).includes(JSON.stringify(bad).slice(1, -1)));
      if (c.ok) failures.push(`class "${bad}": the check passes the item`);
      else if (named.length === 0) failures.push(`class "${bad}": no error names both the item ${ITEM} and the class: ${errors(c)}`);
    }
    expect(failures, `a token class outside keyword, type, function, variable, string, number, comment, operator, punctuation and plain is refused naming it:\n  ${failures.join('\n  ')}`).toEqual([]);
  });
});

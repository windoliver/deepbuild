// Oracle lane, criterion 2 (#1965.1d486d42): GraphemeBreakTest.txt gives grapheme boundaries, so e then U+0301 is one
// grapheme with a two-code-point byte range. A code item holds each row's string as raw with a token on each cluster's
// byte range, classes keyword and string alternating; the glyphs of cluster k (display grapheme k) must then all be in
// one role for even k and another for odd k, both other than the no-token baseline's. A token whose range cuts a cluster, or
// a display that splits or joins clusters differently from the file, leaves a glyph in the wrong role.
import { describe, expect, it } from 'vitest';
import { drawn, drawable, graphemeRows, hex, byteLen, useBin, useDir } from './helpers.ts';
import { accepted, codeDoc, drawOne, LOOK_A, type Token } from '../1965/helpers.ts';

const bin = useBin('deep-canvas-render');
const dir = useDir();

describe('#1965 oracle AC2 #1965.1d486d42: GraphemeBreakTest.txt run on our code', () => {
  it('AC2 #1965.1d486d42 oracle: each drawable row\'s clusters draw as the file\'s clusters, each token on exactly its glyphs', { timeout: 7_200_000 }, () => {
    const { rows, skippedRows } = graphemeRows();
    const raws = rows.map((r) => r.join(''));
    expect(rows.length, `the file's rows (${skippedRows} left out for a control code point)`).toBeGreaterThan(300);
    const base = accepted(drawOne(bin(), dir(), codeDoc('baseline', 'x', { size: 24 }), LOOK_A), 'the baseline');
    const baseRole = base.glyphs[0]!.role;
    const { ok, failures: refusals } = drawable(bin(), raws);
    expect(refusals, 'check refuses some row for a reason other than a missing glyph').toEqual([]);
    const picked = rows.map((r, n) => ({ r, n })).filter(({ n }) => ok[n]);
    expect(picked.length, `${picked.length} of ${rows.length} rows are drawable by the bundled faces`).toBeGreaterThan(50);
    const joined = picked.filter(({ r }) => r.some((c) => /^[A-Za-z][̀-ͯ]/.test(c)));
    expect(joined.length, 'a row where a letter and a combining mark are one cluster is among the rows run').toBeGreaterThan(0);
    const tokens = picked.map(({ r }) => {
      let at = 0;
      return r.map((c, k): Token => { const t = { from: at, to: at + byteLen(c), class: k % 2 === 0 ? 'keyword' : 'string' }; at = t.to; return t; });
    });
    const { texts, failures } = drawn(bin(), dir(), picked.map(({ n }) => raws[n]!), tokens);
    const wrong: string[] = [...failures];
    let even: string | null | undefined; let odd: string | null | undefined;
    picked.forEach(({ r, n }, i) => {
      const t = texts[i]!;
      const what = `row ${n + 1} [${r.map(hex).join(' | ')}]`;
      const byCluster = new Map<number, Set<string | null>>();
      for (const g of t.glyphs) (byCluster.get(g.grapheme) ?? byCluster.set(g.grapheme, new Set()).get(g.grapheme)!).add(g.role);
      for (const [k, roles] of byCluster) {
        if (k >= r.length) { wrong.push(`${what}: a glyph at grapheme ${k}, past the file's ${r.length} clusters`); continue; }
        if (roles.size !== 1) { wrong.push(`${what}: cluster ${k}'s glyphs are in ${roles.size} roles`); continue; }
        const role = [...roles][0]!;
        if (role === baseRole) { wrong.push(`${what}: cluster ${k}'s token leaves it in the plain role ${baseRole}`); continue; }
        if (k % 2 === 0) { even ??= role; if (role !== even) wrong.push(`${what}: cluster ${k} is in role ${role}, other even clusters in ${even}`); } else { odd ??= role; if (role !== odd) wrong.push(`${what}: cluster ${k} is in role ${role}, other odd clusters in ${odd}`); }
      }
    });
    if (even !== undefined && odd !== undefined && even === odd) wrong.push(`keyword and string clusters are drawn in one role, ${even}`);
    expect(wrong, `${wrong.length} cluster findings differ from GraphemeBreakTest.txt:\n  ${wrong.slice(0, 40).join('\n  ')}`).toEqual([]);
    expect(even !== undefined && odd !== undefined, 'both token classes were seen on glyphs').toBe(true);
  });
});

// Criterion 3: the redraft keeps every test name and the planted-writer test's assertions; its diff touches only the stand-in's
// stamping, the twin and REDRAFT.md in tests/acceptance/806/, and changes no hub source. Read from git at run time: the redraft is the
// commit 43d428e86 (redraft.ts, REDRAFT), compared with its parent.
import { describe, expect, it } from 'vitest';
import { REDRAFT, SUITE, at, diff, git } from './redraft.ts';

/** The titles of a test file's `it(...)` calls, as written (a template's placeholders included). */
const titles = (src: string): string[] => [...src.matchAll(/\bit\(\s*(['`])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2]!);
/** The source of the `it(...)` whose title starts with `start`, up to the line that closes it. */
function block(src: string, start: string): string | undefined {
  const lines = src.split('\n');
  const from = lines.findIndex((l) => /\bit\(/.test(l) && l.includes(start));
  if (from < 0) return undefined;
  const indent = /^\s*/.exec(lines[from]!)![0];
  const to = lines.findIndex((l, i) => i > from && l.startsWith(`${indent}}`));
  return to < 0 ? undefined : lines.slice(from, to + 1).join('\n');
}
/** Line ranges [from, to] (1-based, inclusive) of the block opened on the first line matching `open`, closed by the next line at its indent starting with `}`. */
function range(src: string, open: RegExp, withComment = true): [number, number] | undefined {
  const lines = src.split('\n');
  let from = lines.findIndex((l) => open.test(l));
  if (from < 0) return undefined;
  const indent = /^\s*/.exec(lines[from]!)![0];
  const to = lines.findIndex((l, i) => i > from && l.startsWith(`${indent}}`));
  while (withComment && from > 0 && /^\s*(\/\*\*|\*|\/\/)/.test(lines[from - 1]!)) from -= 1;
  return to < 0 ? undefined : [from + 1, to + 1];
}
/** The changed lines of one file between two commits: old line numbers removed, new line numbers added. */
function changes(from: string, to: string, path: string): { removed: number[]; added: number[] } {
  const removed: number[] = [];
  const added: number[] = [];
  for (const m of diff(['-U0', from, to, '--', path]).out.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    const [o, oc, n, nc] = [Number(m[1]), m[2] === undefined ? 1 : Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
    for (let i = 0; i < oc; i++) removed.push(o + i);
    for (let i = 0; i < nc; i++) added.push(n + i);
  }
  return { removed, added };
}
/** The lines outside every range, a blank line (the spacing around an added block) aside. */
const outside = (lines: number[], ranges: ([number, number] | undefined)[], src: string): number[] =>
  lines.filter((l) => src.split('\n')[l - 1]!.trim() !== '' && !ranges.some((r) => r !== undefined && l >= r[0] && l <= r[1]));

describe('#1176 criterion 3: what the redraft changes', () => {
  it('#1176.9980ad17 the redraft keeps every test name and the planted-writer test\'s assertions, and its diff touches only the stand-in\'s stamping, the twin and REDRAFT.md in tests/acceptance/806, no hub source', () => {
    // The redraft, pinned: the commit of PR 1226's branch that says it is part of #1176.
    expect(git(['log', '-1', '--format=%B', REDRAFT]).out, `${REDRAFT.slice(0, 9)} is the redraft for #1176`).toMatch(/#1176\b/);
    const base = `${REDRAFT}^`;
    const head = REDRAFT;

    const files = diff(['--name-only', base, head]).out.split('\n').filter(Boolean).sort();
    expect(files.filter((f) => f.startsWith('packages/') || f.startsWith('crates/')), 'no hub (or other product) source changes').toEqual([]);
    const allowed = ['REDRAFT.md', 'figure.ts', 'helpers.ts', 'sessions.test.ts'].map((f) => `${SUITE}/${f}`);
    expect(files.filter((f) => !allowed.includes(f)), `the diff touches only the stand-in (helpers.ts, figure.ts), the twin (sessions.test.ts) and REDRAFT.md: ${files.join(', ')}`).toEqual([]);
    expect(files, 'REDRAFT.md says what changed').toContain(`${SUITE}/REDRAFT.md`);

    const was = at(base, `${SUITE}/sessions.test.ts`) ?? '';
    const now = at(head, `${SUITE}/sessions.test.ts`) ?? '';
    expect(titles(was).length, 'the first draft\'s sessions suite has its 6 test names (5 calls, one in a loop)').toBe(5);
    expect(titles(was).filter((t) => !titles(now).includes(t)), 'every test name of the first draft is kept').toEqual([]);
    const added = titles(now).filter((t) => !titles(was).includes(t));
    expect(added.length, `one test is added, the twin: ${added.join(' | ')}`).toBe(1);
    expect(added[0], 'the added test is the twin stand-in whose stamp carries other arguments, refused unbound').toMatch(/other arguments[\s\S]*unbound/);
    const planted = 'AC2 a planted hub that takes the writer from the payload';
    expect(block(was, planted), 'the first draft has the planted-writer test').toBeDefined();
    expect(block(now, planted), 'the planted-writer test, assertions included, is unchanged').toBe(block(was, planted));

    // sessions.test.ts: only the twin test's lines are added; nothing of the first draft is removed.
    const s = changes(base, head, `${SUITE}/sessions.test.ts`);
    expect(s.removed, 'no line of the first draft\'s sessions.test.ts is removed or changed').toEqual([]);
    expect(outside(s.added, [range(now, /\bit\(\s*'.*other arguments/, false)], now), 'every added line of sessions.test.ts is in the twin test').toEqual([]);
    // helpers.ts: only the stand-in's stamp is added.
    const h = changes(base, head, `${SUITE}/helpers.ts`);
    const helpersNow = at(head, `${SUITE}/helpers.ts`) ?? '';
    expect(h.removed, 'no line of helpers.ts is removed or changed').toEqual([]);
    expect(h.added.length, 'helpers.ts gains the stamp').toBeGreaterThan(0);
    expect(outside(h.added, [range(helpersNow, /^\s*async stamp\(/)], helpersNow), 'every added line of helpers.ts is the stand-in\'s stamp method').toEqual([]);
    // figure.ts: only showFigure (its stamps) and the import of what it stamps with.
    const g = changes(base, head, `${SUITE}/figure.ts`);
    const figureWas = at(base, `${SUITE}/figure.ts`) ?? '';
    const figureNow = at(head, `${SUITE}/figure.ts`) ?? '';
    const importOf = (src: string): [number, number] | undefined => {
      const lines = src.split('\n');
      const from = lines.findIndex((l) => /^import \{$/.test(l) || /^import \{.*\} from '\.\/helpers\.ts';$/.test(l));
      const to = lines.findIndex((l, i) => i >= from && /\} from '\.\/helpers\.ts';$/.test(l));
      return from < 0 || to < 0 ? undefined : [from + 1, to + 1];
    };
    const show = /^export async function showFigure\(/;
    expect(outside(g.removed, [range(figureWas, show), importOf(figureWas)], figureWas), 'every removed line of figure.ts is in showFigure or the helpers import').toEqual([]);
    expect(outside(g.added, [range(figureNow, show), importOf(figureNow)], figureNow), 'every added line of figure.ts is in showFigure or the helpers import').toEqual([]);
    const r = range(figureNow, show, false);
    const body = r ? figureNow.split('\n').slice(r[0] - 1, r[1]).join('\n') : '';
    expect([...body.matchAll(/\.stamp\(f\.hub, '(deep_\w+)'/g)].map((m) => m[1]), 'showFigure stamps its deep_claim and its deep_show').toEqual(['deep_claim', 'deep_show']);
  }, 120_000);
});

// AC4: runs that change only role or paint, over any span of `AVATAR`, leave every glyph's position
// bit-identical to the plain run's; a planted run that shapes each span on its own loses the A-V kern and
// fails, naming the pair.
// A generated property (fast-check, seed 381, 1,000 cases, the local preflight's count): a text@1 item
// `word` showing AVATAR at a generated size and weight, with an optional item paint and one or two
// disjoint runs `[{from, to, role}]` over its graphemes. Each case's document and its plain twin (the same
// item with no runs) are drawn by `deep-canvas-render raster`, and its `texts` must give every glyph the
// plain run's face, size, ID, grapheme and position, f32 for f32, while each glyph takes its run's role
// inside a span and the item's outside it. The cases are sampled from the seed and drawn in one process;
// a case shrinking makes that isn't among them is drawn on its own. `raster`'s `planted:
// "shapes_spans_apart"` shapes each span on its own. At the base, raster reports no texts.

import fc from 'fast-check';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  LOOK_2D, RENDER_BIN, TEXT_BIN, accepted, glyphsOf, num, obj, sameF32, useBinaries,
  type Glyph, type JsonObject,
} from './helpers.ts';

useBinaries('deep-canvas-render', 'deep-text');

/** The recorded seed and the local preflight's case count. */
const SEED = 381;
const RUNS = 1000;
const WORD = 'AVATAR';
const ROLES = ['run-a', 'run-b', 'run-c', 'ink'] as const;

let out = '';
beforeAll(() => { out = mkdtempSync(join(tmpdir(), 'deep-381-runs-')); });
afterAll(() => { if (out) rmSync(out, { recursive: true, force: true }); out = ''; });

interface Run { from: number; to: number; role: string }
interface Case { size: number; weight: number; paint: string | null; runs: Run[] }

/** One span [from, to) of AVATAR's six graphemes, and optionally a second after it, each with a role. */
const runsArb: fc.Arbitrary<Run[]> = fc.integer({ min: 0, max: WORD.length - 1 }).chain((from) =>
  fc.integer({ min: from + 1, max: WORD.length }).chain((to) =>
    fc.tuple(
      fc.constantFrom(...ROLES),
      to < WORD.length
        ? fc.option(fc.integer({ min: to, max: WORD.length - 1 }).chain((f2) => fc.tuple(fc.constant(f2), fc.integer({ min: f2 + 1, max: WORD.length }), fc.constantFrom(...ROLES))), { nil: null })
        : fc.constant(null),
    ).map(([role, second]) => [{ from, to, role }, ...(second ? [{ from: second[0], to: second[1], role: second[2] }] : [])]),
  ),
);
const caseArb: fc.Arbitrary<Case> = fc.record({
  size: fc.constantFrom(11, 13, 16, 24, 37.5),
  weight: fc.constantFrom(400, 500, 600),
  paint: fc.option(fc.constantFrom('paint-a', 'muted'), { nil: null }),
  runs: runsArb,
});

function doc(c: Pick<Case, 'size' | 'weight' | 'paint'>, runs: Run[]): JsonObject {
  const params: JsonObject = { text: WORD, font: 'body', size: c.size, weight: c.weight };
  if (c.paint) params['paint'] = { fill: { role: c.paint } };
  if (runs.length) params['runs'] = runs.map((r) => ({ from: r.from, to: r.to, role: r.role }));
  return {
    format: 1, id: 'runs-381', profile: 'board', title: 'A word with styled runs',
    description: 'AVATAR in one text item, with runs that change only the role its glyphs are painted in.',
    size: [320, 80], layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    items: { word: { id: 'word', kind: 'text@1', layer: 'main', name: 'Word', order: 'a1', at: { pos: [16, 16, 0] }, params } },
  };
}

let n = 0;
/** `raster` over documents in one process; each answer's `texts.word` glyphs. */
function draw(docs: JsonObject[], planted?: string): Glyph[][] {
  const lines = docs.map((d) => ({ out: join(out, `${n++}.png`), doc: d, look: LOOK_2D, ...(planted ? { planted } : {}) }));
  return accepted(RENDER_BIN, ['raster'], lines).map((a, i) =>
    glyphsOf(obj(obj(a['texts'], `raster line ${i + 1}: texts`)['word'], `raster line ${i + 1}: texts.word`)['glyphs'], `raster line ${i + 1}: texts.word.glyphs`));
}

/**
 * Where a styled run's glyphs leave the plain run's: a different glyph, face or size, or a position not
 * the same f32. A moved glyph is named by the pair whose spacing changed, such as `A-V`.
 */
function positionProblems(plain: Glyph[], styled: Glyph[]): string[] {
  if (plain.length !== WORD.length) return [`the plain run has ${plain.length} glyphs, not one per grapheme of ${WORD}`];
  if (styled.length !== plain.length) return [`the styled run has ${styled.length} glyphs, not ${plain.length}`];
  const problems: string[] = [];
  for (let i = 0; i < plain.length; i++) {
    const p = plain[i]!; const s = styled[i]!;
    if (s.id !== p.id || s.font !== p.font || !sameF32(s.size, p.size) || s.grapheme !== p.grapheme) problems.push(`glyph ${i} is glyph ${s.id} of ${s.font} at ${s.size} px (grapheme ${s.grapheme}), not glyph ${p.id} of ${p.font} at ${p.size} px (grapheme ${p.grapheme})`);
  }
  if (problems.length) return problems;
  for (let i = 0; i < plain.length; i++) {
    const p = plain[i]!; const s = styled[i]!;
    if (sameF32(s.x, p.x) && sameF32(s.y, p.y)) continue;
    const gap = (g: Glyph[]): number => Math.fround(g[i]!.x) - Math.fround(g[i - 1]!.x);
    if (i > 0 && sameF32(s.y, p.y) && sameF32(styled[i - 1]!.x, plain[i - 1]!.x) && gap(styled) !== gap(plain)) {
      problems.push(`the pair ${WORD[p.grapheme - 1]}-${WORD[p.grapheme]} (graphemes ${p.grapheme - 1}, ${p.grapheme}) is spaced ${gap(styled)} px, not ${gap(plain)}: glyph ${i} sits at (${s.x}, ${s.y}), not (${p.x}, ${p.y})`);
    } else {
      problems.push(`glyph ${i} ('${WORD[p.grapheme]}') sits at (${s.x}, ${s.y}), not (${p.x}, ${p.y})`);
    }
    break;
  }
  return problems;
}

/** Each glyph's role: its run's inside a span, the item's paint (ink by default) outside. */
function roleProblems(c: Case, styled: Glyph[]): string[] {
  return styled.flatMap((g, i) => {
    const run = c.runs.find((r) => g.grapheme >= r.from && g.grapheme < r.to);
    const want = run ? run.role : (c.paint ?? 'ink');
    return g.role === want ? [] : [`glyph ${i} ('${WORD[g.grapheme]}') is painted in ${JSON.stringify(g.role)}, not ${want}${run ? ` (its run ${run.from}–${run.to})` : ' (no run covers it)'}`];
  });
}

const plainKey = (c: Pick<Case, 'size' | 'weight' | 'paint'>): string => `${c.size}/${c.weight}/${c.paint}`;
let drawn: { plain: Map<string, Glyph[]>; styled: Map<string, Glyph[]> } | undefined;

/** The sampled cases and every plain twin they need, drawn in one process. */
function answers(c: Case): { plain: Glyph[]; styled: Glyph[] } {
  if (!drawn) {
    const cases = fc.sample(caseArb, { seed: SEED, numRuns: RUNS });
    const plains = [...new Map(cases.map((x) => [plainKey(x), x])).values()];
    const glyphs = draw([...plains.map((x) => doc(x, [])), ...cases.map((x) => doc(x, x.runs))]);
    drawn = {
      plain: new Map(plains.map((x, i) => [plainKey(x), glyphs[i]!])),
      styled: new Map(cases.map((x, i) => [JSON.stringify(x), glyphs[plains.length + i]!])),
    };
  }
  let plain = drawn.plain.get(plainKey(c));
  let styled = drawn.styled.get(JSON.stringify(c));
  if (!plain || !styled) {
    const [p, s] = draw([doc(c, []), doc(c, c.runs)]);
    plain = p!; styled = s!;
  }
  return { plain, styled };
}

describe('AC4 runs that change only role or paint leave every glyph where the plain run puts it', () => {
  it(`AC4 every span of AVATAR, with runs that change only role or paint, leaves every glyph's position bit-identical to the plain run's, and paints each glyph in its run's role (${RUNS} cases, seed ${SEED})`, () => {
    fc.assert(fc.property(caseArb, (c) => {
      const { plain, styled } = answers(c);
      expect(positionProblems(plain, styled), `runs ${JSON.stringify(c.runs)} at ${c.size} px, weight ${c.weight}, paint ${c.paint}: every glyph where the plain run puts it`).toEqual([]);
      expect(roleProblems(c, styled), `runs ${JSON.stringify(c.runs)}: each glyph in its run's role`).toEqual([]);
    }), { seed: SEED, numRuns: RUNS });
    // Every span of the six graphemes was among the cases.
    const spans = new Set(fc.sample(caseArb, { seed: SEED, numRuns: RUNS }).flatMap((x) => x.runs.map((r) => `${r.from}-${r.to}`)));
    expect(spans.size, 'the cases cover all 21 spans [from, to) of AVATAR').toBe(21);
  }, 1_800_000);

  it('AC4 the planted run that shapes each span on its own loses the A-V kern and fails, naming the pair', () => {
    // AVATAR's A-V is kerned in the body face at 13 px: AV is narrower than A and V shaped apart.
    const [av, a, v] = accepted(TEXT_BIN, ['fit'], [{ text: 'AV' }, { text: 'A' }, { text: 'V' }]);
    expect(num(av!['width'], 'AV width'), 'A-V is kerned: AV is narrower than A beside V').toBeLessThan(num(a!['width'], 'A width') + num(v!['width'], 'V width') - 0.1);
    const base = { size: 13, weight: 400, paint: null };
    const splitAV: Run[][] = [[{ from: 1, to: 6, role: 'run-a' }], [{ from: 0, to: 1, role: 'run-b' }], [{ from: 1, to: 3, role: 'run-c' }]];
    const [plain] = draw([doc(base, [])]);
    const planted = draw(splitAV.map((r) => doc(base, r)), 'shapes_spans_apart');
    for (const [i, runs] of splitAV.entries()) {
      const problems = positionProblems(plain!, planted[i]!);
      expect(problems.join('\n'), `the planted run with ${JSON.stringify(runs)} fails, naming the pair A-V`).toMatch(/the pair A-V \(graphemes 0, 1\)/);
    }
    // A run over the whole word splits nothing, so the plant draws it as the plain run: the check fails the split alone.
    const [whole] = draw([doc(base, [{ from: 0, to: 6, role: 'run-a' }])], 'shapes_spans_apart');
    expect(positionProblems(plain!, whole!), 'a run over the whole word, which no span boundary splits, passes').toEqual([]);
  }, 1_800_000);
});


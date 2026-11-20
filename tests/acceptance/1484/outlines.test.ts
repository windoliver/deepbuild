// AC1 #1484.57659fda: "A 64 u title's outlines equal the axis maximum instance, and a 14 u label's the minimum. A planted
// shaper that ignores the axis fails, naming the run"
//
// One `deep-canvas-render raster` line (Vello CPU, as snapshots draw; README: Surface choices) draws a figure holding the
// title (`Hamburgefonts`, 64 u, weight 400) and the label (the same text, 14 u, weight 400), both in the body role, and
// answers each glyph's face file (`font`) and outline (`outline`, in the glyph's own frame, in u, at the coordinates it
// was shaped at). The oracle (instance.ts) reads that face file itself: the instance at `opsz` = the axis maximum (the
// title) or minimum (the label) and `wght` = 400, each glyph found by its character through `cmap`. Each glyph's
// outline must equal the instance's within one font unit (README: Readings), as point sets: its on-curve points and
// control points. A run set in a face with no `opsz` axis can't be at an axis instance and fails, naming its face.
// The wrong program: `raster`'s `planted: "shaper_ignores_opsz"`, a shaper that sets `wght` from the weight but leaves
// `opsz` at its default, as the merge base does; the title then shapes at the minimum and the check fails, naming the
// run `title`. At the base both runs are set in the static `Inter-Regular.ttf`, which has no `opsz` axis.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contoursAt, glyphOf, normalize, pointSet, readFont, type Font, type PointSet } from './instance.ts';
import { AC, REPO, TEXT, drawLine, drew, failsNaming, glyphsOf, run, runName, textDoc, useBin, useDir, type Item, type JsonObject } from './helpers.ts';

const ID = AC[1];
const bin = useBin('deep-canvas-render');
const dir = useDir('deep-1484-outlines-');

const TITLE: Item = { id: 'title', text: TEXT, size: 64, weight: 400, pos: [8, 8] };
const LABEL: Item = { id: 'label', text: TEXT, size: 14, weight: 400, pos: [8, 110] };
/** Which end of the `opsz` axis each run's outlines must equal. */
const END: Record<string, 'max' | 'min'> = { title: 'max', label: 'min' };
const DOC = textDoc('outlines-1484', [560, 140], [TITLE, LABEL]);

const fonts = new Map<string, Font>();
const fontAt = (path: string): Font => {
  if (!fonts.has(path)) fonts.set(path, readFont(join(REPO, path)));
  return fonts.get(path)!;
};

/** The farthest any point of one list lies from the nearest of the other, both ways (u); Infinity when one is empty. */
function gap(a: [number, number][], b: [number, number][]): number {
  if (!a.length && !b.length) return 0;
  if (!a.length || !b.length) return Infinity;
  const near = (p: [number, number], list: [number, number][]): number => Math.min(...list.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1])));
  return Math.max(...a.map((p) => near(p, b)), ...b.map((p) => near(p, a)));
}
/** The program's outline commands as point sets: every command's end point an anchor, a quadratic's or cubic's other
 * points controls. */
function commandPoints(cmds: (string | number)[][]): PointSet {
  const set: PointSet = { anchors: [], controls: [] };
  for (const c of cmds) {
    const p = c.slice(1) as number[];
    if (p.length < 2) continue;
    for (let k = 0; k + 3 < p.length; k += 2) set.controls.push([p[k]!, p[k + 1]!]);
    set.anchors.push([p[p.length - 2]!, p[p.length - 1]!]);
  }
  return set;
}

/** Where a run's outlines differ from its face's instance at the `opsz` axis's `end` and its weight, naming the run. */
function outlineProblems(answer: JsonObject, t: Item): string[] {
  const name = runName(t);
  const glyphs = glyphsOf(answer, t.id, 'raster');
  if (glyphs.length !== [...t.text].length) return [`${name}: ${glyphs.length} glyphs, not one per letter (${[...t.text].length})`];
  const out: string[] = [];
  const unvaried = new Map<string, string[]>();
  for (const g of glyphs) {
    const char = [...t.text][g.grapheme]!;
    const font = fontAt(g.font);
    const opsz = font.axes.find((a) => a.tag === 'opsz');
    if (!opsz || !font.axes.some((a) => a.tag === 'wght')) {
      unvaried.set(g.font, [...(unvaried.get(g.font) ?? []), char]);
      continue;
    }
    const at = END[t.id] === 'max' ? opsz.max : opsz.min;
    const unit = g.size / font.upm;
    const want = pointSet(contoursAt(font, glyphOf(font, char), normalize(font, { opsz: at, wght: t.weight })), g.size, font.upm);
    const got = commandPoints(g.outline);
    const d = Math.max(gap(want.anchors, got.anchors), gap(want.controls, got.controls));
    if (!(d <= unit)) out.push(`${name}: glyph ${g.index} ${JSON.stringify(char)} (id ${g.id}, ${g.font}) is ${(d / unit).toFixed(1)} font units from the instance at opsz ${at}, wght ${t.weight}, past 1`);
  }
  for (const [face, chars] of unvaried) out.push(`${name}: ${chars.length} glyphs (${chars.join('')}) are set in ${face}, a face with no opsz and wght axes, so they can't be at the axis ${END[t.id]}imum instance`);
  return out;
}

/** The figure drawn by one `raster` line (planted when given): its answer. */
function draw(planted?: string): JsonObject {
  const [answer] = run(bin(), ['raster'], [drawLine(dir(), DOC, 1, 'light', planted ? { planted } : {})]);
  return drew(answer!, `raster of the title and the label${planted ? ` planted ${planted}` : ''}`);
}

describe(`${ID} a 64 u title's outlines equal the axis maximum instance, a 14 u label's the minimum`, () => {
  it(`${ID} the title's outlines equal its face's instance at the opsz maximum and the label's at the minimum, each within one font unit`, () => {
    const answer = draw();
    const problems = [...outlineProblems(answer, TITLE), ...outlineProblems(answer, LABEL)];
    expect(problems, `the runs' outlines against their face's axis instances (${problems.length} problems)`).toEqual([]);
    // The comparison can tell the two ends apart: in the title's face each letter's instances at the two ends lie
    // more than ten font units apart, so a run at the wrong end can't pass inside one.
    const g = glyphsOf(answer, TITLE.id, 'raster')[0]!;
    const font = fontAt(g.font);
    const opsz = font.axes.find((a) => a.tag === 'opsz')!;
    const close = [...TEXT].filter((char) => {
      const at = (v: number): PointSet => pointSet(contoursAt(font, glyphOf(font, char), normalize(font, { opsz: v, wght: 400 })), font.upm, font.upm);
      const [hi, lo] = [at(opsz.max), at(opsz.min)];
      return !(Math.max(gap(hi.anchors, lo.anchors), gap(hi.controls, lo.controls)) > 10);
    });
    expect(close, `letters whose opsz ${opsz.min} and ${opsz.max} instances lie within ten font units of each other in ${g.font}`).toEqual([]);
  }, 1_800_000);

  it(`${ID} a planted shaper that ignores the axis (raster planted shaper_ignores_opsz) fails, naming the run`, () => {
    const answer = draw('shaper_ignores_opsz');
    failsNaming(outlineProblems(answer, TITLE), [`run ${TITLE.id} `], 'the planted shaper that ignores opsz');
  }, 1_800_000);
});

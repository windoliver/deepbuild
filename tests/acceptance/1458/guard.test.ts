// AC2, AC5 and AC6: `scripts/color-literal-guard.mjs` also fails a bare size or distance, and a named spacing or
// text-size utility, in a view of `crates/deep-app/src`, naming the file and the line (README, Pinned 7). Each plant is
// one line added to a copy of the checkout's source under /tmp, run through `--root <copy>`; the checkout never changes.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AC, MINUTES, baseTree, cleanup, findings, guard, mergeBase, names, plant, shown, sourceCopy } from './helpers.ts';

afterAll(cleanup, 60_000);
const VIEW = 'crates/deep-app/src/views.rs';
const LOOK = 'crates/deep-canvas-marks/looks/clean.json';
const T = 10 * MINUTES;

/** A fresh copy with `lines` added to the view; the guard's run over it and the first added line's number. */
async function planted(lines: readonly string[]): Promise<{ ran: Awaited<ReturnType<typeof guard>>; line: number }> {
  const root = sourceCopy();
  const line = plant(root, VIEW, lines);
  return { ran: await guard(root), line };
}

describe('#1458 the guard on bare sizes and distances', () => {
  it(`${AC.px}: a planted px(37.) in a view fails the guard, naming the file and line; the same number in the look passes`, async () => {
    const control = await guard(sourceCopy());
    expect.soft(findings(control), 'the guard passes the unplanted copy of the checkout').toEqual([]);
    const { ran, line } = await planted(['fn planted_1458() -> Pixels { px(37.) }']);
    expect.soft(ran.code, `the guard exits 1 on the planted px(37.): ${shown(ran)}`).toBe(1);
    expect.soft(names(ran, VIEW, line), `the guard names ${VIEW}:${line}: ${shown(ran)}`).toBe(true);
    // The same number where sizes belong: the look.
    const root = sourceCopy();
    const look = JSON.parse(readFileSync(join(root, LOOK), 'utf8')) as Record<string, unknown>;
    writeFileSync(join(root, LOOK), `${JSON.stringify({ ...look, planted_1458: { size: 37 } }, null, 2)}\n`);
    const inLook = await guard(root);
    expect(inLook.code === 0 && findings(inLook).length === 0, `the guard passes 37 in the look: ${shown(inLook)}`).toBe(true);
  }, T);

  it(`${AC.utilities}: a planted .gap_6() and a planted .text_sm() in a view each fail the guard, naming the file and line`, async () => {
    for (const call of ['gap_6', 'text_sm']) {
      const { ran, line } = await planted([`fn planted_1458_${call}(d: Div) -> Div { d.${call}() }`]);
      expect.soft(ran.code, `the guard exits 1 on the planted .${call}(): ${shown(ran)}`).toBe(1);
      expect.soft(names(ran, VIEW, line), `the guard names ${VIEW}:${line} for .${call}(): ${shown(ran)}`).toBe(true);
    }
  }, T);

  it(`${AC.main}: the guard passes on main's three lines, and the merge base's failure is there to name in the PR`, async () => {
    const here = await guard();
    expect(here.code === 0 && findings(here).length === 0, `the guard passes this checkout, panel_check.rs and panel_tree.rs included: ${shown(here)}`).toBe(true);
    const sha = mergeBase();
    const base = await guard(baseTree(sha));
    // What the PR names: the merge base's failure, as this checkout's guard reads that tree.
    console.log(`AC5: this checkout's guard over the merge base ${sha.slice(0, 12)}: exit ${base.code}\n${findings(base).slice(0, 40).join('\n')}`);
    expect(base.code, `the merge base ${sha.slice(0, 12)} fails the guard, a failure the PR names: ${shown(base)}`).toBe(1);
  }, T);
});

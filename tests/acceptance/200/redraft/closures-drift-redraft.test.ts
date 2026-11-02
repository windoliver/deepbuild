// Blind redraft of #200 AC4's drift half (REDRAFT.md): "a planted row in the reference's table that calls the
// budget class a registry fails the drift test, naming the list and both closures". The surface is the
// original's: `node scripts/canvas-closures.mjs drift --root <tree>` on a scratch tree holding the canvas
// reference. Only the row lookup changed: the planted row is the Budget class row of the table under
// `### Registries and closed lists`, not the first line of the file that starts with `| Budget class |`.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { failLines, script, scratchTree, shown, useTempDirs } from '../helpers.ts';

useTempDirs();

const REFERENCE = 'docs/canvas-primitives.md';
const SECTION = '### Registries and closed lists';
const LIST = 'Budget class';
const PLANTED_CLOSURE = 'registry `budget.class@1`';
/** The table's own closure for the budget class, however the lint spells it. */
const CLOSED_BUDGET = /closed:? ?budget|closed \{?reason:? ?budget/;

/** The line index of the Budget class row inside the "Registries and closed lists" section (heading to next heading). */
function budgetRowIndex(lines: readonly string[]): number {
  const start = lines.findIndex((l) => l.trim() === SECTION);
  expect(start, `${REFERENCE} has the heading ${SECTION}`).toBeGreaterThanOrEqual(0);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^#{1,6} /.test(lines[i]!)) { end = i; break; }
  const rows: number[] = [];
  for (let i = start + 1; i < end; i++) if (lines[i]!.startsWith(`| ${LIST} |`)) rows.push(i);
  expect(rows.length, `the ${SECTION} table has one ${LIST} row (lines ${start + 1}-${end})`).toBe(1);
  return rows[0]!;
}

describe('AC4 #200.be794a42: the closure lint against the reference table (redraft)', () => {
  it('AC4 (redraft) the reference table passes the drift test as committed, and a planted row that calls the budget class a registry fails it, naming the list and both closures', () => {
    const clean = scratchTree('drift-clean', { docs: true });
    const ok = script('canvas-closures.mjs', ['drift', '--root', clean]);
    expect(ok.code, `the drift test passes on the committed reference:\n${shown(ok)}`).toBe(0);
    expect(ok.out, `the drift test prints a PASS drift line:\n${shown(ok)}`).toMatch(/^PASS drift/m);
    expect(failLines(ok, 'drift'), `no FAIL drift line on the committed reference:\n${shown(ok)}`).toEqual([]);

    const planted = scratchTree('drift-planted', { docs: true });
    const file = join(planted, REFERENCE);
    const lines = readFileSync(file, 'utf8').split('\n');
    const at = budgetRowIndex(lines);
    const row = lines[at]!;
    const cells = row.split('|');
    // `| Budget class | Where | Closure | Why |` splits as ['', list, where, closure, why, ''].
    expect(cells[3]!.trim(), `the ${LIST} row's closure cell is closed: budget as committed: ${row}`).toBe('closed: budget');
    cells[3] = ` ${PLANTED_CLOSURE} `;
    lines[at] = cells.join('|');
    writeFileSync(file, lines.join('\n'));

    const bad = script('canvas-closures.mjs', ['drift', '--root', planted]);
    expect(bad.code, `the drift test fails on the planted row:\n${shown(bad)}`).toBe(1);
    const fails = failLines(bad, 'drift');
    expect(fails.length, `a FAIL drift line on the planted row:\n${shown(bad)}`).toBeGreaterThan(0);
    const naming = fails.filter((l) => l.includes(LIST) && l.includes('budget.class@1') && CLOSED_BUDGET.test(l));
    expect(naming.length, `a FAIL drift line names ${LIST}, budget.class@1 and the closed budget closure:\n${shown(bad)}`).toBeGreaterThan(0);
  }, 1_800_000);
});

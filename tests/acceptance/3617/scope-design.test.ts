// #3617 scope: the design's cost line for the GPU surface (docs/canvas-primitives.md, GPU surface) says which machine and
// which scene each of its timed figures was read on, and carries the draw-and-finish reading and its budget.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO } from './helpers.ts';

function costLine(): string {
  const lines = readFileSync(join(REPO, 'docs', 'canvas-primitives.md'), 'utf8').split('\n');
  const from = lines.findIndex((l) => l === '#### GPU surface');
  expect(from, 'docs/canvas-primitives.md has the GPU surface section').toBeGreaterThanOrEqual(0);
  const line = lines.slice(from + 1).find((l) => l.startsWith('**Cost:**') || l.startsWith('#### '));
  expect(line?.startsWith('**Cost:**'), 'the GPU surface section has its Cost line').toBe(true);
  return line!;
}
const MACHINE = /Mac\d+,\d+|\bM\d(?: Pro| Max| Ultra)?\b/;
const SCENE = /scene|fixture|city|one-pass|one full-screen pass|surface-handoff|list/i;

describe('#3617 scope: the GPU surface\'s cost line names the machine and the scene of each figure', () => {
  it('#3617 every timed figure that was read (not estimated) names a machine and a scene in its own clause, and the copy path\'s 6.6 to 6.8 ms stays', () => {
    const line = costLine();
    expect(line).toContain('6.6 to 6.8 ms');
    const clauses = line.replace('**Cost:**', '').split(';').map((c) => c.trim());
    const timed = clauses.filter((c) => /\bms\b/.test(c) && !/estimate/.test(c));
    expect(timed.length, 'the line has timed figures that were read').toBeGreaterThanOrEqual(1);
    for (const c of timed) {
      expect(c, `the figure "${c}" names the machine it was read on`).toMatch(MACHINE);
      expect(c, `the figure "${c}" names the scene it was read on`).toMatch(SCENE);
    }
  });

  it('#3617 the line gives the one-pass slot\'s 0.9 to 1.0 ms on the Mac17,10 and the draw-and-finish budget of 0.5 ms', () => {
    const line = costLine();
    const clause = line.split(';').find((c) => c.includes('0.9 to 1.0 ms'));
    expect(clause, 'a clause holds the spike\'s 0.9 to 1.0 ms').toBeDefined();
    expect(clause).toMatch(/Mac17,10|M5 Max/);
    expect(clause).toMatch(/one-pass|one full-screen pass/i);
    expect(line, 'the line names the draw-and-finish time and its 0.5 ms budget').toMatch(/draw-and-finish/);
    expect(line).toMatch(/0\.5 ms/);
  });
});

// AC3 #2777.728bbb54: "The ten lists named above each have a row in the generated table: the camera's projection,
// translucency kinds, a material's shadow modes, the water material's terms, foley's materials and actions, an
// emitter's distance models, tone maps, GPU deforms, light kinds and the lens's fields"
//
// AC4 #2777.c186d624: "A planted reference whose generated table drops one list, and one whose row names another reason
// than the data, each fail the drift lane, naming the list"
//
// asserts: AC3: docs/canvas-primitives.md keeps its hand-written table under "### Registries and closed lists" and,
// after it, the generated block (`<!-- field lists: … -->` to `<!-- /field lists -->`, a table `| Field list | Words |
// Closure | Reopens if | Instead |`); it has one row each for camera@1.projection, material@1.translucency.kind,
// material@1.shadow, look.finish@1.tone_map and camera@1.lens.fit, each offering the words the design gives the list;
// a row for a list in material@1.water; and rows offering foley's ten materials, its nine actions, the emitter's
// inverse, linear and exponential, the GPU deforms bob, sway, wave and spin, and the light kinds point, spot, sun and
// area (a word may carry its module's prefix and its major: light.point@1). AC4: on a scratch tree holding a copy of
// the reference and the contracts' data, `node scripts/canvas-closures.mjs drift --root <tree> --listing <the full
// build's dump>` passes as committed; with the row of camera@1.projection dropped it exits 1 with a FAIL drift line
// naming camera@1.projection; with the row of material@1.translucency.kind naming another of the seven reasons than the
// listing gives it, it exits 1 with a FAIL drift line naming material@1.translucency.kind.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DROPPED, FULL, REASONS, REASON_SWAPPED, REFERENCE, REPO, cellsOf, closedOf, closures, dumpOf, failsWithLine, fieldListsOf, none, passes, rowOf,
  rowText, scratchTree, show, tableOf, tenRowFailures, theList, useBuilds, type Table,
} from './helpers.ts';

const builds = useBuilds([FULL]);

/** The generated table of a reference's text; fails, saying why, when there is none. */
function table(text: string, what: string): Table {
  const t = tableOf(text);
  expect(typeof t === 'string' ? t : '', `${what} holds the generated table`).toBe('');
  return t as Table;
}

describe('AC3 #2777.728bbb54 the ten lists in the generated table', () => {
  it('AC3 #2777.728bbb54 the ten lists named above each have a row in the generated table: the camera\'s projection, translucency kinds, a material\'s shadow modes, the water material\'s terms, foley\'s materials and actions, an emitter\'s distance models, tone maps, GPU deforms, light kinds and the lens\'s fields', () => {
    const t = table(readFileSync(join(REPO, REFERENCE), 'utf8'), REFERENCE);
    console.log(`the generated table has ${t.rows.length} rows`);
    none(tenRowFailures(t), `the generated table in ${REFERENCE}`);
  }, 3_600_000);
});

describe('AC4 #2777.c186d624 the drift lane holds the generated table to the listing', () => {
  /** A scratch tree whose reference's generated table `edit` changes (none: as committed), and the drift lane on it. */
  function driftOn(tag: string, listing: string, edit?: (t: Table) => void): ReturnType<typeof closures> {
    const root = scratchTree(tag);
    if (edit) {
      const file = join(root, REFERENCE);
      const t = table(readFileSync(file, 'utf8'), `the copy of ${REFERENCE}`);
      edit(t);
      writeFileSync(file, t.lines.join('\n'));
    }
    return closures(['drift', '--root', root, '--listing', listing]);
  }

  it('AC4 #2777.c186d624 a planted reference whose generated table drops the row of camera@1.projection fails the drift lane, naming the list', () => {
    const d = dumpOf(builds.bin(FULL));
    passes(driftOn('clean', d.path), 'drift', `the drift lane on the committed reference, against the full build's listing`);
    const r = driftOn('dropped', d.path, (t) => { t.lines.splice(rowOf(t, DROPPED).at, 1); });
    failsWithLine(r, 'drift', [DROPPED], `the reference whose generated table drops ${DROPPED}`);
  }, 3_600_000);

  it('AC4 #2777.c186d624 a planted reference whose row of material@1.translucency.kind names another reason than the data fails the drift lane, naming the list', () => {
    const d = dumpOf(builds.bin(FULL));
    const data = closedOf(theList(fieldListsOf(d.value), REASON_SWAPPED).closure);
    expect(data, `the listing closes ${REASON_SWAPPED} with a reason, reopens_if and instead`).toBeDefined();
    const other = REASONS.find((x) => x !== data!.reason)!;
    passes(driftOn('clean', d.path), 'drift', `the drift lane on the committed reference, against the full build's listing`);
    const r = driftOn('reason', d.path, (t) => {
      const row = rowOf(t, REASON_SWAPPED);
      expect(row.closure, `${REASON_SWAPPED}'s row is closed as committed: ${t.lines[row.at]}`).toMatch(/^closed:/);
      const cells = cellsOf(t.lines[row.at]!);
      cells[2] = `closed: ${other}`;
      t.lines[row.at] = rowText(cells);
    });
    failsWithLine(r, 'drift', [REASON_SWAPPED], `the reference whose ${REASON_SWAPPED} row says closed: ${other}, where the listing says ${show(data!.reason)}`);
  }, 3_600_000);
});

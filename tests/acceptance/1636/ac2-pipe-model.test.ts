// AC2 #1636.92e93acb: "At every fork of a 4-level fixture tree, the parent's ring radius raised to the exponent equals the
// sum of its children's within 1%, measured on the built rings. A planted builder that gives each child its parent's
// radius fails, naming the fork"
//
// One document, two trees of the fixture's params (helpers.ts `FIXTURE`: 4 levels, 3 children a fork, so 13 forks):
// `e2` with `exponent` left out (the default, 2.0) and `e3` with `exponent: 3`, each read by `geometry` (README: Assumed
// surfaces 4). At each fork the parent's ring is its last ring and each child's its first; a ring's radius is the mean
// distance of its vertices from their centre, measured on the built positions (README: Readings). The judge holds
// |R^e − Σ r^e| ≤ 1% of R^e and names each fork that misses.
//   - First test, the shipped builder: both trees have their 13 forks of 3 children, and no fork misses.
//   - Second test, `planted: tree_child_keeps_parent_radius` (README: Planted programs): the same documents fail the
//     judge, and every one of the 13 forks is named.
// Wrong programs: the base (no tree@1); the plant; children's radii by a fixed ratio, or by the exponent 2 whatever is
// declared (`e3` fails); radii reported but not built (the judge reads the vertices).
import { describe, expect, it } from 'vitest';
import {
  AC, FIXTURE, TIMEOUT, docId, geometry, none, pipeFailures, presented, runShow, scenario, show, topologyFailures, treeItem, treeRow, treesDoc,
  useBins, useFolders, type JsonObject, type Planted,
} from './helpers.ts';

const ID = AC[2];
const NAME = `AC2 ${ID}`;
const bin = useBins(['deep-show']);
const folder = useFolders();
const DOC = docId(2);
const TREES = { e2: { exponent: 2, params: FIXTURE }, e3: { exponent: 3, params: { ...FIXTURE, exponent: 3 } } } as const;

function built(planted?: Planted): Map<string, ReturnType<typeof treeRow>> {
  const doc = treesDoc({ e2: treeItem(TREES.e2.params), e3: treeItem(TREES.e3.params, { at: { pos: [20, 0, 0] } }) });
  const calls: JsonObject[] = [show(DOC, doc), geometry(DOC, ['e2', 'e3'])];
  const [shown, read] = runShow(bin('deep-show'), scenario(folder(), [DOC], calls, planted ? { planted } : {}));
  presented(shown!, `the two fixture trees${planted ? ` under ${planted}` : ''}`);
  return new Map((['e2', 'e3'] as const).map((id) => [id, treeRow(read!, id, `${id}${planted ? ` under ${planted}` : ''}`)]));
}

describe(`${NAME} the pipe model at every fork, measured on the built rings`, () => {
  it(`${NAME} at every fork of the 4-level fixture, with the default exponent and with 3, the parent's ring radius ^ e is the sum of its children's within 1%`, () => {
    const rows = built();
    for (const [id, t] of Object.entries(TREES)) {
      const row = rows.get(id)!;
      none(topologyFailures(row, FIXTURE), `${id} has the fixture's 13 forks of 3 children`);
      none(pipeFailures(row, t.exponent), `at every fork of ${id} (exponent ${t.exponent}) the parent's ring radius ^ ${t.exponent} equals the children's sum within 1%`);
    }
  }, 2 * TIMEOUT);

  it(`${NAME} the planted tree_child_keeps_parent_radius fails, naming each fork`, () => {
    const row = built('tree_child_keeps_parent_radius').get('e2')!;
    const failures = pipeFailures(row, TREES.e2.exponent);
    console.log(`${ID} tree_child_keeps_parent_radius:\n  ${failures.slice(0, 5).join('\n  ')}`);
    expect(failures.length, 'the planted builder fails the pipe model').toBeGreaterThan(0);
    const unnamed = row.forks.filter((f) => !failures.some((x) => x.startsWith(`fork ${f.id} `)));
    expect(unnamed.map((f) => f.id), 'each of the plant\'s forks is named by a failure').toEqual([]);
    expect(row.forks.length, 'the plant builds the fixture\'s 13 forks').toBe(13);
  }, 2 * TIMEOUT);
});

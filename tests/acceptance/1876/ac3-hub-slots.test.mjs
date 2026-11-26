// #1876 criterion 3: every method and variant in packages/contracts/hub-slots.json has a row in the design's Hub slots
// table, and a planted row for `deep.registerGhost` fails the design links lane, naming it (README: Criteria and tests).
import assert from 'node:assert/strict';
import test from 'node:test';
import { CHECKOUT, DESIGN, SLOTS, clean, namesDotted, read, rows, runLane, shown, slotRow, slotsTable, unfailed, write } from './helpers.mjs';

const METHOD = 'deep.registerGhost';
const slot = ({ method, variant }) => (variant == null ? `\`${method}\`` : `\`${method}\` (${variant})`);

test('AC3 #1876.93b6ae42 the Hub slots table has a row for every method and variant of packages/contracts/hub-slots.json, and a planted row for `deep.registerGhost` fails the design links lane, naming it', (t) => {
  const copy = clean(t);
  const problems = [];
  // The tree: the checkout's own design and hub-slots.json.
  const table = slotsTable(read(CHECKOUT, DESIGN));
  const rowless = rows(CHECKOUT, SLOTS).filter(({ method, variant }) => !slotRow(table.rows, method, variant));
  if (rowless.length) problems.push(`the Hub slots table (${DESIGN}:${table.number}) has no row for ${rowless.length} of the methods and variants in ${SLOTS}: ${rowless.map(slot).join(', ')}`);
  // The plant: one more row in the copy's hub-slots.json, a row with no variant under the planted name and interface.
  const slots = rows(copy.repo, SLOTS);
  assert.ok(!slots.some(({ method }) => method === METHOD) && !slotRow(slotsTable(read(copy.repo, DESIGN)).rows, METHOD, null), `\`${METHOD}\` is already a slot or already in the Hub slots table, so planting it would prove nothing`);
  const model = slots.find(({ variant }) => variant == null) ?? slots[0];
  const ghost = { ...model, method: METHOD, variant: null };
  for (const key of ['interface', 'kit']) if (key in ghost) ghost[key] = 'ghost@1';
  write(copy.repo, SLOTS, `${JSON.stringify([...slots, ghost], null, 2)}\n`);
  const run = runLane(copy.repo, copy.issues);
  const planted = `a planted row for \`${METHOD}\` in ${SLOTS}`;
  problems.push(...unfailed(run, planted));
  if (run.status !== 0 && !namesDotted(run, METHOD)) problems.push(`on ${planted}, the lane failed without naming \`${METHOD}\`: ${shown(run)}`);
  if (problems.length) assert.fail(problems.join('\n\n'));
});

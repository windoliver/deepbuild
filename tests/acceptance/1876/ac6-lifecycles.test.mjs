// #1876 criterion 6: the design's Lifecycles list names exactly the objects with a `*.machine@*.json` table in
// packages/contracts/schemas, and a planted `ghost.machine@1.json` fails the design links lane, naming `ghost` (README:
// Criteria and tests).
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { CHECKOUT, DESIGN, SCHEMAS, clean, lifecycles, machineObjects, namesWord, objectKey, read, runLane, shown, unfailed, write } from './helpers.mjs';

const OBJECT = 'ghost';
const TABLE = `${OBJECT}.machine@1.json`;

test('AC6 #1876.19d18fbd the Lifecycles list names exactly the objects with a `*.machine@*.json` table in packages/contracts/schemas, and a planted `ghost.machine@1.json` fails the design links lane, naming `ghost`', (t) => {
  const copy = clean(t);
  const problems = [];
  // The tree: the checkout's own design and schemas.
  const list = lifecycles(read(CHECKOUT, DESIGN));
  const { objects } = machineObjects(CHECKOUT);
  const listed = new Set(list.names.map(objectKey));
  const tabled = new Set(objects.map(objectKey));
  const unlisted = objects.filter((object) => !listed.has(objectKey(object)));
  const tableless = list.names.filter((name) => !tabled.has(objectKey(name)));
  if (unlisted.length) problems.push(`the Lifecycles list (${DESIGN}:${list.number}) doesn't name ${unlisted.length} of the objects with a *.machine@*.json table in ${SCHEMAS}: ${unlisted.join(', ')}`);
  if (tableless.length) problems.push(`the Lifecycles list (${DESIGN}:${list.number}) names ${tableless.length} objects with no *.machine@*.json table in ${SCHEMAS}: ${tableless.join(', ')}`);
  // The plant: one more table in the copy's schemas, the smallest real table under the planted name.
  const own = machineObjects(copy.repo);
  assert.ok(!own.objects.includes(OBJECT) && !lifecycles(read(copy.repo, DESIGN)).names.map(objectKey).includes(OBJECT), `\`${OBJECT}\` already has a table or is already in the Lifecycles list, so planting it would prove nothing`);
  const size = (file) => statSync(join(copy.repo, SCHEMAS, file)).size;
  const [model] = [...own.tables].sort((a, b) => size(a) - size(b) || a.localeCompare(b));
  const table = JSON.parse(read(copy.repo, `${SCHEMAS}/${model}`));
  if (typeof table.id === 'string') table.id = TABLE.replace(/\.json$/, '');
  write(copy.repo, `${SCHEMAS}/${TABLE}`, `${JSON.stringify(table, null, 2)}\n`);
  assert.ok(machineObjects(copy.repo).objects.includes(OBJECT), `the planted ${TABLE} isn't read as a table of ${SCHEMAS}`);
  const run = runLane(copy.repo, copy.issues);
  const planted = `a planted ${SCHEMAS}/${TABLE}`;
  problems.push(...unfailed(run, planted));
  if (run.status !== 0 && !namesWord(run, OBJECT)) problems.push(`on ${planted}, the lane failed without naming \`${OBJECT}\`: ${shown(run)}`);
  if (problems.length) assert.fail(problems.join('\n\n'));
});

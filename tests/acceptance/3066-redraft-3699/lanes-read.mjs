import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [scripts, listPath] = process.argv.slice(2);
const load = (name) => import(pathToFileURL(join(scripts, name)).href);
const lanes = await load('lanes.mjs');
const affected = await load('affected.mjs');
const { isTestFile } = await load('proof-change.mjs');

const listOf = (name) => (Array.isArray(lanes[name]) ? [...lanes[name]] : []);
const redrafted = lanes.redrafted && typeof lanes.redrafted === 'object' ? { ...lanes.redrafted } : {};
const lists = Object.fromEntries(['alone', 'exclusive', 'timed', 'slow', 'byHand', 'ownLane'].map((name) => [name, listOf(name)]));
const tests = JSON.parse(readFileSync(listPath, 'utf8')).filter(isTestFile);
const files = tests.filter((file) => existsSync(join(process.cwd(), file)));
const blocks = Object.fromEntries(files.map((file) => [file, null]));
const plan = affected.plan(process.cwd(), files, []);
for (const [block, byRunner] of [...Object.entries(plan.blocks), ['timed', plan.timed], ['slow', plan.slow]]) for (const [runner, list] of Object.entries(byRunner)) for (const file of list) blocks[file] = `${block}/${runner}`;
for (const entry of plan.skipped) {
  const [, file, why] = entry.match(/^(.*) \(([^()]*)\)$/) ?? [, entry, '?'];
  if (file in blocks) blocks[file] = `skipped/${why}`;
}
process.stdout.write(JSON.stringify({ redrafted, lists, tests, blocks }));

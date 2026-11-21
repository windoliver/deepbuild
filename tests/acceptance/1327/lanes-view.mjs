// What the lanes do with each of a list of test files, read from a scripts/ folder's own exports. Run with the
// repository as the working folder:
//
//   node tests/acceptance/1327/lanes-view.mjs <scripts folder> <JSON file holding the list of test paths>
//
// It prints one JSON object: for each file its scripts' proof-change.mjs counts as a test file (the others are left out), the block affected.mjs's plan() puts it in (with its runner), its shard
// group in the alone block, whether each of lanes.mjs's lists names it, and which of the unit lane's vitest commands
// run it. It reads only the scripts' exports; nothing here decides a lane.
import { readFileSync } from 'node:fs';
import { join, matchesGlob } from 'node:path';
import { pathToFileURL } from 'node:url';

const [scripts, listPath] = process.argv.slice(2);
const cwd = process.cwd();
const lanes = await import(pathToFileURL(join(scripts, 'lanes.mjs')).href);
const affected = await import(pathToFileURL(join(scripts, 'affected.mjs')).href);
const { isTestFile } = await import(pathToFileURL(join(scripts, 'proof-change.mjs')).href);
const files = JSON.parse(readFileSync(listPath, 'utf8')).filter(isTestFile);

const view = Object.fromEntries(files.map((file) => [file, { block: null, group: null, lists: {}, unit: null }]));
const plan = affected.plan(cwd, files, []);
for (const [block, byRunner] of Object.entries(plan.blocks)) for (const [runner, list] of Object.entries(byRunner)) for (const file of list) view[file].block = `${block}/${runner}`;
for (const [block, byRunner] of [['timed', plan.timed], ['slow', plan.slow]]) for (const [runner, list] of Object.entries(byRunner)) for (const file of list) view[file].block = `${block}/${runner}`;
for (const entry of plan.skipped) {
  const [, file, why] = entry.match(/^(.*) \(([^()]*)\)$/) ?? [, entry, '?'];
  if (view[file]) view[file].block = `skipped/${why}`;
}

// The alone block's shard groups: each file's group mates, and whether its group is exclusive.
const aloneFiles = Object.values(plan.blocks.alone).flat();
const groups = affected.shardGroups(aloneFiles);
for (const [kind, list] of [['shared', groups.shared], ['exclusive', groups.exclusive]]) for (const group of list) for (const file of group) view[file].group = `${kind}: ${[...group].sort().join(' ')}`;

for (const name of ['alone', 'exclusive', 'byHand', 'timed', 'slow', 'ownLane']) {
  if (!Array.isArray(lanes[name])) continue;
  for (const file of files) view[file].lists[name] = lanes.listed(lanes[name], file);
}

// The unit lane's vitest commands: the parallel one, and the one run with --no-file-parallelism (its alone block).
// Vitest takes positional arguments as filters a file's path must contain, and --exclude values as globs.
const unit = lanes.checks.find(({ name }) => name === 'unit');
const vitestRuns = (unit?.commands ?? []).filter((command) => command.some((arg) => String(arg).endsWith('vitest.mjs')) && command.includes('run'));
const runs = (command, file) => {
  const args = command.slice(command.indexOf('run') + 1).map(String), filters = [], excludes = [];
  for (let at = 0; at < args.length; at += 1) {
    if (args[at] === '--exclude') excludes.push(args[(at += 1)]);
    else if (!args[at].startsWith('-')) filters.push(args[at]);
  }
  return (!filters.length || filters.some((filter) => file.includes(filter))) && !excludes.some((glob) => matchesGlob(file, glob));
};
for (const file of files) {
  if (!view[file].block?.endsWith('/vitest')) continue;
  view[file].unit = vitestRuns.filter((command) => runs(command, file)).map((command) => (command.includes('--no-file-parallelism') ? 'alone' : 'parallel')).join('+') || 'none';
}
process.stdout.write(JSON.stringify(view));

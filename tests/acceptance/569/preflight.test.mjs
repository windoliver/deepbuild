// #569 acceptance: the proof lanes are the preflight's, through `scripts/lanes.mjs`'s exported
// `checks` (the local preflight) and `releaseChecks` (the release preflight), and package.json's
// scripts. The full preflight takes 10 to 25 minutes, so it is not run here (README: Not covered).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { lanesUrl, root } from './helpers.mjs';

const proofCommands = (lanes) => lanes.flatMap(({ commands }) => commands).filter((command) => command.includes('scripts/proof.mjs'));
const isNode = (command) => [process.execPath, 'node'].includes(command[0]);

test('#569.60ea8a8b #569.f7197598 the local preflight runs every proof lane once, as node scripts/proof.mjs with no mode', async () => {
  const { checks } = await import(lanesUrl);
  const commands = proofCommands(checks);
  assert.equal(commands.length, 1, `the local lanes run scripts/proof.mjs ${commands.length} times: ${JSON.stringify(commands)}`);
  assert.ok(isNode(commands[0]), JSON.stringify(commands[0]));
  assert.deepEqual(commands[0].slice(1), ['scripts/proof.mjs'], 'the local preflight runs every proof lane in local mode');
});

test('#569.60ea8a8b #569.f7197598 the release preflight runs the proof lanes with --release, and npm run release:check is scripts/preflight --release', async () => {
  const { releaseChecks } = await import(lanesUrl);
  assert.ok(Array.isArray(releaseChecks), 'scripts/lanes.mjs exports no releaseChecks');
  const commands = proofCommands(releaseChecks);
  assert.equal(commands.length, 1, JSON.stringify(commands));
  assert.ok(isNode(commands[0]), JSON.stringify(commands[0]));
  assert.deepEqual(commands[0].slice(1), ['scripts/proof.mjs', '--release']);
  const { scripts } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(scripts.preflight, 'scripts/preflight');
  assert.equal(scripts['release:check'], 'scripts/preflight --release');
});

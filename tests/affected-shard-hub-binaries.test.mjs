import assert from 'node:assert/strict';
import test from 'node:test';
import { affected, aloneFolders, evidence, fixture, prints, record, sandbox, TEST, workspace } from './acceptance/2820/helpers.mjs';
import { join } from 'node:path';

const NAME = 'shard-hub.test';

const startsTheHub = (file) => `import assert from 'node:assert/strict';
import test from 'node:test';
import { appendFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let root = dirname(fileURLToPath(import.meta.url));
while (!existsSync(join(root, 'Cargo.toml')) && dirname(root) !== root) root = dirname(root);
const hub = join(root, 'packages/hub/src/paths.ts');
test('the checkout has the hub its paths name', () => {
  const hook = join(root, 'target', 'debug', 'deep-hook');
  appendFileSync(process.env.T2820_RECORD, JSON.stringify({ file: ${JSON.stringify(file)}, root, hub, event: 'start', hook: existsSync(hook) }) + '\\n');
  assert.ok(existsSync(hook), 'no deep-hook is built under ' + join(root, 'target'));
});
`;

test('a shard whose alone tests start the hub gets deep-hook in its target/debug before they run', TEST, async (t) => {
  const box = sandbox(t);
  const files = aloneFolders(2, NAME).map((folder) => `${folder}${NAME}.mjs`);
  const fx = fixture(box, {
    ...workspace(box, { 'deep-hook': prints('deep-hook') }),
    ...Object.fromEntries(files.map((file) => [file, startsTheHub(file)])),
  }, { DEEP_SHARDS: '2' });
  const run = await affected(box, fx, files);
  const all = evidence(run, box, fx);
  const shards = join(box.home, 'deepbuild-shards');
  const starts = record(fx).filter((e) => e.event === 'start');
  assert.equal(starts.length, 2, `the planted files did not both run\n${all}`);
  assert.ok(starts.every((e) => e.root.startsWith(`${shards}/`)), `the planted files did not run in shards under ${shards}\n${all}`);
  for (const e of starts) assert.ok(e.hook, `${e.root} had no target/debug/deep-hook when ${e.file} started\n${all}`);
});

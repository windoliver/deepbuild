// node_modules/vitest/vitest.mjs of the twin's fixture repo (#2218 AC5): the fixture's test runner, entered as this
// repo's spec enters Vitest's, `node node_modules/vitest/vitest.mjs run <folder>`. It loads every *.mjs file under the
// folder, each a node:test file, so the tests the hub counts come from node:test's own report, never from this file.
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [, , verb, folder] = process.argv;
if (verb !== 'run' || !folder) {
  console.error('usage: vitest run <folder>');
  process.exit(2);
}
const files = readdirSync(folder, { recursive: true }).map(String).filter((name) => name.endsWith('.mjs')).sort();
if (!files.length) {
  console.error(`no test file under ${folder}`);
  process.exit(1);
}
for (const name of files) await import(pathToFileURL(resolve(folder, name)).href);

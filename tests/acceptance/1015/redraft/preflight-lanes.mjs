// #1015 AC7's preflight, scaled down (redraft README, Open points 2): the preflight's lane runner, `runLanes` of
// scripts/lanes.mjs as scripts/checks.mjs calls it, given one lane whose one command runs the block. Before it calls the
// runner it writes the time into DH1015_DIR/began-<DH1015_LABEL>, so a lease taken before this process started (one for
// the whole command) can't pass for the block's own. Paths are built from pieces, never written as one, so
// scripts/affected.mjs's path reader links nothing to them.
import { writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..', '..');
writeFileSync(join(process.env.DH1015_DIR, `began-${process.env.DH1015_LABEL}`), String(Date.now()));
const { runLanes } = await import(pathToFileURL(join(root, 'scripts', 'lanes.mjs')).href);
process.exitCode = runLanes([
  { name: 'block', commands: [[process.execPath, '--test', relative(root, join(here, 'block.test.mjs'))]], fix: 'Let the block end (its go file).' },
]);

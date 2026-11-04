// #1015 AC7's block (redraft README): the one command of the scaled-down preflight's lane and the one test file each
// `node scripts/affected.mjs` run is handed as its change, so it is a block of each run whose start and end the test
// sees. It marks its start (`S`) and end (`E`) in the world's log, as the suite's stand-ins do, and holds until its go
// file exists. Run by anything but that test (no DH1015_DIR), it is skipped.
import { appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const dir = process.env.DH1015_DIR;
const label = process.env.DH1015_LABEL;

test('#1015.d86f2d2a the block marks its start and end and holds until its go file', { skip: !dir || !label }, async () => {
  const stamp = (kind) => appendFileSync(join(dir, 'log'), `${kind}\t${label}\t${process.pid}\t${Date.now()}\tnode --test block\n`);
  stamp('S');
  while (!existsSync(join(dir, 'go', label)) && !existsSync(join(dir, 'go', 'all'))) await new Promise((resolve) => setTimeout(resolve, 50));
  stamp('E');
});

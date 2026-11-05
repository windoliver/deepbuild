// #1015 AC7's probe block (README, AC7): the one test file `node scripts/affected.mjs` is handed as the change, so its
// node --test block is a block of that run whose start and end the suite can see. It marks its start and end in the
// suite's log and holds until its go file exists. Run by anything but that test (no DH1015_DIR), it is skipped.
import { appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const dir = process.env.DH1015_DIR;
const label = process.env.DH1015_LABEL;

test('#1015.d86f2d2a the probe block of an affected.mjs run marks its start and end and holds until its go file', { skip: !dir || !label }, async () => {
  const stamp = (kind) => appendFileSync(join(dir, 'log'), `${kind}\t${label}\t${process.pid}\t${Date.now()}\tnode --test probe.test.mjs\n`);
  stamp('S');
  while (!existsSync(join(dir, 'go', label)) && !existsSync(join(dir, 'go', 'all'))) await new Promise((resolve) => setTimeout(resolve, 50));
  stamp('E');
});

// A build that joins the job pool as a make client does (#2648 AC4), run under `deep lease`: it takes $DH2648_TAKE
// tokens from the pipe MAKEFLAGS names, waiting for each, writes $DH2648_HELD once it holds them (the pipe's path and
// what it holds), and exits 0 once $DH2648_GO exists, giving none back, as a build that was stopped would.
import { constants, existsSync, openSync, readSync, writeFileSync } from 'node:fs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const flags = process.env.CARGO_MAKEFLAGS ?? process.env.MAKEFLAGS ?? '';
const pipe = /--jobserver-auth=fifo:(\S+)/.exec(flags)?.[1];
if (!pipe) {
  writeFileSync(process.env.DH2648_HELD, JSON.stringify({ error: `no jobserver in MAKEFLAGS: ${JSON.stringify(flags)}` }));
  process.exit(3);
}
const fd = openSync(pipe, constants.O_RDONLY | constants.O_NONBLOCK);
const want = Number(process.env.DH2648_TAKE);
const one = Buffer.alloc(1);
let held = 0;
while (held < want) {
  try {
    if (readSync(fd, one, 0, 1, null) === 1) held++;
  } catch {
    await sleep(20); // EAGAIN: none free yet
  }
}
writeFileSync(process.env.DH2648_HELD, JSON.stringify({ pipe, held, pid: process.pid }));
while (!existsSync(process.env.DH2648_GO)) await sleep(50);
process.exit(0);

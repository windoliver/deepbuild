// #1016's stand-ins (README, How commands are stood in for), installed in a world's bin folder as `holder` and `npm`.
//
// holder: a build that joins the jobserver it was given in CARGO_MAKEFLAGS or MAKEFLAGS (`--jobserver-auth=fifo:<path>`)
//   as a make or cargo client does, and holds tokens until its go file exists: DH1016_TAKE=<n> reads n tokens, waiting
//   for each; DH1016_LEAVE=<n> reads every token there is without waiting and writes n of them back at once. On its go
//   file it writes every token it holds back and exits 0. Killed, it gives nothing back.
// npm: a test runner that records the words it was given (its worker flag among them) and exits 0.
//
// Each writes one JSON line to $DH1016_DIR/log per mark: {role, label, what, pid, pgid, makeflags, cargo_makeflags, ...}.
import { execFileSync } from 'node:child_process';
import { appendFileSync, constants, existsSync, openSync, readSync, writeSync } from 'node:fs';
import { join } from 'node:path';

const role = process.argv[2];
const dir = process.env.DH1016_DIR;
const label = process.env.DH1016_LABEL ?? role;
const pgid = Number(execFileSync('/bin/ps', ['-o', 'pgid=', '-p', String(process.pid)], { encoding: 'utf8' }).trim());
const base = { role, label, pid: process.pid, pgid, makeflags: process.env.MAKEFLAGS ?? null, cargo_makeflags: process.env.CARGO_MAKEFLAGS ?? null };
const mark = (what, extra = {}) => appendFileSync(join(dir, 'log'), `${JSON.stringify({ ...base, what, ms: Date.now(), ...extra })}\n`);
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const goFile = () => existsSync(join(dir, 'go', label)) || existsSync(join(dir, 'go', 'all'));

if (role === 'npm') {
  mark('ran', { argv: process.argv.slice(3) });
  process.exit(0);
}

const flags = process.env.CARGO_MAKEFLAGS ?? process.env.MAKEFLAGS ?? '';
const fifo = /--jobserver-auth=fifo:(\S+)/.exec(flags)?.[1];
if (!fifo) {
  mark('held', { joined: false, held: 0 });
  while (!goFile()) pause(100);
  process.exit(0);
}
const fd = openSync(fifo, constants.O_RDWR | constants.O_NONBLOCK);
const held = [];
const readOne = () => {
  const buf = Buffer.alloc(1);
  try { return readSync(fd, buf, 0, 1, null) === 1 ? buf : undefined; } catch (error) { if (error.code === 'EAGAIN') return undefined; throw error; }
};
if (process.env.DH1016_LEAVE !== undefined) {
  for (let b = readOne(); b; b = readOne()) held.push(b);
  const leave = Math.min(Number(process.env.DH1016_LEAVE), held.length);
  if (leave) writeSync(fd, Buffer.concat(held.splice(0, leave)));
} else {
  const want = Number(process.env.DH1016_TAKE ?? 1);
  const deadline = Date.now() + 60_000;
  while (held.length < want && Date.now() < deadline) {
    const b = readOne();
    if (b) held.push(b);
    else pause(20);
  }
}
mark('held', { joined: true, fifo, held: held.length });
while (!goFile()) pause(100);
if (held.length) writeSync(fd, Buffer.concat(held));
mark('gave back', { held: held.length });
process.exit(0);

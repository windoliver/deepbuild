// #1411's stand-ins (README, How commands are stood in for), installed in a world's bin folder as `jobbuild` and
// `steadyrun`. Neither prints anything, so no line of what `deep lease` prints comes from them.
//
// jobbuild: a build that joins the jobserver it was given in CARGO_MAKEFLAGS (else MAKEFLAGS), as make and cargo do:
//   one job always runs on its implicit token, and each further job reads one token from the pipe and writes that byte
//   back when it ends. It wants every token it can get (up to 32 jobs at once), each job 100 to 300 ms long (200 on
//   average), so jobs end one by one as a build's do, and the pipe stays empty while it runs. A byte a job gives back
//   stays in the pipe 1 ms before the build reads again: a reader the write woke (the hub's) has the first go at it, as
//   with cargo's own reader thread. It starts jobs without end until its go file; then it runs DH1411_TAIL more (0),
//   gives every token back and exits 0. Killed, it gives nothing back. On each change of what it holds, and every
//   250 ms, it writes {what: 'jobs', held, running, done}.
// steadyrun: a runner with a fixed job count of its own (DH1411_FIXED, 3): it never joins a jobserver; it writes a
//   heartbeat {what: 'beat', jobs} every 100 ms until its go file, then exits 0.
//
// Each writes JSON lines to $DH1411_DIR/<label>.jsonl (DH1411_LABEL, else its role), the first {what: 'joined' |
// 'started', pid, pgid, makeflags, cargo_makeflags, argv}, every line with its time `ms`. Its go file is
// $DH1411_DIR/go/<label> or $DH1411_DIR/go/all.
import { execFileSync } from 'node:child_process';
import { appendFileSync, closeSync, constants, existsSync, openSync, readSync, writeSync } from 'node:fs';
import { join } from 'node:path';

const role = process.argv[2];
const dir = process.env.DH1411_DIR;
const label = process.env.DH1411_LABEL ?? role;
const log = join(dir, `${label}.jsonl`);
const write = (line) => appendFileSync(log, `${JSON.stringify({ ms: Date.now(), ...line })}\n`);
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const go = () => existsSync(join(dir, 'go', label)) || existsSync(join(dir, 'go', 'all'));
const pgid = Number(execFileSync('/bin/ps', ['-o', 'pgid=', '-p', String(process.pid)], { encoding: 'utf8' }).trim());
const first = { role, pid: process.pid, pgid, makeflags: process.env.MAKEFLAGS ?? null, cargo_makeflags: process.env.CARGO_MAKEFLAGS ?? null, argv: process.argv.slice(3) };

if (role === 'steadyrun') {
  const jobs = Number(process.env.DH1411_FIXED ?? 3);
  write({ what: 'started', ...first, jobs });
  let beat = 0;
  while (!go()) {
    if (Date.now() - beat >= 100) {
      write({ what: 'beat', jobs });
      beat = Date.now();
    }
    pause(20);
  }
  write({ what: 'ended' });
  process.exit(0);
}

if (role !== 'jobbuild') throw Error(`no stand-in is called ${role}`);
const fifo = /--jobserver-auth=fifo:(\S+)/.exec(process.env.CARGO_MAKEFLAGS ?? process.env.MAKEFLAGS ?? '')?.[1] ?? null;
write({ what: 'joined', ...first, fifo });
const fd = fifo ? openSync(fifo, constants.O_RDWR | constants.O_NONBLOCK) : undefined;
const JOB_MS = 200;
const TAIL = Number(process.env.DH1411_TAIL ?? 0);
const MAX = 32;
/** The jobs running: when each ends, and the byte it read (null for the job on the implicit token). */
const jobs = [];
const readToken = () => {
  if (fd === undefined) return null;
  const byte = Buffer.alloc(1);
  try { return readSync(fd, byte, 0, 1, null) === 1 ? byte : null; } catch (error) { if (error.code === 'EAGAIN') return null; throw error; }
};
let done = 0;
let going = false;
let tail = 0;
let goRead = 0;
let shown = '';
let shownAt = 0;
for (;;) {
  const now = Date.now();
  const back = [];
  for (let i = jobs.length - 1; i >= 0; i--) {
    if (jobs[i].end > now) continue;
    if (jobs[i].token) back.push(jobs[i].token);
    jobs.splice(i, 1);
    done++;
  }
  if (back.length) writeSync(fd, Buffer.concat(back));
  pause(1);
  if (!going && now - goRead >= 100) {
    going = go();
    goRead = now;
  }
  const more = () => !going || tail < TAIL;
  const start = (token) => {
    jobs.push({ end: Date.now() + Math.round(JOB_MS * (0.5 + Math.random())), token });
    if (going) tail++;
  };
  if (more() && !jobs.some((j) => !j.token)) start(null);
  while (more() && jobs.length < MAX) {
    const token = readToken();
    if (!token) break;
    start(token);
  }
  if (going && !more() && !jobs.length) break;
  const held = jobs.filter((j) => j.token).length;
  const state = `${held}/${jobs.length}`;
  if (state !== shown || Date.now() - shownAt >= 250) {
    write({ what: 'jobs', held, running: jobs.length, done });
    shown = state;
    shownAt = Date.now();
  }
}
write({ what: 'ended', done });
if (fd !== undefined) closeSync(fd);
process.exit(0);

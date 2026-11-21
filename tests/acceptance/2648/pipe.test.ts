// #2648 AC4: "With one leased command running and then ended, the job pool's pipe holds its full count again at once,
// and with none running for 60 s nothing writes to it. The planted `refills-while-running` still fails as it does
// today".
//
// A hub told 5 cores, so its job pool holds 4 tokens (#1016: one a core, less one), with memory pressure read as
// normal, so it holds none back (#1411). One `deep lease` of a build that takes 2 tokens from the pool's pipe and ends
// without giving them back, as a stopped build would. The pipe is read as #1016's suite reads it: every byte there is,
// each written back. While the build runs, no read may hold more than the 2 it left (#1016 AC3: no token is added while a
// leased build runs). Once its `deep lease` exits, the pipe holds 4. Then for 60 s nothing writes to it: a write to a
// named pipe moves its modification time, which the test reads four times a second. The wrong programs: the merge
// base, which refills the pipe every 500 ms, and #1016's planted `refills-while-running`.
import { closeSync, constants, existsSync, lstatSync, openSync, readFileSync, readSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { AC4, cleanup, envOf, FIXTURES, makeWorld, NODE, own, REPO, running, sleep, startHub, stopHub, type Hub, type World } from './helpers.ts';

afterAll(cleanup, 120_000);

/** #1016's planted wrong program: the hub tops the pipe up to its full count while a leased build runs. */
const PLANT = 'refills-while-running';
const CORES = 5;
const FULL = CORES - 1;
const TAKE = 2;
const QUIET_MS = 60_000;

/** The pipe's free tokens: every byte read without waiting, then each written back. */
function tokens(pipe: string): number {
  const fd = openSync(pipe, constants.O_RDWR | constants.O_NONBLOCK);
  try {
    const got: Buffer[] = [];
    const buf = Buffer.alloc(4096);
    for (;;) {
      let n = 0;
      try { n = readSync(fd, buf, 0, buf.length, null); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EAGAIN') break; throw error; }
      if (n <= 0) break;
      got.push(Buffer.from(buf.subarray(0, n)));
    }
    const all = Buffer.concat(got);
    if (all.length) writeSync(fd, all);
    return all.length;
  } finally {
    closeSync(fd);
  }
}
const mtime = (pipe: string): bigint => statSync(pipe, { bigint: true }).mtimeNs;

/** One run: the hub (planted or not), the lease, and each reading the criterion names; throws naming the first that fails. */
async function judgePipe(plant?: string): Promise<void> {
  const w: World = makeWorld();
  const pressure = join(w.tmp, 'pressure');
  writeFileSync(pressure, 'normal\n');
  const env = { DEEP_HUB_TEST_CORES: String(CORES), DEEP_TEST_MEMORY_PRESSURE_FILE: pressure };
  const hub: Hub = await startHub(w, { ...(plant ? { plant } : {}), env });
  const held = join(w.tmp, 'held');
  const go = join(w.tmp, 'go');
  try {
    const pipe = join(w.root, 'jobserver');
    if (!existsSync(pipe) || !lstatSync(pipe).isFIFO()) throw Error(`BLOCKED: the hub's job pool has no named pipe at ${pipe}`);
    let start = tokens(pipe);
    for (const deadline = Date.now() + 5000; start !== FULL && Date.now() < deadline; start = tokens(pipe)) await sleep(250);
    if (start !== FULL) throw Error(`BLOCKED: a pool on ${CORES} cores holds ${FULL} tokens before any lease; the pipe held ${start}`);

    const lease = spawn(NODE, [join(REPO, 'packages/cli/dist/main.js'), 'lease', '--', NODE, join(FIXTURES, 'holder.mjs')], {
      cwd: w.tmp, env: envOf(w, { ...env, DH2648_TAKE: String(TAKE), DH2648_HELD: held, DH2648_GO: go }), stdio: ['ignore', 'ignore', 'pipe'],
    });
    own(lease);
    let leaseErr = '';
    lease.stderr.setEncoding('utf8').on('data', (d: string) => (leaseErr += d));
    const ended = new Promise<number | null>((resolve) => lease.on('exit', (code) => resolve(code)));
    for (const deadline = Date.now() + 60_000; !existsSync(held) && Date.now() < deadline;) await sleep(50);
    const holder = existsSync(held) ? (JSON.parse(readFileSync(held, 'utf8')) as { pipe?: string; held?: number; error?: string }) : undefined;
    if (holder?.held !== TAKE || holder.pipe !== pipe) throw Error(`BLOCKED: the leased build must join the pool's pipe ${pipe} and take ${TAKE} tokens: ${JSON.stringify(holder ?? 'it never said')}; deep lease said ${leaseErr.slice(-800)}`);

    // While it runs: no token added, so no read holds more than the build left.
    const ranFrom = Date.now();
    let most = 0;
    for (let sample = 1; sample <= 12; sample++) {
      const n = tokens(pipe);
      most = Math.max(most, n);
      if (n > FULL - TAKE) throw Error(`AC4 ${AC4}: while the leased build ran, holding ${TAKE} of the pool's ${FULL} tokens, sample ${sample} (+${((Date.now() - ranFrom) / 1000).toFixed(2)} s) read ${n} tokens in the pipe, more than the ${FULL - TAKE} it left: the hub added tokens while a leased command ran`);
      await sleep(250);
    }

    writeFileSync(go, '');
    const code = await Promise.race([ended, sleep(60_000).then(() => 'hung' as const)]);
    if (code !== 0) throw Error(`BLOCKED: deep lease of the build must end 0 once it is let go: ${String(code)}; it said ${leaseErr.slice(-800)}`);
    const after = tokens(pipe);
    if (after !== FULL) throw Error(`AC4 ${AC4}: just after the one leased command ended, the job pool's pipe held ${after} tokens, not its full count of ${FULL}`);

    // With none running for 60 s, nothing writes to it.
    const quiet = Date.now();
    let last = mtime(pipe);
    const writes: number[] = [];
    while (Date.now() - quiet < QUIET_MS) {
      await sleep(250);
      const now = mtime(pipe);
      if (now !== last) writes.push(Date.now() - quiet);
      last = now;
    }
    // A hub that ended in the window writes nothing: that's no reading.
    if (!running(hub.child)) throw Error(`BLOCKED: the hub ended during the ${QUIET_MS / 1000} s with nothing leased: ${hub.stderr().slice(-800)}`);
    if (writes.length) throw Error(`AC4 ${AC4}: with no leased command running for ${QUIET_MS / 1000} s, something wrote to the job pool's pipe: its modification time moved ${writes.length} times, first ${(writes[0]! / 1000).toFixed(2)} s after the command ended, last ${(writes.at(-1)! / 1000).toFixed(2)} s after`);
    console.log(`AC4 reading: the pipe held ${start} tokens before the lease, at most ${most} in 12 reads while the build ran, ${after} once it ended, and nothing wrote to it for ${QUIET_MS / 1000} s`);
  } finally {
    // A build still waiting is let go, so it ends with its lease.
    if (!existsSync(go)) writeFileSync(go, '');
    await stopHub(hub);
  }
}

describe(`AC4 ${AC4} the job pool's pipe is refilled when the last leased command ends, and not on a beat with nothing held`, () => {
  it(`AC4 ${AC4} the pipe holds its full count at once after the one leased command ends, and nothing writes to it for the next 60 s`, async () => {
    await judgePipe();
  }, 600_000);

  it(`AC4 ${AC4} the planted ${PLANT} still fails, naming the sample read while the leased command ran`, async () => {
    let failure: string | undefined;
    try {
      await judgePipe(PLANT);
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    expect(failure, `the planted ${PLANT} must fail AC4's readings`).toBeDefined();
    console.log(`AC4 on the planted ${PLANT}: ${failure}`);
    expect(failure!, `the planted ${PLANT} fails while the leased build runs, naming the sample`).toMatch(/while the leased build ran.*sample \d+/);
  }, 600_000);
});

// #2569.b4a750e6: no `lists_1477` process outlives the test run that started it. A test run that dies can't stop what
// it started (the issue's orphaned `lists_1477-plain arm blank` held its runner for 53 minutes), so the bench must go
// by itself. starter.mjs starts the bench as #1477's tests do and waits for it; once the bench's processes are in the
// process table this test kills the starter by its PID, as a run that dies is killed, and reads the table: 5 s later
// none of them is left. At the merge base an arm lives on for its warm-up and its 8 counted seconds at least, and
// `measure` for as long as its arm, so both are still there. Whatever is left is stopped by its PID before the test
// ends. Off macOS it fails with a message starting `INCONCLUSIVE:`.
import { spawn } from 'node:child_process';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC2, GRACE_S, REPO, SUITE, descendants, leftAfter, processTable, shown, sleep, stop, useBench, useDir, type Proc,
} from './helpers.ts';

const bench = useBench();
const dir = useDir();

/**
 * Starts `lists_1477 <args>` under the starter, waits for `want` bench processes under it (the call, and the arms it
 * starts), kills the starter, and returns the bench processes still in the table GRACE_S later.
 */
async function leftBehind(args: string[], want: number): Promise<{ started: Proc[]; left: Proc[] }> {
  const bin = bench();
  const starter = spawn(process.execPath, [join(SUITE, 'starter.mjs'), REPO, bin, ...args], { cwd: REPO, stdio: 'ignore' });
  const gone = new Promise<void>((resolve) => { starter.on('exit', () => resolve()); starter.on('error', () => resolve()); });
  let started: Proc[] = [];
  try {
    const end = performance.now() + 60_000;
    while (started.length < want && performance.now() < end && starter.exitCode === null) {
      started = descendants(processTable(), starter.pid ?? -1).filter((p) => p.command.includes(basename(bin)));
      if (started.length < want) await sleep(100);
    }
    expect(started.length, `\`lists_1477 ${args.join(' ')}\` is running under its starter, ${want} bench ${want === 1 ? 'process' : 'processes'} in the process table: ${shown(started)}`).toBe(want);
    // The run that started it dies, with no chance to stop what it started.
    starter.kill('SIGKILL');
    await gone;
    return { started, left: await leftAfter(started, GRACE_S * 1000) };
  } finally {
    if (starter.exitCode === null && starter.signalCode === null) { starter.kill('SIGKILL'); await gone; }
    await stop(started);
  }
}

describe(`${AC2} no \`lists_1477\` process outlives the test run that started it`, () => {
  it(`${AC2} \`arm blank\`, started as #1477's tests start it: ${GRACE_S} s after its starter is killed, it is no longer in the process table`, async () => {
    const { started, left } = await leftBehind(['arm', 'blank'], 1);
    expect(left.map((p) => `pid ${p.pid}: ${p.command}`), `${GRACE_S} s after the process that started it was killed, \`lists_1477 arm blank\` (${shown(started)}) is still running: it outlives the run that started it`).toEqual([]);
  }, 300_000);

  it(`${AC2} \`measure --arms blank\`, started as #1477's tests start it: ${GRACE_S} s after its starter is killed, neither it nor the arm it started is in the process table`, async () => {
    const { started, left } = await leftBehind(['measure', '--out', join(dir(), 'record.json'), '--arms', 'blank'], 2);
    expect(started.map((p) => (/ measure --out /.test(p.command) ? 'measure' : / arm blank$/.test(p.command) ? 'arm blank' : p.command)).sort(), 'the two are the measure call and its blank arm').toEqual(['arm blank', 'measure']);
    expect(left.map((p) => `pid ${p.pid}: ${p.command}`), `${GRACE_S} s after the process that started \`lists_1477 measure\` was killed, of ${shown(started)} these are still running: they outlive the run that started them`).toEqual([]);
  }, 300_000);
});

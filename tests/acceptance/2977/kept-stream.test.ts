// AC2: when more than one filter shows a canary's report, the supervisor keeps exactly one `log stream` child, the
// cheapest filter in FILTERS order that showed it, and a write its sandbox refuses is recorded as one sandbox.denied
// for that run. Under `reports-other-subsystem` the kernel's filter and the sender alone both show a report, and the
// kernel's is kept; under `reports-other-process` only the sender alone shows one, and it is kept. Warming every
// filter at once must still end with one stream, the right one, and one refusal recorded once, not once per stream.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { AC, deniedFor, open, sleep, streams, type World } from './helpers.ts';

test.skipIf(process.platform !== 'darwin').each([
  ['reports-other-subsystem', "the kernel's", '--predicate process == "kernel" AND sender =='],
  ['reports-other-process', 'the sender alone', '--predicate sender =='],
] as const)(`${AC[2]} under %s, the one log stream kept is %s, and a refused write is one sandbox.denied for its run`, async (world: World, _name, filter) => {
  const w = await open(world);
  try {
    const target = join(w.dir, 'outside', 'w.txt');
    const started = await w.sup.start({ run: 'run:DENIED', argv: ['/usr/bin/touch', target], cwd: join(w.dir, 'in'), grant: { write: [join(w.dir, 'in')] } });
    expect(started.status).toBe('started');
    await w.sup.wait('run:DENIED');
    expect(existsSync(target), 'the sandbox refused the write').toBe(false);
    for (const until = Date.now() + 15_000; !(await deniedFor(w.record, 'run:DENIED')).length && Date.now() < until;) await sleep(100);
    // Time for a second stream, or a second report of the same refusal, to add another event.
    await sleep(2_000);
    const denied = await deniedFor(w.record, 'run:DENIED');
    expect(denied.map((d) => d.target), `the sandbox.denied events for run:DENIED: ${JSON.stringify(denied)}`).toEqual([target]);
    const left = streams();
    expect(left.map((line) => line.includes(filter)), `this process's log stream children; the one kept is ${filter}:\n${left.join('\n')}`).toEqual([true]);
  } finally {
    await w.close();
  }
}, 90_000);

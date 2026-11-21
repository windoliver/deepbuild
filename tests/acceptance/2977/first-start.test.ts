// AC1: on a macOS whose sandbox reports don't show through the first filter, a new supervisor's first sandboxed
// start() resolves within 5 s of openSupervisor resolving. The two planted worlds the criterion names: under
// `reports-other-subsystem` the first filter shows no report; under `reports-other-process` neither the first nor the
// second does. On the base the first start waits out the whole 10 s warm of each filter that shows nothing.
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { AC, FIRST_START_MS, open, type World } from './helpers.ts';

test.skipIf(process.platform !== 'darwin').each([
  ['reports-other-subsystem'],
  ['reports-other-process'],
] as const)(`${AC[1]} under %s, a new supervisor's first sandboxed start() resolves within 5 s of openSupervisor resolving`, async (world: World) => {
  const w = await open(world);
  try {
    // A sandboxed run: no run_as_you, its writes held to its own folder.
    const started = await w.sup.start({ run: 'run:FIRST', argv: ['/usr/bin/true'], cwd: join(w.dir, 'in'), grant: { write: [join(w.dir, 'in')] } });
    const took = performance.now() - w.openedAt;
    expect(started.status).toBe('started');
    expect(took, `ms from openSupervisor resolving to the first sandboxed start() resolving (${world})`).toBeLessThan(FIRST_START_MS);
    await w.sup.wait('run:FIRST');
  } finally {
    await w.close();
  }
}, 90_000);

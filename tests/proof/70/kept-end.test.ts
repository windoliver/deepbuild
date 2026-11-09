// A kept run that ends after a restart (#70): no hub holds its exit, so it finishes as stopped, never passed, and isn't
// run again. On a real systemd user service, in the VMs tests/acceptance/70 needs; its helpers stand up the hub.
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { allEvents, call, cleanup, makeHome, requireBubblewrap, requireService, restartService, startService, ulid, waitFor } from '../../acceptance/70/helpers.ts';

afterEach(cleanup, 60_000);

it('finishes as stopped once it ends, started once', async () => {
  requireService();
  requireBubblewrap();
  const h = makeHome();
  const hub = await startService(h);
  const [stop, starts, script] = ['stop', 'starts', 'kept.sh'].map((f) => join(h.tmp, f)) as [string, string, string];
  // Exit 0: a hub that took it for a pass, or read an exit it never saw, would say passed.
  writeFileSync(script, `echo started >> '${starts}'\nuntil [ -f '${stop}' ]; do sleep 0.1; done\nexit 0\n`);
  const { run } = await call(hub, 'cli', 'run.start', { check: 'kept', claim: `claim:${ulid(Date.now())}`, commit: '0'.repeat(40), argv: ['/bin/sh', script], cwd: h.tmp, keep: true }) as { run: string };
  await waitFor(() => existsSync(starts) || undefined, 30_000, `${run} to start`);
  await restartService(hub);
  writeFileSync(stop, '');
  const finished = await waitFor(async () => (await allEvents(hub)).find((e) => e.kind === 'run.finished' && e.data.run === run), 30_000, `${run} to finish`);
  expect(finished.data.outcome).toBe('stopped');
  expect(finished.data.findings).toEqual(['it ended with no hub to read its exit']);
  expect((await allEvents(hub)).filter((e) => e.kind === 'run.started').length, 'never run again').toBe(1);
}, 120_000);

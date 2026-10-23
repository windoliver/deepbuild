// #236 AC13, the contract half: the supervisor is the local implementation of `host@1`, the one contract every
// place that runs work follows: start a run by its token in a folder, with its environment and leases; signal
// its process group; wait for its end and read its exit; and read the host's facts (README, host@1).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { alive, cleanup, ownPidDir, pidsIn, runId, sub, tempDir, waitFor } from './helpers.ts';
import { openWorld } from './world.ts';

afterEach(cleanup, 30_000);

describe('AC13 #236.6e7cc737 the supervisor is host@1\'s local implementation', () => {
  it('AC13 local starts a run in its folder with its environment, signals its process group, waits for its exit and reads the host\'s facts', async () => {
    const dir = tempDir();
    const cwd = sub(dir, 'run');
    const pids = ownPidDir(sub(dir, 'pids'));
    const w = await openWorld();
    try {
      expect(w.sup.name).toBe('local');
      const facts = await w.sup.facts();
      expect(facts).toMatchObject({ host: 'local', platform: process.platform, arch: process.arch });
      expect(facts.cores).toBeGreaterThan(0);
      expect(facts.memory).toBeGreaterThan(0);

      const run = runId();
      const script = 'printf %s "$WHO" > "$0/who"; pwd > "$0/cwd"; /bin/sleep 600 & touch "$0/child.$!"; wait';
      const started = await w.sup.start({ run, cwd, argv: ['/bin/sh', '-c', script, pids], env: { WHO: 'the run' }, grant: { write: [pids] } });
      expect(started.status, JSON.stringify(started)).toBe('started');
      const child = await waitFor(() => pidsIn(pids).child?.[0], 5000, 'the run\'s child');
      expect(readFileSync(join(pids, 'who'), 'utf8'), 'the run got its environment').toBe('the run');
      expect(readFileSync(join(pids, 'cwd'), 'utf8').trim(), 'the run started in its folder').toBe(cwd);
      await w.sup.signal(run, 'SIGTERM');
      const exit = await w.sup.wait(run);
      expect(exit.run).toBe(run);
      expect(exit.signal, 'the run ended on the signal').toBe('SIGTERM');
      await waitFor(() => !alive(child), 3000, `the signal to reach ${child}, a member of the run's group`);
      await w.sup.cleanup(run);
    } finally {
      await w.close();
    }
  }, 60_000);
});

// #580 AC1: on the sample app, the first claim's journey on a green stop whose reply ends the turn runs every start step;
// a second claim changing only src/cart.ts runs no services, install, migrate or seed step, its record naming each as
// reused with its key, and starts only the app; a third changing package-lock.json runs install, migrate and seed
// again, and both installs stay kept. A planted environment that reuses the install after the lockfile changed fails
// environment@1, naming the step and both keys. The truth of what ran is the sample's own scripts' log beside the record.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Bench, failureOf, passed, STEPS, stepOf, type Done } from './helpers.ts';

let bench: Bench | undefined;
afterEach(async () => { await bench?.close(); bench = undefined; }, 300_000);

interface Seen { b: Bench; first: Done; second: Done; third: Done; logs: { first: string[]; second: string[]; third: string[] } }
async function scenario(plant?: string): Promise<Seen> {
  const b = bench = await Bench.open(plant ? { plant } : {});
  const s = await b.session();
  const log = () => b.stepLog().map((l) => l.step);
  const first = await b.whole(s);
  const one = log();
  const second = await b.whole(s);
  const two = log();
  const third = await b.whole(s, {
    change: async () => {
      const path = join(s.cwd, 'package-lock.json');
      await s.call('Write', { file_path: path, content: b.w.lock101 }, { effect: () => writeFileSync(path, b.w.lock101) });
      const manifest = join(s.cwd, 'package.json');
      const text = readFileSync(manifest, 'utf8').replace('dh-wire-1.0.0', 'dh-wire-1.0.1');
      await s.call('Write', { file_path: manifest, content: text }, { effect: () => writeFileSync(manifest, text) });
    },
  });
  return { b, first, second, third, logs: { first: one, second: two.slice(one.length), third: log().slice(two.length) } };
}

function criterion({ b, first, second, third, logs }: Seen): void {
  const steps = (d: Done) => d.served.steps.map((x) => `${x.step} ${x.status}`).join(', ');
  passed(first);
  for (const step of [...STEPS, 'app']) expect(stepOf(first.served, step).status, `the first claim ran ${step} (${steps(first)})`).toBe('ran');
  expect(logs.first.sort(), 'the sample logged install, migrate and seed once each').toEqual(['install', 'migrate', 'seed']);

  passed(second);
  for (const step of STEPS) {
    const was = stepOf(first.served, step);
    const now = stepOf(second.served, step);
    expect(now.status, `the second claim reused ${step} (${steps(second)})`).toBe('reused');
    expect(typeof now.key === 'string' && /[0-9a-f]{12,}/.test(now.key), `its record names ${step}'s key (${now.key})`).toBe(true);
    expect(now.key, `${step}'s key stands, its inputs unchanged`).toBe(was.key);
  }
  expect(logs.second, 'the sample logged no start step on the second claim').toEqual([]);
  expect(stepOf(second.served, 'app').status, 'the second claim started the app').toBe('ran');
  expect(second.app?.pid, 'with a process of its own').toBeGreaterThan(0);
  expect(second.app!.pid, 'the app started for the second run alone').not.toBe(first.app!.pid);
  expect(second.app!.cwd, 'from the run\'s own checkout').toBe(second.served.checkout);
  expect(second.served.checkout, 'never the live worktree').not.toBe(s(second));
  expect(second.app!.linked, 'node_modules is cloned, never linked').toBe(false);

  expect(stepOf(third.served, 'services').status, 'the lockfile changes nothing of the services').toBe('reused');
  for (const step of ['install', 'migrate', 'seed']) {
    expect(stepOf(third.served, step).status, `the third claim ran ${step} (${steps(third)})`).toBe('ran');
    expect(stepOf(third.served, step).key, `${step}'s key changed`).not.toBe(stepOf(second.served, step).key);
  }
  passed(third);
  expect(logs.third.sort(), 'the sample logged install, migrate and seed again').toEqual(['install', 'migrate', 'seed']);
  expect(third.app?.version, 'the run\'s app has the lockfile\'s dependency').toBe('1.0.1');
  const kept = b.kept('node_modules');
  expect(kept.length, `both installs stay kept in the repo's product store (${kept.join(', ')})`).toBe(2);
  for (const d of [first, third]) expect(kept.some((k) => k.endsWith(stepOf(d.served, 'install').product?.key ?? '(no product)')), `the store keeps ${d.run}'s install, by its key`).toBe(true);
}
const s = (d: Done): string => d.s.cwd;

describe('AC1 #580 a claim whose keys hold runs no start step but the app; one whose lockfile changed runs install, migrate and seed again', () => {
  it('AC1 the first claim runs every start step, the second only the app with each step reused by its key, the third install, migrate and seed, and both installs stay kept', async () => {
    criterion(await scenario());
  }, 1_500_000);

  it('AC1 (wrong program) an environment that reuses the install after the lockfile changed (DEEP_HUB_PLANT=env-reuses-stale-install) fails environment@1, naming the step and both keys', async () => {
    let seen: Seen | undefined;
    const failure = await failureOf(async () => { seen = await scenario('env-reuses-stale-install'); criterion(seen); });
    expect(failure, 'the planted environment passed').not.toBeNull();
    expect(failure, 'it fails environment@1').toContain('environment@1');
    expect(failure, 'naming the step').toContain('install');
    const kept = stepOf(seen!.second.served, 'install').key!;
    expect(failure, 'naming the key it reused').toContain(kept);
    const keys = new Set(failure!.match(/[0-9a-f]{12,}/g) ?? []);
    expect(keys.size, `and the key the lockfile makes (keys named: ${[...keys].join(', ')})`).toBeGreaterThanOrEqual(2);
  }, 1_500_000);
});

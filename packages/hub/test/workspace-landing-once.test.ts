import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { Workspaces } from '../src/workspaces.js';
import type { WorkspaceDeps } from '../src/workspaces-port.js';

const home = realpathSync(mkdtempSync('/tmp/landing-once-'));
afterAll(() => rmSync(home, { recursive: true, force: true }));

it('two tasks of one session landing at once make one workspace and tell the agent once', async () => {
  const told: string[] = [];
  const unused = (): never => { throw Error('not reached by a landing'); };
  const deps = {
    root: join(home, '.deepbuild'), now: () => Date.now(), raw: async () => [], append: async () => undefined,
    connection: (extra = {}) => ({ ...extra }), trust: async () => undefined, adopted: () => undefined,
    told: (_session: string, _cwd: string, text: string) => { told.push(text); },
    record: unused, keep: unused, fetch: unused, plugin: unused, rerun: unused, forge: '', token: async () => undefined, repoOf: () => undefined,
  } as unknown as WorkspaceDeps;
  const spaces = new Workspaces(deps);
  const outside = realpathSync(mkdtempSync(join(home, 'outside-')));
  const [a, b] = await Promise.all([
    spaces.land({ session: 's1', cwd: outside, task_ref: 'task:a', text: 'free 200 GB' }),
    spaces.land({ session: 's1', cwd: outside, task_ref: 'task:b', text: 'tidy the downloads' }),
  ]);
  expect(a, 'both tasks land in one workspace').toBe(b);
  expect(told, 'the agent hears where its work lives once').toHaveLength(1);
  expect(told[0]).toContain(a!);
});

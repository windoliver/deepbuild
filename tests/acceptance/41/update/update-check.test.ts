// AC #41 (update check): "With the network down, Check for updates says it couldn't check and gives the last
// check's time; a planted check that reports up to date offline fails."
//
// Surface assumed (the issue and design name no module, so this is the one the tests pin):
//   packages/cli/src/update-check.ts exports
//     checkForUpdate({ fetchManifest: () => Promise<{ version: string }>, current: string, statePath: string,
//                      now: () => Date }) => Promise<{ line: string; status: 'up-to-date' | 'update-available' | 'could-not-check' }>
//   - fetchManifest resolving with a manifest { version } is a check that succeeded; rejecting (offline, refused,
//     timed out) or resolving with something without a string `version` is a check that did not.
//   - the time of the last successful check, as now().toISOString(), is persisted in statePath (any format) and
//     read back by a later call, also a later process.
//   - a failed check returns status 'could-not-check' and a line that contains the last successful check's ISO
//     time, or the word "never" when none succeeded; it never says "up to date" and never overwrites that time.
//   - an up-to-date line says "up to date"; an update-available line names the new version.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

type Result = { line: string; status: 'up-to-date' | 'update-available' | 'could-not-check' };
type Check = (o: {
  fetchManifest: () => Promise<{ version: string }>;
  current: string;
  statePath: string;
  now: () => Date;
}) => Promise<Result>;

const load = async (): Promise<Check> =>
  ((await import('../../../../packages/cli/src/update-check.ts')) as { checkForUpdate: Check }).checkForUpdate;

const dirs: string[] = [];
const state = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'update-check-'));
  dirs.push(d);
  return join(d, 'update-state.json');
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const T1 = new Date('2026-11-01T08:30:00.000Z');
const T2 = new Date('2026-11-05T17:45:10.000Z');
const T3 = new Date('2026-11-06T09:00:00.000Z');
const ok = (version: string) => async () => ({ version });
const offline = async (): Promise<{ version: string }> => {
  throw new Error('getaddrinfo ENOTFOUND updates.example');
};

describe('update check says up to date only after a check that succeeded', () => {
  it('AC14 #41.3e1f79e3 a successful check of the same version says up to date', async () => {
    const check = await load();
    const r = await check({ fetchManifest: ok('1.2.0'), current: '1.2.0', statePath: state(), now: () => T1 });
    expect(r.status).toBe('up-to-date');
    expect(r.line).toMatch(/up to date/i);
  });

  it('AC14 #41.3e1f79e3 a successful check that finds a newer version says so and names it, never up to date', async () => {
    const check = await load();
    const r = await check({ fetchManifest: ok('1.3.0'), current: '1.2.0', statePath: state(), now: () => T1 });
    expect(r.status).toBe('update-available');
    expect(r.line).toContain('1.3.0');
    expect(r.line).not.toMatch(/up to date/i);
  });

  it('AC14 #41.3e1f79e3 offline with no earlier check says it could not check and that it never has, not up to date', async () => {
    const check = await load();
    const r = await check({ fetchManifest: offline, current: '1.2.0', statePath: state(), now: () => T1 });
    expect(r.status).toBe('could-not-check');
    expect(r.line).toMatch(/could(n't| not) check/i);
    expect(r.line).toMatch(/never/i);
    expect(r.line).not.toMatch(/up to date/i);
  });

  it('AC14 #41.3e1f79e3 offline after an earlier success gives that success time, from the state file, not the time of the failed try', async () => {
    const check = await load();
    const statePath = state();
    expect((await check({ fetchManifest: ok('1.2.0'), current: '1.2.0', statePath, now: () => T1 })).status).toBe('up-to-date');
    const r = await check({ fetchManifest: offline, current: '1.2.0', statePath, now: () => T2 });
    expect(r.status).toBe('could-not-check');
    expect(r.line).toMatch(/could(n't| not) check/i);
    expect(r.line).toContain(T1.toISOString());
    expect(r.line).not.toContain(T2.toISOString());
    expect(r.line).not.toMatch(/up to date/i);
    expect(r.line).not.toMatch(/never/i);
  });

  it('AC14 #41.3e1f79e3 a failed check does not move the last check: two failures in a row still give the one success time', async () => {
    const check = await load();
    const statePath = state();
    await check({ fetchManifest: ok('1.2.0'), current: '1.2.0', statePath, now: () => T1 });
    await check({ fetchManifest: offline, current: '1.2.0', statePath, now: () => T2 });
    const r = await check({ fetchManifest: offline, current: '1.2.0', statePath, now: () => T3 });
    expect(r.status).toBe('could-not-check');
    expect(r.line).toContain(T1.toISOString());
  });

  it('AC14 #41.3e1f79e3 a later success moves the last check forward, so the next failure names the later time', async () => {
    const check = await load();
    const statePath = state();
    await check({ fetchManifest: ok('1.2.0'), current: '1.2.0', statePath, now: () => T1 });
    await check({ fetchManifest: ok('1.2.0'), current: '1.2.0', statePath, now: () => T2 });
    const r = await check({ fetchManifest: offline, current: '1.2.0', statePath, now: () => T3 });
    expect(r.line).toContain(T2.toISOString());
    expect(r.line).not.toContain(T1.toISOString());
  });

  it('AC14 #41.3e1f79e3 a refused answer (no usable manifest) is a check that did not succeed, not up to date', async () => {
    const check = await load();
    const statePath = state();
    await check({ fetchManifest: ok('1.2.0'), current: '1.2.0', statePath, now: () => T1 });
    const refused = (async () => ({ error: 'forbidden' })) as unknown as () => Promise<{ version: string }>;
    const r = await check({ fetchManifest: refused, current: '1.2.0', statePath, now: () => T2 });
    expect(r.status).toBe('could-not-check');
    expect(r.line).toContain(T1.toISOString());
    expect(r.line).not.toMatch(/up to date/i);
  });

  it('AC14 #41.3e1f79e3 a failed check on a newer current version than any recorded still never claims up to date', async () => {
    const check = await load();
    const r = await check({ fetchManifest: offline, current: '9.9.9', statePath: state(), now: () => T1 });
    expect(r.status).toBe('could-not-check');
    expect(r.line).not.toMatch(/up to date/i);
  });
});

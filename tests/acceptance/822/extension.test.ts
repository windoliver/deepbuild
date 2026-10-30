// AC3, a call's deadline in the extension host (`within`): a check run's deadline past 2³¹ − 1 ms waits its full
// time, and one that isn't a positive whole number of ms is refused, naming it.
//
// Read as (README, The surface under test): the caller's value is `ctx.deadline` of `ExtensionHost.runCheck(kind,
// spec, ctx)`, which the host gives the call to the package that registered the kind. The package is fixtures/waiter,
// a first-party package loaded in the hub through `@deepbuild/extension-host`'s public entry (install, check, load),
// on the real record, asks core, supervisor and project trust; its check runner notes each call in a file and never
// answers, so only the host's deadline can end the run. The fake clock is Vitest's setTimeout and clearTimeout,
// moving with real time too, turned on once the package is loaded. "Waits its full time" means runCheck hasn't
// returned until the deadline, then returns `overran`; "refused" means the package's runner was never called.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { openAsks } from '../../../packages/asks/src/index.ts';
import type { CheckResult, CheckSpec } from '../../../packages/conformance/src/index.ts';
import { openExtensionHost, openTrust, packageDigest, type ExtensionHost } from '../../../packages/extension-host/src/index.ts';
import { openRecord, type RecordStore } from '../../../packages/record/src/index.ts';
import { openSupervisor, type Supervisor } from '../../../packages/supervisor/src/index.ts';
import { BAD, DAY, FIXTURES, MAX_TIMER, MINUTE, THIRTY_DAYS, advance, fakeClock, namesValue, outcomeOf, realSleep, tempDir, tracked, until } from './helpers.ts';

const KIND = 'ext.test-waiter.wait';
const SPEC: CheckSpec = { kind: KIND, runner: 'node --test', inputs: [], depth: 'unit', oracle: 'code', contract: null };
let record: RecordStore;
let sup: Supervisor;
const hosts: ExtensionHost[] = [];

beforeAll(async () => {
  const dir = tempDir('ext-world');
  record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 2 * DAY } } } });
}, 60_000);
afterEach(() => { vi.useRealTimers(); });
afterAll(async () => {
  for (const h of hosts.splice(0)) await h.close().catch(() => undefined);
  await sup?.close();
  await record?.close();
});

/** fixtures/waiter in a temp folder, `*.fixture` renamed, pointed at its calls file, its digest the host's own. */
function waiter(calls: string): string {
  const dir = tempDir('pkg-waiter');
  cpSync(join(FIXTURES, 'waiter'), dir, { recursive: true });
  for (const name of readdirSync(dir)) if (name.endsWith('.fixture')) renameSync(join(dir, name), join(dir, name.slice(0, -'.fixture'.length)));
  writeFileSync(join(dir, 'waiter.json'), JSON.stringify({ file: calls }));
  const path = join(dir, 'deepbuild.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  manifest.digest = packageDigest(dir);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}
/** A host on its own home with the waiter installed, checked and loaded in the hub as a release package; the file its runner notes calls in. */
async function loaded(): Promise<{ host: ExtensionHost; calls: () => string[] }> {
  const dir = tempDir('ext');
  const home = join(dir, 'deepbuild');
  mkdirSync(home, { recursive: true });
  const file = join(dir, 'calls.jsonl');
  const pkg = waiter(file);
  const m = JSON.parse(readFileSync(join(pkg, 'deepbuild.json'), 'utf8')) as { id: string; version: string };
  const trust = await openTrust({ record, now: Date.now });
  const host = await openExtensionHost({ record, supervisor: sup, trust, home, release: [{ id: m.id, version: m.version, digest: packageDigest(pkg) }], now: Date.now });
  hosts.push(host);
  await host.ready();
  const p = await host.install({ from: pkg, builtBy: null });
  const c = await host.check(p);
  expect(c.passed, `the waiter passes conformance: ${JSON.stringify(c)}`).toBe(true);
  const load = await host.load(p);
  expect(load.status === 'loaded' && load.place, `the waiter loads in the hub: ${JSON.stringify(load)}`).toBe('hub');
  expect((await host.checks()).map((k) => k.kind), 'the waiter registered its kind').toContain(KIND);
  return { host, calls: () => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : []) };
}

describe('AC3 #822 a check run\'s deadline of 30 days in the extension host waits its full time', () => {
  it('AC3 extension host within: runCheck with a deadline of 30 days hasn\'t returned after 24.8 days on a fake clock, and returns overran at 30 days', async () => {
    const { host, calls } = await loaded();
    fakeClock();
    const going = tracked(host.runCheck(KIND, SPEC, { checkout: tempDir('checkout'), deadline: THIRTY_DAYS }));
    expect(await until(() => calls().length > 0, 10_000), 'the package\'s runner was called').toBe(true);

    // Just after the call: Node keeps a delay past 2³¹ − 1 ms as 1 ms, so a deadline raced with it ends the call here.
    await realSleep(1_000);
    expect(going.settled(), `the call returned just after it started: its 30-day deadline fired at once (${JSON.stringify(await Promise.race([going.promise, Promise.resolve(null)]))})`).toBe(false);

    await advance(MAX_TIMER + MINUTE);
    await realSleep(100);
    expect(going.settled(), 'the call returned before 30 days, after 24.8').toBe(false);

    await advance(THIRTY_DAYS - MINUTE - (MAX_TIMER + MINUTE));
    await realSleep(100);
    expect(going.settled(), 'the call returned a minute before 30 days').toBe(false);

    await advance(2 * MINUTE);
    const done = await Promise.race([going.promise, realSleep(30_000).then(() => undefined)]);
    expect(done, 'the call never returned once 30 days passed').toBeDefined();
    expect((done as CheckResult).outcome, `ended at its deadline: ${JSON.stringify(done)}`).toBe('overran');
  }, 120_000);
});

describe('AC3 #822 a check run\'s deadline that is not a positive whole number of ms is refused by the extension host, naming it', () => {
  for (const bad of BAD) {
    it(`AC3 extension host within: runCheck with deadline ${bad.written} is refused before the package's runner is called, naming deadline and ${bad.written}`, async () => {
      const { host, calls } = await loaded();
      const got = await outcomeOf(() => host.runCheck(KIND, SPEC, { checkout: tempDir('checkout'), deadline: bad.value }));
      await realSleep(200);
      expect(calls(), `the package's runner was called for a run with deadline ${bad.written}`).toEqual([]);
      if (!got.threw) {
        const r = got.value as CheckResult;
        expect(['passed', 'overran'], `a refused run neither passed nor ran past a deadline: ${JSON.stringify(r)}`).not.toContain(r.outcome);
      }
      expect(got.text, `the refusal names the field: ${got.text}`).toContain('deadline');
      expect(namesValue(got.text, bad.written), `the refusal names the value ${bad.written} as written: ${got.text}`).toBe(true);
    }, 60_000);
  }
});

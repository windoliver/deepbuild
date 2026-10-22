// #16 AC23 (moved here from #311's AC14): a deep-hook binary built with a planted feature `f_test`. The
// hub lists its features in its hello line; deep-hook (#315) turns off any feature the hub doesn't list. The
// planted build is `cargo build -p deep-hook --features plant-f-test`, which lists f_test among deep-hook's
// features and, only in that build, sends `"f_test": true` whatever the hub lists when DEEP_HOOK_FORCE_F_TEST=1
// is set (README, deep-hook). The test watches the bytes both ways through a forwarded socket the address
// setting names, and compares what deep-hook prints with the unplanted build's and with a run with the hub down.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  allEvents, buildDeepHook, childEnv, cleanup, control, DEEP_HOOK, forwarder, installedRoot, makeHome, newSession, payload, REPO, run, setAddress,
  startHub, stopHub, tempDir, waitFor, type Line, type Ran,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const PLANTED = join(REPO, 'target/plant-f-test/debug/deep-hook');
const lines = (text: string): Line[] => text.split('\n').flatMap((raw) => { try { const l = JSON.parse(raw) as unknown; return typeof l === 'object' && l !== null ? [l as Line] : []; } catch { return []; } });

interface Observed {
  hello: Line | undefined;
  plain: Ran; planted: Ran; plantedRequest: Line | undefined; recorded: boolean;
  forced: Ran; forcedRequest: Line | undefined; refusal: Line | undefined; spooled: boolean;
  down: Ran;
}
async function observe(plant?: string): Promise<Observed> {
  await buildDeepHook();
  await buildDeepHook(['--features', 'plant-f-test', '--target-dir', join(REPO, 'target/plant-f-test')]);
  if (!existsSync(PLANTED)) throw Error(`BLOCKED: the planted build is not at ${PLANTED}`);
  const home = makeHome();
  const hub = await startHub({ home, ...(plant && { plant }) });
  const s = newSession(home, 'claude-code');
  const body = payload(s, 'PreToolUse', { tool_input: { command: 'ls' } });
  const hook = (binary: string, env: Record<string, string> = {}) => run(binary, ['claude-code', 'PreToolUse'], { cwd: s.cwd, env: childEnv(home, env), input: JSON.stringify(body), timeoutMs: 30_000 });
  const through = async () => { const f = await forwarder(tempDir(), hub.socket); setAddress(home, `unix:${f.path}`); return f; };

  let f = await through();
  const plain = await hook(DEEP_HOOK);
  const hello = lines(f.downText())[0];
  await f.close();

  f = await through();
  const planted = await hook(PLANTED);
  const plantedRequest = lines(f.upText()).find((l) => l.event === 'PreToolUse');
  await f.close();

  f = await through();
  const forced = await hook(PLANTED, { DEEP_HOOK_FORCE_F_TEST: '1' });
  const forcedRequest = lines(f.upText()).find((l) => l.event === 'PreToolUse');
  const refusal = lines(f.downText()).find((l) => 'error' in l)?.error as Line | undefined;
  await f.close();

  const cli = await control(hub);
  const recorded = plantedRequest ? await waitFor(async () => (await allEvents(cli)).some((e) => e.id === plantedRequest.id) || undefined, 10_000, 'the planted build\'s event').catch(() => false) : false;
  cli.close();
  const spoolDir = join(installedRoot(home), 'spool');
  const spooled = !!forcedRequest && existsSync(spoolDir) && readdirSync(spoolDir).some((f2) => readFileSync(join(spoolDir, f2), 'utf8').includes(forcedRequest.id as string));

  // The same call with the hub down: the setting names a socket nobody listens on.
  setAddress(home, `unix:${join(tempDir(), 'nobody.sock')}`);
  const down = await hook(DEEP_HOOK);
  await stopHub(hub);
  return { hello, plain, planted, plantedRequest, recorded, forced, forcedRequest, refusal, spooled, down };
}
function negotiated(o: Observed): void {
  expect(o.hello?.features, 'the hub lists its features in its hello').toBeDefined();
  expect(o.hello?.features, 'the hub doesn\'t list f_test').not.toContain('f_test');
  // Not forced: the field is off, and the call is decided as before.
  expect(o.plantedRequest, 'the planted build sent its request').toBeDefined();
  expect(Object.keys(o.plantedRequest ?? {}), 'the planted build sends no f_test field to a hub that doesn\'t list it').not.toContain('f_test');
  expect({ exit: o.planted.code, stdout: o.planted.stdout }, 'its call is decided as before').toEqual({ exit: o.plain.code, stdout: o.plain.stdout });
  expect(o.recorded, 'the hub recorded the planted build\'s call').toBe(true);
  // Forced: the hub refuses it naming the field, and deep-hook acts as with the hub down.
  expect(o.forcedRequest?.f_test, 'the forced request carries f_test').toBe(true);
  expect(o.refusal?.path, `the hub must refuse the forced request naming /f_test; it answered ${JSON.stringify(o.refusal)}`).toBe('/f_test');
  expect({ exit: o.forced.code, stdout: o.forced.stdout }, 'deep-hook acts as with the hub down').toEqual({ exit: o.down.code, stdout: o.down.stdout });
  expect(o.spooled, 'the refused request is spooled, as with the hub down').toBe(true);
}

describe('AC23 #16.6279113a a deep-hook built with a planted feature f_test, against a hub that doesn\'t list it', () => {
  it('AC23 sends no f_test and is decided as before; forced, the hub refuses it naming the field and deep-hook acts as with the hub down', async () => {
    negotiated(await observe());
  }, 900_000);
  it('AC23 (wrong program) a hub that ignores the field fails this test', async () => {
    const o = await observe('ignores-unknown-field');
    expect(() => negotiated(o)).toThrow(/must refuse the forced request naming \/f_test/);
  }, 900_000);
});

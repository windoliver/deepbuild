// AC13 #41.1d9debfb, the app's half: "An app newer than the running hub shows one screen naming the hub as older with its
// fix, and calls nothing the hub doesn't list; a planted app that calls an unlisted method fails, naming the method."
// Scope line: "The hub's hello lists its contract version and features; the app and the CLI check them against the
// methods they call and, on a mismatch, show one screen that names which side is older and the one step that fixes it,
// instead of failing call by call." The CLI's half is tests/acceptance/41/compat.
//
// Surface assumed (the issue and design name no app surface, so this is the one the tests pin):
//   `deep-app --hub-needs`: no window, no hub; prints one JSON line `{"contract": "<major>.<minor>", "features":
//     [<every hub method the app calls>]}` and exits 0. `features` is not empty: the app reads the record from the hub.
//   `deep-app --hub-check`: no window. With HOME set, it connects to the hub at the app's address (`hub.address` in
//     ~/.deepbuild/config.json, else ~/.deepbuild/hub.sock, as crates/deep-app/src/hub.rs reads it today), reads its
//     hello and checks it against what `--hub-needs` prints, then exits 0 within 60 s:
//     - the hello covers the app (same major, an equal or higher minor, every needed method in `features`): it does
//       what the window does on connect (presents ~/.deepbuild/control.token as the app and makes the calls the window
//       makes, whatever each returns) and its first stdout line starts with `hub ok`;
//     - the hub is older (no contract, a lower one, or a needed method missing from `features`): stdout is the one
//       screen the window shows instead: exactly one line names the hub as older (/\bhub\b.*\bolder\b/i), the screen
//       names the hub's contract and the app's (or "none" for a hello without one) or each needed method the hub
//       doesn't list, and its last line is the one step that fixes it, a step on the hub's side (it says to update,
//       upgrade, install, reinstall or restart). No `hub ok`.
//     In every case it never calls a method the hello doesn't list.
//   The cargo feature `plant-calls-unlisted` on deep-app, in no shipped build: `--hub-check` treats every hello as
//     covering the app, shows no screen, and makes the window's calls without checking the hello's features.
// The stand-in hub (helpers.ts) answers as an older running hub would; the real hub of this checkout (the built CLI's
// `deep hub run`, packages/hub/test/hub.ts) must be one the app finds compatible.

import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { withHub } from '../../../../packages/hub/test/hub.js';
import {
  appBinary, childEnv, cleanup, failsWith, parseObject, rootOf, run, setUpHome, shown, standInHub,
  type Hello, type Ran, type StandInHub,
} from './helpers.ts';

afterAll(cleanup, 60_000);
const BUILD = 3_600_000;

interface Needs { contract: string; features: string[] }
async function needs(app: string): Promise<Needs> {
  const h = setUpHome();
  const r = await run(app, ['--hub-needs'], { env: childEnv(h), cwd: h.tmp, timeoutMs: 60_000 });
  const line = parseObject(r.stdout.trim().split('\n').at(-1) ?? '');
  if (r.code !== 0 || !line) expect.fail(`#41 AC13 deep-app --hub-needs must print the app's contract and the methods it calls as one JSON line and exit 0: ${shown(r)}`);
  if (typeof line.contract !== 'string' || !/^\d+\.\d+$/.test(line.contract)) expect.fail(`#41 AC13 deep-app --hub-needs: contract must be "<major>.<minor>": ${JSON.stringify(line)}`);
  if (!Array.isArray(line.features) || !line.features.length || !line.features.every((f: unknown) => typeof f === 'string' && f)) expect.fail(`#41 AC13 deep-app --hub-needs: features must list the hub methods the app calls: ${JSON.stringify(line)}`);
  return { contract: line.contract, features: line.features as string[] };
}

/** A contract older than `contract` with the same shape, or undefined for "0.0". */
function olderThan(contract: string): string | undefined {
  const [major, minor] = contract.split('.').map(Number) as [number, number];
  if (minor > 0) return `${major}.${minor - 1}`;
  if (major > 0) return `${major - 1}.99`;
  return undefined;
}

/** `deep-app --hub-check` in a set-up home whose running hub is the stand-in with `hello`. */
async function check(app: string, hello: Hello): Promise<{ ran: Ran; hub: StandInHub }> {
  const h = setUpHome();
  const hub = await standInHub(join(rootOf(h.home), 'hub.sock'), hello);
  const ran = await run(app, ['--hub-check'], { env: childEnv(h), cwd: h.tmp, timeoutMs: 120_000 });
  await hub.close();
  return { ran, hub };
}

/** Nothing the hub doesn't list was called; the failure names each method that was. */
function calledOnlyListed(hub: StandInHub): void {
  const unlisted = hub.calls().filter((m) => !hub.hello.features.includes(m));
  if (unlisted.length) expect.fail(`#41 AC13 the app called ${[...new Set(unlisted)].join(', ')}, which the hub's hello doesn't list (it lists ${JSON.stringify(hub.hello.features)})`);
}

/** The one screen naming the hub as older, with `named` in it and the fix as its last line. */
function olderScreen(ran: Ran, named: string[]): void {
  if (ran.code !== 0 || ran.timedOut) expect.fail(`#41 AC13 deep-app --hub-check must show the screen and exit 0 within its time: ${shown(ran)}`);
  if (ran.ms > 60_000) expect.fail(`#41 AC13 deep-app --hub-check took ${ran.ms} ms; it must answer within 60 s`);
  const lines = ran.stdout.trim().split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.some((l) => /^hub ok/.test(l))) expect.fail(`#41 AC13 with an older hub the app must not say hub ok: ${shown(ran)}`);
  const naming = lines.filter((l) => /\bhub\b.*\bolder\b/i.test(l));
  if (naming.length !== 1) expect.fail(`#41 AC13 the screen must name the hub as older in exactly one line, once: ${naming.length} lines do: ${shown(ran)}`);
  for (const n of named) if (!ran.stdout.includes(n)) expect.fail(`#41 AC13 the screen must name ${JSON.stringify(n)}: ${shown(ran)}`);
  const fix = lines.at(-1) ?? '';
  if (!/\b(update|upgrade|install|reinstall|restart)\b/i.test(fix)) expect.fail(`#41 AC13 the screen's last line must be the one step that fixes the older hub: it is ${JSON.stringify(fix)}`);
}

describe('AC13 #41.1d9debfb the app against an older running hub', () => {
  it('AC13 #41.1d9debfb with a hub that lists the app\'s contract and every method it calls, the app says hub ok, calls the hub, and calls only listed methods', async () => {
    const app = await appBinary();
    const n = await needs(app);
    const { ran, hub } = await check(app, { contract: n.contract, features: n.features });
    calledOnlyListed(hub);
    if (ran.code !== 0 || !/^hub ok/.test(ran.stdout.trim())) expect.fail(`#41 AC13 with a hub that covers the app, deep-app --hub-check must say hub ok and exit 0: ${shown(ran)}`);
    expect(ran.stdout).not.toMatch(/\bolder\b/i);
    expect(hub.lines.some((l) => l.hello === 'app'), 'the app presents itself to a hub that covers it').toBe(true);
    expect(hub.calls().length, 'the app makes the calls the window makes on connect').toBeGreaterThan(0);
  }, BUILD);

  it('AC13 #41.1d9debfb with a hub on an older contract, the app shows one screen naming the hub as older, both contracts and the fix, and calls nothing the hub doesn\'t list', async () => {
    const app = await appBinary();
    const n = await needs(app);
    const old = olderThan(n.contract);
    if (!old) expect.fail(`#41 AC13 the app's contract ${n.contract} leaves no older one to test; it must be above 0.0`);
    const { ran, hub } = await check(app, { contract: old, features: n.features });
    calledOnlyListed(hub);
    olderScreen(ran, [old, n.contract]);
  }, BUILD);

  it('AC13 #41.1d9debfb with a hub whose hello has no contract and lists nothing, the app shows the older-hub screen and calls nothing', async () => {
    const app = await appBinary();
    const n = await needs(app);
    const { ran, hub } = await check(app, { features: [] });
    calledOnlyListed(hub);
    expect(hub.calls()).toEqual([]);
    olderScreen(ran, [n.contract]);
  }, BUILD);

  it('AC13 #41.1d9debfb with a hub of the app\'s contract that lacks one method the app calls, for each such method, the screen names the hub as older and the method, and the app never calls it', async () => {
    const app = await appBinary();
    const n = await needs(app);
    for (const missing of n.features) {
      const { ran, hub } = await check(app, { contract: n.contract, features: n.features.filter((f) => f !== missing) });
      calledOnlyListed(hub);
      olderScreen(ran, [missing]);
    }
  }, BUILD);

  it('AC13 #41.1d9debfb against the real hub of this checkout, the app finds it compatible: hub ok, no older screen', async () => {
    const app = await appBinary();
    await withHub(async (_root, home) => {
      const env = { ...childEnv(setUpHome()), HOME: home };
      const ran = await run(app, ['--hub-check'], { env, cwd: home, timeoutMs: 120_000 });
      if (ran.code !== 0 || !/^hub ok/.test(ran.stdout.trim())) expect.fail(`#41 AC13 the app and the hub built from one checkout must agree: deep-app --hub-check against the running hub must say hub ok: ${shown(ran)}`);
      expect(ran.stdout).not.toMatch(/\bolder\b/i);
    });
  }, BUILD);

  it('AC13 #41.1d9debfb planted: an app that calls without checking the hello (plant-calls-unlisted) fails this test, naming the method it called', async () => {
    const app = await appBinary();
    const n = await needs(app);
    // The method the real app calls first against a hub that covers it: one the planted app is sure to call too.
    const covered = await check(app, { contract: n.contract, features: n.features });
    const first = covered.hub.calls()[0];
    if (!first) expect.fail(`#41 AC13 the app made no call to a hub that covers it, so the planted app can't be shown to call an unlisted one: ${shown(covered.ran)}`);
    const planted = await appBinary('plant-calls-unlisted');
    const { ran, hub } = await check(planted, { contract: n.contract, features: n.features.filter((f) => f !== first) });
    const escaped = first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    await failsWith(() => { calledOnlyListed(hub); olderScreen(ran, [first]); }, new RegExp(`^#41 AC13 the app called (.*, )?${escaped}(,|\\b)`));
  }, BUILD);
});

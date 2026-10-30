// AC9, AC10, AC11, AC14, AC24: `deep setup`, `deep doctor` and Codex's own hook list (the real codex in a scratch home).
import { lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, symlinkSync, watch, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AC, allEvents, begin, cleanup, codexHook, control, deep, doctor, editStopTimeout, hooksList, hubWithSetup, isDeepBuild, LOGIN_SECRET, makeHome, MINUTE, newThread, ourEntries, shown, slowLane, stopEntry, STOP_TIMEOUT_S, trustAll, waitFor,
} from './helpers.ts';

afterEach(cleanup, 60_000);
const ours = (list: Awaited<ReturnType<typeof hooksList>>) => list.filter((l) => isDeepBuild(l.command));

describe(`${AC[9]} The output of codex login status is never printed or logged; only its exit code is read`, () => {
  it(`${AC[9]} doctor and the hub read the exit code: the secret-shaped line the stand-in prints reaches no output and no file, and the exit code decides sign-in both ways`, async () => {
    const h = makeHome();
    const hub = await hubWithSetup(h);
    const r = await doctor(h);
    expect(readFileSync(h.codexLog, 'utf8'), `${AC[9]} doctor really ran codex login status`).toContain('login status');
    const everything = [r.stdout, r.stderr, hub.output(), JSON.stringify(await allEvents(hub))].join('\n');
    expect(everything.includes(LOGIN_SECRET), `${AC[9]} the login output reached an output or the record`).toBe(false);
    const files: string[] = [];
    const walk = (d: string) => { for (const n of readdirSync(d, { withFileTypes: true })) { if (n.isDirectory()) walk(join(d, n.name)); else if (n.isFile()) files.push(join(d, n.name)); } };
    walk(h.root);
    expect(files.filter((f) => readFileSync(f).includes(LOGIN_SECRET)), `${AC[9]} no file under ~/.deepbuild holds it`).toEqual([]);
    expect(r.stdout, `${AC[9]} signed in, from exit 0`).toMatch(/codex\.sign_in/);
    const out = makeHome({ loginExit: 1 });
    const outHub = await hubWithSetup(out);
    const signedOut = await doctor(out);
    expect(signedOut.stdout, `${AC[9]} signed out, from exit 1, naming only the code: ${shown(signedOut)}`).toMatch(/exits 1/);
    expect(`${signedOut.stdout}${signedOut.stderr}${outHub.output()}`.includes(LOGIN_SECRET)).toBe(false);
  }, 240_000);
});

describe(`${AC[10]} A Codex config.toml with hooks = false under [features] shows in deep doctor as hooks that won't run there, naming the setting, and deep doctor exits non-zero`, () => {
  it(`${AC[10]} doctor names [features] hooks = false, exits non-zero, and setup never flips your setting`, async () => {
    const h = makeHome();
    writeFileSync(h.configToml, '[features]\nhooks = false\n');
    await hubWithSetup(h);
    const r = await doctor(h);
    expect(r.stdout, `${AC[10]} a finding names the setting: ${shown(r)}`).toMatch(/hooks\s*=\s*false/);
    expect(r.stdout, `${AC[10]} and the table it sits in`).toMatch(/features/);
    expect(r.stdout, `${AC[10]} and says the hooks won't run`).toMatch(/won't run|will not run/i);
    expect(r.code, `${AC[10]} doctor exits non-zero: ${shown(r)}`).not.toBe(0);
    expect(readFileSync(h.configToml, 'utf8'), `${AC[10]} setup never flips your hooks = false`).toMatch(/hooks = false/);
  }, 180_000);
});

describe(`${AC[11]} With ~/.codex/hooks.json a symlink into a dotfiles folder, setup writes its entries into the linked file through a temporary file beside it, and the link is still the same symlink afterwards; a setup that renames its temporary file over the link replaces the link with a plain file and fails this test, naming the path`, () => {
  it(`${AC[11]} the link stays the same symlink; the linked file holds your entry then DeepBuild's; a temporary file appeared beside the linked file, none beside the link`, async () => {
    const h = makeHome();
    const dotfiles = join(h.tmp, 'dotfiles', 'codex');
    mkdirSync(dotfiles, { recursive: true });
    const target = join(dotfiles, 'hooks.json');
    writeFileSync(target, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: '/usr/bin/true', timeout: 5 }] }] } }, null, 2));
    symlinkSync(target, h.hooksFile);
    const seenByTarget = new Set<string>();
    const seenByLink = new Set<string>();
    const w1 = watch(dotfiles, (_e, n) => { if (n && n !== 'hooks.json') seenByTarget.add(n); });
    const w2 = watch(h.codexHome, (_e, n) => { if (n && n !== 'hooks.json' && /hooks/.test(n)) seenByLink.add(n); });
    await hubWithSetup(h);
    await new Promise((r) => setTimeout(r, 300));
    w1.close(); w2.close();
    expect(lstatSync(h.hooksFile).isSymbolicLink(), `${AC[11]} ${h.hooksFile} must still be a symlink, but setup replaced it with a plain file`).toBe(true);
    expect(readlinkSync(h.hooksFile), `${AC[11]} ${h.hooksFile} points where it did`).toBe(target);
    const linked = JSON.parse(readFileSync(target, 'utf8')) as { hooks: { Stop: { hooks: { command: string }[] }[] } };
    const stops = linked.hooks.Stop.flatMap((g) => g.hooks.map((x) => x.command));
    expect(stops.some(isDeepBuild), `${AC[11]} the linked file ${target} holds DeepBuild's Stop entry: ${JSON.stringify(stops)}`).toBe(true);
    expect(stops[0], `${AC[11]} your entry stays first, ours after`).toBe('/usr/bin/true');
    expect(seenByTarget.size, `${AC[11]} a temporary file beside the linked file (${dotfiles})`).toBeGreaterThan(0);
    expect([...seenByLink], `${AC[11]} none beside the link`).toEqual([]);
  }, 180_000);
});

describe(`${AC[14]} After a DeepBuild update, its entries in hooks.json are byte-identical and Codex's hook list still reports them trusted; changing one entry's timeout in a test makes health show that entry as modified within one session`, () => {
  it(`${AC[14]} entries name a fixed path; a second setup (the update) leaves the file byte-identical and Codex's hooks/list trusted; a changed timeout shows as modified in health`, async () => {
    const h = makeHome({ real: true });
    const hub = await hubWithSetup(h);
    expect(ourEntries(h).length, `${AC[14]} setup wrote entries in ${h.hooksFile}`).toBeGreaterThan(0);
    const before = readFileSync(h.hooksFile);
    const trusted = ours(await trustAll(h));
    expect(trusted.map((l) => l.trustStatus), `${AC[14]} approved once`).toEqual(trusted.map(() => 'trusted'));
    const again = await deep(h, ['setup']);
    expect(again.code, shown(again)).toBe(0);
    expect(readFileSync(h.hooksFile).equals(before), `${AC[14]} byte-identical after the update`).toBe(true);
    const after = ours(await hooksList(h));
    expect(after.map((l) => `${l.key} ${l.trustStatus}`), `${AC[14]} still trusted in Codex's own list`).toEqual(trusted.map((l) => `${l.key} trusted`));
    editStopTimeout(h, 1200);
    const t = newThread(h);
    await begin(h, t);
    const health = await waitFor(async () => { const v = JSON.stringify(await control(hub, 'health')); return /modified/i.test(v) && v; }, 15_000, 'health to show the entry as modified').catch(async () => JSON.stringify(await control(hub, 'health')));
    expect(health, `${AC[14]} health shows the Stop entry as modified within the session`).toMatch(/Stop[^"]*modified|modified[^"]*Stop/i);
    await codexHook(h, t, 'Stop');
  }, 240_000);
});

describe(`${AC[24]} Running setup again after the slow lane's expected time changes from 20 to 30 minutes leaves Codex's Stop hook entry byte-identical at 45 minutes, and Codex's hook list still reports it trusted; a setup that writes the new expected time into the entry makes Codex ask for trust again, and that version fails this test, naming the entry`, () => {
  it(`${AC[24]} the Stop entry stays 45 minutes and byte-identical, trusted in hooks/list, across 20 to 30 minutes`, async () => {
    const h = makeHome({ real: true });
    slowLane(h, 20 * MINUTE);
    await hubWithSetup(h);
    const first = stopEntry(h);
    expect(first?.hook.timeout, `${AC[24]} setup sets the Stop entry at 45 minutes: ${JSON.stringify(first)}`).toBe(STOP_TIMEOUT_S);
    const bytes = readFileSync(h.hooksFile);
    await trustAll(h);
    slowLane(h, 30 * MINUTE);
    const again = await deep(h, ['setup']);
    expect(again.code, shown(again)).toBe(0);
    const name = `the Stop entry ${JSON.stringify(stopEntry(h)?.hook)}`;
    expect(readFileSync(h.hooksFile).equals(bytes), `${AC[24]} ${name} changed, so Codex asks for trust again`).toBe(true);
    const stop = (await hooksList(h)).find((l) => l.eventName === 'stop' && isDeepBuild(l.command));
    expect(stop?.timeoutSec, `${AC[24]} ${name} at 45 minutes in Codex's list`).toBe(STOP_TIMEOUT_S);
    expect(stop?.trustStatus, `${AC[24]} ${name} trusted`).toBe('trusted');
  }, 240_000);
});

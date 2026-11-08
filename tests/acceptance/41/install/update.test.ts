// AC5 #41.115d2abb: "An update that switches versions leaves every hook entry DeepBuild wrote byte-identical, since
// each names a fixed command path the switch keeps."
// AC16 #41.539bf83d: "After two updates, the login service still starts the hub, by its definition read back; a
// planted setup that pins a version's folder starts nothing once that folder is removed and fails."
// (Scope: "The login service points at a path every update keeps (the versions folder's current link), never a
// version's own folder." Design, Editing agent settings: "Each hook entry names a fixed command path that every update
// keeps".)
//
// Surface assumed (the issue and design name no code surface, so this is the one the tests pin):
//   - The installer: packages/hub/src/installer.ts's installVersion, as installer.test.ts pins it. `home` is
//     DeepBuild's folder, `<HOME>/.deepbuild` here, so versions go in `<HOME>/.deepbuild/versions/<v>/` and the link is
//     `<HOME>/.deepbuild/versions/current`.
//   - A version folder holds the release's two programs, `bin/deep` and `bin/deep-hook`, each executable.
//   - The real `deep setup`, run as the installed version's `<HOME>/.deepbuild/versions/current/bin/deep setup` (the
//     test release's bin/deep hands off to this checkout's built CLI), in a home where that link exists, writes every
//     entry through a fixed path: deep-hook as `<HOME>/.deepbuild/bin/deep-hook` or
//     `<HOME>/.deepbuild/versions/current/bin/deep-hook`, and the deep command as `<HOME>/.deepbuild/bin/deep` or
//     `<HOME>/.deepbuild/versions/current/bin/deep`, each reaching the current version through its links. That covers
//     Claude Code's hook entries and status line (~/.claude/settings.json), its MCP servers (~/.claude.json), Codex's
//     hooks.json and config.toml MCP server, and the login service's program. No entry names a version's own folder or
//     the checkout. An entry run through Node names its script as the program, which must meet the same rule.
//   - The login service definition is where `deep hub start` writes it today: ~/Library/LaunchAgents/
//     com.deepbuild.hub.plist (launchd) or ~/.config/systemd/user/deepbuild-hub.service; setup hands it to the service
//     manager through DEEP_HUB_LAUNCHER, which a stand-in (fixtures/launcher.mjs) answers by starting the program the
//     definition read back from disk names.
//   - An update here is installVersion of the next version, then the new version's own `deep setup` (as its first
//     `deep` command would run it): every file above must come out byte-identical.
// The release programs print their version under DEEP_TEST_PROBE (helpers.ts), so "starts the newest version" is read
// from what the entry, run as its agent runs it, prints. A planted pinning setup is judged in twins.test.ts.

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  answers, childEnv, cleanup, definitionFile, entriesOf, installer, keys, launched, makeHome, notFixed, notNewest, readDefinition,
  release, run, shown, snapshot, stop, waitFor, type Home,
} from './helpers.js';

const AC5 = 'AC5 #41.115d2abb';
const AC16 = 'AC16 #41.539bf83d';
const VERSIONS = ['1.0.0', '2.0.0', '3.0.0'];
const NEWEST = '3.0.0';

let h: Home;
/** The files setup wrote, after the first setup and after each update's. */
const snapshots: { after: string; files: Record<string, string | null> }[] = [];

beforeAll(async () => {
  h = makeHome();
  const install = await installer();
  const k = keys();
  for (const v of VERSIONS) {
    await install({ home: h.root, ...release(v, k.privateKey), publicKey: k.publicKey });
    const deep = join(h.root, 'versions', 'current', 'bin', 'deep');
    const r = await run(deep, ['setup'], { env: childEnv(h), cwd: h.tmp, timeoutMs: 240_000 });
    if (r.code !== 0) throw Error(`BLOCKED: ${deep} setup (version ${v}) must exit 0: ${shown(r)}`);
    snapshots.push({ after: v === VERSIONS[0] ? `the first setup, at ${v}` : `the update to ${v} and its setup`, files: snapshot(h) });
  }
}, 900_000);
afterAll(async () => { await cleanup(h ? [h] : []); }, 30_000);

/** The two older version folders removed, as a rollback window passing would: only the newest is left. */
const removeOlder = () => { for (const v of VERSIONS.slice(0, -1)) rmSync(join(h.root, 'versions', v), { recursive: true, force: true }); };

describe(`${AC5} hook entries across two updates`, () => {
  it(`${AC5} every file holding an entry DeepBuild wrote is there after setup and byte-identical after each update`, () => {
    const first = snapshots[0]!;
    for (const [name, text] of Object.entries(first.files)) expect(text, `${first.after} must have written ${name}`).not.toBeNull();
    for (const s of snapshots.slice(1)) {
      for (const [name, text] of Object.entries(s.files)) {
        expect(text === first.files[name], `${name} after ${s.after} must be byte-identical to ${first.after}'s: before ${JSON.stringify(first.files[name]?.slice(0, 2000))}, after ${JSON.stringify(text?.slice(0, 2000))}`).toBe(true);
      }
    }
  });

  it(`${AC5} each entry names a fixed path under the versions folder's current link or DeepBuild's bin, never a version's own folder, and reaches the newest version`, () => {
    const entries = entriesOf(h);
    expect(entries.filter((e) => e.where.startsWith('Claude Code settings.json')).length, 'Claude Code settings.json must hold DeepBuild\'s hook entries').toBeGreaterThan(0);
    expect(entries.filter((e) => e.where.startsWith('Codex hooks.json')).length, 'Codex hooks.json must hold DeepBuild\'s hook entries').toBeGreaterThan(0);
    const wrong = entries.map((e) => notFixed(e, h.root, NEWEST)).filter((w): w is string => w !== undefined);
    expect(wrong, `${wrong.length} of ${entries.length} entries don't name a fixed path every update keeps`).toEqual([]);
  });

  it(`${AC5} with the older version folders removed, every entry, run as its agent runs it, starts the newest version`, () => {
    removeOlder();
    const entries = entriesOf(h);
    // An entry that doesn't name a fixed path is judged by that alone and never run: on this machine it could start a real hub.
    const wrong = entries.map((e) => notFixed(e, h.root, NEWEST) ?? notNewest(e, NEWEST)).filter((w): w is string => w !== undefined);
    expect(wrong, `${wrong.length} of ${entries.length} entries don't start ${NEWEST}`).toEqual([]);
  }, 120_000);
});

describe(`${AC16} the login service after two updates`, () => {
  it(`${AC16} its definition read back names a fixed path that reaches the newest version, and its program starts ${NEWEST}`, () => {
    removeOlder();
    const file = definitionFile(h);
    expect(existsSync(file), `setup must have written the login service definition at ${file}`).toBe(true);
    const { argv, env } = readDefinition(readFileSync(file, 'utf8'), file.endsWith('.plist'));
    const e = { where: `the login service definition ${file}`, argv, env };
    expect(notFixed(e, h.root, NEWEST)).toBeUndefined();
    expect(notNewest(e, NEWEST)).toBeUndefined();
  }, 60_000);

  it(`${AC16} handed to the service manager again, the definition read back starts a hub that answers, through ${NEWEST}'s deep`, async () => {
    removeOlder();
    const file = definitionFile(h);
    expect(existsSync(file), `setup must have written the login service definition at ${file}`).toBe(true);
    const { argv, env } = readDefinition(readFileSync(file, 'utf8'), file.endsWith('.plist'));
    // Judged before anything starts: a definition naming the checkout's CLI would start a hub that isn't the install's.
    expect(notFixed({ where: `the login service definition ${file}`, argv, env }, h.root, NEWEST)).toBeUndefined();
    const socket = join(h.root, 'hub.sock');
    await stop(launched(h));
    expect(await waitFor(async () => !(await answers(socket)), 15_000), `the hub the first setup started must stop before the login service starts it again`).toBe(true);
    const ran = join(h.tmp, 'ran.log');
    const before = existsSync(ran) ? readFileSync(ran, 'utf8').length : 0;
    const r = await run(childEnv(h).DEEP_HUB_LAUNCHER!, [file], { env: childEnv(h), cwd: h.tmp, timeoutMs: 30_000 });
    expect(r.code, `the service manager stand-in must start the program the definition names: ${shown(r)}`).toBe(0);
    expect(await waitFor(() => answers(socket), 30_000), `the login service must start the hub: none answered at ${socket} within 30 s`).toBe(true);
    const started = (existsSync(ran) ? readFileSync(ran, 'utf8').slice(before) : '').split('\n').filter((l) => / deep hub run\b/.test(l));
    expect(started.length, 'the hub must have been started through a version\'s bin/deep').toBeGreaterThan(0);
    expect(started.every((l) => l.startsWith(`${NEWEST} `)), `the hub must start through ${NEWEST}'s deep: ${JSON.stringify(started)}`).toBe(true);
  }, 90_000);
});

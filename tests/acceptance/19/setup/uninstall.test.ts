// AC23 #19.abfcb227 `deep setup --undo`, once the OS confirms you, also unloads and removes the hub's login service,
// the MCP registration, the skill and the status line forwarder, restoring your own status line command, and keeps
// `~/.deepbuild/` with the record, evidence and wiki, saying where they are; an undo that leaves the login service
// in place starts the hub again at the next login and fails this test, naming the service.
//
// Setup starts the hub through its login service, here the launchd stand-in (README: The login service), so the
// service is really loaded and its program really runs. After a confirmed undo the test logs you out and in again
// as launchd does, loading every plist left in ~/Library/LaunchAgents, and no hub may start.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { openRecord } from '../../../../packages/record/src/index.ts';
import {
  Claude, MY_STATUS_LINE, agentsDir, answers, changes, cleanup, control, deepMcpServers, deepSkills, eventIds, forwarderInstalled, hubJobs, hubPlists,
  installedHub, makeHome, mcpCalls, newSession, onMac, payload, readSettings, relogin, rootOf, seedYours, setup, shown, skillsDir, sleep, snapshot,
  socketOf, typedPrompt, undo, waitFor,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const PLANT = 'undo-keeps-login-service';
/** A 1×1 PNG, pasted into the evidence store as the app pastes an image. */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function uninstall(env: Record<string, string | undefined> = {}): Promise<void> {
  onMac();
  const { tmp, home } = makeHome();
  seedYours(home);
  const yourSkills = snapshot(skillsDir(home));
  const repo = join(tmp, 'shop');
  mkdirSync(repo);
  await setup(home, { env, cwd: repo });
  await installedHub(home);

  // The controls: setup installed each of the four things the undo must remove.
  const services = hubPlists(home);
  if (!services.length || !hubJobs(home).length) expect.fail(`deep setup must register the hub's login service in ${agentsDir(home)} and load it (the control): ${JSON.stringify({ services, jobs: hubJobs(home) })}`);
  const registered = [...deepMcpServers(home), ...mcpCalls(home).added];
  if (!registered.length) expect.fail(`deep setup must register DeepBuild's MCP server at user scope, in ~/.claude.json or through claude mcp add (the control)`);
  if (!deepSkills(home).length) expect.fail(`deep setup must install DeepBuild's skill under ${skillsDir(home)} (the control)`);
  if (!forwarderInstalled(readSettings(home))) expect.fail(`deep setup must install the status line forwarder as ~/.claude/settings.json's statusLine (the control): ${JSON.stringify(readSettings(home).statusLine)}`);

  // What ~/.deepbuild holds by the undo: a session's events in the record, a pasted image in the evidence, a wiki page.
  const claude = Claude.start(home, env);
  const s = newSession(home, repo);
  await claude.hook('SessionStart', payload(s, 'SessionStart'));
  typedPrompt(s, 'Look around.');
  await claude.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: 'Look around.' }));
  const before = await waitFor(async () => { const ids = await eventIds(home); return ids.length >= 2 && ids; }, 30_000, 'the session\'s events in the record');
  await control(home, (conn) => conn.call('evidence.paste', { bytes: PNG, type: 'png' }), 'app');
  mkdirSync(join(rootOf(home), 'wiki'), { recursive: true });
  writeFileSync(join(rootOf(home), 'wiki', 'my-notes.md'), '# My notes\n\nThe shop runs on port 4100.\n');
  const kept = (dir: string) => snapshot(join(rootOf(home), dir));
  const evidence = kept('evidence');
  const wiki = kept('wiki');
  if (!evidence.size) throw Error(`BLOCKED: the evidence store under ${rootOf(home)} holds nothing to keep`);

  const undone = await undo(home, { env });
  expect(undone.code, `AC23 deep setup --undo, confirmed, must exit 0: ${shown(undone)}`).toBe(0);

  // The login service: unloaded, its definition gone, and a new login starts no hub.
  const left = hubPlists(home);
  const loaded = hubJobs(home);
  const names = services.map((x) => `${x.label} (${x.file})`).join(', ');
  if (left.length || loaded.length) {
    expect.fail(`AC23 deep setup --undo must unload and remove the hub's login service ${names}: ${left.length ? `its definition is still at ${left.map((x) => x.file).join(', ')}` : ''}${loaded.length ? ` launchd still has ${loaded.map((j) => j.label).join(', ')} loaded` : ''}; it starts the hub again at the next login`);
  }
  relogin(home);
  await sleep(1500);
  if (hubJobs(home).length || (await answers(socketOf(home)))) {
    expect.fail(`AC23 after deep setup --undo, the next login started the hub again through the login service ${names}: ${JSON.stringify(hubJobs(home))}`);
  }

  // The MCP registration, the skill and the status line forwarder: gone, your own back.
  expect(deepMcpServers(home), `AC23 deep setup --undo must remove DeepBuild's MCP server from ~/.claude.json`).toEqual([]);
  const { added, removed } = mcpCalls(home);
  expect(added.filter((name) => !removed.includes(name)), `AC23 deep setup --undo must remove each MCP server setup added through claude mcp add`).toEqual([]);
  expect(deepSkills(home), `AC23 deep setup --undo must remove DeepBuild's skill from ${skillsDir(home)}`).toEqual([]);
  expect(changes(yourSkills, snapshot(skillsDir(home))), `AC23 deep setup --undo must leave your own skills as they were`).toEqual([]);
  const settings = readSettings(home);
  expect(forwarderInstalled(settings), `AC23 deep setup --undo must remove the status line forwarder: ${JSON.stringify(settings.statusLine)}`).toBe(false);
  expect(settings.statusLine, 'AC23 deep setup --undo must restore your own status line command').toEqual(MY_STATUS_LINE);

  // ~/.deepbuild stays, with the record, the evidence and the wiki, and the undo says where.
  expect(existsSync(join(rootOf(home), 'ledger.db')), `AC23 deep setup --undo must keep the record, ${join(rootOf(home), 'ledger.db')}`).toBe(true);
  const record = await openRecord({ path: join(rootOf(home), 'ledger.db'), now: () => Date.now() });
  try {
    const after = new Set((await record.read({ after: 0, limit: 1_000_000 })).map((e) => e.id));
    expect(before.filter((id) => !after.has(id)), 'AC23 deep setup --undo must keep every event of the record').toEqual([]);
  } finally {
    await record.close();
  }
  const lost = (was: Map<string, string>, now: Map<string, string>) => [...was].filter(([path, v]) => now.get(path) !== v).map(([path]) => path);
  expect(lost(evidence, kept('evidence')), `AC23 deep setup --undo must keep the evidence under ${rootOf(home)}`).toEqual([]);
  expect(lost(wiki, kept('wiki')), `AC23 deep setup --undo must keep the wiki under ${rootOf(home)}`).toEqual([]);
  const said = `${undone.stdout}\n${undone.stderr}`;
  expect(said.includes(rootOf(home)) || said.includes('~/.deepbuild'), `AC23 deep setup --undo must say where it kept ~/.deepbuild (${rootOf(home)}): ${shown(undone)}`).toBe(true);
  expect(readFileSync(join(rootOf(home), 'wiki', 'my-notes.md'), 'utf8')).toContain('port 4100');
}

describe('AC23 #19.abfcb227 `deep setup --undo`, once the OS confirms you, also unloads and removes the hub\'s login service, the MCP registration, the skill and the status line forwarder, restoring your own status line command, and keeps `~/.deepbuild/` with the record, evidence and wiki, saying where they are; an undo that leaves the login service in place starts the hub again at the next login and fails this test, naming the service', () => {
  it('AC23 #19.abfcb227 a confirmed deep setup --undo unloads and removes the login service (no hub at the next login), removes the MCP registration, the skill and the forwarder, restores your status line, and keeps the record, evidence and wiki, saying where', async () => {
    await uninstall();
  }, 600_000);

  it(`AC23 #19.abfcb227 (wrong program) an undo that leaves the login service in place (${PLANT}) fails this test, naming the service`, async () => {
    let failure = '';
    try { await uninstall({ DEEP_HUB_PLANT: PLANT }); } catch (error) { failure = (error as Error).message; }
    expect(failure, `the login-service check must fail on ${PLANT}`).toMatch(/^AC23 (deep setup --undo must unload and remove the hub's login service|after deep setup --undo, the next login started the hub again through the login service) \S+ \(/);
  }, 600_000);
});

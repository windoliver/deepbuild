// #16 AC7: the hub runs as a per-user service, never as a child of the terminal that started it; it ignores
// hangups and records why it stopped. `deep hub start` installs the login service definition under $HOME and
// hands it to the service manager; here $DEEP_HUB_LAUNCHER (fixtures/launcher.mjs) stands in for launchd or
// systemd, so no real service is touched. Closing a terminal is a hangup to its process group, then a kill of
// that group, on a shell this test started in a session of its own (README, The service).
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  alive, allEvents, childEnv, cleanup, CLI, control, FIXTURES, health, installedRoot, makeHome, NODE, own, ownFromFile, REPO, sleep, startHub,
  stopHub, tempDir, waitFor, type Conn,
} from './helpers.ts';

afterEach(cleanup, 60_000);

function launcher(): { path: string; log: string } {
  const dir = tempDir();
  const path = join(dir, 'launcher');
  writeFileSync(path, `#!/bin/sh\nexec "${NODE}" "${join(FIXTURES, 'launcher.mjs')}" "$@"\n`);
  chmodSync(path, 0o755);
  return { path, log: join(dir, 'launched.pids') };
}
const definitionFolder = (home: string) => (process.platform === 'darwin' ? join(home, 'Library/LaunchAgents') : join(home, '.config/systemd/user'));

describe('AC7 #16.d8339694 closing the terminal or SSH session that started the hub leaves it running; every stop records its reason', () => {
  it('AC7 started by `deep hub start`, the hub outlives the terminal that started it and its hangups, with the secret store and the network still reachable', async (ctx) => {
    const home = makeHome();
    const root = installedRoot(home);
    const l = launcher();
    // The terminal: a shell, leader of a session of its own, that runs `deep hub start` and stays open.
    const terminal = spawn('/bin/sh', ['-c', '"$0" "$@"; exec sleep 600', NODE, CLI, 'hub', 'start'], {
      cwd: REPO, env: childEnv(home, { DEEP_HUB_LAUNCHER: l.path, DEEP_TEST_LAUNCHER_LOG: l.log }), detached: true, stdio: 'ignore',
    });
    own(terminal.pid);
    const socket = join(root, 'hub.sock');
    let cli: Conn = await waitFor(async () => { try { return await control({ socket, root }); } catch { return undefined; } }, 30_000, 'the hub `deep hub start` started');
    const before = await health(cli);
    cli.close();
    ownFromFile(l.log);
    own(before.pid as number);

    // The login service definition it installed under $HOME, naming `deep hub run`.
    const folder = definitionFolder(home);
    const files = existsSync(folder) ? readdirSync(folder).filter((f) => f.endsWith(process.platform === 'darwin' ? '.plist' : '.service')) : [];
    expect(files.length, `deep hub start installed one service definition in ${folder}`).toBe(1);
    const definition = readFileSync(join(folder, files[0]!), 'utf8');
    expect(definition, 'the service runs `deep hub run`').toMatch(process.platform === 'darwin' ? /<string>hub<\/string>\s*<string>run<\/string>/ : /ExecStart=.*hub run/);
    if (process.platform === 'darwin') expect(definition, 'it starts at login').toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
    const pgid = Number(execFileSync('ps', ['-o', 'pgid=', '-p', String(before.pid)], { encoding: 'utf8' }).trim());
    expect(pgid, 'the hub is not in the terminal\'s process group').not.toBe(terminal.pid);

    // Close the terminal: hang up its process group, then kill what is left of it.
    process.kill(-terminal.pid!, 'SIGHUP');
    await sleep(300);
    try { process.kill(-terminal.pid!, 'SIGKILL'); } catch { /* already gone */ }
    // And a hangup to the hub itself.
    process.kill(before.pid as number, 'SIGHUP');
    await sleep(1000);
    expect(alive(before.pid as number), 'the hub still runs after its terminal closed and a hangup').toBe(true);
    cli = await control({ socket, root });
    const after = await health(cli);
    expect(after.pid, 'the same hub answers').toBe(before.pid);
    expect(after.start, 'it was not restarted').toBe(before.start);
    expect((await allEvents(cli)).filter((e) => e.kind === 'hub.stopped'), 'no stop was recorded: a hangup is not a stop').toEqual([]);
    expect({ secrets: after.secrets, network: after.network }, 'the secret store and the network as before the terminal closed').toEqual({ secrets: before.secrets, network: before.network });
    cli.close();
    await stopHub({ pid: before.pid as number });
    if (before.secrets !== 'reachable' || before.network !== 'reachable') ctx.skip(`INCONCLUSIVE: this machine gave the hub no ${before.secrets !== 'reachable' ? 'secret store' : 'network'} even before the terminal closed`);
  }, 90_000);

  it('AC7 every stop records its reason: SIGTERM, SIGINT, hub.stop from the CLI, and a kill -9 found at the next start', async () => {
    const home = makeHome();
    let hub = await startHub({ home });
    process.kill(hub.pid, 'SIGTERM');
    await hub.proc.exit;
    hub = await startHub({ home });
    process.kill(hub.pid, 'SIGINT');
    await hub.proc.exit;
    hub = await startHub({ home });
    const cli = await control(hub);
    await cli.call('hub.stop', {}).catch(() => undefined);
    await hub.proc.exit;
    hub = await startHub({ home });
    process.kill(hub.pid, 'SIGKILL');
    await hub.proc.exit;
    hub = await startHub({ home });
    const reader = await control(hub);
    const stops = await waitFor(async () => { const s = (await allEvents(reader)).filter((e) => e.kind === 'hub.stopped'); return s.length >= 4 ? s : undefined; }, 10_000, 'four recorded stops');
    expect(stops.map((e) => e.data.reason), 'each stop with its reason, in order').toEqual(['signal:SIGTERM', 'signal:SIGINT', 'requested', 'crashed']);
    reader.close();
  }, 90_000);
});

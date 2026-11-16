import { chmodSync, existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { cleanup, Conn, makeHome, settle, spawnHub } from '../16/helpers.ts';

const preload = fileURLToPath(new URL('./overlap.mjs', import.meta.url));
afterEach(cleanup, 60_000);

it('AC1 + AC2: real core directories retain 0700 during socket creation; the socket is private at creation', async () => {
  if (!['linux', 'darwin'].includes(process.platform) || !process.getuid) {
    throw Error('BLOCKED: #2594 requires Unix pathname sockets and POSIX owner/mode metadata');
  }
  const home = makeHome();
  // A private mkdtemp ancestor must NOT supply the hub's confidentiality proof.
  chmodSync(dirname(home), 0o755);
  chmodSync(home, 0o755);
  const root = join(home, '.deepbuild');
  expect(existsSync(join(root, 'agents'))).toBe(false);
  const hub = spawnHub({ home, umask: '000', preload });
  const outcome = await settle(hub, 30_000);
  const diagnostic = `${JSON.stringify(outcome)}\n${hub.stderr()}`;
  const report = (name: string) => {
    const path = join(home, `.2594-${name}.json`);
    if (!existsSync(path)) throw Error(`BLOCKED: #2594 missing ${name} boundary observation; ${diagnostic}`);
    return JSON.parse(readFileSync(path, 'utf8'));
  };
  const bound = report('socket');
  const core = report('core');
  expect(bound.pid).toBe(hub.pid);
  expect(bound.threadId).toBe(0);
  expect(core.pid, 'the real core shares the socket creator’s process').toBe(hub.pid);
  expect(core.threadId, 'the mkdir ran in a worker, not a surrogate on main').toBeGreaterThan(0);
  if (!bound.socket.socket) {
    throw Error(`BLOCKED: Node listen did not expose the bound Unix socket synchronously: ${JSON.stringify(bound)}`);
  }

  // AC2: inspect before listen returns, before any later chmod can hide exposure.
  // Linux enforces socket write permission; macOS requires directory protection.
  // Only ancestors created/secured by the hub count, not the test's HOME or /tmp.
  expect(bound.socket.uid).toBe(process.getuid());
  const privateParent = bound.parents.some((p: any) =>
    p.directory && p.uid === process.getuid!() && (p.mode & 0o011) === 0);
  const privateSocket = process.platform === 'linux' && (bound.socket.mode & 0o077) === 0;
  expect(privateParent || privateSocket,
    `AC2: another ordinary user must be denied from creation: ${JSON.stringify(bound)}`).toBe(true);

  // AC1: the barrier records the real mkdir's result before main can restore its
  // umask or repair a mode. Even root cannot hide the 0600 regression from stat.
  expect(core.requested, 'the issue’s real core mkdir requested 0700').toBe(0o700);
  expect(core.failure, `AC1: concurrent core mkdir must not fail; ${diagnostic}`).toBeNull();
  for (const key of ['agents', 'syncs']) {
    expect(core[key].directory, `AC1: ${key} exists as a directory`).toBe(true);
    expect(core[key].mode, `AC1: ${key} retains the requested search bits during listen`).toBe(0o700);
  }
  expect(outcome.ready, `AC1: the real hub must finish starting; ${diagnostic}`).toBeDefined();
  const socket = outcome.ready!.socket;
  expect(statSync(socket).mode & 0o777, 'the design’s final socket mode remains 0600').toBe(0o600);
  const connection = await Conn.open(socket);
  try {
    expect(connection.hello?.hello, 'the owner can actually open the real hub socket').toBe('deep-hub');
  } finally {
    connection.close();
  }
}, 45_000);

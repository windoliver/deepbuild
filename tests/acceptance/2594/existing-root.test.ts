import { chmodSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { cleanup, Conn, makeHome, settle, spawnHub } from '../16/helpers.ts';

const preload = fileURLToPath(new URL('./overlap.mjs', import.meta.url));
afterEach(cleanup, 60_000);

it('AC2: an existing permissive hub root protects the socket from its creation', async () => {
  if (!['linux', 'darwin'].includes(process.platform) || !process.getuid) {
    throw Error('BLOCKED: #2594 requires Unix pathname sockets and POSIX metadata');
  }
  const uid = process.getuid();
  const home = makeHome();
  chmodSync(dirname(home), 0o755);
  chmodSync(home, 0o755);
  const root = join(home, '.deepbuild');
  mkdirSync(root);
  chmodSync(root, 0o755);
  expect(statSync(root).mode & 0o777).toBe(0o755);
  // Isolate AC2 from AC1: existing searchable core folders survive the old umask.
  mkdirSync(join(root, 'agents', 'syncs'), { recursive: true, mode: 0o700 });
  const hub = spawnHub({ home, umask: '000', preload });
  const outcome = await settle(hub, 30_000);
  const diagnostic = `${JSON.stringify(outcome)}\n${hub.stderr()}`;
  const report = join(home, '.2594-socket.json');
  if (!existsSync(report)) throw Error(`BLOCKED: missing socket boundary observation; ${diagnostic}`);
  const bound = JSON.parse(readFileSync(report, 'utf8'));
  expect(bound.pid).toBe(hub.pid);
  expect(bound.threadId).toBe(0);
  expect(bound.socket?.socket, 'the real socket must exist at the listen boundary').toBe(true);
  expect(bound.socket.uid).toBe(uid);
  expect(Number.isInteger(bound.socket.mode), 'missing socket mode is not privacy').toBe(true);
  expect(Array.isArray(bound.parents)).toBe(true);
  expect(bound.parents.length).toBeGreaterThan(0);
  expect(bound.parents.at(-1)?.path, 'only hub-controlled ancestors count').toBe(root);
  for (const parent of bound.parents) {
    expect(parent.directory, 'missing ancestor metadata is not privacy').toBe(true);
    expect(Number.isInteger(parent.mode)).toBe(true);
    expect(Number.isInteger(parent.uid)).toBe(true);
    expect(parent.path === root || parent.path.startsWith(`${root}/`)).toBe(true);
  }
  // Captured by real Node listen before returning to hub code: later chmods
  // cannot erase exposure. macOS does not enforce socket mode as Linux does.
  const privateParent = bound.parents.some((p: { uid: number; mode: number }) =>
    p.uid === uid && (p.mode & 0o011) === 0);
  const privateSocket = process.platform === 'linux' && (bound.socket.mode & 0o077) === 0;
  expect(privateParent || privateSocket,
    `AC2: pre-existing root must not expose the socket at creation: ${JSON.stringify(bound)}`).toBe(true);
  expect(outcome.ready, `the real hub must start; ${diagnostic}`).toBeDefined();
  expect(outcome.ready!.socket).toBe(bound.socket.path);
  expect(statSync(outcome.ready!.socket).mode & 0o777).toBe(0o600);
  const connection = await Conn.open(outcome.ready!.socket);
  try {
    expect(connection.hello?.hello, 'the owner can open the real hub').toBe('deep-hub');
  } finally {
    connection.close();
  }
}, 45_000);

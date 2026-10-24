import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Host } from '@deepbuild/supervisor';
import { afterEach, expect, test } from 'vitest';
import { composeKind, composeRefusal, portKind, upStack } from './index.js';

const dirs: string[] = [];
const { PATH: path, DOCKER_CONFIG: config } = process.env;
afterEach(() => {
  process.env.PATH = path;
  if (config === undefined) delete process.env.DOCKER_CONFIG; else process.env.DOCKER_CONFIG = config;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const repo = (ready: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'env-local-'));
  dirs.push(dir);
  mkdirSync(join(dir, '.deepbuild'));
  writeFileSync(join(dir, '.deepbuild', 'done.yaml'), `environment:\n  up: "true"\n  ports: [web]\n  ready: { http: ${JSON.stringify(ready)}, within: 1 }\n`);
  return dir;
};
// Nothing may start for a block that can't be checked; a start here fails the test.
const noStart = { start: () => { throw Error('started a stack whose health route was never checkable'); } } as unknown as Host;

test.each([
  ['an https route', 'https://127.0.0.1:${web}/health'],
  ['a variable that names no port', 'http://127.0.0.1:${WEB}/health'],
  ['a route off this machine', 'http://example.invalid:${web}/health'],
  ['a fixed port beside leased ones', 'http://127.0.0.1:8080/health'],
])('a health route with %s is BLOCKED before anything starts', async (_, ready) => {
  const up = await upStack(noStart, { run: 'run:TEST', folder: repo(ready) });
  expect(up).toMatchObject({ status: 'BLOCKED', cause: expect.stringContaining('environment.ready.http') });
});

test('a port something listens on at ::1 alone is not free', async () => {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen({ port: 0, host: '::1' }, resolve));
  try {
    const port = (server.address() as net.AddressInfo).port;
    expect(await portKind().free!(String(port))).toBe(false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// Compose's containers run outside the sandbox, so what `docker compose config --format json` resolves is judged.
const service = (extra: Record<string, unknown>, top: Record<string, unknown> = {}) => ({ name: 'shop', services: { web: { image: 'busybox', ...extra } }, networks: { default: { name: 'shop_default' } }, ...top });
test.each([
  ['a mount of the agents\' hook folder', () => service({ volumes: [{ type: 'bind', source: join(homedir(), '.claude'), target: '/c' }] }), /mounts/],
  ['a mount of a hook folder inside the worktree', (dir: string) => service({ volumes: [{ type: 'bind', source: join(dir, '.claude'), target: '/c' }] }), /mounts/],
  ['a mount of the Docker socket', () => service({ volumes: [{ type: 'bind', source: '/var/run/docker.sock', target: '/s' }] }), /mounts/],
  ['a privileged service', () => service({ privileged: true }), /privileged/],
  ['the machine\'s PID namespace', () => service({ pid: 'host' }), /pid/],
  ['the machine\'s network', () => service({ network_mode: 'host' }), /network_mode/],
  ['added capabilities', () => service({ cap_add: ['SYS_ADMIN'] }), /cap_add/],
  ['a lifecycle hook', () => service({ post_start: [{ command: ['sh'], privileged: true, user: 'root' }] }), /post_start/],
  ['reserved devices', () => service({ deploy: { resources: { reservations: { devices: [{ capabilities: ['gpu'] }] } } } }), /devices/],
  ['a port it wasn\'t leased', () => service({ ports: [{ target: 5432, published: '5432' }] }), /publishes port 5432/],
  ['a leased port published on every address', () => service({ ports: [{ target: 80, published: '1', host_ip: '0.0.0.0' }] }), /not on loopback/],
  ['a volume bound by driver options', () => service({}, { volumes: { v: { name: 'shop_v', driver_opts: { type: 'none', o: 'bind', device: '/' } } } }), /volume v/],
  ['another project\'s volume', () => service({}, { volumes: { v: { name: 'someoneelses_pgdata' } } }), /volume v/],
  ['an outside network', () => service({}, { networks: { default: { name: 'host', external: true } } }), /network default/],
  ['a secret read from outside', () => service({}, { secrets: { s: { file: '/etc/passwd' } } }), /secret s/],
  ['the Docker API socket', () => service({ use_api_socket: true }), /use_api_socket/],
  ['a provider program', () => service({ provider: { type: './x' } }), /provider/],
  ['GPUs', () => service({ gpus: 'all' }), /gpus/],
  ['a top-level key compose added later', () => service({}, { models: { m: { model: 'x' } } }), /models/],
  ['the folder itself mounted writable', (dir: string) => service({ volumes: [{ type: 'bind', source: dir, target: '/app' }] }), /writable/],
  ['a subfolder mounted writable, where a container could plant a link a later mount follows', (dir: string) => service({ volumes: [{ type: 'bind', source: join(dir, 'sub'), target: '/s' }] }), /writable/],
  ['a path compose reads again as a variable', (dir: string) => {
    // `config` writes `$${HOME}` for a literal `${HOME}`, which `up` reads as the variable: a link by that name points out.
    symlinkSync(homedir(), join(dir, '${HOME}'));
    return service({ volumes: [{ type: 'bind', source: join(dir, '$${HOME}'), target: '/m' }] });
  }, /mounts/],
  // `up` reads a relative path from the judged file's folder, not the worktree; `config` writes every path absolute.
  ['a relative path, which up reads from elsewhere', () => service({ volumes: [{ type: 'bind', source: 'www', target: '/www', read_only: true }] }), /mounts www/],
  // `up` runs under the leased project whatever the file names itself, so names are its, not the file's.
  ['a volume named for the project the file names, not the one it runs as', () => service({}, { name: 'myapp', volumes: { v: { name: 'myapp_v' } } }), /volume v/],
  // A shape the judge didn't judge is refused, not left to compose's own checks.
  ['ports given other than as a list', () => service({ ports: { a: { target: 80, published: '5432' } } }), /ports/],
  ['a read-only mount whose submounts are writable', (dir: string) => service({ volumes: [{ type: 'bind', source: join(dir, 'www'), target: '/w', read_only: true, bind: { recursive: 'writable' } }] }), /bind/],
])('a compose stack with %s is refused', (_, config, why) => {
  const dir = repo('http://127.0.0.1:${web}/health');
  expect(composeRefusal(config(dir), dir, ['1'], 'shop')).toMatch(why);
});
test('a compose stack mounting only its own folder, read-only, on its leased port, may run', () => {
  const dir = repo('http://127.0.0.1:${web}/health');
  const config = service({ ports: [{ target: 3000, published: '1' }], volumes: [{ type: 'bind', source: join(dir, 'www'), target: '/www', read_only: true }, { type: 'volume', source: 'data', target: '/data' }] }, { volumes: { data: { name: 'shop_data' } } });
  expect(composeRefusal(config, dir, ['1'], 'shop')).toBeUndefined();
});

// A stand-in Docker CLI first on PATH, with a compose plugin in its own config: `script` is its body, and each call
// appends its arguments to `calls`. The compose kind made then finds it, as a hub starting then would.
const fakeDocker = (script: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'env-local-docker-'));
  dirs.push(dir);
  const calls = join(dir, 'calls');
  writeFileSync(join(dir, 'docker'), `#!/bin/sh\necho "$*" >> '${calls}'\n${script}\n`);
  chmodSync(join(dir, 'docker'), 0o755);
  mkdirSync(join(dir, 'config', 'cli-plugins'), { recursive: true });
  writeFileSync(join(dir, 'config', 'cli-plugins', 'docker-compose'), '');
  writeFileSync(join(dir, 'config', 'config.json'), '{}');
  process.env.DOCKER_CONFIG = join(dir, 'config');
  process.env.PATH = `${dir}:${path}`;
  return () => (readFileSync(calls, 'utf8').trim().split('\n'));
};
test('a compose stack whose Docker context reaches its daemon over TCP is BLOCKED before anything starts', async () => {
  fakeDocker('case "$1" in context) echo tcp://192.0.2.1:2376;; esac');
  const dir = repo('http://127.0.0.1:${web}/health');
  writeFileSync(join(dir, '.deepbuild', 'done.yaml'), 'environment:\n  compose: compose.yaml\n  ports: [web]\n  ready: { http: "http://127.0.0.1:${web}/health", within: 1 }\n');
  const hub = mkdtempSync(join(tmpdir(), 'env-local-hub-'));
  dirs.push(hub);
  const up = await upStack(noStart, { run: 'run:TEST', folder: dir, compose: { dir: hub, docker: composeKind(hub).docker } });
  expect(up).toMatchObject({ status: 'BLOCKED', cause: expect.stringContaining('tcp://192.0.2.1:2376') });
});
test('a daemon that stops answering fails a compose lease at once, not once per key', async () => {
  const calls = fakeDocker('exit 1');
  const dir = mkdtempSync(join(tmpdir(), 'env-local-hub-'));
  dirs.push(dir);
  const kind = composeKind(dir);
  for (const key of kind.keys.slice(0, 50)) expect(await kind.free!(key)).toBe(false);
  expect(calls().filter((call) => /^(ps|volume) /.test(call))).toHaveLength(2);
});
test('the Docker CLI a compose stack runs is the one the hub found when it started, not one planted on PATH after', async () => {
  const first = fakeDocker('case "$1" in context) echo unix:///nonexistent.sock;; version) echo "config $DOCKER_CONFIG" >> "$(dirname "$0")/calls"; exit 1;; esac');
  const hub = mkdtempSync(join(tmpdir(), 'env-local-hub-'));
  dirs.push(hub);
  const kind = composeKind(hub);
  const planted = fakeDocker('exit 0');
  const dir = repo('http://127.0.0.1:${web}/health');
  writeFileSync(join(dir, '.deepbuild', 'done.yaml'), 'environment:\n  compose: compose.yaml\n  ports: [web]\n  ready: { http: "http://127.0.0.1:${web}/health", within: 1 }\n');
  expect(await upStack(noStart, { run: 'run:TEST', folder: dir, compose: { dir: hub, docker: kind.docker } })).toMatchObject({ status: 'BLOCKED' });
  expect(() => planted()).toThrow(/ENOENT/);
  // The hub asks the daemon with its own config, which links compose alone, and never with `info`, which runs every plugin.
  expect(first().filter((call) => /^(info|version|config)/.test(call))).toEqual(['version --format {{.Server.Version}}', `config ${join(hub, 'docker')}`]);
  // Where it was found, and where one planted later would be found first, no run writes.
  const found = dirname(kind.docker!);
  expect(kind.guarded).toEqual(expect.arrayContaining([found, join(found, 'config', 'cli-plugins'), join(found, 'config', 'config.json'), '/usr/local/lib/docker/cli-plugins']));
});
test('compose runs with remote includes off and a home of the hub\'s, so loading a file fetches and reads nothing a run planted', () => {
  fakeDocker('case "$1" in context) echo unix:///nonexistent.sock;; esac');
  const hub = mkdtempSync(join(tmpdir(), 'env-local-hub-'));
  dirs.push(hub);
  const env = composeKind(hub).release!.env!;
  expect(env).toMatchObject({ COMPOSE_EXPERIMENTAL_GIT_REMOTE: '0', COMPOSE_EXPERIMENTAL_OCI_REMOTE: '0', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });
  expect(env.HOME).toBe(join(hub, 'home'));
});

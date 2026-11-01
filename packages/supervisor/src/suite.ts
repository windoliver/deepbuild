// The sandbox seam's own suite: every backend ships only once it passes, and each planted backend, one rule
// wider than Seatbelt, fails exactly its own case. Each case pairs what the grant names, which must work, with
// what it doesn't, which the sandbox must refuse, so a backend that refuses everything fails too.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { bubblewrapPlants } from './bubblewrap.js';
import { quote, real, seatbeltWith } from './seatbelt.js';
import { HELPER } from './procs.js';
import type { Grant, SandboxBackend } from './types.js';

/** The suite's fixtures: two listening Unix sockets the caller runs, standing for the hub's and an agent session's inbox. */
export interface SuiteFixtures { hubSocket: string; inboxSocket: string }
export interface SuiteResult { backend: string; passed: boolean; cases: { name: string; ok: boolean; detail: string }[] }

interface Try { op: string; target: string; ok: boolean; errno: string }
interface Device { device: string; sandbox: string }
const DEVICES = ['camera', 'microphone', 'audio-output', 'screen-capture'] as const;
const lines = <T>(file: string): T[] => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as T) : []);
const refused = (t: Try | undefined): boolean => t !== undefined && !t.ok && (t.errno === 'EPERM' || t.errno === 'EACCES');
const shown = (t: Try | undefined): string => (t ? (t.ok ? 'allowed' : `refused (${t.errno})`) : 'never tried');

function listen(at: string | 0): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer((sock) => sock.on('error', () => undefined).resume());
    server.once('error', reject);
    if (at === 0) server.listen(0, '127.0.0.1', () => resolve(server));
    else server.listen(at, () => resolve(server));
  });
}
const portOf = (server: net.Server): string => String((server.address() as net.AddressInfo).port);

export async function sandboxSuite(backend: SandboxBackend, fixtures: SuiteFixtures): Promise<SuiteResult> {
  const dir = real(mkdtempSync('/tmp/deep-suite-'));
  const servers: net.Server[] = [];
  try {
    const [cwd, data, out, outside] = ['run', 'data', 'out', 'outside'].map((name) => {
      mkdirSync(join(dir, name));
      return join(dir, name);
    }) as [string, string, string, string];
    writeFileSync(join(data, 'in.txt'), 'granted\n');
    writeFileSync(join(outside, 'secret.txt'), 'not granted\n');
    const granted = await listen(0);
    const stranger = await listen(0);
    const socket = join(dir, 'granted.sock');
    servers.push(granted, stranger, await listen(socket));
    const file = join(out, 'tries.json');
    const devices = join(out, 'devices.json');
    const grant: Grant = { read: [dirname(HELPER), data], write: [out], hosts: [`127.0.0.1:${portOf(granted)}`], sockets: [socket] };
    const argv = [HELPER, 'probe', file,
      'read', join(data, 'in.txt'), 'read', join(outside, 'secret.txt'), 'write', join(out, 'w.txt'), 'write', join(outside, 'w.txt'),
      'tcp', portOf(granted), 'tcp', portOf(stranger), 'unix', socket, 'unix', fixtures.hubSocket, 'unix', fixtures.inboxSocket, 'devices', devices];
    const launch = await backend.confine({ argv, cwd, env: { PATH: '/usr/bin:/bin' } }, grant);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(launch.argv[0]!, launch.argv.slice(1), { cwd: launch.cwd, env: launch.env, stdio: 'ignore' });
      const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
      child.on('error', reject);
      child.on('exit', () => { clearTimeout(timer); resolve(); });
    });
    const tries = lines<Try>(file);
    const tried = (op: string, target: string) => tries.find((t) => t.op === op && t.target === target);
    const pair = (name: string, op: string, inside: string, beyond: string) => {
      const a = tried(op, inside);
      const b = tried(op, beyond);
      return { name, ok: a?.ok === true && refused(b), detail: `${op} ${inside} (granted): ${shown(a)}; ${op} ${beyond} (not granted): ${shown(b)}` };
    };
    const socketCase = (name: string, path: string) => {
      const a = tried('unix', socket);
      const b = tried('unix', path);
      return { name, ok: a?.ok === true && refused(b), detail: `a granted socket: ${shown(a)}; ${path}: ${shown(b)}` };
    };
    const seen = lines<Device>(devices);
    const cases = [
      pair('egress', 'tcp', portOf(granted), portOf(stranger)),
      pair('write-outside', 'write', join(out, 'w.txt'), join(outside, 'w.txt')),
      pair('read-outside', 'read', join(data, 'in.txt'), join(outside, 'secret.txt')),
      socketCase('hub-socket', fixtures.hubSocket),
      socketCase('inbox-socket', fixtures.inboxSocket),
      ...DEVICES.map((device) => {
        const d = seen.find((s) => s.device === device);
        return { name: device, ok: d?.sandbox === 'deny', detail: `a child of the sandboxed process: ${d ? `${d.sandbox} ${device}` : 'never checked'}` };
      }),
    ];
    if (existsSync(join(outside, 'w.txt')) && cases[1]!.ok) cases[1] = { ...cases[1]!, ok: false, detail: `${cases[1]!.detail}, yet the file exists` };
    return { backend: backend.name, passed: cases.every((c) => c.ok), cases };
  } finally {
    await Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve))));
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The suite's broken fakes: the platform's backend with one rule more, each letting through the one thing its case refuses. */
export function plantedBackends(fixtures: SuiteFixtures): Record<'egress' | 'write-outside' | 'hub-socket' | 'camera', SandboxBackend> {
  if (process.platform === 'linux') return bubblewrapPlants(fixtures.hubSocket);
  return {
    egress: seatbeltWith('planted-egress', ['(allow network-outbound (remote ip "*:*"))']),
    'write-outside': seatbeltWith('planted-write-outside', ['(allow file-write*)']),
    'hub-socket': seatbeltWith('planted-hub-socket', [`(allow network-outbound (remote unix-socket (path-literal ${quote(real(fixtures.hubSocket))})))`]),
    camera: seatbeltWith('planted-camera', ['(allow device-camera)']),
  };
}

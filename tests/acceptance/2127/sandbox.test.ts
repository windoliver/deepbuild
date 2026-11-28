import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import net from 'node:net';
import { arch, constants } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openAsks } from '@deepbuild/asks';
import { openRecord, type Event, type RecordStore } from '@deepbuild/record';
import { HELPER, openSupervisor, type Exit, type Supervisor } from '@deepbuild/supervisor';
import { afterAll, expect, test } from 'vitest';

const SOCKETS = '#2127.8a497e6d';
const X32 = '#2127.30ea8fe8';
const LISTEN = '#2127.50cd37a3';
const TIMEOUT = 180_000;
const RACE_TRIES = 5000;
const PROBE_SOURCE = fileURLToPath(new URL('./probe.c', import.meta.url));

interface Bench { dir: string; probe: string; record: RecordStore; sup: Supervisor }
interface Ran { exit: Exit; lines: Record<string, unknown>[]; denied: { operation: string; target: string }[] }

const cleanups: Array<() => Promise<void> | void> = [];
afterAll(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
}, 60_000);

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

function ccWorks(): boolean {
  try { execFileSync('cc', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

function whyBlocked(id: string): string | null {
  if (process.platform !== 'linux') return `BLOCKED: ${id} needs Linux (real bubblewrap and the built helper); this machine is ${process.platform}`;
  if (!existsSync('/usr/bin/bwrap')) return `BLOCKED: ${id} needs bubblewrap at /usr/bin/bwrap; this machine has none`;
  if (!existsSync(HELPER)) return `BLOCKED: ${id} needs the supervisor's built helper at ${HELPER} (npm run build -w packages/supervisor); this machine has none`;
  if (!ccWorks()) return `BLOCKED: ${id} needs a C compiler (cc) to build its probe program; this machine has none`;
  return null;
}

let bench: Promise<Bench> | undefined;
function theBench(): Promise<Bench> {
  bench ??= openBench();
  return bench;
}

async function openBench(): Promise<Bench> {
  const dir = realpathSync(mkdtempSync('/tmp/deep-2127-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const probe = join(bin, 'probe');
  try {
    execFileSync('cc', ['-O2', '-pthread', '-o', probe, PROBE_SOURCE], { stdio: 'pipe' });
  } catch (error) {
    throw Error(`BLOCKED: the probe program ${PROBE_SOURCE} doesn't build with cc here: ${String((error as { stderr?: Buffer }).stderr ?? error)}`);
  }
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } } });
  cleanups.push(async () => { await sup.close(); await record.close(); });
  return { dir, probe, record, sup };
}

async function runProbe(b: Bench, run: string, args: (out: string) => string[]): Promise<Ran> {
  const out = join(b.dir, run.replace(/[^A-Za-z0-9]/g, '-'));
  mkdirSync(out);
  const file = join(out, 'probe.json');
  const started = await b.sup.start({
    run,
    argv: [b.probe, ...args(file)],
    cwd: out,
    grant: { read: [join(b.dir, 'bin')], write: [out] },
  });
  if (started.status !== 'started') throw Error(`BLOCKED: the supervised run ${run} must start: ${JSON.stringify(started)}`);
  const exit = await b.sup.wait(run);
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>) : [];
  const denied = ((await b.record.read({ after: 0, limit: 100_000 })) as Event[])
    .filter((e) => e.kind === 'sandbox.denied' && (e.data as { run?: string }).run === run)
    .map((e) => e.data as { operation: string; target: string });
  return { exit, lines, denied };
}

function strangerListener(): Promise<{ port: number; connections: () => number; server: net.Server }> {
  let n = 0;
  const server = net.createServer((sock) => { n++; sock.on('error', () => undefined).resume(); });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ port: 0, host: '127.0.0.1', backlog: 4096 }, () => resolve({ port: (server.address() as net.AddressInfo).port, connections: () => n, server }));
  });
}

test(`${SOCKETS} The Linux sandbox makes each socket and metadata call it checks itself, so what was checked is what runs: a connect with a netlink address swapped by a second thread for the stranger listener's, looped ${RACE_TRIES} times in a run with no host grant, gives the stranger no connection`, async () => {
  const why = whyBlocked(SOCKETS);
  if (why) throw Error(why);
  const b = await theBench();
  const stranger = await strangerListener();
  cleanups.push(() => new Promise<void>((done) => stranger.server.close(() => done())));
  const r = await runProbe(b, 'run:RACE2127', (file) => ['race', file, String(stranger.port), String(RACE_TRIES)]);
  await sleep(500);
  const report = r.lines.find((l) => l.mode === 'race') as { tries: number; sockets: number; connected: number } | undefined;
  if (!report || report.sockets === 0) throw Error(`BLOCKED: ${SOCKETS}: the probe inside the sandbox never finished its loop or made no TCP socket, so no connect raced (exit ${JSON.stringify({ code: r.exit.code, signal: r.exit.signal })}, report ${JSON.stringify(report)})`);
  expect.soft(report.tries, 'connects the probe looped through').toBe(RACE_TRIES);
  expect.soft(report.connected, 'connects that succeeded inside the run').toBe(0);
  expect(stranger.connections(), 'connections the stranger listener accepted from the run').toBe(0);
}, TIMEOUT);

test(`${X32} The Linux sandbox's filter stops an x32 call on x86_64, so no call skips its rules: syscall(0x40000000 | __NR_getpid) inside a run kills the process by SIGSYS`, async () => {
  const why = whyBlocked(X32);
  if (why) throw Error(why);
  if (arch() !== 'x64') throw Error(`BLOCKED: ${X32} needs the x86_64 lane, where the x32 ABI exists; this machine is ${process.platform} ${arch()}`);
  const b = await theBench();
  const r = await runProbe(b, 'run:X322127', (file) => ['x32', file]);
  if (!r.lines.some((l) => l.mode === 'x32' && l.calling === true)) throw Error(`BLOCKED: ${X32}: the probe inside the sandbox never reached its x32 call (exit ${JSON.stringify({ code: r.exit.code, signal: r.exit.signal })})`);
  expect.soft(r.lines.find((l) => 'returned' in l), 'what the x32 call returned, when it returned at all').toBeUndefined();
  expect({ code: r.exit.code, signal: r.exit.signal }, 'the run\'s end').toEqual({ code: null, signal: 'SIGSYS' });
}, TIMEOUT);

test(`${LISTEN} A run on Linux listens only on a port its grant names: listen on an unbound TCP socket in a run with no listen grant fails with EACCES and sandbox.denied names network-bind`, async () => {
  const why = whyBlocked(LISTEN);
  if (why) throw Error(why);
  const b = await theBench();
  const r = await runProbe(b, 'run:LISTEN2127', (file) => ['listen', file]);
  const report = r.lines.find((l) => l.mode === 'listen') as { socket: boolean; rc: number; errno: number } | undefined;
  if (!report || !report.socket) throw Error(`BLOCKED: ${LISTEN}: the probe inside the sandbox made no TCP socket to listen on (exit ${JSON.stringify({ code: r.exit.code, signal: r.exit.signal })}, report ${JSON.stringify(report)})`);
  expect.soft({ rc: report.rc, errno: report.errno }, 'what listen returned, and its errno').toEqual({ rc: -1, errno: constants.errno.EACCES });
  expect(r.denied.map((d) => d.operation), 'the operations the run\'s sandbox.denied events name').toContain('network-bind');
}, TIMEOUT);

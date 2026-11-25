// #3371: on Linux the bubblewrap sandbox gives a run its own empty /run, so a socket a grant names under /run (as
// /var/run/docker.sock resolves to /run/docker.sock on Ubuntu) can't be reached. Both criteria read one supervised run:
//
//   AC1 #3371.93dce41a: a socket granted by a path that resolves through a symlink to a real path under /run is
//   connected to by the path as granted and by its real path (the listener counts at least 1 for each), exit 0.
//   AC2 #3371.abb32c74: in the same run, a second listening socket in the same /run folder that the grant doesn't
//   name gets 0 connections and the program's connect fails.
//
// The run is started through openSupervisor (@deepbuild/supervisor) on real bubblewrap and the built helper. The /run
// folder is a temp folder under /run/user/<uid> (the user's XDG_RUNTIME_DIR, a real /run path the user can write), and
// a symlink under /tmp to it stands in for /var/run → /run. The program inside is the helper's own `probe`, which
// connects to each path in turn and writes one JSON line per try.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { openAsks } from '@deepbuild/asks';
import { openRecord } from '@deepbuild/record';
import { HELPER, openSupervisor, type Exit } from '@deepbuild/supervisor';
import { afterAll, expect, test } from 'vitest';

const AC1 = 'AC1 #3371.93dce41a';
const AC2 = 'AC2 #3371.abb32c74';
const TIMEOUT = 120_000;

/** A Unix listener that counts the connections it accepts. */
interface Listener { path: string; server: net.Server; connections: () => number }
function listen(path: string): Promise<Listener> {
  let n = 0;
  const server = net.createServer((sock) => { n++; sock.on('error', () => undefined).resume(); });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, () => resolve({ path, server, connections: () => n }));
  });
}

interface Try { op: string; target: string; ok: boolean; errno: string }
interface Run {
  /** The granted socket, as granted (through the symlink) and by its real path under /run. */
  granted: { asGranted: string; real: string; listener: Listener };
  /** The socket beside it in the same /run folder, which the grant doesn't name. */
  other: { real: string; throughLink: string; listener: Listener };
  exit: Exit;
  tries: Try[];
}

const cleanups: Array<() => Promise<void> | void> = [];
afterAll(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
}, 60_000);

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Why this machine can't run the criterion, or null when it can. */
function blockedHere(id: string): string | null {
  if (process.platform !== 'linux') return `BLOCKED: ${id} needs Linux (real bubblewrap and the built helper); this machine is ${process.platform}`;
  if (!existsSync('/usr/bin/bwrap')) return `BLOCKED: ${id} needs bubblewrap at /usr/bin/bwrap; this machine is ${process.platform} without it`;
  if (!existsSync(HELPER)) return `BLOCKED: ${id} needs the supervisor's built helper at ${HELPER} (npm run build -w packages/supervisor); this machine is ${process.platform} without it`;
  const runtime = `/run/user/${process.getuid!()}`;
  if (!existsSync(runtime)) return `BLOCKED: ${id} needs a folder under /run the user can make sockets in (${runtime}); this machine is ${process.platform} without it`;
  return null;
}

let shared: Promise<Run> | undefined;
/** The one run both criteria read, started once. */
function theRun(): Promise<Run> {
  shared ??= start();
  return shared;
}

async function start(): Promise<Run> {
  const runtime = `/run/user/${process.getuid!()}`;
  const runDir = realpathSync(mkdtempSync(join(runtime, 'deep-3371-')));
  cleanups.push(() => rmSync(runDir, { recursive: true, force: true }));
  const tmp = realpathSync(mkdtempSync('/tmp/deep-3371-'));
  cleanups.push(() => rmSync(tmp, { recursive: true, force: true }));
  // The stand-in for /var/run → /run: a symlink outside /run whose path resolves to the folder under /run.
  const link = join(tmp, 'var-run');
  symlinkSync(runDir, link);
  const out = join(tmp, 'out');
  mkdirSync(out);

  const a = await listen(join(runDir, 'a.sock'));
  const b = await listen(join(runDir, 'b.sock'));
  for (const l of [a, b]) cleanups.push(() => new Promise<void>((done) => l.server.close(() => done())));
  const asGranted = join(link, 'a.sock');
  // The fixture is what the criterion names, or the test can't judge it.
  if (realpathSync(asGranted) !== a.path || !a.path.startsWith('/run/')) throw Error(`BLOCKED: the granted path ${asGranted} must resolve through its symlink to ${a.path} under /run; it resolves to ${realpathSync(asGranted)}`);

  const record = await openRecord({ path: join(tmp, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } } });
  cleanups.push(async () => { await sup.close(); await record.close(); });

  const triesFile = join(out, 'tries.json');
  const probes = [asGranted, a.path, b.path, join(link, 'b.sock')];
  const started = await sup.start({
    run: 'run:SOCK3371',
    argv: [HELPER, 'probe', triesFile, ...probes.flatMap((p) => ['unix', p])],
    cwd: tmp,
    grant: { read: [HELPER.slice(0, HELPER.lastIndexOf('/'))], write: [out], sockets: [asGranted] },
  });
  if (started.status !== 'started') throw Error(`BLOCKED: the supervised run must start: ${JSON.stringify(started)}`);
  const exit = await sup.wait('run:SOCK3371');
  // A connection is counted when the listener accepts it, which can come just after the run's end: wait for both
  // connections the granted socket should see, up to 5 s, then a moment more for any to the other socket.
  for (let t = 0; t < 50 && a.connections() < 2; t++) await sleep(100);
  await sleep(300);
  const tries = existsSync(triesFile)
    ? readFileSync(triesFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Try)
    : [];
  return { granted: { asGranted, real: a.path, listener: a }, other: { real: b.path, throughLink: join(link, 'b.sock'), listener: b }, exit, tries };
}

/** What the probe reported for one path: "connected", "refused <errno>", or "not tried". */
function outcome(r: Run, path: string): string {
  const t = r.tries.find((x) => x.op === 'unix' && x.target === path);
  return t === undefined ? 'not tried' : t.ok ? 'connected' : `refused ${t.errno}`;
}

test(`${AC1} a socket granted by a path through a symlink to a real path under /run is connected to by the path as granted and by its real path, and the run exits 0`, async () => {
  const why = blockedHere(AC1);
  if (why) throw Error(why);
  const r = await theRun();
  if (r.tries.length === 0) throw Error(`BLOCKED: ${AC1}: the probe inside the sandbox wrote no tries, so the run never connected to anything (exit ${JSON.stringify({ code: r.exit.code, signal: r.exit.signal })})`);
  expect.soft(outcome(r, r.granted.asGranted), `the connect by the path as granted (${r.granted.asGranted}, through the symlink)`).toBe('connected');
  expect.soft(outcome(r, r.granted.real), `the connect by the real path under /run (${r.granted.real})`).toBe('connected');
  // Both connects dial the one listener and nothing else does: two connections is at least one for each path.
  expect.soft(r.granted.listener.connections(), 'connections the granted socket\'s listener counted: at least 1 by each of the two paths').toBeGreaterThanOrEqual(2);
  expect.soft(r.exit.code, 'the run\'s exit code').toBe(0);
}, TIMEOUT);

test(`${AC2} in the same run, a second listening socket in the same /run folder that the grant doesn't name gets 0 connections and the program's connect fails`, async () => {
  const why = blockedHere(AC2);
  if (why) throw Error(why);
  const r = await theRun();
  if (r.tries.length === 0) throw Error(`BLOCKED: ${AC2}: the probe inside the sandbox wrote no tries, so its connects to the ungranted socket never ran (exit ${JSON.stringify({ code: r.exit.code, signal: r.exit.signal })})`);
  for (const path of [r.other.real, r.other.throughLink]) {
    expect.soft(outcome(r, path), `the connect to the ungranted socket by ${path} fails`).toMatch(/^refused /);
  }
  expect.soft(r.other.listener.connections(), `connections the ungranted socket's listener (${r.other.real}) counted`).toBe(0);
}, TIMEOUT);

// #2584: the supervisor's `listening(port)` must not read lsof's warning about a mount it can't stat as a failure,
// and must still reject when lsof fails for another reason. lsof is the OS's, a boundary the repo doesn't own, and
// `listening` runs it by absolute path, so the stand-in sits at node:child_process's execFile, for lsof only: it runs
// the real lsof with the same arguments and adds, as a machine with such a mount makes lsof do, the warning to its
// stderr unless `-w` is among them. Every other call, and every lsof call outside a test's arming, is the real one.
import { createServer, type Server } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';
import { listening } from '../../../packages/supervisor/src/index.ts';

const LSOF = process.platform === 'darwin' ? '/usr/sbin/lsof' : '/usr/bin/lsof';
const WARNING = "lsof: WARNING: can't stat() tracefs file system /sys/kernel/debug/tracing\n      Output information may be incomplete.\n";

type Mode = 'mount-warning' | 'status-error' | 'missing' | 'killed';
const stand = vi.hoisted(() => ({ mode: null as null | string, calls: [] as string[][] }));
vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof import('node:child_process')>();
  const real = actual.execFile as (...a: unknown[]) => unknown;
  return {
    ...actual,
    execFile: ((file: string, args: string[], ...rest: unknown[]) => {
      const mode = stand.mode as Mode | null;
      if (!mode || !file.endsWith('/lsof')) return real(file, args, ...rest);
      stand.calls.push(args);
      const done = rest.at(-1) as (error: (Error & { code?: unknown; signal?: unknown }) | null, stdout: string, stderr: string) => void;
      const options = rest.length > 1 ? rest[0] : {};
      // lsof warns about the mount on every call unless told not to with -w.
      const warn = args.includes('-w') ? '' : WARNING;
      if (mode === 'missing') return real('/nonexistent-2584/lsof', args, options, done);
      if (mode === 'killed') {
        // lsof printed the warning, then died on a signal before it answered.
        setImmediate(() => done(Object.assign(new Error('Command failed: lsof'), { code: null, signal: 'SIGKILL', killed: true }), '', warn));
        return undefined;
      }
      // The real lsof's answer for the same arguments (with a name that doesn't exist, for a real error), plus the warning.
      const runArgs = mode === 'status-error' ? [...args, '/nonexistent-2584'] : args;
      return real(LSOF, runArgs, options, (error: Parameters<typeof done>[0], stdout: string, stderr: string) => done(error, stdout, warn + stderr));
    }) as typeof actual.execFile,
  };
});

let server: Server | undefined;
afterEach(async () => {
  stand.mode = null;
  stand.calls = [];
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = undefined;
});

/** A port nothing listens on: one the OS just handed out and took back. */
async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const port = (s.address() as { port: number }).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

it('#2584.ae5eab8b with lsof warning that it can\'t stat a mount, listening answers a port nothing listens on as empty', async () => {
  const port = await freePort();
  // Precondition: with no warning, the real lsof answers the port as empty.
  await expect(listening(port), 'the port was taken before the warning was added').resolves.toEqual({ pids: [], empty: true });
  stand.mode = 'mount-warning';
  await expect(listening(port)).resolves.toEqual({ pids: [], empty: true });
  expect(stand.calls.length, 'listening never ran lsof').toBeGreaterThan(0);
});

it('#2584.ae5eab8b with the mount warning, a port a process listens on still yields that process', async () => {
  server = createServer();
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  stand.mode = 'mount-warning';
  await expect(listening(port)).resolves.toEqual({ pids: [process.pid], empty: false });
});

it('#2584.6f1bcc3c an lsof that exits 1 with a real error (and the mount warning) still rejects', async () => {
  const port = await freePort();
  stand.mode = 'status-error';
  await expect(listening(port)).rejects.toThrow(/status error on \/nonexistent-2584/);
});

it('#2584.6f1bcc3c an lsof that is missing still rejects', async () => {
  const port = await freePort();
  stand.mode = 'missing';
  await expect(listening(port)).rejects.toThrow();
});

it('#2584.6f1bcc3c an lsof killed by a signal after printing only the mount warning still rejects', async () => {
  const port = await freePort();
  stand.mode = 'killed';
  await expect(listening(port)).rejects.toThrow();
});

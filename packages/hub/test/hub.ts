// A hub started on a temp home, and hook requests sent to it the way deep-hook sends them (#315's hub tests).
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../../cli/dist/main.js', import.meta.url));

/** A hook request line as deep-hook writes it; `seq` defaults to now. */
export function hookLine(id: string, event: string, payload: Record<string, unknown>, extra: Record<string, unknown> = {}): string {
  const seq = String(BigInt(Date.now()) * 1_000_000n);
  return `${JSON.stringify({ v: 1, agent: 'claude-code', event, seq, id, pid: process.pid, ppid: process.ppid, matched: [], payload, ...extra })}\n`;
}

/** Sends one hook request the way deep-hook does: waits for the hello, writes the line, reads the acknowledgement. */
export function send(socket: string, line: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(socket);
    let got = '';
    sock.on('data', (d) => {
      got += d;
      if (got.split('\n').length === 2) sock.write(line);
      if (got.split('\n').length > 2) { sock.destroy(); resolve(got.split('\n')[1]!); }
    });
    sock.on('error', reject);
  });
}

/** Runs `body` against a hub started on a temp home, which it may restart, then stops the hub and removes the home. */
export async function withHub(body: (root: string, home: string, restart: () => Promise<void>) => Promise<void>): Promise<void> {
  const home = realpathSync(mkdtempSync('/tmp/hub-315-'));
  const root = join(home, '.deepbuild');
  mkdirSync(root, { recursive: true });
  let hub: ChildProcessByStdio<null, Readable, null>;
  const start = async () => {
    hub = spawn(process.execPath, [CLI, 'hub', 'run'], { env: { ...process.env, HOME: home }, stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise((resolve, reject) => { hub.stdout.once('data', resolve); hub.once('exit', () => reject(Error('the hub exited before it was ready'))); });
  };
  const stop = async () => {
    if (hub.exitCode === null && hub.signalCode === null) {
      const exited = new Promise((resolve) => hub.once('exit', resolve));
      hub.kill('SIGTERM');
      await exited;
    }
  };
  try {
    await start();
    await body(root, home, async () => { await stop(); await start(); });
  } finally {
    await stop();
    rmSync(home, { recursive: true, force: true });
  }
}

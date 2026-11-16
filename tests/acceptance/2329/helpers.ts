// A real hub (the built CLI's `hub run`) on a temp home, hook lines sent the way deep-hook sends them, a `ps` stand-in on
// the hub's PATH, and agent processes that ps shows as Claude Code's own binary. Nothing of the hub's source is imported.
import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../../../packages/cli/dist/main.js', import.meta.url));
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface World {
  root: string;
  home: string;
  /** Every `ps` the hub ran since the log was last cleared, one line of arguments each. */
  psCalls: () => string[];
  clearPsLog: () => void;
  /** A Claude Code process as ps shows one: its native binary's name. Its PID is the `ppid` of that agent's hooks. */
  agent: () => ChildProcess & { pid: number };
  /** Sends one SessionStart (or other) hook from `ppid` for `session`, and waits for the hub's acknowledgement. */
  hook: (session: string, event: string, ppid: number, extra?: Record<string, unknown>) => Promise<void>;
  /** Waits until the record holds `n` events of `kind` for the session (up to 15 s); the count then. */
  recorded: (session: string, kind: string, n: number) => Promise<number>;
  /** The `unverified` flag of each of the session's session.start events, in record order. */
  starts: (session: string) => number[];
}

/**
 * Runs `body` against a hub whose PATH starts with a `ps` that logs each call and runs the real one, and a `claude`
 * that lists no mods. While `<home>/reuse` holds a PID, that process's start time (`ps -o lstart= -p <PID>`) reads as a
 * different one, as it does once another process has taken the PID.
 */
export async function withWorld(body: (w: World) => Promise<void>): Promise<void> {
  const home = realpathSync(mkdtempSync('/tmp/ac-2329-'));
  const root = join(home, '.deepbuild');
  const bin = join(home, 'bin');
  const log = join(home, 'ps.log');
  mkdirSync(root, { recursive: true });
  mkdirSync(bin, { recursive: true });
  writeFileSync(log, '');
  writeFileSync(join(bin, 'ps'), `#!/bin/sh
echo "$*" >> '${log}'
if [ -s '${home}/reuse' ] && [ "$*" = "-o lstart= -p $(cat '${home}/reuse')" ]; then echo 'Mon Jan  1 00:00:00 2001'; exit 0; fi
exec /bin/ps "$@"
`);
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\ncase "$1 $2" in\n  "plugin list") echo '[]';;\n  *) exit 1;;\nesac\n`);
  chmodSync(join(bin, 'ps'), 0o755);
  chmodSync(join(bin, 'claude'), 0o755);
  const hub = spawn(process.execPath, [CLI, 'hub', 'run'], {
    env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH ?? ''}`, DEEP_HUB_TEST_MANAGED_SETTINGS: join(home, 'no-managed.json') },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const agents: ChildProcess[] = [];
  let seq = 0;
  const transcriptOf = (session: string): string => {
    const work = join(home, 'work');
    const dir = join(home, '.claude', 'projects', work.replace(/[^a-zA-Z0-9]/g, '-'));
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${session}.jsonl`);
    writeFileSync(file, '', { flag: 'a' });
    return file;
  };
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("the hub wasn't ready within 10 s (is packages/cli built?)")), 10_000);
      hub.stdout!.once('data', () => { clearTimeout(timer); resolve(undefined); });
      hub.once('exit', () => { clearTimeout(timer); reject(Error('the hub exited before it was ready')); });
    });
    await body({
      root,
      home,
      psCalls: () => readFileSync(log, 'utf8').split('\n').filter(Boolean),
      clearPsLog: () => writeFileSync(log, ''),
      agent: () => {
        const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { argv0: join(home, 'versions', 'claude'), stdio: 'ignore' });
        agents.push(child);
        return child as ChildProcess & { pid: number };
      },
      hook: (session, event, ppid, extra = {}) => new Promise((resolve, reject) => {
        const work = join(home, 'work');
        mkdirSync(work, { recursive: true });
        const n = ++seq;
        const id = `01K74FKZVK8Q2X5R7M3N9P4T${ALPHABET[(n >> 5) & 31]}${ALPHABET[n & 31]}`;
        const line = `${JSON.stringify({ v: 1, agent: 'claude-code', event, seq: String(BigInt(Date.now()) * 1_000_000n + BigInt(n)), id, pid: ppid, ppid, matched: [], payload: { session_id: session, transcript_path: transcriptOf(session), cwd: work, hook_event_name: event, ...extra } })}\n`;
        const sock = net.connect(join(root, 'hub.sock'));
        let got = '';
        sock.on('data', (d) => {
          got += d;
          if (got.split('\n').length === 2) sock.write(line);
          if (got.split('\n').length > 2) { sock.destroy(); resolve(); }
        });
        sock.on('error', reject);
      }),
      recorded: async (session, kind, n) => {
        const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
        try {
          const count = () => (db.prepare('SELECT count(*) AS n FROM events WHERE kind = ? AND session_id = ?').get(kind, session) as { n: number }).n;
          for (const end = Date.now() + 15_000; Date.now() < end && count() < n; await sleep(50));
          return count();
        } finally { db.close(); }
      },
      starts: (session) => {
        const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
        try { return (db.prepare("SELECT unverified FROM events WHERE kind = 'session.start' AND session_id = ? ORDER BY log_pos").all(session) as { unverified: number }[]).map((r) => r.unverified); } finally { db.close(); }
      },
    });
  } finally {
    for (const a of agents) a.kill();
    if (hub.exitCode === null && hub.signalCode === null) {
      hub.kill('SIGTERM');
      await new Promise((resolve) => { hub.once('exit', resolve); setTimeout(resolve, 30_000); });
    }
    rmSync(home, { recursive: true, force: true });
  }
}

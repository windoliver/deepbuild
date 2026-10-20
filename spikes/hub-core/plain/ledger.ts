// The PID ledger: every process group this hub starts, appended to <state>/ledger.jsonl as it
// starts and as it's seen gone, so a hub restarted after kill -9 can stop what the killed one left.
import { execFileSync } from 'node:child_process';
import { existsSync, openSync, readFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';

type Entry = { pgid: number; at: number } | { pgid: number; gone: true };

export function killGroup(pgid: number): void {
  try {
    process.kill(-pgid, 'SIGKILL');
  } catch {
    // ESRCH: the group is already gone.
  }
}

export function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

// Waits until a group sent SIGKILL has no process left. A child forked as the signal landed can
// miss it, so a group still there after 100 ms of probes gets SIGKILL again.
export async function waitGroupGone(pgid: number): Promise<void> {
  for (let probe = 1; groupAlive(pgid); probe++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (probe % 20 === 0) killGroup(pgid);
  }
}

// Every process on the machine with its group and start time. ps prints whole seconds.
function processTable(): Array<{ pid: number; pgid: number; start: number }> {
  const out = execFileSync('ps', ['-axo', 'pid=,pgid=,lstart='], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });
  return out.split('\n').flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/);
    return match ? [{ pid: Number(match[1]), pgid: Number(match[2]), start: Date.parse(match[3] ?? '') }] : [];
  });
}

export class Ledger {
  readonly live = new Set<number>();
  readonly #fd: number;

  private constructor(fd: number) {
    this.#fd = fd;
  }

  // Stops what an earlier hub on this state left running, then starts a fresh ledger, open for the
  // hub's life: under endpoint security every open costs milliseconds of a blocked event loop.
  static async open(state: string): Promise<Ledger> {
    const path = join(state, 'ledger.jsonl');
    if (existsSync(path)) await reap(readFileSync(path, 'utf8'));
    return new Ledger(openSync(path, 'w'));
  }

  started(pgid: number): void {
    this.live.add(pgid);
    this.#write({ pgid, at: Date.now() });
  }

  gone(pgid: number): void {
    this.live.delete(pgid);
    this.#write({ pgid, gone: true });
  }

  #write(entry: Entry): void {
    // Synchronous, so the line is on disk before a kill -9 can land.
    writeSync(this.#fd, `${JSON.stringify(entry)}\n`);
  }
}

// Stops every group the ledger says started and was never seen gone. A group counts as the earlier
// hub's only while it still has members: its ID can't be reused until it's empty. If its leader is
// still among them, the leader must also have started when the ledger says (within ps's whole
// seconds), so a reused PID that leads a new group is left alone.
async function reap(ledger: string): Promise<void> {
  const open = new Map<number, number>();
  for (const line of ledger.split('\n')) {
    if (!line) continue;
    const entry = JSON.parse(line) as Entry;
    if ('gone' in entry) open.delete(entry.pgid);
    else open.set(entry.pgid, entry.at);
  }
  if (!open.size) return;
  const table = processTable();
  const stopping: Promise<void>[] = [];
  for (const [pgid, at] of open) {
    const members = table.filter((row) => row.pgid === pgid);
    const leader = members.find((row) => row.pid === pgid);
    if (!members.length) continue;
    if (leader && Math.abs(leader.start - at) >= 2000) {
      process.stderr.write(`left running: process group ${pgid} isn't the one the ledger recorded\n`);
      continue;
    }
    killGroup(pgid);
    stopping.push(waitGroupGone(pgid));
  }
  await Promise.all(stopping);
}

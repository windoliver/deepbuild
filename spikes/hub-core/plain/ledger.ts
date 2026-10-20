// The PID ledger: every process group this hub starts, appended to <state>/ledger.jsonl as it
// starts and as it's seen gone, so a hub restarted after kill -9 can stop what the killed one left.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Entry = { pgid: number; at: number } | { pgid: number; gone: true };

export function killGroup(pgid: number): void {
  try {
    process.kill(-pgid, 'SIGKILL');
  } catch {
    // ESRCH: the group is already gone.
  }
}

function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export async function waitGroupGone(pgid: number): Promise<void> {
  while (groupAlive(pgid)) await new Promise((resolve) => setTimeout(resolve, 10));
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
  readonly #path: string;

  constructor(state: string) {
    this.#path = join(state, 'ledger.jsonl');
  }

  started(pgid: number): void {
    this.live.add(pgid);
    this.#append({ pgid, at: Date.now() });
  }

  gone(pgid: number): void {
    this.live.delete(pgid);
    this.#append({ pgid, gone: true });
  }

  // Stops every group an earlier hub on this state started and never saw gone, then starts a fresh
  // ledger. A group counts as that hub's only while it still has members: its ID can't be reused
  // until it's empty. If its leader is still among them, the leader must also have started when the
  // ledger says (within ps's whole seconds), so a reused PID that leads a new group is left alone.
  async reap(): Promise<void> {
    const open = new Map<number, number>();
    if (existsSync(this.#path)) {
      for (const line of readFileSync(this.#path, 'utf8').split('\n')) {
        if (!line) continue;
        const entry = JSON.parse(line) as Entry;
        if ('gone' in entry) open.delete(entry.pgid);
        else open.set(entry.pgid, entry.at);
      }
    }
    if (open.size) {
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
    writeFileSync(this.#path, '');
  }

  #append(entry: Entry): void {
    // Written synchronously, so the entry is on disk before a kill -9 can land.
    appendFileSync(this.#path, `${JSON.stringify(entry)}\n`);
  }
}

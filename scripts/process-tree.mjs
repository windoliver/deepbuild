import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

function processTable() {
  const result = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,pgid=,stat=,lstart='], { env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' }, encoding: 'utf8', maxBuffer: 1 << 24 });
  if (result.status !== 0 || !result.stdout) return null;
  const rows = new Map();
  for (const line of result.stdout.split('\n')) {
    const row = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
    if (row && !row[4].startsWith('Z')) rows.set(Number(row[1]), { ppid: Number(row[2]), pgid: Number(row[3]), start: row[5] });
  }
  return rows;
}

export async function endTree(unreapedChild) {
  const owned = new Map(), leaders = new Set();
  const isOwned = (rows, pid) => owned.has(pid) && rows.get(pid)?.start === owned.get(pid);
  const childRuns = () => unreapedChild.exitCode === null && unreapedChild.signalCode === null;
  const ownedIn = (rows) => [...rows.keys()].filter((pid) => isOwned(rows, pid));
  for (const deadline = Date.now() + 10_000; Date.now() < deadline; await sleep(100)) {
    const rows = processTable();
    if (!rows) {
      if (childRuns()) try { process.kill(unreapedChild.pid, 'SIGKILL'); } catch {}
      continue;
    }
    if (childRuns() && !owned.has(unreapedChild.pid) && rows.has(unreapedChild.pid)) owned.set(unreapedChild.pid, rows.get(unreapedChild.pid).start);
    for (let grew = true; grew;) {
      grew = false;
      for (const [pid, row] of rows) if (isOwned(rows, pid) && row.pgid === pid) leaders.add(pid);
      const ownedGroups = new Set([...rows].filter(([pid, row]) => isOwned(rows, pid) && leaders.has(row.pgid)).map(([, row]) => row.pgid));
      for (const [pid, row] of rows) if (!owned.has(pid) && (isOwned(rows, row.ppid) || ownedGroups.has(row.pgid))) { owned.set(pid, row.start); grew = true; }
    }
    const left = ownedIn(rows);
    if (!left.length) return left;
    for (const pid of left) try { process.kill(pid, 'SIGKILL'); } catch {}
  }
  const rows = processTable();
  return rows ? ownedIn(rows) : null;
}

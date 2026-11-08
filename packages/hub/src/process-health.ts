// The hub's own process in its health (#41): open files, resident memory and child processes, so the release soak
// can fail on steady growth in any of them.
import { execFile } from 'node:child_process';
import { fstatSync, readdirSync } from 'node:fs';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Every process under `pid`, its children's children included, from one `ps` listing. */
async function descendants(pid: number): Promise<number> {
  const { stdout } = await run('ps', ['-A', '-o', 'pid=,ppid=']);
  const kids = new Map<number, number[]>();
  for (const line of stdout.split('\n')) {
    const [child, parent] = line.trim().split(/\s+/).map(Number);
    if (child && parent !== undefined) kids.set(parent, [...(kids.get(parent) ?? []), child]);
  }
  let count = 0;
  const next = [...(kids.get(pid) ?? [])];
  while (next.length) {
    const at = next.pop()!;
    // The ps this reading started is no child of the hub's to count.
    count++;
    next.push(...(kids.get(at) ?? []));
  }
  return count;
}

export async function processHealth(): Promise<{ openFiles: number; rssBytes: number; children: number }> {
  // Every descriptor number that fstat finds open: macOS's /dev/fd listing leaves some kinds out. The probe runs well
  // past the highest number the listing shows, since descriptors can be sparse.
  const listed = readdirSync(process.platform === 'linux' ? '/proc/self/fd' : '/dev/fd').map(Number).filter(Number.isInteger);
  const top = Math.max(1024, ...listed.map((fd) => fd * 2));
  const count = () => {
    let open = 0;
    for (let fd = 0; fd <= top; fd++) {
      try { fstatSync(fd); open++; } catch { /* not open */ }
    }
    return open;
  };
  // The files it holds, not one a passing step opens for a moment: the fewest of three counts a few ms apart.
  let openFiles = count();
  for (let i = 0; i < 2; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    openFiles = Math.min(openFiles, count());
  }
  const children = Math.max(0, (await descendants(process.pid)) - 1);
  return { openFiles, rssBytes: process.memoryUsage.rss(), children };
}

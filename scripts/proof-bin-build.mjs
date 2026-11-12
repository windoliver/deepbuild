// Binary build ownership: a detached guardian survives the lease wrapper, but starts Cargo only after
// its group identity is durably recorded for the bay's cleanup-before-reuse barrier.
import { fork, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { constants } from 'node:os';
import { fileURLToPath } from 'node:url';

const self = fileURLToPath(import.meta.url);
const exitCode = (status, signal) => signal ? 128 + constants.signals[signal] : status ?? 3;
const env = { ...process.env, TZ: 'UTC', LC_ALL: 'C' };
function identity(pid) {
  const result = spawnSync('ps', ['-o', 'ppid=,stat=,lstart=', '-p', String(pid)], { encoding: 'utf8', env });
  if (result.error || (result.status !== 0 && result.status !== 1)) throw Error('BLOCKED test binaries: process identity scan failed');
  const row = result.stdout?.trim().match(/^(\d+)\s+(\S+)\s+(.+)$/);
  return row && !row[2].startsWith('Z') ? { pid: Number(pid), parent: Number(row[1]), start: row[3] } : null;
}
const live = ({ pid, start }) => identity(pid)?.start === start;
const signalGroup = (group, signal) => {
  const current = identity(group.pid);
  if (current && current.start !== group.start) throw Error('BLOCKED test binaries: build group identity changed');
  try { process.kill(-group.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
};
const groupAlive = (group) => {
  const result = spawnSync('ps', ['-A', '-o', 'pid=,pgid=,stat=,lstart='], { encoding: 'utf8', maxBuffer: 1 << 24, env });
  if (result.status !== 0 || !result.stdout?.trim()) throw Error('BLOCKED test binaries: process group scan failed');
  const rows = result.stdout.split('\n').map(row => row.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/)).filter(Boolean);
  const leader = rows.find(([, pid]) => Number(pid) === group.pid);
  if (leader && leader[4].trim() !== group.start) throw Error('BLOCKED test binaries: build group identity changed');
  return rows.some(([, , pgid, state]) => Number(pgid) === group.pid && !state.startsWith('Z'));
};

if (process.argv[2] === '--worker') {
  // An IPC-gated group leader retains its PID until the guardian has checked all compiler descendants.
  const [command, ...args] = process.argv.slice(3);
  let child;
  process.on('disconnect', () => { try { process.kill(-process.pid, 'SIGKILL'); } catch { process.exit(3); } });
  process.on('message', (message) => {
    if (message === 'start' && !child) {
      child = spawn(command, args, { stdio: 'inherit' });
      child.once('error', (error) => process.send?.({ status: 3, error: error.message }));
      child.once('close', (status, signal) => process.send?.({ status, signal }));
    }
  });
} else {
  const [directory, ownerPid, started, command, ...args] = process.argv.slice(2);
  const owner = { pid: Number(ownerPid), start: started };
  if (!directory || !ownerPid || !started || !command || !live(owner)) process.exit(3);
  if (!process.send) {
    const lineage = [];
    for (let pid = process.ppid; pid > 1;) {
      const found = identity(pid);
      if (!found) process.exit(3);
      lineage.push(found);
      if (pid === owner.pid) break;
      pid = found.parent;
    }
    if (!lineage.some(peer => peer.pid === owner.pid && peer.start === owner.start)) {
      console.error('BLOCKED test binaries: build owner is not a live launch ancestor'); process.exit(3);
    }
    const guardian = fork(self, process.argv.slice(2), { detached: true, stdio: ['inherit', 'inherit', 'inherit', 'ipc'], execArgv: [] });
    guardian.send(lineage);
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => guardian.kill(signal));
    guardian.once('error', error => { console.error(`BLOCKED test binaries: ${error.message}`); process.exitCode = 3; });
    guardian.once('exit', (status, signal) => process.exit(exitCode(status, signal)));
  } else process.once('message', (lineage) => {
    if (!live(owner) || !lineage.every(live) || !process.connected) process.exit(3);
    const worker = fork(self, ['--worker', command, ...args], { detached: true, stdio: ['inherit', 'inherit', 'inherit', 'ipc'], execArgv: [] });
    const group = identity(worker.pid), supervisor = identity(process.pid);
    if (!group || !supervisor) { worker.kill('SIGKILL'); process.exit(3); }
    const recordDir = join(process.cwd(), 'target', '.deep-proof-builds');
    mkdirSync(recordDir, { recursive: true });
    const recordFile = join(recordDir, `${process.pid}.json`), temp = `${recordFile}.tmp`;
    writeFileSync(temp, JSON.stringify({ owner, supervisor, group })); renameSync(temp, recordFile);
    let finishing = false, timer;
    const finish = async (status, signal, stopped = false, problem) => {
      if (finishing) return; finishing = true; clearInterval(timer);
      try {
        if (problem) console.error(`BLOCKED test binaries: ${problem}`);
        // The gated leader is still alive, so group identity cannot be recycled before this kill.
        signalGroup(group, 'SIGKILL');
        if (stopped) rmSync(directory, { recursive: true, force: true });
        const deadline = Date.now() + 5000;
        while (groupAlive(group) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
        if (groupAlive(group)) throw Error('BLOCKED test binaries: build group did not stop');
        if (stopped) rmSync(directory, { recursive: true, force: true });
        rmSync(recordFile, { force: true });
        process.exit(stopped || problem ? 3 : exitCode(status, signal));
      } catch (error) { console.error(error.message); process.exit(3); } // Retain record: a bay cannot claim unverified cleanup.
    };
    const stop = () => void finish(3, null, true);
    process.on('disconnect', stop);
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, stop);
    worker.once('error', error => void finish(3, null, true, error.message));
    worker.on('message', ({ status, signal, error }) => void finish(status, signal, false, error));
    worker.once('exit', () => { if (!finishing) void finish(3, null, true, 'build leader exited without a result'); });
    timer = setInterval(() => { try { if (!live(owner) || !lineage.every(live)) stop(); } catch (error) { void finish(3, null, true, error.message); } }, 250);
    if (!process.connected || !live(owner) || !lineage.every(live)) stop(); else worker.send('start');
  });
}

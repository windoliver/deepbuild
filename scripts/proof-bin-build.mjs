// Build supervision stays outside the bay/lease launcher's group. Its IPC pipe also closes on SIGKILL,
// so reclaiming a bay or timing out a spawn cannot strand Cargo in another process group.
import { fork, spawn, spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { constants } from 'node:os';
import { fileURLToPath } from 'node:url';

const [directory, owner, started, command, ...args] = process.argv.slice(2);
const ownerAlive = () => {
  const row = spawnSync('ps', ['-o', 'stat=,lstart=', '-p', owner], { encoding: 'utf8', env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' } }).stdout?.trim();
  const match = row?.match(/^(\S+)\s+(.+)$/);
  return Boolean(match && !match[1].startsWith('Z') && match[2] === started);
};
if (!directory || !owner || !started || !command || !ownerAlive()) process.exit(3);
const exitCode = (status, signal) => signal ? 128 + constants.signals[signal] : status ?? 3;
if (!process.send) {
  const supervisor = fork(fileURLToPath(import.meta.url), process.argv.slice(2), { detached: true, stdio: ['inherit', 'inherit', 'inherit', 'ipc'], execArgv: [] });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => supervisor.kill(signal));
  supervisor.on('error', (error) => { console.error(`BLOCKED test binaries: ${error.message}`); process.exitCode = 3; });
  supervisor.on('exit', (status, signal) => process.exit(exitCode(status, signal)));
} else {
  const child = spawn(command, args, { stdio: 'inherit', detached: true });
  let stopped = false;
  const kill = () => { if (child.pid) try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
  const stop = () => { stopped = true; kill(); rmSync(directory, { recursive: true, force: true }); };
  const timer = setInterval(() => { if (!ownerAlive()) stop(); }, 250);
  process.on('disconnect', stop);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, stop);
  child.on('error', (error) => { console.error(`BLOCKED test binaries: ${error.message}`); });
  child.on('close', async (status, signal) => {
    // A leader can exit while a build-script child keeps writing. Quiesce this owned group before returning.
    const groupAlive = () => child.pid && spawnSync('ps', ['-A', '-o', 'pgid=,stat='], { encoding: 'utf8', maxBuffer: 1 << 24 }).stdout?.split('\n')
      .some((row) => { const m = row.trim().split(/\s+/); return m[0] === String(child.pid) && !m[1]?.startsWith('Z'); });
    if (groupAlive()) kill();
    const deadline = Date.now() + 5000;
    while (groupAlive() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    const remaining = groupAlive();
    clearInterval(timer);
    if (stopped) rmSync(directory, { recursive: true, force: true });
    process.exit(stopped || remaining ? 3 : exitCode(status, signal));
  });
}

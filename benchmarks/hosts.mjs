// The host link's workload, for the perf lane's budgets (issue #1942): node benchmarks/hosts.mjs. One process names the
// reference Mac's Lima VM deep-ubuntu in a temp home's SSH config, refreshes its facts over SSH, and starts a remote run
// there that writes 20 lines stamped with the host's clock, 100 ms apart, failing unless the facts hold the VM's kernel
// release, every line arrives in order within 500 ms and the run ends 0. The issue's 5 s refresh and 500 ms lag stay in
// tests/acceptance/1942/budgets.test.ts.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hosts } from '../packages/hub/dist/hosts.js';

const lima = join(homedir(), '.lima', 'deep-ubuntu', 'ssh.config');
const values = new Map(readFileSync(lima, 'utf8').split('\n').map((l) => /^\s+(\S+)\s+(.+?)\s*$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2].replace(/^"(.*)"$/, '$1')]));
const home = mkdtempSync(join(tmpdir(), 'deep-hosts-bench-'));
try {
  mkdirSync(join(home, '.ssh'), { mode: 0o700 });
  copyFileSync(values.get('UserKnownHostsFile'), join(home, '.ssh', 'known_hosts'));
  writeFileSync(join(home, '.ssh', 'config'), ['Host bench', '  HostName 127.0.0.1', `  Port ${values.get('Port')}`, `  User ${values.get('User')}`, `  IdentityFile ${values.get('IdentityFile')}`,
    '  IdentitiesOnly yes', `  UserKnownHostsFile ${join(home, '.ssh', 'known_hosts')}`, `  HostKeyAlias ${values.get('HostKeyAlias')}`, ''].join('\n'), { mode: 0o600 });
  const ssh = (cmd) => execFileSync('ssh', ['-F', join(home, '.ssh', 'config'), 'bench', cmd], { encoding: 'utf8' });
  const kernel = ssh('uname -r').trim();
  // The host's clock less this one's, from the round trip's middle.
  const t0 = Date.now();
  const offset = Number(BigInt(ssh('date +%s%N').trim()) / 1_000_000n) - (t0 + Date.now()) / 2;
  process.env.HOME = home;
  const hosts = new Hosts({ root: home, now: Date.now, plant: undefined, raise: () => Promise.reject(Error('no asks here')) });
  const { facts } = await hosts.facts('bench', true);
  if (!JSON.stringify(facts.system.value).includes(kernel)) throw Error(`the facts don't hold the kernel release ${kernel}`);
  const lags = [];
  let text = '';
  const { ended } = hosts.run({
    host: 'bench', token: randomBytes(24).toString('base64url'), env: {}, argv: ['/bin/sh', '-c', 'i=0; while [ $i -lt 20 ]; do echo "$i $(date +%s%N)"; i=$((i + 1)); sleep 0.1; done'],
    output: { stdout: (chunk) => { const at = Date.now(); text += chunk; for (const m of String(chunk).matchAll(/(\d+) (\d{15,})\n/g)) lags.push(at - (Number(BigInt(m[2]) / 1_000_000n) - offset)); }, stderr: () => undefined },
  });
  const end = await ended;
  const order = text.trim().split('\n').map((l) => Number(l.split(' ')[0]));
  if (end.code !== 0 || order.join() !== Array.from({ length: 20 }, (_, i) => i).join()) throw Error(`the run ended ${JSON.stringify(end)} with lines ${order.join()}`);
  if (Math.max(...lags) > 500) throw Error(`a line came ${Math.max(...lags).toFixed(0)} ms after the host wrote it`);
} finally {
  rmSync(home, { recursive: true, force: true });
}

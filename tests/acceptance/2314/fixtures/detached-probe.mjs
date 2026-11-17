// Test-owned input to the public runProbe API. No environment injection or sandbox exemption.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const { marker } = JSON.parse(readFileSync(0, 'utf8'));
// On POSIX, detached creates a new session/process group. Ignored stdio means the
// child cannot keep the probe's pipes open and accidentally delay run resolution.
const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)', marker], {
  detached: true,
  stdio: 'ignore',
});
child.unref();
// Both processes outlive the check's 4 s deadline, but have a finite safety lifetime.
setTimeout(() => {}, 60_000);

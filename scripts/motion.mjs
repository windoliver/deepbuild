// The motion lane (#1427): the motion check on the three shipped journeys (Needs you, a session page and the project
// page), each recorded at every 1/120 s step of a replica's virtual clock. It prints one line a journey, with its claim,
// its findings and its recording's hash, then says pacing was not measured. It exits 0 only when every journey passes.
// Needs target/debug/deep-drive (cargo build --locked -p deep-replica --bin deep-drive) and macOS.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const out = mkdtempSync(join(tmpdir(), 'motion-lane-'));
const child = spawn('target/debug/deep-drive', ['--out', out], { stdio: ['pipe', 'pipe', 'inherit'] });
const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
const next = async () => JSON.parse((await lines.next()).value ?? '{}');

let code = 1;
try {
  if ((await next()).ready !== true) throw new Error('deep-drive did not start');
  child.stdin.write(`${JSON.stringify({ call: 'motion_check', motion_check: { shipped: true } })}\n`);
  const reply = await next();
  if (reply.ok !== true) throw new Error(`motion_check: ${JSON.stringify(reply.error)}`);
  for (const j of reply.journeys) {
    console.log(`motion ${j.name}: ${j.claim}, ${j.findings.length} finding(s), recording ${j.recording.sha256} (${j.recording.frames} steps)`);
    for (const f of j.findings) console.log(`  ${f.finding} on ${f.element} at t ${f.t}: ${f.value}`);
  }
  for (const s of reply.stale) console.log(`  stale allowance: ${s.finding} on ${s.element}`);
  for (const i of reply.invalid) console.log(`  INVALID allowance: ${i.why}`);
  console.log(`motion: ${reply.claim}; ${reply.pacing}`);
  code = reply.claim === 'PASS' ? 0 : 1;
} catch (error) {
  console.log(`motion: BLOCKED: ${error.message}; pacing not measured`);
} finally {
  child.stdin.end();
  rmSync(out, { recursive: true, force: true });
}
process.exit(code);

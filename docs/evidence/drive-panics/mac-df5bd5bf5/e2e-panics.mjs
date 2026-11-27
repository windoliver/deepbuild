import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const dest = process.argv[2];
mkdirSync(dest, { recursive: true });
const FLICKS = 705_600_000;
const out = mkdtempSync(join(tmpdir(), 'e2e-3012-'));
const child = spawn('target/debug/deep-drive', ['--out', out], { stdio: ['pipe', 'pipe', 'pipe'] });
let stderr = '';
child.stderr.on('data', (d) => { stderr += d; });
let exited = null;
child.on('exit', (code, signal) => { exited = { code, signal }; });
const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
const next = async () => { const l = await lines.next(); return l.done ? { ok: false, error: { code: 'deep-drive exited', exited } } : JSON.parse(l.value); };
const call = async (c) => { child.stdin.write(`${JSON.stringify(c)}\n`); return next(); };
const log = [];
const say = (s) => { console.log(s); log.push(s); };
let failures = 0;
const step = async (what, c) => {
  const r = await call(c);
  if (r.ok === false) { failures += 1; say(`  ERROR ${what}: ${JSON.stringify(r.error).slice(0, 300)}`); }
  else say(`  ok   ${what}${typeof r.t === 'number' ? ` (t ${r.t})` : ''}`);
  return r;
};
const shot = async (name, replica) => {
  const r = await step(`screenshot ${name}`, { call: 'screenshot', replica, screenshot: { target: 'window' } });
  if (r.path) { copyFileSync(r.path, join(dest, `${name}.png`)); say(`       ${name}.png ${r.w}x${r.h}`); }
};
const ASK = 'ask:01MCBHM300GP83QANM5WDCWNNP';
try {
  await next();
  say('launch 1: hover an ask row, then resize');
  const one = await step('launch', { call: 'launch', launch: { from: 'fixture', center: 'deepbuild/needs-you', clock: 'virtual' } });
  await step(`hover ${ASK}`, { call: 'act', replica: one.replica, locator: { id: ASK }, act: { kind: 'hover' } });
  await step('resize 1200x800', { call: 'resize', replica: one.replica, resize: { size: [1200, 800] } });
  await step('wait_for +1 s', { call: 'wait_for', replica: one.replica, wait_for: { t: (one.t ?? 0) + FLICKS }, timeout: 60_000 });
  await shot('launch1-after-resize', one.replica);
  await step('close', { call: 'close', replica: one.replica });
  for (const n of [2, 3]) {
    say(`launch ${n}: a later launch in the same process, its clock stepped`);
    const r = await step('launch', { call: 'launch', launch: { from: 'fixture', center: 'deepbuild/needs-you', clock: 'virtual' } });
    await step(`hover ${ASK}`, { call: 'act', replica: r.replica, locator: { id: ASK }, act: { kind: 'hover' } });
    await step('wait_for +3 s', { call: 'wait_for', replica: r.replica, wait_for: { t: (r.t ?? 0) + 3 * FLICKS }, timeout: 60_000 });
    await shot(`launch${n}-after-3s`, r.replica);
    await step('close', { call: 'close', replica: r.replica });
  }
  say('motion_check: the shipped journeys, launched in the same process');
  const m = await step('motion_check', { call: 'motion_check', motion_check: { shipped: true } });
  for (const j of m.journeys ?? []) say(`       ${j.name}: ${j.claim}, ${j.findings.length} finding(s), recording ${j.recording.sha256.slice(0, 16)}…`);
  if (m.claim !== undefined) { say(`       motion: ${m.claim}`); if (m.claim !== "PASS") failures += 1; }
  say(failures === 0 && !/panicked/.test(stderr) ? 'e2e: no error, no panic' : `e2e: ${failures} error(s)${/panicked/.test(stderr) ? ', a panic' : ''}`);
} finally {
  child.stdin.end();
  writeFileSync(join(dest, 'e2e-log.txt'), `${log.join('\n')}\n`);
  writeFileSync(join(dest, 'e2e-stderr.txt'), stderr);
  rmSync(out, { recursive: true, force: true });
}
process.exitCode = failures === 0 ? 0 : 1;

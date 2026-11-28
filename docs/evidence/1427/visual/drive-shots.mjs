import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const [bin, dest, ...only] = process.argv.slice(2);
mkdirSync(dest, { recursive: true });
const FLICKS = 705_600_000;
const out = mkdtempSync(join(tmpdir(), 'v3028-'));
const child = spawn(bin, ['--out', out], { stdio: ['pipe', 'pipe', 'pipe'] });
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
  else say(`  ok   ${what} (t ${r.t})`);
  return r;
};
const SESSION = 'session:01MCBH57D812FQ88XJ33AV9KCE';
const journeys = [
  ['needs-you', 'deepbuild/needs-you', 'ask:01MCBHM300GP83QANM5WDCWNNP'],
  ['session', 'deepbuild/session', SESSION],
  ['project', 'deepbuild/home', SESSION],
];
const OFFSETS_MS = [0, 50, 100, 200, 1000, 1500, 1550, 1600, 1650, 1700, 2000, 3000];
try {
  await next();
  for (const [name, center, row] of journeys.filter(([n]) => only.length === 0 || only.includes(n))) {
    say(`journey ${name}: ${center}, hover ${row}`);
    const l = await step('launch', { call: 'launch', launch: { from: 'fixture', center, clock: 'virtual', size: [1512, 2048] } });
    const replica = l.replica;
    const shot = async (label) => {
      const r = await step(`screenshot ${label}`, { call: 'screenshot', replica, screenshot: { target: 'window' } });
      if (r.path) { copyFileSync(r.path, join(dest, `${name}-${label}.png`)); say(`       ${name}-${label}.png ${r.w}x${r.h} t ${r.t}`); }
    };
    await shot('launch');
    const h = await step(`hover ${row}`, { call: 'act', replica, locator: { id: row }, act: { kind: 'hover' } });
    for (const ms of OFFSETS_MS) {
      const t = h.t + Math.round((ms * FLICKS) / 1000);
      if (ms > 0) await step(`wait_for hover+${ms} ms`, { call: 'wait_for', replica, wait_for: { t }, timeout: 60_000 });
      await shot(`hover+${String(ms).padStart(4, '0')}ms`);
    }
    await step('close', { call: 'close', replica });
  }
  say(failures === 0 && !/panicked/.test(stderr) ? 'drive: no error, no panic' : `drive: ${failures} error(s)${/panicked/.test(stderr) ? ', a panic' : ''}`);
} finally {
  child.stdin.end();
  const tag = only.length ? `-${only.join('-')}` : '';
  writeFileSync(join(dest, `drive-log${tag}.txt`), `${log.join('\n')}\n`);
  writeFileSync(join(dest, `drive-stderr${tag}.txt`), stderr);
  rmSync(out, { recursive: true, force: true });
}
process.exitCode = failures === 0 ? 0 : 1;

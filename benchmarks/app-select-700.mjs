// Selecting a row in the app's list of 700 sessions, for the perf lane's budgets (issue #1461): node
// benchmarks/app-select-700.mjs. It writes a record of 700 working sessions in 7 projects, with the list's rows the hub
// builds for them, launches the replica (target/debug/deep-drive, built by the suite or `cargo build -p deep-replica
// --bin deep-drive`) on it with the real clock, and presses a row at its point 21 times, the first a warm-up, timing each
// press through the frames drawn after it. It prints the median as one JSON line and fails unless each press opened its
// row's page. The issue's 100 ms at the 95th percentile stays in tests/acceptance/1461/budget.test.ts.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const DRIVE = join(process.env.CARGO_TARGET_DIR ?? join(REPO, 'target'), 'debug', 'deep-drive');
if (!existsSync(DRIVE)) throw Error(`no ${DRIVE}: build it with cargo build -p deep-replica --bin deep-drive`);
const ROWS = 700;
const END = Date.now() - 60_000;
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const pad = (n) => String(Math.max(0, n)).padStart(16, '0');

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'app-select-bench-')));
const lines = [];
let pos = 0;
for (let n = 0; n < ROWS; n++) {
  const session = `bench-${String(n).padStart(3, '0')}`;
  const project = `repo${n % 7}`;
  const at = END - 3_600_000 + n * 1000;
  lines.push({ session_id: session, event: { v: 3, id: `s${n}`, kind: 'session.start', ts: at, log_pos: ++pos, data: { agent: 'claude-code', worktree: `/work/${project}`, branch: 'main', thread: session, loads: [] } } });
  // The row the hub builds for a working session, placed as rows.ts's orderOf places it.
  const row = { id: `session:${session}`, address: `session/${session}`, title: `Task ${String(n + 1).padStart(3, '0')}`, project, session, agent: 'claude-code', entry: 'running', word: 'working', why: '', waits_on: 'agent', since: at, actions: [], unread: false };
  lines.push({ session_id: session, event: { v: 1, id: `r${n}`, kind: 'row.set', ts: at, log_pos: ++pos, writer: 'core', data: { listed: true, order: `0|1|${project}|3|${pad(at)}|${row.id}`, ...row } } });
}
const fixture = join(dir, 'record.jsonl');
writeFileSync(fixture, lines.map((l) => JSON.stringify(l)).join('\n'));

const drive = spawn(DRIVE, ['--out', join(dir, 'out')], { cwd: REPO, env: { ...process.env, HOME: dir }, stdio: ['pipe', 'pipe', 'inherit'] });
let buffer = '';
const waiting = [];
drive.stdout.setEncoding('utf8').on('data', (d) => {
  buffer += d;
  for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
    const line = buffer.slice(0, i);
    buffer = buffer.slice(i + 1);
    waiting.shift()?.(JSON.parse(line));
  }
});
const next = () => new Promise((resolve) => waiting.push(resolve));
const call = async (args) => {
  const reply = next();
  drive.stdin.write(`${JSON.stringify(args)}\n`);
  const got = await reply;
  if (got.ok === false) throw Error(`${args.call}: ${JSON.stringify(got.error)}`);
  return got;
};
try {
  await next();
  await call({ call: 'launch', launch: { from: 'fixture', fixture, clock: 'real', size: [1512, 982] } });
  const seen = await call({ call: 'see' });
  const rows = [];
  const walk = (n) => { if (typeof n.id === 'string' && /^session:[^:]+$/.test(n.id)) rows.push(n); for (const c of n.children ?? []) walk(c); };
  walk(seen.snapshot.tree);
  if (rows.length < 2) throw Error(`the list draws ${rows.length} session rows`);
  const runs = [];
  for (let i = 0; i <= 20; i++) {
    const row = rows[i % Math.min(rows.length, 10)];
    const [x, y, w, h] = row.bounds;
    const t0 = performance.now();
    await call({ call: 'act', act: { kind: 'click', point: [Math.round(x + w / 2), Math.round(y + h / 2)] } });
    const ms = performance.now() - t0;
    const after = await call({ call: 'see' });
    if (after.address !== row.id.replace(/^session:/, 'session/')) throw Error(`a press on ${row.id} opened ${after.address}`);
    if (i > 0) runs.push(ms);
  }
  console.log(JSON.stringify({ selectMs: median(runs), rows: ROWS }));
} finally {
  drive.stdin.end();
  await new Promise((resolve) => (drive.exitCode !== null ? resolve() : drive.once('exit', resolve)));
  rmSync(dir, { recursive: true, force: true });
}

// `deep` over 700 rows, for the perf lane's budgets (issue #1463): node benchmarks/deep-list.mjs. It seeds a record in
// a temp HOME with 140 sessions in 7 repos, each with five open asks, starts the hub on it, and times five `deep` runs
// after a warm-up, printing the median as one JSON line. Each run must list the 700 asks with their one count. The
// issue's 100 ms stays in tests/acceptance/1463/budget.test.ts. It stops only the hub it started, by PID.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { askSources } from '../packages/asks/dist/index.js';
import { openRecord } from '../packages/record/dist/index.js';

const CLI = fileURLToPath(new URL('../packages/cli/dist/main.js', import.meta.url));
const DAY = 86_400_000;
const END = Date.now() - 60_000;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let counter = 0n;
/** A ULID at `ms`, with a counter for its random part: unique and ordered. */
function ulidAt(ms) {
  let s = '';
  let value = (BigInt(ms) << 80n) | counter++;
  for (let i = 0; i < 26; i++) { s = CROCKFORD[Number(value & 31n)] + s; value >>= 5n; }
  return s;
}
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const choice = askSources().find((row) => row.kind === 'choice').fixture.ask;

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-list-bench-')));
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('DEEP_') && !k.startsWith('CLAUDE'))), HOME: dir, LC_ALL: 'C' };
mkdirSync(join(dir, '.deepbuild'), { recursive: true, mode: 0o700 });
// Setup finished here, so `deep` lists and sets nothing up.
writeFileSync(join(dir, '.deepbuild', 'setup-finished.json'), JSON.stringify({ version: JSON.parse(readFileSync(new URL('../packages/cli/package.json', import.meta.url), 'utf8')).version }));
const record = await openRecord({ path: join(dir, '.deepbuild', 'ledger.db'), now: () => END });
for (let n = 0; n < 140; n++) {
  const session = `bench-${String(n).padStart(3, '0')}`;
  const project = `repo${n % 7}`;
  const who = { writer: 'hook', actor: 'you', scope: 'you', session, project, agent: 'claude-code' };
  const at = END - 3_600_000 + n * 1000;
  await record.append(who, { v: 3, id: ulidAt(at), kind: 'session.start', ts: at, data: { agent: 'claude-code', worktree: `/work/${project}`, branch: 'main', thread: session, loads: [] } });
  // Each ask its own key, so none supersedes another.
  for (let k = 0; k < 5; k++) {
    const ts = END - 600_000 + n * 10 + k;
    await record.append({ ...who, writer: 'core' }, { v: 1, id: ulidAt(ts), kind: 'ask.created', ts, data: { ...structuredClone(choice), question: `Keep store ${n}-${k} on SQLite or plain files?`, deadline: END + DAY, key: createHash('sha256').update(`deep-list ${n}-${k}`).digest('hex') } });
  }
}
await record.close();

const hub = spawn(process.execPath, [CLI, 'hub', 'run'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
try {
  await new Promise((resolve, reject) => { hub.stdout.once('data', resolve); hub.once('exit', () => reject(Error('the hub did not start'))); });
  const runs = [];
  for (let i = 0; i <= 5; i++) {
    const t0 = performance.now();
    const out = execFileSync(process.execPath, [CLI], { env, encoding: 'utf8' });
    const ms = performance.now() - t0;
    if (!out.trimEnd().endsWith('700 asks need you')) throw Error(`deep didn't end on "700 asks need you":\n${out.slice(-2000)}`);
    // The first run warms the hub, which builds the rows, and the file cache; it isn't counted.
    if (i > 0) runs.push(ms);
  }
  console.log(JSON.stringify({ deepMs: median(runs), rows: 840 }));
} finally {
  hub.kill('SIGTERM');
  await new Promise((resolve) => (hub.exitCode !== null ? resolve() : hub.once('exit', resolve)));
  rmSync(dir, { recursive: true, force: true });
}

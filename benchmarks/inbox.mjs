// `deep inbox` over 30 days of asks, for the perf lane's budgets (issue #24): node benchmarks/inbox.mjs.
// It seeds a record in a temp HOME with a heavy month, 20 sessions a day each raising five asks, the first 29 days'
// asks closed at their defaults and the last day's 100 open, starts the hub on it, and times five `deep inbox`
// runs after a warm-up, printing the median as one JSON line. The issue's 300 ms stays in
// tests/acceptance/24/budgets.test.ts. It stops only the hub it started, by PID.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
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
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const taste = askSources().find((row) => row.kind === 'taste').fixture.ask;

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-inbox-bench-')));
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('DEEP_') && !k.startsWith('CLAUDE'))), HOME: dir, LC_ALL: 'C' };
mkdirSync(join(dir, '.deepbuild'), { recursive: true, mode: 0o700 });
const record = await openRecord({ path: join(dir, '.deepbuild', 'ledger.db'), now: () => END });
let open = 0;
// Appends running together don't keep their order, so every ask is in before any default that closes it.
const appends = [];
const defaults = [];
for (let d = 0; d < 30; d++) {
  for (let s = 0; s < 20; s++) {
    const session = `D${d}S${s}`;
    const at = END - (30 - d) * DAY + s * 1_800_000;
    appends.push(record.append({ writer: 'hook', actor: 'you', scope: 'you', session }, { v: 1, id: ulidAt(at), kind: 'session.start', ts: at, data: { agent: 'claude-code', worktree: '/nowhere', branch: 'main', thread: session } }));
    for (let n = 0; n < 5; n++) {
      const id = ulidAt(at + n);
      const data = { ...structuredClone(taste), question: `Which header for ${session} screen ${n}?`, key: sha256(`${session}:${n}`), pinned_to: { kind: 'evidence', ref: sha256(`${session} screen ${n}`) }, deadline: at + (d === 29 ? 3 * DAY : DAY) };
      appends.push(record.append({ writer: 'core', actor: 'you', scope: 'you', session }, { v: 1, id, kind: 'ask.created', ts: at + n, data }));
      if (d < 29) defaults.push({ session, input: { v: 1, id: ulidAt(at + DAY), kind: 'ask.defaulted', subject: `ask:${id}`, ts: at + DAY, data: { answer: taste.default, plan_hash: null, decision: 'none' } } });
      else open++;
    }
  }
}
await Promise.all(appends);
await Promise.all(defaults.map(({ session, input }) => record.append({ writer: 'core', actor: 'you', scope: 'you', session }, input)));
await record.close();

const hub = spawn(process.execPath, [CLI, 'hub', 'run'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
try {
  await new Promise((resolve, reject) => { hub.stdout.once('data', resolve); hub.once('exit', () => reject(Error('the hub did not start'))); });
  const runs = [];
  for (let i = 0; i <= 5; i++) {
    const t0 = performance.now();
    const out = execFileSync(process.execPath, [CLI, 'inbox'], { env, encoding: 'utf8' });
    const ms = performance.now() - t0;
    const listed = out.split('\n').filter((line) => line.startsWith('ask:')).length;
    if (listed !== open) throw Error(`deep inbox listed ${listed} asks, not the ${open} open ones`);
    // The first run warms the hub's asks core and the file cache; it isn't counted.
    if (i > 0) runs.push(ms);
  }
  console.log(JSON.stringify({ inboxMs: median(runs), open }));
} finally {
  hub.kill('SIGTERM');
  await new Promise((resolve) => (hub.exitCode !== null ? resolve() : hub.once('exit', resolve)));
  rmSync(dir, { recursive: true, force: true });
}

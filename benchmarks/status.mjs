// `deep status` over a month of sessions, for the perf lane's budgets (issue #19): node benchmarks/status.mjs.
// It seeds a record in a temp HOME with a heavy month, 20 sessions a day each with a prompt, a tool call and a finished
// stop, then 30 live ones (an open ask on three, a stuck stop on three), starts the hub on it, and times five
// `deep status` runs after a warm-up, printing the median as one JSON line. The issue's 200 ms stays in
// tests/acceptance/19/status/budgets.test.ts. Beside it go, for each timed round, the command's own instructions and
// peak footprint and an empty Node program's instructions, and the modules the command loads (#2698, by
// process-reader.mjs). It stops only the hub it started, by PID.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { askSources } from '../packages/asks/dist/index.js';
import { openRecord } from '../packages/record/dist/index.js';
import { loadedModules, readCommand, unread } from './process-reader.mjs';

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
const taste = askSources().find((row) => row.kind === 'taste').fixture.ask;

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-status-bench-')));
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('DEEP_') && !k.startsWith('CLAUDE'))), HOME: dir, LC_ALL: 'C' };
mkdirSync(join(dir, '.deepbuild'), { recursive: true, mode: 0o700 });
const record = await openRecord({ path: join(dir, '.deepbuild', 'ledger.db'), now: () => END });
const hook = (session, project) => ({ writer: 'hook', actor: 'you', scope: 'you', session, project, agent: 'claude-code' });
const turn = async (session, project, at, stop) => {
  await record.append(hook(session, project), { v: 3, id: ulidAt(at), kind: 'session.start', ts: at, data: { agent: 'claude-code', worktree: `/work/${project}`, branch: 'main', thread: session, loads: [] } });
  await record.append(hook(session, project), { v: 1, id: ulidAt(at + 1000), kind: 'user.ask', ts: at + 1000, data: { msg: 0, text: 'tidy the imports', tasks: [], from: 'person' } });
  await record.append(hook(session, project), { v: 3, id: ulidAt(at + 2000), kind: 'tool.before', ts: at + 2000, data: { kind: 'shell', paths: [], command: 'npm test', call: `call_${session}` } });
  if (stop) await record.append(hook(session, project), { v: 3, id: ulidAt(at + 3000), kind: 'agent.stop', ts: at + 3000, subject: `session:${session.replace(/[^0-9A-Za-z]/g, '')}`, data: { turn: 1, did_work: true, usage: null, ...stop } });
};
for (let d = 0; d < 30; d++) for (let s = 0; s < 20; s++) await turn(`m${d}-${s}`, ['orchard', 'quarry', 'tundra'][s % 3], END - (30 - d) * DAY + s * 1_800_000, { outcome: 'finished', cause: 'unknown' });
const attention = [];
for (let n = 0; n < 30; n++) {
  const session = `live-${n}`;
  const project = ['orchard', 'quarry', 'tundra'][n % 3];
  await turn(session, project, END - 3_600_000 + n * 1000, n < 3 ? undefined : n < 6 ? { outcome: 'failed', cause: 'rate_limited', owner: 'service' } : undefined);
  if (n < 3) await record.append({ writer: 'core', actor: 'you', scope: 'you', session, project }, { v: 4, id: ulidAt(END - 600_000 + n), kind: 'ask.created', ts: END - 600_000 + n, data: { ...structuredClone(taste), question: `Which header for ${session}?`, deadline: END + DAY } });
  if (n < 6) attention.push(session.slice(0, 8));
}
await record.close();

const hub = spawn(process.execPath, [CLI, 'hub', 'run'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
try {
  await new Promise((resolve, reject) => { hub.stdout.once('data', resolve); hub.once('exit', () => reject(Error('the hub did not start'))); });
  const runs = [], instructions = [], emptyInstructions = [], peakFootprintBytes = [];
  writeFileSync(join(dir, 'empty.mjs'), '');
  for (let i = 0; i <= 5; i++) {
    const t0 = performance.now();
    const out = execFileSync(process.execPath, [CLI, 'status'], { env, encoding: 'utf8' });
    const ms = performance.now() - t0;
    const missing = attention.filter((id) => !out.split('\n').slice(0, 20).some((line) => line.includes(id)));
    if (missing.length) throw Error(`deep status left ${missing.join(', ')} out of its first 20 lines:\n${out}`);
    // The first run warms the hub and the file cache; it isn't counted.
    if (i === 0) continue;
    runs.push(ms);
    // The round's command once more, untimed, for its own instructions and peak, then an empty Node program (#2698).
    const counted = await readCommand(process.execPath, [CLI, 'status'], { env });
    instructions.push(counted.instructions);
    peakFootprintBytes.push(counted.peakFootprintBytes);
    emptyInstructions.push((await readCommand(process.execPath, [join(dir, 'empty.mjs')], { env })).instructions);
  }
  const modules = await loadedModules((args, added) => execFileSync(process.execPath, [...args, CLI, 'status'], { env: { ...env, ...added }, stdio: 'ignore' }));
  console.log(JSON.stringify({ statusMs: median(runs), sessions: 630, instructions, emptyInstructions, peakFootprintBytes, modules,
    ...unread({ "deep status's instructions": instructions, "an empty Node program's instructions": emptyInstructions, "deep status's peak footprint": peakFootprintBytes }) }));
} finally {
  hub.kill('SIGTERM');
  await new Promise((resolve) => (hub.exitCode !== null ? resolve() : hub.once('exit', resolve)));
  rmSync(dir, { recursive: true, force: true });
}

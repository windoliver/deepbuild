// deep mcp over 30 days of record, for the perf lane's budgets (issue #26): node benchmarks/mcp.mjs.
// It seeds a record in a temp HOME with a heavy month, 20 sessions a day each raising five asks, the first saved as a
// decision, and an open item, starts the hub on it, establishes a session whose hooks come from children of this
// process, and starts `deep mcp` as this process's child, so the hub binds it to that session. It times 40 deep_status
// and 40 deep_open_item calls and 20 deep_search calls over the month after a warm-up, failing on any error, and prints
// the p95s and deep mcp's resident memory as one JSON line. The issue's limits stay in
// tests/acceptance/26/budgets.test.ts. It stops only the processes it started, by PID.
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
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
const p95 = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]; };
const OPTIONS = [{ id: 'sqlite', label: 'SQLite', decision: 'none' }, { id: 'files', label: 'Plain files', decision: 'none' }];

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-mcp-bench-')));
const worktree = join(dir, 'work');
mkdirSync(join(worktree, '.deepbuild'), { recursive: true });
writeFileSync(join(worktree, '.deepbuild', 'done.yaml'), 'checks:\n  unit: { type: command, run: "true" }\n');
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('DEEP_') && !k.startsWith('CLAUDE'))), HOME: dir, LC_ALL: 'C' };
mkdirSync(join(dir, '.deepbuild'), { recursive: true, mode: 0o700 });
const record = await openRecord({ path: join(dir, '.deepbuild', 'ledger.db'), now: () => END });
const appends = [];
for (let d = 0; d < 30; d++) {
  for (let s = 0; s < 20; s++) {
    const session = `D${d}S${s}`;
    const conn = { writer: 'core', actor: 'you', scope: 'you', session, project: 'shop' };
    let at = END - (30 - d) * DAY + s * 1_800_000;
    appends.push(record.append({ ...conn, writer: 'hook' }, { v: 1, id: ulidAt(at), kind: 'session.start', ts: at, data: { agent: 'claude-code', worktree, branch: 'main', thread: session } }));
    for (let n = 0; n < 5; n++) {
      at += 60_000;
      const question = `Keep the ${n % 3 ? 'store' : 'ledger'} ${d}-${s}-${n} on SQLite or plain files?`;
      const id = ulidAt(at);
      appends.push(record.append(conn, { v: 1, id, kind: 'ask.created', ts: at, data: { kind: 'choice', question, options: OPTIONS, recommended: 'sqlite', deadline: END + DAY, fallback: 'you', default: 'sqlite', provisional: false, owner: 'you', key: sha256(question), pinned_to: { kind: 'evidence', ref: sha256(question) } } }));
      if (n === 0) appends.push(record.append(conn, { v: 1, id: ulidAt(at + 1), kind: 'decision.created', ts: at + 1, data: { key: sha256(question), scope: 'repo:shop', answer: 'files', ask: `ask:${id}` } }));
    }
    appends.push(record.append(conn, { v: 1, id: ulidAt(at + 2), kind: 'open_item.opened', ts: at + 2, data: { task_ref: `task:${ulidAt(at)}`, text: `the ledger journey for day ${d} is still open` } }));
  }
}
await Promise.all(appends);
await record.close();

const started = [];
const hub = spawn(process.execPath, [CLI, 'hub', 'run'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
started.push(hub);
try {
  await new Promise((resolve, reject) => { hub.stdout.once('data', resolve); hub.once('exit', () => reject(Error('the hub did not start'))); });
  // A session established by hooks sent from children of this process, as deep-hook sends them from an agent's.
  const session = randomUUID();
  const transcript = join(dir, '.claude', 'projects', 'work', `${session}.jsonl`);
  mkdirSync(join(dir, '.claude', 'projects', 'work'), { recursive: true });
  writeFileSync(transcript, '');
  let seq = BigInt(Date.now()) * 1_000_000n;
  const hook = (event, extra = {}) => {
    const request = { v: 1, agent: 'claude-code', event, seq: String(seq += 1000n), id: ulidAt(Date.now()), matched: [], payload: { session_id: session, transcript_path: transcript, cwd: worktree, hook_event_name: event, ...extra } };
    const send = `const s=require('node:net').connect(${JSON.stringify(join(dir, '.deepbuild', 'hub.sock'))});let n=0;s.on('data',(d)=>{for(const l of String(d).split('\\n').filter(Boolean)){if(n++===0)s.write(JSON.stringify({...${JSON.stringify(request)},pid:process.pid,ppid:process.ppid})+'\\n');else if(/"(exit|error)"/.test(l)){s.destroy();process.exit(0)}}});setTimeout(()=>process.exit(1),10000);`;
    execFileSync(process.execPath, ['-e', send], { env });
  };
  hook('SessionStart', { source: 'startup' });
  hook('UserPromptSubmit', { prompt: 'fix the ledger' });
  hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: `toolu_${randomUUID()}` });

  const mcp = spawn(process.execPath, [CLI, 'mcp'], { cwd: worktree, env, stdio: ['pipe', 'pipe', 'inherit'] });
  started.push(mcp);
  const waiting = new Map();
  createInterface({ input: mcp.stdout }).on('line', (raw) => { const m = JSON.parse(raw); waiting.get(m.id)?.(m); waiting.delete(m.id); });
  let ids = 0;
  const request = (method, params) => new Promise((resolve) => { const id = ++ids; waiting.set(id, resolve); mcp.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  const call = async (name, args) => {
    const t0 = performance.now();
    const reply = await request('tools/call', { name, arguments: args });
    const ms = performance.now() - t0;
    if (!reply.result || reply.result.isError) throw Error(`${name} failed: ${JSON.stringify(reply).slice(0, 500)}`);
    return { ms, value: reply.result.structuredContent };
  };
  await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'bench', version: '0' } });
  const bound = (await call('deep_status', {})).value.session;
  if (bound !== session) throw Error(`deep mcp bound to ${bound}, not the session ${session}`);
  const round = async () => {
    const status = [];
    const items = [];
    const searches = [];
    for (let i = 0; i < 40; i++) {
      status.push((await call('deep_status', {})).ms);
      items.push((await call('deep_open_item', { text: `bench item ${i}` })).ms);
    }
    for (let i = 0; i < 20; i++) {
      const { ms, value } = await call('deep_search', { query: i % 2 ? 'ledger' : `store ${i}` });
      if (i % 2 && !value.hits.length) throw Error('deep_search found nothing over the month');
      searches.push(ms);
    }
    return { status: p95(status), item: p95(items), search: p95(searches) };
  };
  await round();
  const r = await round();
  const rssMb = Number(execFileSync('ps', ['-o', 'rss=', '-p', String(mcp.pid)], { encoding: 'utf8' }).trim()) / 1024;
  console.log(JSON.stringify({ statusP95Ms: r.status, openItemP95Ms: r.item, searchP95Ms: r.search, mcpRssMb: rssMb }));
} finally {
  for (const child of started.reverse()) {
    child.kill('SIGTERM');
    await new Promise((resolve) => (child.exitCode !== null ? resolve() : child.once('exit', resolve)));
  }
  rmSync(dir, { recursive: true, force: true });
}

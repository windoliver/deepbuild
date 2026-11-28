// How often a query finds the claim that answers it (#3460): a reading, never a pass or a fail, with no threshold.
//   node scripts/search-reading.mjs <fixture.json>
// The fixture is `{claims: [{page, id, text}], queries: [{form, query, claim}]}`, each query tied to the claim (its
// `wiki:<page>#<id>` handle) that answers it, in one of three forms: `words` (the claim's own words as a list), `form`
// (one word in another form) and `question`. The shipped wiki learns the claims in a temp home, each resting on a
// decision of yours, and a hub of its own runs there, with no model and no network. Each query is asked through
// `deep_search` (a `deep mcp` bound to no session, every page) and `deep find --json`; a query is found only when the
// reply holds its own claim. For each search, then each form, it prints the queries found over those asked, by words
// in the query, and each query not found with its claim. It stops only what it started, by PID.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { openEvidenceStore } from '@deepbuild/evidence';
import { openRecord } from '@deepbuild/record';
import { ulid } from '@deepbuild/record/ids';
import { openWiki } from '@deepbuild/wiki';

const ROOT = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const CLI = join(ROOT, 'packages/cli/dist/main.js');
const SEARCHES = ['deep_search', 'deep find'];
const FORMS = ['words', 'form', 'question'];
/** A query's length: its words by deep_search's rule, runs of letters and digits. */
const length = (query) => query.normalize('NFC').toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean).length;

/** Whether a reply's hits hold the claim the query is tied to; any other claim's hit is not finding it. */
const foundBy = (hits, claim) => hits.includes(claim);

/** The reading's lines, from each search's hits for each query. */
function reading(queries, hitsOf) {
  const out = [];
  for (const search of SEARCHES) for (const form of FORMS) {
    const of = queries.filter((q) => q.form === form);
    const found = (q) => foundBy(hitsOf(search, q), q.claim);
    const by = [...new Set(of.map((q) => length(q.query)))].sort((a, b) => a - b)
      .map((n) => { const at = of.filter((q) => length(q.query) === n); return `${n}: ${at.filter(found).length} of ${at.length}`; });
    out.push(`${search}, ${form}: ${of.filter(found).length} of ${of.length} found; by words in the query, ${by.join(', ')}`);
    for (const q of of.filter((x) => !found(x))) out.push(`  not found: ${JSON.stringify(q.query)}, tied to ${q.claim}`);
  }
  return `${out.join('\n')}\n`;
}

/** The claims, learned by the shipped wiki into the record at `root` while no hub runs, each resting on a decision of yours. */
async function learn(root, claims) {
  let t = Date.now() - 3_600_000;
  const now = () => t;
  const store = await openEvidenceStore({ root: join(root, 'evidence'), now });
  const record = await openRecord({ path: join(root, 'ledger.db'), now, evidence: store });
  try {
    const candidates = [];
    for (const c of claims) {
      t += 1000;
      const id = ulid(t);
      await record.append({ writer: 'core', actor: 'you', scope: 'you' }, { v: 1, id, kind: 'decision.created', ts: t, data: { key: createHash('sha256').update(`decision ${id}`).digest('hex'), scope: 'all', answer: c.text, ask: `ask:${ulid(t)}` } });
      candidates.push({ page: c.page, id: c.id, text: c.text, scope: 'all', sources: [{ at: `decision:${id}`, quote: c.text }] });
    }
    const learned = await (await openWiki({ record, folder: join(root, 'wiki'), now })).learn(candidates);
    const lost = candidates.map((c) => `wiki:${c.page}#${c.id}`).filter((h) => !learned.written.includes(h));
    if (lost.length) throw Error(`the wiki didn't write ${lost.join(', ')}`);
  } finally {
    await record.close();
  }
}

/** A JSON-RPC client on a `deep mcp` started in a folder no session works in, so its calls are bound to none. */
function mcp(env, cwd, started) {
  const child = spawn(process.execPath, [CLI, 'mcp'], { cwd, env, stdio: ['pipe', 'pipe', 'ignore'] });
  started.push(child);
  // A write after deep mcp exits fails the ask through the exit below, never the process.
  child.stdin.on('error', () => {});
  const replies = new Map();
  const waiting = new Map();
  child.once('exit', () => { for (const fail of [...waiting.values()]) fail(); });
  createInterface({ input: child.stdout }).on('line', (raw) => {
    let reply;
    try { reply = JSON.parse(raw); } catch { return; }
    if (reply?.id === undefined) return;
    replies.set(reply.id, reply);
    waiting.get(reply.id)?.();
  });
  let next = 0;
  const ask = (method, params) => new Promise((done, fail) => {
    const id = ++next;
    const timer = setTimeout(() => { waiting.delete(id); fail(Error(`deep mcp gave no reply to ${method}`)); }, 120_000);
    // Woken by its reply, or by deep mcp's exit, which leaves no reply.
    waiting.set(id, () => { clearTimeout(timer); waiting.delete(id); if (replies.has(id)) done(replies.get(id)); else fail(Error('deep mcp exited')); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  return { ask };
}

/** Every hit's handle for a query through `deep find --json`, following `next` to the last slice. */
function findAll(root, env, cwd, query) {
  const out = [];
  for (let cursor; ;) {
    const r = spawnSync(process.execPath, [CLI, 'find', query, '--json', '--root', root, ...(cursor !== undefined ? ['--slice', cursor] : [])], { cwd, env, encoding: 'utf8', timeout: 120_000 });
    if (r.status !== 0) throw Error(`deep find ${JSON.stringify(query)} --json exited ${r.status}: ${String(r.stderr).slice(0, 400)}`);
    const found = JSON.parse(r.stdout);
    out.push(...found.hits.map((h) => h.handle));
    cursor = typeof found.next === 'string' ? found.next : undefined;
    if (cursor === undefined) return out;
  }
}

/** Every hit's source for a query through deep_search, following `next` to the last page. */
async function searchAll(client, query) {
  const out = [];
  for (let cursor; ;) {
    const reply = await client.ask('tools/call', { name: 'deep_search', arguments: { query, ...(cursor !== undefined ? { cursor } : {}) } });
    const text = reply?.result?.content?.[0]?.text;
    const value = reply?.result?.structuredContent ?? (text ? JSON.parse(text) : undefined);
    if (!Array.isArray(value?.hits)) throw Error(`deep_search ${JSON.stringify(query)} answered ${JSON.stringify(reply).slice(0, 400)}`);
    out.push(...value.hits.map((h) => String(h.source)));
    cursor = typeof value.next === 'string' ? value.next : undefined;
    if (cursor === undefined) return out;
  }
}

async function main(file) {
  const { claims, queries } = JSON.parse(readFileSync(file, 'utf8'));
  // A short folder: the hub's socket path must fit the OS's limit, which a path under the macOS temp folder exceeds.
  const tmp = realpathSync(mkdtempSync(join(process.platform === 'win32' ? tmpdir() : '/tmp', 'dsr-')));
  const home = join(tmp, 'h');
  const root = join(home, '.deepbuild');
  const elsewhere = join(tmp, 'elsewhere');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  mkdirSync(elsewhere);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('DEEP_') && !k.startsWith('XDG_') && !k.startsWith('CLAUDE') && !k.startsWith('CODEX') && k !== 'NODE_OPTIONS'));
  Object.assign(env, { HOME: home, XDG_CONFIG_HOME: join(home, '.config') });
  const started = [];
  try {
    await learn(root, claims);
    const hub = spawn(process.execPath, [CLI, 'hub', 'run', '--root', root], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    started.push(hub);
    let log = '';
    hub.stderr.setEncoding('utf8').on('data', (d) => { log += d; });
    // Ready when its first line says so, as the hub's own tests wait for it.
    await new Promise((ready, fail) => {
      const timer = setTimeout(() => fail(Error(`the hub did not start in 120 s: ${log.slice(0, 2000)}`)), 120_000);
      let first = '';
      hub.stdout.setEncoding('utf8').on('data', function line(d) {
        first += d;
        if (!first.includes('\n')) return;
        hub.stdout.off('data', line);
        clearTimeout(timer);
        let said;
        try { said = JSON.parse(first.split('\n')[0]); } catch { /* not the ready line */ }
        if (said?.ready === true) ready(); else fail(Error(`the hub did not start: ${first.split('\n')[0].slice(0, 400)} ${log.slice(0, 2000)}`));
      });
      hub.once('exit', () => { clearTimeout(timer); fail(Error(`the hub did not start: ${log.slice(0, 2000)}`)); });
    });
    const client = mcp(env, elsewhere, started);
    await client.ask('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'search-reading', version: '0' } });
    const hits = new Map();
    for (const q of queries) {
      hits.set(`deep_search\n${q.query}`, await searchAll(client, q.query));
      hits.set(`deep find\n${q.query}`, findAll(root, env, elsewhere, q.query));
    }
    process.stdout.write(reading(queries, (search, q) => hits.get(`${search}\n${q.query}`)));
  } finally {
    for (const child of started.reverse()) {
      if (child.exitCode !== null || child.signalCode !== null) continue;
      child.kill('SIGTERM');
      await new Promise((done) => { const t = setTimeout(() => { child.kill('SIGKILL'); done(); }, 15_000); child.once('exit', () => { clearTimeout(t); done(); }); });
    }
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) { console.error('Usage: node scripts/search-reading.mjs <fixture.json>'); process.exit(2); }
  main(process.argv[2]).catch((error) => { console.error(`search-reading: ${error instanceof Error ? error.message : String(error)}`); process.exit(1); });
}

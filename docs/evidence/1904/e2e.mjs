// #1904 hand e2e: every GitHub REST caller, run from its built code, against a stand-in GitHub on 127.0.0.1.
// Three cases each: a same-origin redirect that should be followed (ok), a redirect to another host (cross-host,
// http://localhost:<other port>), and a redirect to itself forever (loop). Prints one row per caller and case.
// Usage: node e2e.mjs <repo root>
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = process.argv[2];
const dist = (p) => import(join(ROOT, 'packages', p));
const { githubPushes, revoke, repoOf } = await dist('github/dist/index.js');
const { Forge } = await dist('hub/dist/forge.js');
const { liveFetch, liveGraphql } = await dist('hub/dist/github-source.js');
const { Landing } = await dist('hub/dist/landing.js');
const { Work } = await dist('hub/dist/work.js');
const { Intake } = await dist('hub/dist/intake.js');
const { Workspaces } = await dist('hub/dist/workspaces.js');
const { openArchive } = await dist('archive/dist/index.js');
const { openEvidenceStore } = await dist('evidence/dist/index.js');
const { openRecord } = await dist('record/dist/index.js');
const { openAsks } = await dist('asks/dist/index.js');
const { shipped } = await dist('adapters/dist/index.js');

const temps = [];
const temp = (n) => { const d = mkdtempSync(join(tmpdir(), `e2e-1904-${n}-`)); temps.push(d); return d; };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

/** What GitHub would answer at each path, so a followed call has something real to read. */
function github(method, path) {
  const p = path.split('?')[0].replace(/^\/ok/, '');
  if (method === 'DELETE') return [204, ''];
  if (method === 'POST' && p === '/user/repos') return [201, { full_name: 'o/new', clone_url: 'https://example.invalid/o/new.git' }];
  if (method === 'POST' && p.endsWith('/issues')) return [201, { number: 7, html_url: 'https://example.invalid/o/r/issues/7' }];
  if (method === 'POST' && p.includes('/statuses/')) return [201, { state: 'success' }];
  if (p === '/graphql') return [200, { data: { viewer: { login: 'e2e' } } }];
  if (p === '/user') return [200, { login: 'e2e' }];
  if (p === '/repos/o/r') return [200, { default_branch: 'main', fork: false, full_name: 'o/r' }];
  if (p.endsWith('/actions/runs')) return [200, { workflow_runs: [] }];
  return [200, []];
}
/** A stand-in server; `answer` decides each reply. Records what it was asked. */
async function server(host, answer) {
  const seen = [];
  const s = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization ?? '', body });
      const [status, headers, out] = answer(req);
      res.writeHead(status, { 'content-type': 'application/json', ...headers }).end(typeof out === 'string' ? out : JSON.stringify(out));
    });
  });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return { url: `http://${host}:${s.address().port}`, seen, close: () => new Promise((r) => { s.closeAllConnections(); s.close(r); }) };
}
const redirectCode = (method) => (method === 'GET' ? 302 : 307);

/** One run of `call` against a forge acting out `kase`; the row it makes. */
async function run(name, token, kase, call) {
  const elsewhere = await server('localhost', (req) => { const [s, b] = github(req.method, req.url); return [s, {}, b]; });
  let self = '';
  const forge = await server('127.0.0.1', (req) => {
    if (kase === 'loop') return [redirectCode(req.method), { location: `${self}${req.url}` }, ''];
    if (kase === 'cross-host') return [redirectCode(req.method), { location: `${elsewhere.url}${req.url}` }, ''];
    // ok: one same-origin redirect (301 for a GET, 307 otherwise), then GitHub's answer.
    if (!req.url.startsWith('/ok')) return [req.method === 'GET' ? 301 : 307, { location: `/ok${req.url}` }, ''];
    const [s, b] = github(req.method, req.url);
    return [s, {}, b];
  });
  self = forge.url;
  const started = Date.now();
  let outcome;
  try { outcome = `returned ${JSON.stringify(await call(forge.url, token))?.slice(0, 70)}`; } catch (e) { outcome = `${kase === 'ok' ? 'ERROR' : 'refused, threw'}: ${String(e?.message ?? e).slice(0, 70)}`; }
  const row = {
    caller: name, case: kase, ms: Date.now() - started,
    forge: forge.seen.length, tokenAtForge: forge.seen.filter((s) => s.auth === `Bearer ${token}`).length,
    elsewhere: elsewhere.seen.length, tokenElsewhere: elsewhere.seen.filter((s) => s.auth.includes(token)).length,
    outcome,
  };
  await forge.close(); await elsewhere.close();
  return row;
}

// ---- Each caller, through its own code.
async function archivePass(api, token) {
  const dir = temp('archive');
  const root = join(dir, 'home', '.deepbuild');
  const store = await openEvidenceStore({ root: join(root, 'evidence'), now: Date.now });
  const record = await openRecord({ path: join(root, 'ledger.db'), now: Date.now, evidence: store });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  try {
    const archive = await openArchive({ record, evidence: store, asks, adapters: shipped(), env: { HOME: join(dir, 'home'), GH_TOKEN: token }, connection: { writer: 'ext:deepbuild/archive', actor: 'you', scope: 'you' }, now: Date.now, held: () => [], forge: { api, repos: ['o/r'] } });
    await archive.pass();
    return 'pass done';
  } finally { await record.close(); }
}
function checkoutWithOrigin() {
  const dir = temp('checkout');
  const bare = join(dir, 'origin.git');
  git(dir, 'init', '-q', '--bare', bare);
  const work = join(dir, 'work');
  git(dir, 'init', '-q', '-b', 'main', work);
  writeFileSync(join(work, 'a'), 'a');
  git(work, 'add', 'a');
  git(work, '-c', 'user.name=e2e', '-c', 'user.email=e2e@example.invalid', 'commit', '-q', '-m', 'a');
  git(work, 'remote', 'add', 'origin', bare);
  return { work, commit: git(work, 'rev-parse', 'HEAD') };
}

const callers = [
  ['github pushes (restOf)', (api, t) => githubPushes({ api, token: t, repo: 'o/r' })],
  ['github apps revoke', (api, t) => revoke(api, t)],
  ['hub Forge.pullFor', (api, t) => new Forge(api, t).pullFor('o/r', 'b')],
  ['hub liveFetch', async (api, t) => (await liveFetch(api, t)('/repos/o/r/issues', 1)).status],
  ['hub liveGraphql', async (api, t) => (await liveGraphql(api, t)('query { viewer { login } }', {})).status],
  ['archive forge runs', archivePass],
  ['hub Work.get', async (api, t) => (await new Work({ api, token: async () => t }).get('/user')).status],
  ['hub Landing.call', async (api, t) => (await new Landing({ api, token: async () => t }).call('GET', '/repos/o/r/pulls')).status],
  ['hub Landing.post', async (api, t) => {
    const c = checkoutWithOrigin();
    await new Landing({ api, token: async () => t, gateApp: () => undefined }).post(c.work, 'o/r', c.commit, { outcome: 'PASS', requirements: [] });
    return 'status posted';
  }],
  ['hub Intake.repo', async (api, t) => (await new Intake({ forge: api, token: async () => t, root: temp('intake') }).repo('E2E thing')).repo],
  ['hub Intake.issue', (api, t) => new Intake({ forge: api, token: async () => t }).issue('o/r', 'A task', ['it works'], [])],
  ['hub Workspaces.file', async (api, t) => {
    const dir = temp('space');
    git(dir, 'init', '-q');
    git(dir, 'remote', 'add', 'origin', 'https://github.com/o/r.git');
    const ws = new Workspaces({ forge: api, token: async () => t, repoOf, now: Date.now });
    ws.tasksOf = async () => [{ task: 1, step: 'entered', title: 'A task', criteria: ['it works'], blocked_by: [], issue: null }];
    ws.appendTask = async () => undefined;
    return (await ws.file({ id: 's' }, dir)).filed;
  }],
];

const rows = [];
for (const [name, call] of callers) {
  const token = `tok-e2e-${name.replace(/\W+/g, '-')}`;
  for (const kase of ['ok', 'cross-host', 'loop']) rows.push(await run(name, token, kase, call));
}
for (const d of temps) rmSync(d, { recursive: true, force: true });

const pad = (s, n) => String(s).padEnd(n).slice(0, n);
console.log(`${pad('caller', 22)} ${pad('case', 10)} ${pad('forge', 5)} ${pad('tok@f', 5)} ${pad('else', 4)} ${pad('tok@e', 5)} ${pad('ms', 5)} outcome`);
for (const r of rows) console.log(`${pad(r.caller, 22)} ${pad(r.case, 10)} ${pad(r.forge, 5)} ${pad(r.tokenAtForge, 5)} ${pad(r.elsewhere, 4)} ${pad(r.tokenElsewhere, 5)} ${pad(r.ms, 5)} ${r.outcome}`);
const bad = rows.filter((r) => r.case !== 'ok' && (r.elsewhere > 0 || r.tokenElsewhere > 0 || r.forge > 6 || r.outcome.startsWith('returned 200')));
const okBad = rows.filter((r) => r.case === 'ok' && (r.outcome.startsWith('threw') || r.tokenAtForge !== r.forge));
console.log(`\ncross-host and loop: ${24 - bad.length}/24 bounded (other host asked 0 times, at most 6 requests to the forge)`);
console.log(`ok (same-origin redirect followed with the token): ${12 - okBad.length}/12`);
process.exitCode = bad.length || okBad.length ? 1 : 0;

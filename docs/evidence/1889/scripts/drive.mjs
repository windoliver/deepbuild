// #1889 e2e driver: the hub's own pieces (record, evidence store, asks core, supervisor, project trust and the
// extension host, all from the built dist) with the shipped Gmail source installed, checked and loaded in its own
// supervised process, and its HTTP sent over a real socket to the stand-in Gmail (standin.mjs) instead of
// gmail.googleapis.com. Any other host is refused before a socket: nothing leaves 127.0.0.1.
// Usage: node drive.mjs <repo> <stand-in port> <case>
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [repo, port, kase] = process.argv.slice(2);
const dist = (p) => import(join(repo, 'packages', p, 'dist/index.js'));
const { openRecord } = await dist('record');
const { openEvidenceStore } = await dist('evidence');
const { openAsks } = await dist('asks');
const { openSupervisor } = await dist('supervisor');
const { openExtensionHost, openTrust, packageDigest } = await dist('extension-host');

const GMAIL = 'gmail.googleapis.com';
const BASE = `http://127.0.0.1:${port}`;
const YOU = { writer: 'app', actor: 'you', scope: 'you' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (s) => console.log(`[hub ${kase}] ${s}`);

const http = async (request, signal) => {
  const url = new URL(request.url);
  if (url.hostname !== GMAIL) throw new TypeError(`refused: ${url.hostname} is not the stand-in's host`);
  const res = await fetch(`${BASE}${url.pathname}${url.search}`, { method: request.method, headers: request.headers, redirect: 'manual', ...(signal ? { signal } : {}), ...(request.body === undefined ? {} : { body: request.body }) });
  const headers = {};
  res.headers.forEach((v, k) => { headers[k] = v; });
  return { status: res.status, headers, body: await res.text() };
};
const entries = new Map();
const secrets = { get: async (k) => entries.get(k), set: async (k, v) => { entries.set(k, v); }, delete: async (k) => { entries.delete(k); } };

const dir = realpathSync(mkdtempSync('/tmp/dh1889-e2e-'));
let code = 1;
try {
  const now = () => Date.now();
  const evidence = await openEvidenceStore({ root: join(dir, 'evidence') });
  const record = await openRecord({ path: join(dir, 'ledger.db'), now, evidence });
  const asks = await openAsks({ record, now, deliver: () => undefined });
  const sup = await openSupervisor({ record, asks, now, settings: { asks: { unblock: { deadline_ms: 2 * 86_400_000 } } } });
  const trust = await openTrust({ record, now });
  const h = await openExtensionHost({ record, supervisor: sup, trust, home: join(dir, 'deepbuild'), release: [], now, asks, secrets, http });
  await h.ready();

  const pkg = join(dir, 'gmail');
  cpSync(join(repo, 'packages/sources/gmail'), pkg, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(pkg, 'deepbuild.json'), 'utf8'));
  manifest.digest = packageDigest(pkg);
  writeFileSync(join(pkg, 'deepbuild.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const p = await h.install({ from: pkg, builtBy: null, grant: { hosts: [{ host: GMAIL, quota: { calls: 1_000_000, per_ms: 3_600_000 } }] } });
  const checked = await h.check(p);
  if (!checked.passed) throw Error(`conformance: ${checked.reasons.join('; ')}`);
  const load = await h.load(p);
  if (load.status !== 'loaded') throw Error(`load: ${JSON.stringify(load)}`);
  say(`installed and loaded ${p.id}@${p.version}`);
  await h.enterSecret(YOU, p.id, 'gmail_token', 'ya29.dh1889-e2e-test-token');
  const handle = await h.addWorkSource(YOU, { source: 'ext.gmail.label', scope: 'Label_7', every: 300_000 });
  await h.setWorkRule(YOU, handle, { sentence: 'reply in the thread it came from' });
  await fetch(`${BASE}/_add`, { method: 'POST' });
  await h.runNow(YOU, handle);
  await h.idle();
  const [task] = (await h.workTasks()).filter((t) => t.source === handle);
  if (!task) throw Error('the labelled email became no task');
  say(`task ${task.task_ref} for ${task.id}`);
  const key = await h.deliverResult(task.task_ref, { verdict: 'PASS', summary: 'The export keeps its rows.', requirements: [{ id: 'R1', text: 'No row is dropped', verdict: 'PASS', evidence: ['https://receipts.example/ev/1'] }], receipt: 'https://receipts.example/r/1' });
  say(`delivery ${key} recorded`);
  let last = '';
  for (let tick = 1; tick <= 12; tick++) {
    await h.tick();
    await h.idle();
    const d = (await h.deliveries()).find((x) => x.key === key);
    const row = `${d.outcome}${d.cause ? ` (${d.cause})` : ''}`;
    say(`tick ${tick}: delivery ${row}${d.outcome === 'unknown' ? ', its retry held until the marker can be read' : ''}`);
    last = d.outcome;
    if (d.outcome === 'sent' || d.outcome === 'gone') break;
    await sleep(1000);
  }
  const counted = await (await fetch(`${BASE}/_count`)).json();
  const kinds = (await record.read({ after: 0, limit: 10_000 })).filter((e) => e.kind === 'work.delivery').map((e) => e.data.phase);
  say(`record work.delivery phases: ${kinds.join(' -> ')}`);
  say(`stand-in counted: ${counted.sends_received} send request(s) received, ${counted.sends_kept} reply kept in the thread`);
  say(counted.sends_kept === 1 ? 'RESULT exactly one reply in the thread' : `RESULT ${counted.sends_kept} replies in the thread`);
  code = counted.sends_kept === 1 && last === 'sent' ? 0 : 1;
  await h.close();
  await sup.close();
  await record.close();
} catch (e) {
  console.error(`[hub ${kase}] error: ${e?.stack ?? e}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
process.exit(code);

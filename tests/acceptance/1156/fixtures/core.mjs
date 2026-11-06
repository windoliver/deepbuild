// What the tests do on DeepBuild's own packages, in a child process whose HOME is the test's (README: Seeds and reads).
//   node core.mjs seed  {root, repo, from}          your trust answer for the repo, then its extension installed and checked
//   node core.mjs pad   {root, events}              `events` rows bulk-inserted into the record, the hub stopped
//   node core.mjs card  {root, ask}                 the ask's card, from the asks core
//   node core.mjs raise {root, session, plan, plant} the asks core under `plant` raises one authority ask with this plan; its plan.proposed row
//   node core.mjs time  {root, repo, from, data, calls, runs}  #881's reading: what the trust check adds to the hook reply
//   node core.mjs per-call {root, repo, from, id, data}  the host on a trust reader that walks the record at every call; its replies
import { createHash, randomBytes } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openAsks } from '@deepbuild/asks';
import { openEvidenceStore } from '@deepbuild/evidence';
import { openExtensionHost, openTrust, packageDigest } from '@deepbuild/extension-host';
import { openRecord, ulid } from '@deepbuild/record';
import { openSupervisor } from '@deepbuild/supervisor';

const DAY = 86_400_000;
const YOU = { writer: 'app', actor: 'you', scope: 'you' };
const GRANT = { record: ['tool.before'] };
const [op, raw] = process.argv.slice(2);
const a = JSON.parse(raw);

async function world(root) {
  const evidence = await openEvidenceStore({ root: join(root, 'evidence') });
  const record = await openRecord({ path: join(root, 'ledger.db'), now: Date.now, evidence });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 2 * DAY } } } });
  const trust = await openTrust({ record, now: Date.now });
  return { record, asks, sup, trust };
}
const close = async (w, ...hosts) => {
  for (const h of hosts) await h.close().catch(() => undefined);
  await w.sup.close().catch(() => undefined);
  await w.record.close();
};
/** A copy of the package with its manifest's digest set, under `id`. */
function packaged(from, id) {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'pkg-'));
  cpSync(from, dir, { recursive: true });
  const path = join(dir, 'deepbuild.json');
  const manifest = { ...JSON.parse(readFileSync(path, 'utf8')), id };
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  manifest.digest = packageDigest(dir);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}
async function installed(host, from, project) {
  const p = await host.install({ from, builtBy: null, grant: GRANT, ...(project ? { project } : {}) });
  const checked = await host.check(p);
  if (!checked.passed) throw Error(`${p.id}'s conformance: ${checked.reasons.join('; ')}`);
  return p;
}

if (op === 'seed') {
  const w = await world(a.root);
  await w.trust.answer(YOU, a.repo, true);
  const host = await openExtensionHost({ record: w.record, supervisor: w.sup, trust: w.trust, home: a.root, release: [], now: Date.now });
  await host.ready();
  const { id } = JSON.parse(readFileSync(join(a.from, 'deepbuild.json'), 'utf8'));
  await installed(host, packaged(a.from, id), a.repo);
  console.log(JSON.stringify({ id }));
  await close(w, host);
} else if (op === 'pad') {
  // The record's own table, in one transaction: the hub is stopped and no projection reads tool calls. About 1 KB each, as #881's.
  const db = new DatabaseSync(join(a.root, 'ledger.db'));
  db.exec('PRAGMA synchronous = OFF');
  // The record hands out positions from a block it reserved, past the newest row.
  const end = Number(db.prepare("SELECT value FROM meta WHERE key = 'log_block_end'").get()?.value ?? 1);
  const top = Math.max(end, db.prepare('SELECT COALESCE(MAX(log_pos), 0) AS top FROM events').get().top);
  const words = 'npm test -- src/cart/checkout.test.ts --reporter verbose --coverage ';
  const data = JSON.stringify({ kind: 'shell', paths: [], command: words.repeat(Math.ceil(1024 / words.length)).slice(0, 1000) });
  const session = ulid(Date.now() - DAY);
  const padded = db.prepare(`INSERT INTO events (id, log_pos, v, ts, session_id, seq, agent, writer, actor, scope, kind, data, hash)
    WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
    SELECT printf('01PAD%021d', i), ? + i, 1, ? + i, ?, i, 'claude-code', 'hook', 'you', 'you', CASE i % 2 WHEN 0 THEN 'tool.after' ELSE 'tool.before' END, ?, 'pad' FROM n`);
  db.exec('BEGIN');
  padded.run(a.events, top, Date.now() - DAY, session, data);
  db.prepare("INSERT INTO meta (key, value) VALUES ('log_block_end', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(String(top + a.events + 1));
  db.exec('COMMIT');
  db.close();
  console.log(JSON.stringify({ from: top, to: top + a.events }));
} else if (op === 'card') {
  const w = await world(a.root);
  console.log(JSON.stringify(await w.asks.card(a.ask)));
  await close(w);
} else if (op === 'raise') {
  const w = await world(a.root);
  const asks = await openAsks({ record: w.record, now: Date.now, deliver: () => undefined, plant: a.plant });
  const key = randomBytes(32).toString('hex');
  const connection = { writer: 'core', actor: 'you', scope: 'you', session: a.session, project: a.project };
  const ask = await asks.raise(connection, 'effect.push', {
    kind: 'authority', question: a.question, options: [{ id: 'approve', label: 'Push it', decision: 'allow' }, { id: 'decline', label: 'Hold the push', decision: 'deny' }],
    recommended: null, deadline: Date.now() + DAY, default: 'decline', fallback: 'you', provisional: false, owner: 'you', key, pinned_to: a.pinned_to,
  }, a.plan);
  const [row] = await w.record.raw(`SELECT data FROM events WHERE kind = 'plan.proposed' AND writer = 'core' AND json_extract(data, '$.ask') = ? ORDER BY log_pos LIMIT 1`, [ask]);
  console.log(JSON.stringify({ ask, row: JSON.parse(row.data) }));
  await close(w);
} else if (op === 'time') {
  // Two hosts on the fixture's record, each with the same extension: on host P it comes with the trusted repo, so its
  // trust is checked at each call; on host C it comes with no project. Calls go to each in turn; a run's reading is
  // P's p95 reply time minus C's, floored at 0.
  const w = await world(a.root);
  const hostOf = async () => {
    const home = mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'host-'));
    const host = await openExtensionHost({ record: w.record, supervisor: w.sup, trust: w.trust, home, release: [], now: Date.now });
    await host.ready();
    return host;
  };
  const P = await hostOf();
  const C = await hostOf();
  const load = async (host, id, project) => {
    const loaded = await host.load(await installed(host, packaged(a.from, id), project));
    if (loaded.status !== 'loaded') throw Error(`${id} didn't load: ${JSON.stringify(loaded)}`);
  };
  await load(P, 'checkout-web/timed-project', a.repo);
  await load(C, 'checkout-web/timed-control');
  const p95 = (xs) => [...xs].sort((x, y) => x - y)[Math.ceil(0.95 * xs.length) - 1];
  let failed = 0;
  let denied = 0;
  const timed = async (host, data) => {
    const t0 = performance.now();
    const reply = await host.hook({ kind: 'tool.before', data, deadline: 500, bound: 4096 });
    const ms = performance.now() - t0;
    failed += reply.failed.length;
    denied += reply.denies.length;
    return ms;
  };
  for (let i = 0; i < 5; i++) { await timed(P, a.data[0]); await timed(C, a.data[0]); }
  [failed, denied] = [0, 0];
  const runs = [];
  for (let run = 0; run < a.runs; run++) {
    const [p, c] = [[], []];
    for (let i = 0; i < a.calls; i++) {
      const data = a.data[i % a.data.length];
      if (i % 2 === 0) { p.push(await timed(P, data)); c.push(await timed(C, data)); } else { c.push(await timed(C, data)); p.push(await timed(P, data)); }
    }
    runs.push({ project: p95(p), control: p95(c), added: Math.max(0, p95(p) - p95(c)) });
  }
  console.log(JSON.stringify({ runs, failed, denied }));
  await close(w, P, C);
} else if (op === 'per-call') {
  // The wrong program of AC6: a host handed a trust reader that reads the record at each call, through its public read.
  const w = await world(a.root);
  const key = createHash('sha256').update(`project trust\n${realpathSync(a.repo)}`).digest('hex');
  const trust = {
    async trusted() {
      let answer;
      for (let after = 0; ;) {
        const page = await w.record.read({ after, limit: 1000 });
        for (const e of page) if (e.kind === 'decision.created' && e.data?.key === key) answer = e.data.answer;
        if (page.length < 1000) return answer === 'trusted';
        after = page[page.length - 1].log_pos;
      }
    },
    answer: w.trust.answer,
  };
  const home = mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'host-'));
  const host = await openExtensionHost({ record: w.record, supervisor: w.sup, trust, home, release: [], now: Date.now });
  await host.ready();
  const loaded = await host.load(await installed(host, packaged(a.from, a.id), a.repo));
  if (loaded.status !== 'loaded') throw Error(`${a.id} didn't load: ${JSON.stringify(loaded)}`);
  const replies = [];
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    const reply = await host.hook({ kind: 'tool.before', data: a.data, deadline: 500, bound: 4096 });
    replies.push({ denied: reply.denies.some((d) => d.extension === a.id), failed: reply.failed.map((f) => f.reason), ms: performance.now() - t0 });
  }
  console.log(JSON.stringify({ replies }));
  await close(w, host);
} else throw Error(`no op ${op}`);

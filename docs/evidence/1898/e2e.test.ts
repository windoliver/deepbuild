// #1898 hand e2e: a real dev hub (deep hub run, real deep-hook and CLI, via the repo's #322/#1537 world), started with a
// loader hook that logs every module each thread loads. Shows (1) no check kit is loaded at the hub's start, (2) one
// claim whose checks cover every kind the hub holds (command, review, numbers, document, data, message, service) loads
// each kit then and every check passes, and (3) `deep lease` loads neither yaml nor the SQLite addon.
//
//   docs/evidence/1898/e2e.command (runs this file with vitest.e2e.mjs and prints what it saw; E2E_LOG is the log).
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';

it('#1898 e2e', async ({ onTestFinished }) => {

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const A = join(REPO, 'tests/acceptance');
const h322 = await import(join(A, '322/helpers.ts'));
const h1537 = await import(join(A, '1537/helpers.ts'));
const { prAnswers } = await import(join(A, '323/github.ts'));
const { EXPIRED } = await import(join(A, '323/helpers.ts'));
const { makeWorld, childEnv, parseObject, COVERED, SETTINGS, req, CLI, NODE, stopHub, cleanup, trustRepo, reportWindow, runsOf } = h322;
const { addToBase, suiteDatabase, openTask, openPr, judged, claimAfter, taskVerdicts, outcomeOf, lastPos, reviewJobs, heldKinds, FIXTURE, FIX, CLEAN } = h1537;

const say = (s: string) => appendFileSync(process.env.E2E_LOG!, `${s}\n`);
const KITS = /\/packages\/(checks-(?:command|numbers|review|work)|conformance)\/dist\//;
const kitOf = (url: string) => KITS.exec(url)?.[1];

// ---- The service check's endpoint: #68's real HTTP server, fast mode.
const server = spawn(NODE, [join(A, '68/fixtures/server.mjs'), 'fast'], { stdio: ['ignore', 'pipe', 'inherit'] });
const port = await new Promise<number>((resolve) => server.stdout!.setEncoding('utf8').once('data', (d: string) => resolve(Number(d.trim()))));
// Whatever happens below, the endpoint, a hub that never got ready and the temp folders go when the test ends; a ready
// hub is stopped by its PID in the finally below. Only processes this test started are stopped.
let hubChild: ReturnType<typeof spawn> | undefined;
onTestFinished(async () => {
  if (hubChild?.pid && hubChild.exitCode === null && hubChild.signalCode === null) try { process.kill(hubChild.pid, 'SIGTERM'); } catch { /* gone */ }
  server.kill('SIGTERM');
  await cleanup();
});

// ---- The world: #1537's, with a reviewer that finds nothing, and a definition naming a check of each work kind.
const ASK = 'make the auth middleware reject expired tokens, write the q3 report, then open a pull request';
const CHECKS = {
  document: '.deepbuild/checks/q3-report.json',
  data: '.deepbuild/checks/orders.json',
  message: '.deepbuild/checks/shipped-mail.json',
  service: '.deepbuild/checks/order-endpoint.json',
};
const work = (id: string, text: string, check: string) => req(id, text, { check, asserts: [], depth: 'unit', oracle: 'code', on_base: 'passes', refuted_by: `a run where ${text.toLowerCase()} does not hold` });
const DRAFT = {
  ask: ASK,
  requirements: [
    req('R1', 'An expired token is rejected with 401', { check: EXPIRED.check, asserts: EXPIRED.asserts }),
    work('R2', 'Every figure in the report matches its cited source', CHECKS.document),
    work('R3', 'The east and west order totals hold', CHECKS.data),
    work('R4', 'The shipped mail reached ana and was read', CHECKS.message),
    work('R5', 'The order endpoint answers its users within its floor', CHECKS.service),
  ],
  deliverables: ['src/auth.js', 'report.md'],
  budget: null,
};
let w = makeWorld({ drafts: [DRAFT], files: EXPIRED.files, answers: prAnswers([{ n: 21, body: 'Rejects expired tokens in the auth middleware.', threads: [] }]) });
const bin = join(w.tmp, 'bin');
mkdirSync(bin, { recursive: true });
writeFileSync(join(bin, 'claude'), FIXTURE('fake-reviewer.pl').replace('__CONFIG__', Buffer.from(JSON.stringify({ version: COVERED, model: 'claude-sonnet-5-5', findings: [] }), 'utf8').toString('base64')), { mode: 0o755 });
writeFileSync(join(w.root, 'config.json'), `${JSON.stringify({ asks: SETTINGS, runner: { login_path: `${bin}:/usr/bin:/bin` }, plan: { reserve_pct: 10 } }, null, 2)}\n`);
writeFileSync(join(w.home, '.claude', '.credentials.json'), `${JSON.stringify({ claudeAiOauth: { accessToken: `sk-ant-oat01-<made-up>${'x'.repeat(40)}`, refreshToken: `sk-ant-ort01-<made-up>${'y'.repeat(40)}`, expiresAt: 4102444800000, scopes: ['user:inference'], subscriptionType: 'max' } })}\n`, { mode: 0o600 });
writeFileSync(join(w.home, '.claude', 'settings.json'), '{}\n');
mkdirSync(join(w.root, 'wiki'), { recursive: true });
writeFileSync(join(w.root, 'wiki', 'review-rubric.md'), FIXTURE('rubric.md'));

const STATED = 398;
await suiteDatabase(w, 'data/suite.db', STATED);
const { DatabaseSync } = await import('node:sqlite');
mkdirSync(join(w.repo, 'data'), { recursive: true });
const shop = new DatabaseSync(join(w.repo, 'data/shop.db'));
shop.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY, region TEXT NOT NULL, amount INTEGER NOT NULL)');
shop.exec("INSERT INTO orders (id, region, amount) VALUES (1, 'east', 100), (2, 'east', 50), (3, 'west', 90)");
shop.close();
const mail = ['Message-ID: <order-1042@shop.test>', 'From: shop@shop.test', 'To: ana@shop.test', 'Subject: Your order shipped', '', 'Your order shipped today.', ''].join('\r\n');
for (const sub of ['new', 'cur', 'tmp']) mkdirSync(join(w.repo, 'mail/ana', sub), { recursive: true });
writeFileSync(join(w.repo, 'mail/ana/new/.keep'), '');
writeFileSync(join(w.repo, 'mail/ana/tmp/.keep'), '');
const spec = (o: Record<string, unknown>) => `${JSON.stringify({ depth: 'unit', oracle: 'code', contract: null, ...o }, null, 2)}\n`;
w = addToBase(w, {
  'sources/q3.json': FIXTURE('q3.json'),
  'mail/ana/cur/1761955200.M1P1.deep-1898:2,S': mail,
  [CHECKS.document]: FIXTURE('q3-report.check.json'),
  [CHECKS.data]: spec({ kind: 'data', runner: 'sqlite', inputs: ['data/shop.db'], database: 'data/shop.db', query: 'SELECT region, SUM(amount) AS total FROM orders GROUP BY region ORDER BY region', rows: [{ region: 'east', total: 150 }, { region: 'west', total: 90 }] }),
  [CHECKS.message]: spec({ kind: 'message', runner: 'maildir', inputs: ['mail/ana'], mailbox: 'mail/ana', message_id: '<order-1042@shop.test>' }),
  [CHECKS.service]: spec({ kind: 'service', runner: 'http', inputs: [], depth: 'integration', url: `http://127.0.0.1:${port}/orders/1042`, from: '127.0.0.1', shape: { id: 'number', status: 'string', items: 'array' }, floor: { latency_ms: 100, throughput_rps: 5 }, requests: 5 }),
});
await trustRepo(w, true);

// ---- The hub, with the loader log.
const log = join(w.tmp, 'loads.log');
const hook = join(w.tmp, 'loads.mjs');
writeFileSync(hook, `import { registerHooks } from 'node:module';\nimport { appendFileSync } from 'node:fs';\nimport { threadId } from 'node:worker_threads';\nregisterHooks({ load(url, ctx, next) { appendFileSync(${JSON.stringify(log)}, Date.now() + ' ' + threadId + ' ' + url + '\\n'); return next(url, ctx); } });\n`);
const env = childEnv(w.home, { DEEP_HUB_TEST_CONFIRM: w.confirm, DEEP_HUB_TEST_DRAFTS: w.drafts, DEEP_HUB_TEST_WORK: w.work, DEEP_HUB_TEST_GITHUB: w.github });
const started = Date.now();
const child = spawn(NODE, ['--import', hook, CLI, 'hub', 'run'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
hubChild = child;
let out = '';
let err = '';
child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
const exit = new Promise<void>((resolve) => child.on('exit', () => resolve()));
const ready = await new Promise<Record<string, unknown> | undefined>((resolve) => {
  child.stdout!.setEncoding('utf8').on('data', (d: string) => { out += d; if (out.includes('\n')) resolve(parseObject(out.split('\n')[0]!)); });
  void exit.then(() => resolve(undefined));
});
if (!ready || ready.ready !== true) { say(`HUB DID NOT START: ${err.slice(-1500)}`); throw Error('hub did not start'); }
const hub = { pid: Number(ready.pid ?? child.pid), socket: String(ready.socket), home: w.home, root: w.root, child, exit, readyAt: Date.now(), plant: undefined, stderr: () => err };
const loads = () => readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => { const [t, th, ...u] = l.split(' '); return { t: Number(t), thread: th!, url: u.join(' ') }; });

let failed = false;
const check = (ok: boolean, line: string) => { say(`${ok ? 'OK  ' : 'FAIL'} ${line}`); if (!ok) failed = true; };
try {
  say(`== deep hub run started: pid ${hub.pid}, ready in ${hub.readyAt - started} ms, socket ${hub.socket.replace(w.tmp, '<tmp>')}`);
  await new Promise((r) => setTimeout(r, 5000));
  const atStart = loads();
  const kitsAtStart = atStart.filter((l) => kitOf(l.url));
  say(`   modules loaded by ready + 5 s, all threads: ${atStart.length}`);
  check(kitsAtStart.length === 0, `no check kit or conformance module loaded at the hub's start (${kitsAtStart.length} loaded)`);

  // ---- One claim through a session whose checks cover every kind.
  await reportWindow(hub, 5, Date.now() + 3 * 3_600_000);
  const { s, ref } = await openTask(hub, w, ASK, '#1898 e2e');
  say(`== task ${ref} opened by a Claude Code session through deep-hook; its definition locked with R1-R5`);
  const kitsBeforeClaim = loads().filter((l) => kitOf(l.url));
  check(kitsBeforeClaim.length === 0, `still no kit loaded after the session started and its definition locked (${kitsBeforeClaim.length})`);
  await s.read('src/auth.js');
  await s.read('sources/q3.json');
  const since = await lastPos(hub);
  await s.edit(FIX.file, FIX.from, FIX.to);
  await s.edit(CLEAN.file, CLEAN.from, CLEAN.to);
  const wrote = await s.writeCall('report.md', FIXTURE('q3-sales.md').replace('1,250', '1,240'));
  check(wrote.allowed, 'the session\'s Write of report.md was allowed');
  await openPr(s, '#1898 e2e');
  const claimAt = Date.now();
  await s.stop(`Expired tokens are rejected now, the q3 report is written with every figure cited, and the suite has ${STATED} tests (SELECT count(*) FROM tests on data/suite.db).`);
  say(`== the session stopped with its claim (states ${STATED} tests, opens PR 21)`);

  const events = await judged(hub, ref, since, { standMs: 45_000, timeoutMs: 900_000 });
  const claim = claimAfter(events, ref, since);
  const verdicts = taskVerdicts(events, ref, since);
  const last = verdicts.at(-1);
  say(`== ${claim ?? 'no claim'}: ${verdicts.map((v: { data: Record<string, unknown> }) => outcomeOf(v)).join(' -> ') || 'no verdict'}`);

  // Each kit's first module, relative to the hub's ready line and to the claim.
  const all = loads();
  for (const kit of ['checks-command', 'checks-review', 'checks-numbers', 'checks-work', 'conformance']) {
    const first = all.find((l) => kitOf(l.url) === kit);
    check(first !== undefined && first.t >= claimAt, `${kit} loaded only once a check needed it: ${first ? `first module at ready + ${((first.t - hub.readyAt) / 1000).toFixed(1)} s, claim + ${((first.t - claimAt) / 1000).toFixed(1)} s, thread ${first.thread}, ${all.filter((l) => kitOf(l.url) === kit).length} modules` : 'never loaded'}`);
  }

  // Every check of the claim, by kind, and how it ended: each must have run and passed.
  const runs = runsOf(events, ref, since) as { started: { data: Record<string, unknown> }; finished?: { data: Record<string, unknown> } }[];
  const onClaim = runs.filter((r) => String(r.started.data.commit) !== w.base);
  const outcome = (r: (typeof onClaim)[number]) => String(r.finished?.data.outcome ?? 'unfinished');
  for (const r of onClaim) if (outcome(r) !== 'passed') say(`   run ${String(r.started.data.check)}: ${outcome(r)} ${JSON.stringify(r.finished?.data ?? {}).slice(0, 600)}`);
  check(onClaim.length > 0 && onClaim.every((r) => outcome(r) === 'passed'), `every run on the claim passed (${onClaim.filter((r) => outcome(r) === 'passed').length} of ${onClaim.length})`);
  const passed = (name: string, test: (check: string) => boolean) => {
    const rs = onClaim.filter((r) => test(String(r.started.data.check)));
    check(rs.length > 0 && rs.every((r) => outcome(r) === 'passed'), `${name}: ${rs.map((r) => `${String(r.started.data.check)} ${outcome(r)}`).join(', ') || 'no run'}`);
  };
  passed('command check, the spec\'s unit check', (c) => c === 'unit');
  passed('command check, R1\'s drafted check', (c) => c === EXPIRED.check);
  passed('review check', (c) => c === 'review');
  passed(`numbers check on the stated ${STATED}`, (c) => c.startsWith('numbers') && c.includes(String(STATED)));
  for (const [kind, file] of Object.entries(CHECKS)) passed(`${kind} check`, (c) => c === file);
  const jobs = (await reviewJobs(hub)) as { job: string; state: string }[];
  check(jobs.length > 0 && jobs.every((j) => j.state === 'finished'), `the review ran as a runner job: ${jobs.map((j) => `${j.job} ${j.state}`).join(', ') || 'none'}`);
  check(outcomeOf(last) === 'PASS', `the claim's verdict is ${outcomeOf(last)}, its reasons:`);
  for (const reason of ((last?.data.reasons ?? []) as string[])) say(`     ${reason}`);
  const held = ((await heldKinds(hub)) as { kind: string }[]).map((k) => k.kind);
  const kinds = ['command', 'review', 'numbers', 'service', 'data', 'document', 'message'];
  check(kinds.every((k) => held.includes(k)), `checks.kinds holds ${held.join(', ')}`);

  // ---- deep lease, against this hub, with the same loader log.
  const leaseLog = join(w.tmp, 'lease.log');
  const leaseHook = join(w.tmp, 'lease.mjs');
  writeFileSync(leaseHook, readFileSync(hook, 'utf8').replace(JSON.stringify(log), JSON.stringify(leaseLog)));
  const lease = spawnSync(NODE, ['--import', leaseHook, CLI, 'lease', '--', '/bin/echo', 'leased run'], { cwd: w.repo, env: childEnv(w.home), encoding: 'utf8', timeout: 300_000 });
  const leased = existsSync(leaseLog) ? readFileSync(leaseLog, 'utf8').split('\n').filter(Boolean).map((l) => l.split(' ').slice(2).join(' ')) : [];
  say(`== deep lease -- /bin/echo 'leased run': exit ${lease.status}, stdout ${JSON.stringify(lease.stdout.trim())}, ${leased.length} modules`);
  const heavy = leased.filter((u) => /\/node_modules\/(yaml|better-sqlite3)\/|\.node$|^node:sqlite$/.test(u));
  check(lease.status === 0 && lease.stdout.trim() === 'leased run' && leased.length > 0, 'the leased command ran and printed its line');
  check(heavy.length === 0, `deep lease loaded neither yaml nor the SQLite addon (${heavy.length}: ${heavy.join(', ')})`);
  check(leased.some((u) => u.endsWith('/packages/hub/dist/heavy.js')), 'deep lease ran through @deepbuild/hub/lease (dist/heavy.js)');
} catch (error) {
  check(false, `the run stopped early: ${(error as Error).message.slice(0, 600)}`);
} finally {
  await stopHub(hub);
  say(failed ? '== RESULT: FAIL' : '== RESULT: every check above OK');
}
if (failed) throw Error('a check above failed');
}, 1_500_000);

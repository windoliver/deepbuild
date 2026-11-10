// check.kind@1's kit for each work kind (#68), run by the conformance package's one runner. A case is a piece of
// work the judge builds in a temporary checkout (files, a SQLite database from SQL, a local endpoint, or a source
// that only arrives after a while), with the run outcome it must come to. Each kind's fixed part holds its work, the
// work with a planted fault (ids starting `planted-`), a run that crashes and a run past its deadline; its seeded
// part draws the work's values. Each rule has one planted runner that breaks it alone: the reference with one fault.
import { spawnSync } from 'node:child_process';
import { closeSync, constants, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fail, Finding } from '@deepbuild/conformance/findings';
import type { CheckContext, CheckResult, Fixture, PlantedFill, Random, RunOutcome, SlotCase, SlotKitImpl, SlotRule } from '@deepbuild/conformance';
import type { JsonType, WorkFill, WorkKind, WorkSpec } from './types.js';

const SLOT = 'check.kind@1';
/** Far past any case's run; the deadline cases state their own. */
const LONG = 60_000;
/** The deadline cases: work that takes SLOW ms against a DEADLINE ms deadline. */
const DEADLINE = 300;
const SLOW = 1500;
const OUTCOMES: readonly RunOutcome[] = ['passed', 'failed', 'ran_nothing', 'missing', 'overran', 'stopped', 'uncounted'];

const RULES = {
  work: { id: 'outcome-from-work', rule: 'The outcome is the work\'s: work that doesn\'t hold fails at the check\'s assertion, naming what it measured, and work that holds passes.', message: 'reported a run other than what the work shows', code: 'work_outcome' },
  deadline: { id: 'deadline-holds', rule: 'A run still going at its deadline is overran; a result that arrives after the deadline is never passed or failed.', message: 'reported a result after the deadline instead of overran', code: 'reported_after_deadline' },
  crash: { id: 'crash-output-kept', rule: 'A run that stops on an error before its assertion is failed, its error kept as a failure that isn\'t the check\'s assertion.', message: 'dropped a crashed run\'s output', code: 'crash_output_dropped' },
} as const;
type Rule = keyof typeof RULES;
const rules: SlotRule[] = Object.values(RULES).map(({ id, rule }) => ({ id, rule }));

/** A local endpoint for a service case: what it answers and after how long, or a port nothing listens on. */
type Serve = { status: number; body: string; delay_ms: number } | 'refused';
/** A case's work: its spec (a service's URL with `{port}`), the files of its checkout, SQL that builds a database, an endpoint, and a file that arrives only after SLOW ms. */
interface Work { spec: WorkSpec; deadline: number; files?: Record<string, string>; sql?: { database: string; text: string }; serve?: Serve; slow?: string }
/** What the run must come to: its outcome, a failure at the assertion naming `assertion`, a crash's failure naming `crash`. */
interface Expected { outcome: RunOutcome; assertion?: string; crash?: string }

const base = { inputs: [] as string[], depth: 'unit', oracle: 'code' as const, contract: null };
const work = (id: string, w: Work, expected: Expected): Fixture => ({ id, input: w as unknown as Fixture['input'], expected: expected as unknown as Fixture['expected'] });

// ---- The fixed parts, one per kind.

const ORDER = JSON.stringify({ id: 1042, status: 'shipped', items: [{ sku: 'A-1', qty: 2 }] });
const service = (serve: Serve, more: Partial<WorkSpec> = {}): Work => ({
  deadline: LONG, serve,
  spec: { ...base, kind: 'service', runner: 'http', url: 'http://localhost:{port}/orders/1042', from: '127.0.0.1', shape: { id: 'number', status: 'string', items: 'array' }, floor: { latency_ms: 1000, throughput_rps: 1 }, requests: 3, ...more } as WorkSpec,
});
const answers = (delay_ms: number, body = ORDER): Serve => ({ status: 200, body, delay_ms });

const ORDERS = "CREATE TABLE orders (id INTEGER PRIMARY KEY, region TEXT NOT NULL, amount INTEGER NOT NULL); INSERT INTO orders (id, region, amount) VALUES (1, 'east', 100), (2, 'east', 50), (3, 'west', 90);";
const TOTALS = 'SELECT region, SUM(amount) AS total FROM orders GROUP BY region ORDER BY region';
const data = (sql: string, query: string, rows: Record<string, string | number | null>[], deadline = LONG): Work =>
  ({ deadline, sql: { database: 'shop.db', text: sql }, spec: { ...base, kind: 'data', runner: 'sqlite', database: 'shop.db', query, rows } });

const Q3 = JSON.stringify({ revenue: { west: 1240, east: 860 } });
const report = (body: string): Record<string, string> => ({ 'report.md': `# Third-quarter sales\n\n${body}\n`, 'sources/q3.json': Q3 });
const document = (files: Record<string, string>, more: Partial<Work> = {}): Work =>
  ({ deadline: LONG, files, ...more, spec: { ...base, kind: 'document', runner: 'markdown', document: 'report.md' } });

const ID = '<order-1042@shop.test>';
const mail = (id: string): string => [`Message-ID: ${id}`, 'From: shop@shop.test', 'To: ana@shop.test', 'Subject: Your order shipped', '', 'Your order shipped today.', ''].join('\r\n');
const maildir = (files: Record<string, string>, more: Partial<Work> = {}, id = ID): Work =>
  ({ deadline: LONG, files: { 'mail/ana/tmp/.keep': '', ...files }, ...more, spec: { ...base, kind: 'message', runner: 'maildir', mailbox: 'mail/ana', message_id: id } });
const NAME = '1761955200.M1P1.kit';

const FIXED: Record<WorkKind, Fixture[]> = {
  service: [
    work('answers-within-floor', service(answers(0)), { outcome: 'passed' }),
    work('planted-slow-answers', service(answers(300), { floor: { latency_ms: 100, throughput_rps: 1 } } as Partial<WorkSpec>), { outcome: 'failed', assertion: 'latency' }),
    work('planted-wrong-shape', service(answers(0, JSON.stringify({ id: '1042', status: 'shipped', items: [] }))), { outcome: 'failed', assertion: 'id is string, not number' }),
    work('from-elsewhere', service(answers(0), { from: '192.0.2.10' } as Partial<WorkSpec>), { outcome: 'missing' }),
    work('crashed-refused', service('refused'), { outcome: 'failed', crash: 'ECONNREFUSED' }),
    work('past-deadline', { ...service(answers(SLOW), { requests: 1, floor: { latency_ms: LONG, throughput_rps: 0 } } as Partial<WorkSpec>), deadline: DEADLINE }, { outcome: 'overran' }),
  ],
  data: [
    work('totals-hold', data(ORDERS, TOTALS, [{ region: 'east', total: 150 }, { region: 'west', total: 90 }]), { outcome: 'passed' }),
    work('planted-double-import', data(`${ORDERS} INSERT INTO orders VALUES (4, 'east', 50);`, TOTALS, [{ region: 'east', total: 150 }, { region: 'west', total: 90 }]), { outcome: 'failed', assertion: 'row 1' }),
    work('crashed-no-table', data(ORDERS, 'SELECT * FROM refunds', []), { outcome: 'failed', crash: 'no such table' }),
    work('past-deadline', data(ORDERS, 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 10000000) SELECT count(*) AS n FROM c', [{ n: 10_000_000 }], DEADLINE), { outcome: 'overran' }),
  ],
  document: [
    work('cited-and-matching', document(report('West revenue was 1,240 [source](sources/q3.json#/revenue/west) in the third quarter. East revenue was 860 [source](sources/q3.json#/revenue/east).')), { outcome: 'passed' }),
    work('planted-wrong-number', document(report('West revenue was 1,250 [source](sources/q3.json#/revenue/west) in the third quarter.')), { outcome: 'failed', assertion: '1,250 doesn\'t match its source sources/q3.json' }),
    work('planted-uncited-claim', document(report('West revenue was 1,240 [source](sources/q3.json#/revenue/west). Sales grew fast.')), { outcome: 'failed', assertion: 'cites no source' }),
    work('nothing-claimed', document({ 'report.md': '# Third-quarter sales\n\n## West\n' }), { outcome: 'ran_nothing' }),
    work('crashed-source-not-json', document({ ...report('West revenue was 1,240 [source](sources/q3.json#/revenue/west).'), 'sources/q3.json': '{"revenue": ' }), { outcome: 'failed', crash: 'JSON' }),
    work('past-deadline', { ...document(report('West revenue was 1,240 [source](sources/q3.json#/revenue/west).')), slow: 'sources/q3.json', deadline: DEADLINE }, { outcome: 'overran' }),
  ],
  message: [
    work('delivered-and-seen', maildir({ [`mail/ana/cur/${NAME}:2,S`]: mail(ID), 'mail/ana/new/.keep': '' }), { outcome: 'passed' }),
    work('planted-never-seen', maildir({ [`mail/ana/new/${NAME}`]: mail(ID), 'mail/ana/cur/.keep': '' }), { outcome: 'failed', assertion: 'not acknowledged' }),
    work('planted-never-delivered', maildir({ [`mail/ana/cur/${NAME}:2,S`]: mail('<other@shop.test>'), 'mail/ana/new/.keep': '' }), { outcome: 'failed', assertion: 'not delivered' }),
    work('crashed-not-maildir', maildir({ 'mail/ana/new': 'a file, not a folder', 'mail/ana/cur/.keep': '' }), { outcome: 'failed', crash: 'isn\'t a Maildir' }),
    work('past-deadline', { ...maildir({ [`mail/ana/cur/${NAME}:2,S`]: mail(ID), 'mail/ana/new/.keep': '' }), slow: `mail/ana/cur/${NAME}:2,S`, deadline: DEADLINE }, { outcome: 'overran' }),
  ],
};

// ---- The seeded parts: the work's values drawn, once holding and once with one value off.

const word = (random: Random): string => Array.from({ length: 6 }, () => 'abcdefghijklmnopqrstuvwxyz'[random.int(0, 25)]).join('');
const TYPES: [JsonType, unknown][] = [['number', 7], ['string', 'x'], ['boolean', true], ['array', []], ['object', {}], ['null', null]];

function generate(kind: WorkKind, random: Random): SlotCase[] {
  const seeded = (i: number, w: Work, expected: Expected): SlotCase => ({ id: `seeded-${i}`, part: 'seeded', input: w as unknown as SlotCase['input'], expected: expected as unknown as SlotCase['expected'] });
  const off = random.int(1, 9);
  if (kind === 'service') {
    const fields = Array.from({ length: random.int(1, 4) }, (_, i) => [`${word(random)}${i}`, TYPES[random.int(0, TYPES.length - 1)]!] as const);
    const shape = Object.fromEntries(fields.map(([f, [t]]) => [f, t]));
    const body = Object.fromEntries(fields.map(([f, [, v]]) => [f, v]));
    const [bent, [type]] = fields[0]!;
    const wrong = TYPES.find(([t]) => t !== type)!;
    return [
      seeded(1, service(answers(0, JSON.stringify(body)), { shape } as Partial<WorkSpec>), { outcome: 'passed' }),
      seeded(2, service(answers(0, JSON.stringify({ ...body, [bent]: wrong[1] })), { shape } as Partial<WorkSpec>), { outcome: 'failed', assertion: `${bent} is ${wrong[0]}, not ${type}` }),
    ];
  }
  if (kind === 'data') {
    const regions = Array.from({ length: random.int(1, 4) }, (_, i) => `${word(random)}${i}`).sort();
    const amounts = regions.map(() => Array.from({ length: random.int(1, 5) }, () => random.int(0, 1000)));
    const sql = `CREATE TABLE sales (region TEXT NOT NULL, amount INTEGER NOT NULL); INSERT INTO sales VALUES ${regions.flatMap((r, i) => amounts[i]!.map((a) => `('${r}', ${a})`)).join(', ')};`;
    const query = 'SELECT region, SUM(amount) AS total FROM sales GROUP BY region ORDER BY region';
    const rows = regions.map((region, i) => ({ region, total: amounts[i]!.reduce((s, a) => s + a, 0) }));
    return [
      seeded(1, data(sql, query, rows), { outcome: 'passed' }),
      seeded(2, data(sql, query, rows.map((r, i) => (i === rows.length - 1 ? { ...r, total: r.total + off } : r))), { outcome: 'failed', assertion: `row ${rows.length}` }),
    ];
  }
  if (kind === 'document') {
    const keys = Array.from({ length: random.int(1, 4) }, (_, i) => `${word(random)}${i}`);
    const values = keys.map(() => random.int(0, 2_000_000));
    const source = JSON.stringify({ figures: Object.fromEntries(keys.map((k, i) => [k, values[i]])) });
    const text = (bump: number): string => keys.map((k, i) => `The ${k} figure was ${(values[i]! + (i === 0 ? bump : 0)).toLocaleString('en-US')} [source](sources/s.json#/figures/${k}).`).join(' ');
    const files = (bump: number): Record<string, string> => ({ 'report.md': `# Figures\n\n${text(bump)}\n`, 'sources/s.json': source });
    return [
      seeded(1, document(files(0)), { outcome: 'passed' }),
      seeded(2, document(files(off)), { outcome: 'failed', assertion: `${(values[0]! + off).toLocaleString('en-US')} doesn't match its source sources/s.json` }),
    ];
  }
  const id = `<${word(random)}@${word(random)}.test>`;
  const name = `${random.int(1, 1_999_999_999)}.M${random.int(1, 999)}.seeded`;
  return [
    seeded(1, maildir({ [`mail/ana/cur/${name}:2,${random.int(0, 1) ? 'RS' : 'S'}`]: mail(id), 'mail/ana/new/.keep': '' }, {}, id), { outcome: 'passed' }),
    // Delivered and never seen: still in new/, or in cur/ marked replied only.
    seeded(2, maildir({ [random.int(0, 1) ? `mail/ana/new/${name}` : `mail/ana/cur/${name}:2,R`]: mail(id), 'mail/ana/new/.keep': '', 'mail/ana/cur/.keep': '' }, {}, id), { outcome: 'failed', assertion: 'not acknowledged' }),
  ];
}

// ---- Building a case's work, and taking it down.

interface Made { spec: WorkSpec; checkout: string; cleanup(): void }

function build(w: Work): Made {
  const checkout = mkdtempSync(join(tmpdir(), `deep-work-${w.spec.kind}-`));
  for (const [path, text] of Object.entries(w.files ?? {})) {
    mkdirSync(dirname(join(checkout, path)), { recursive: true });
    if (path !== w.slow) writeFileSync(join(checkout, path), text);
  }
  if (w.sql) {
    const db = new DatabaseSync(join(checkout, w.sql.database));
    db.exec(w.sql.text);
    db.close();
  }
  let timer: NodeJS.Timeout | undefined;
  if (w.slow) {
    // The file is a pipe whose text arrives SLOW ms in: a reader waits on it, as on a slow disk or a mount.
    const pipe = join(checkout, w.slow);
    const made = spawnSync('mkfifo', [pipe], { encoding: 'utf8' });
    if (made.status !== 0) throw new Finding('BLOCKED', `the kit couldn't make a pipe for its deadline case: ${made.stderr || made.error?.message}`, []);
    timer = setTimeout(() => {
      try {
        const fd = openSync(pipe, constants.O_WRONLY | constants.O_NONBLOCK);
        writeFileSync(fd, w.files![w.slow!]!);
        closeSync(fd);
      } catch { /* no reader is left: the run already ended */ }
    }, SLOW);
  }
  return { spec: w.spec, checkout, cleanup: () => { clearTimeout(timer); rmSync(checkout, { recursive: true, force: true }); } };
}

/** The case's endpoint on a port of its own, or a port nothing listens on; closed by the case's cleanup. */
function listen(serve: Serve): Promise<{ port: number; close(): void }> {
  const server: Server = createServer((_req, res) => {
    if (serve === 'refused') return;
    setTimeout(() => res.writeHead(serve.status, { 'content-type': 'application/json' }).end(serve.body), serve.delay_ms);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const { port } = server.address() as AddressInfo;
    const close = (): void => { server.closeAllConnections(); server.close(); };
    if (serve === 'refused') close();
    resolve({ port, close });
  }));
}

// ---- The judge.

const grace = (deadline: number): number => Math.max(100, deadline);
const broke = (rule: Rule, detail: string): Finding => fail(RULES[rule].message, [RULES[rule].code], detail);

function hold(answer: unknown, ex: Expected, deadline: number, elapsed: number): void {
  if (typeof answer !== 'object' || answer === null) throw new Finding('FAIL', 'the result is not an object', ['type']);
  const r = answer as Record<string, unknown>;
  if ('verdict' in r) throw new Finding('FAIL', 'the result carries a verdict; a runner reports a run outcome and the core matches it to a verdict', ['unlisted_field']);
  if (!OUTCOMES.includes(r.outcome as RunOutcome)) throw new Finding('FAIL', `outcome ${JSON.stringify(r.outcome)} is not one of the run outcomes`, ['enum']);
  if (!Number.isInteger(r.testsRun) || (r.testsRun as number) < 0 || !Array.isArray(r.failures) || !Array.isArray(r.read)) throw new Finding('FAIL', 'the result lacks its testsRun, failures or read', ['type']);
  const failures = r.failures as CheckResult['failures'];
  const outcome = r.outcome as RunOutcome;
  const shown = failures.map((f) => `${f.assertion ? '(assertion) ' : ''}${f.message}`).join(' | ') || 'no failures';
  if (elapsed > deadline + grace(deadline) && outcome !== 'overran') throw broke('deadline', `reported ${outcome} ${elapsed} ms in, past the ${deadline} ms deadline`);
  if (outcome !== ex.outcome) throw broke('work', `reported ${outcome}; the work's run is ${ex.outcome} (${shown})`);
  if (ex.assertion && !failures.some((f) => f.assertion && f.message.includes(ex.assertion!))) throw broke('work', `no failure at the check's assertion names "${ex.assertion}" (${shown})`);
  if (ex.crash && !failures.some((f) => !f.assertion && f.message.includes(ex.crash!))) throw broke('crash', `the run stopped on "${ex.crash}", and no failure keeps it (${shown})`);
}

function* judge(fill: WorkFill, c: SlotCase): Generator<() => unknown, void, unknown> {
  const w = c.input as unknown as Work;
  const made = build(w);
  let endpoint: { port: number; close(): void } | undefined;
  try {
    let spec = made.spec;
    if (w.serve && spec.kind === 'service') {
      endpoint = (yield () => listen(w.serve!)) as { port: number; close(): void };
      spec = { ...spec, url: spec.url.replace('{port}', String(endpoint.port)) };
    }
    const ctx: CheckContext = { checkout: made.checkout, deadline: w.deadline, now: () => Date.now() };
    const started = Date.now();
    const answer = yield () => fill.run(spec, ctx);
    hold(answer, c.expected as unknown as Expected, w.deadline, Date.now() - started);
  } finally {
    endpoint?.close();
    made.cleanup();
  }
}

// ---- The planted runners.

function planted(reference: WorkFill): PlantedFill<WorkFill>[] {
  const plant = (name: string, breaks: Rule, run: WorkFill['run']): PlantedFill<WorkFill> =>
    ({ name, message: RULES[breaks].message, codes: [RULES[breaks].code], breaks: RULES[breaks].id, fill: { ...reference, run } });
  return [
    plant('misses-the-fault', 'work', async (spec, ctx) => {
      const r = await reference.run(spec, ctx);
      return r.outcome === 'failed' && r.failures.every((f) => f.assertion) ? { ...r, outcome: 'passed', failures: [] } : r;
    }),
    plant('past-deadline', 'deadline', (spec, ctx) => reference.run(spec, { ...ctx, deadline: LONG })),
    plant('dropped-output', 'crash', async (spec, ctx) => {
      const r = await reference.run(spec, ctx);
      return { ...r, failures: r.failures.filter((f) => f.assertion), evidence: [] };
    }),
  ];
}

/** check.kind@1's kit for one work kind. */
export function kitFor(kind: WorkKind, reference: () => WorkFill): SlotKitImpl<WorkFill> {
  return {
    slot: SLOT, fills: 'one', revision: 1, rules, fixtures: FIXED[kind], planted: planted(reference()), clean: () => [reference()],
    generate: (random) => generate(kind, random), judge,
  };
}

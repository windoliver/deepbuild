// Shared test-side tools for the #68 acceptance tests: the plug-in and the gate (imported lazily, so each test fails
// on its own at the base), the real pieces of work each kind checks (an HTTP endpoint in a process of its own, a
// SQLite database, a Markdown document with its JSON source, a Maildir), each with a planted fault and its fix, and
// the core's verdict over one check's run. None of them stands in for the plug-in.
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { afterAll } from 'vitest';
import { verdict } from '../../../packages/verdicts/src/index.ts';
import type { ClaimCheck, ClaimInput, Depth, Oracle, Run, Verdict } from '../../../packages/verdicts/src/index.ts';
import type { CheckContext, CheckResult, SlotCaseResult, SlotReport } from '../../../packages/conformance/src/index.ts';
import type { DataSpec, DocumentSpec, MessageSpec, ServiceSpec, WorkKind, WorkSpec } from '../../../packages/checks-work/src/index.ts';

// ---- The plug-in and the gate, reached only through their public entries, imported when a test first needs them.

type Work = typeof import('../../../packages/checks-work/src/index.ts');
export const work = (): Promise<Work> => import('../../../packages/checks-work/src/index.ts');
type Gate = typeof import('../../../packages/gate/src/index.ts');
export const gate = (): Promise<Gate> => import('../../../packages/gate/src/index.ts');

export const KINDS: readonly WorkKind[] = ['service', 'data', 'document', 'message'];
/** Far past any run here; a kind's own deadline cases live in its kit. */
export const DEADLINE = 30_000;
export const context = (checkout: string, deadline = DEADLINE): CheckContext => ({ checkout, deadline, now: () => Date.now() });

// ---- What the tests start, stopped and removed when the file's tests end: only what they started, by handle.

const dirs: string[] = [];
const children: ChildProcess[] = [];
afterAll(() => {
  for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill('SIGTERM');
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const tempDir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'deep-68-'));
  dirs.push(d);
  return d;
};
const write = (dir: string, path: string, text: string): void => {
  const file = join(dir, path);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, text);
};

// ---- The pieces of work: each kind's, with a planted fault or with its fix.

export type Variant = 'fault' | 'fix';
export interface Piece {
  kind: WorkKind;
  spec: WorkSpec;
  /** The folder the check runs in. */
  checkout: string;
  /** For a service: the source address of every request the endpoint got, in order; empty for the other kinds. */
  seen(): Promise<string[]>;
}

/** Where the endpoint's users are: the local address a service check's requests must leave from. */
export const USERS = '127.0.0.1';
const SERVER = fileURLToPath(new URL('./fixtures/server.mjs', import.meta.url));

/** The order endpoint in a process of its own: the fault answers its users (IPv4) after 300 ms and ::1 at once. */
async function endpoint(variant: Variant): Promise<{ url: string; seen(): Promise<string[]> }> {
  const child = spawn(process.execPath, [SERVER, variant === 'fault' ? 'slow-for-ipv4' : 'fast'], { stdio: ['ignore', 'pipe', 'inherit'] });
  children.push(child);
  const port = await new Promise<number>((resolve, reject) => {
    let out = '';
    child.stdout!.on('data', (d: Buffer) => {
      out += d.toString();
      if (out.includes('\n')) resolve(Number(out.split('\n')[0]));
    });
    child.once('exit', (code) => reject(new Error(`the test endpoint exited ${code} before it listened`)));
  });
  return {
    url: `http://localhost:${port}/orders/1042`,
    seen: async () => (await (await fetch(`http://[::1]:${port}/__seen`)).json()) as string[],
  };
}

export const SERVICE_FLOOR = { latency_ms: 100, throughput_rps: 5 };
/** The document's number the fault gets wrong, as written, and the source it cites. */
export const WRONG_NUMBER = '1,250';
export const SOURCE = 'sources/q3.json';
export const MESSAGE_ID = '<order-1042@shop.test>';

export async function piece(kind: WorkKind, variant: Variant): Promise<Piece> {
  const none = async (): Promise<string[]> => [];
  if (kind === 'service') {
    const e = await endpoint(variant);
    const spec: ServiceSpec = {
      kind: 'service', runner: 'http', inputs: [], depth: 'integration', oracle: 'code', contract: null,
      url: e.url, from: USERS, shape: { id: 'number', status: 'string', items: 'array' }, floor: { ...SERVICE_FLOOR }, requests: 5,
    };
    return { kind, spec, checkout: tempDir(), seen: e.seen };
  }
  const dir = tempDir();
  if (kind === 'data') {
    const db = new DatabaseSync(join(dir, 'shop.db'));
    db.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY, region TEXT NOT NULL, amount INTEGER NOT NULL)');
    db.exec("INSERT INTO orders (id, region, amount) VALUES (1, 'east', 100), (2, 'east', 50), (3, 'west', 90)");
    // The planted fault: order 2 imported twice, so the east total no longer holds.
    if (variant === 'fault') db.exec("INSERT INTO orders (id, region, amount) VALUES (4, 'east', 50)");
    db.close();
    const spec: DataSpec = {
      kind: 'data', runner: 'sqlite', inputs: ['shop.db'], depth: 'unit', oracle: 'code', contract: null,
      database: 'shop.db', query: 'SELECT region, SUM(amount) AS total FROM orders GROUP BY region ORDER BY region',
      rows: [{ region: 'east', total: 150 }, { region: 'west', total: 90 }],
    };
    return { kind, spec, checkout: dir, seen: none };
  }
  if (kind === 'document') {
    write(dir, SOURCE, `${JSON.stringify({ revenue: { west: 1240, east: 860 } }, null, 2)}\n`);
    // The planted fault: the west figure written as 1,250 where its source says 1240.
    const west = variant === 'fault' ? WRONG_NUMBER : '1,240';
    write(dir, 'report.md', [
      '# Third-quarter sales',
      '',
      `West revenue was ${west} [source](${SOURCE}#/revenue/west) in the third quarter.`,
      `East revenue was 860 [source](${SOURCE}#/revenue/east) in the third quarter.`,
      '',
    ].join('\n'));
    const spec: DocumentSpec = { kind: 'document', runner: 'markdown', inputs: ['report.md', SOURCE], depth: 'unit', oracle: 'code', contract: null, document: 'report.md' };
    return { kind, spec, checkout: dir, seen: none };
  }
  // A Maildir: delivered is a file in new/ or cur/ with the message's Message-ID; acknowledged is the seen flag (S)
  // in a cur/ file's info. The planted fault: delivered, never seen.
  for (const sub of ['new', 'cur', 'tmp']) mkdirSync(join(dir, 'mail', 'ana', sub), { recursive: true });
  const mail = ['Message-ID: <order-1042@shop.test>', 'From: shop@shop.test', 'To: ana@shop.test', 'Subject: Your order shipped', '', 'Your order shipped today.', ''].join('\r\n');
  const name = '1761955200.M1P1.deep-68';
  write(dir, variant === 'fault' ? `mail/ana/new/${name}` : `mail/ana/cur/${name}:2,S`, mail);
  const spec: MessageSpec = { kind: 'message', runner: 'maildir', inputs: ['mail/ana'], depth: 'unit', oracle: 'code', contract: null, mailbox: 'mail/ana', message_id: MESSAGE_ID };
  return { kind, spec, checkout: dir, seen: none };
}

/** The kind's runner on a piece, with the oracle given or the spec's own. */
export async function runOn(p: Piece, oracle: Oracle = p.spec.oracle): Promise<CheckResult> {
  const fill = (await work()).workFill(p.kind);
  return await fill.run({ ...p.spec, oracle }, context(p.checkout));
}

// ---- The core's verdict on a claim whose one requirement one check covers, from that check's one run.

const HEAD = 'c'.repeat(40);
const ENV = { os: 'darwin' };
const T0 = 1_761_955_200_000;
const REQ = 'R1';
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

export function runRecord(result: CheckResult, check: string): Run {
  return {
    run: `run:${check.replace(/[^0-9A-Za-z]/g, '')}`, check, claim: 'claim:68', commit: HEAD, digest: `d1:${sha256(check)}`,
    environment: { ...ENV }, tools: {}, outcome: result.outcome, started: T0, ended: T0 + 1, tests_run: result.testsRun,
    reads: [...result.read],
    failures: result.failures.map((f) => ({ test: f.test, message: f.message, cause: 'change:work', frames: [{ file: f.file, line: f.line }], covers: [], case: null })),
    evidence: [], kept: true,
    ...(result.outcome === 'missing' ? { missing: { cause: result.failures.map((f) => f.message).join('; ') || 'missing', owner: 'you', since: T0 } } : {}),
  };
}
/** The verdict on one run of a kind's check whose oracle is `oracle` (the spec's own unless given). */
export function judge(result: CheckResult, spec: WorkSpec, oracle: Oracle = spec.oracle): Verdict {
  const check = `check:${spec.kind}`;
  const depth = spec.depth as Depth;
  const c: ClaimCheck = {
    check, digest: `d1:${sha256(check)}`, source: 'definition', depth, proof: 'test_run', covers: [REQ],
    environment: { ...ENV }, tools: {}, oracle,
  };
  const claim: ClaimInput = {
    claim: 'claim:68', agent: 'session:agent', repo: 'repo:work', task: 'task:68', commit: HEAD,
    requirements: [{ req: REQ, depth, oracle: 'code', on_base: 'passes' }],
    checks: [c], runs: [runRecord(result, check)], changes: [], waivers: [], now: T0 + 2,
  };
  return verdict(claim);
}

export const shown = (r: CheckResult): string =>
  `run ${r.outcome}, ${r.testsRun} run; failures: ${r.failures.map((f) => `${f.file}:${f.line} ${f.assertion ? '(assertion) ' : ''}${f.message}`).join(' | ') || '(none)'}`;
export const caseOf = (report: SlotReport, id: string): SlotCaseResult | undefined => report.cases.find((c) => c.id === id);
export const listed = (report: SlotReport): string => report.cases.map((c) => `${c.id}: ${c.outcome} ${c.message}`).join(' | ');

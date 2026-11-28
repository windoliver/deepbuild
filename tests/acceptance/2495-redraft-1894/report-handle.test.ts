import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import * as adapters from '@deepbuild/adapters';
import { openEvidenceStore } from '@deepbuild/evidence';
import { compareReplay, openRecord } from '@deepbuild/record';
import { cleanup, world } from '../1108/helpers.ts';
import { handleOf, layerRow, learn, LOCAL_FIRST, said, startSession, T0, type World } from '../112/helpers.ts';

const idOf = (text: string): string => `#2495.${createHash('sha256').update(text.trim().replace(/\s+/g, ' ')).digest('hex').slice(0, 8)}`;
const AC1 = idOf("After an eval run, the evidence store holds the report's bytes, and the handle the run prints resolves to them: a test fails on the merge base, where the store holds nothing");
const AC2 = idOf('A `learn.widened` change by the local-first rule that cites that handle passes `replayCheck` when the report adopts, and is refused naming the outcome when it doesn\'t');

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const CLI = join(REPO, 'packages/cli/dist/main.js');
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');

afterAll(cleanup);

async function startHub(root: string, home: string) {
  if (!existsSync(CLI)) throw Error(`BLOCKED: the CLI isn't built (${CLI}); run npm run build --workspaces`);
  mkdirSync(root, { recursive: true });
  const child = spawn(process.execPath, [CLI, 'hub', 'run', '--root', root], { cwd: REPO, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const exit = new Promise<void>((r) => child.on('exit', () => r()));
  let err = '';
  child.stderr.on('data', (d: Buffer) => { err += d; });
  const ready = await new Promise<boolean>((res) => {
    let out = '';
    const timer = setTimeout(() => res(false), 20_000);
    child.stdout.on('data', (d: Buffer) => {
      out += d;
      if (!out.includes('\n')) return;
      clearTimeout(timer);
      try { res((JSON.parse(out.split('\n')[0]!) as { ready?: boolean }).ready === true); } catch { res(false); }
    });
    void exit.then(() => res(false));
  });
  if (!ready) { child.kill('SIGKILL'); throw Error(`BLOCKED: the hub didn't start (deep hub run --root): ${err.slice(0, 1000)}`); }
  return { stop: async () => { child.kill('SIGTERM'); await Promise.race([exit, sleep(10_000)]); if (child.exitCode === null) child.kill('SIGKILL'); } };
}

const runScript = (env: NodeJS.ProcessEnv, input: string) => new Promise<{ code: number | null; out: string; err: string }>((res) => {
  const child = spawn(process.execPath, [join(REPO, 'scripts', 'config-eval.mjs'), 'run', input], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  child.stdout.on('data', (d: Buffer) => { out += d; });
  child.stderr.on('data', (d: Buffer) => { err += d; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 240_000);
  child.on('close', (code) => { clearTimeout(timer); res({ code, out, err }); });
});

let shared: ReturnType<typeof doRun> | undefined;
const ran = () => (shared ??= doRun());
async function doRun() {
  process.env.TMPDIR = '/tmp';
  const names = Array.from({ length: 6 }, (_, i) => `t${i + 1}`);
  const prompts = names.map((n) => `Ticket ${n}: fix the cart badge for item ${n}.`);
  const w = await world(Object.fromEntries(prompts.map((p) => [p, { steps: [] }])));
  const plan = w.plan(names);
  const input = join(w.box, 'input.json');
  writeFileSync(input, JSON.stringify({ plan, tasks: names.map((n, i) => w.task(n, prompts[i]!)) }));
  const root = join(w.home, '.deepbuild');
  const hub = await startHub(root, w.home);
  let result: Awaited<ReturnType<typeof runScript>>;
  try { result = await runScript({ ...w.env, LC_ALL: 'C' }, input); } finally { await hub.stop(); }
  return { w, plan, root, ...result };
}

async function afterRun() {
  expect('transcriptReaders' in adapters, '@deepbuild/adapters exports transcriptReaders (#1894)').toBe(true);
  const r = await ran();
  const store = await openEvidenceStore({ root: join(r.root, 'evidence'), now: () => T0 });
  const printed = [...new Set(r.out.match(/\bev:[0-9a-f]{64}\b/g) ?? [])];
  expect(printed, `the run prints the handle of its report as ev:<sha256>; it printed:\n${r.out}\n${r.err}`).not.toHaveLength(0);
  const reports: { handle: string; bytes: Uint8Array }[] = [];
  for (const handle of printed) {
    const at = handle.slice(3);
    if (!(await store.get(at))) continue;
    const bytes = await store.read(at);
    try { const v = JSON.parse(Buffer.from(bytes).toString('utf8')) as { plan?: unknown; runs?: unknown }; if (v.plan && Array.isArray(v.runs)) reports.push({ handle, bytes }); } catch { continue; }
  }
  expect(reports, `exactly one printed handle resolves, in the evidence store, to a report (its plan and runs); printed ${printed.join(', ')}`).toHaveLength(1);
  return { ...r, store, ...reports[0]! };
}

function keptFile(root: string) {
  const files = existsSync(join(root, 'evals')) ? readdirSync(join(root, 'evals')).filter((f) => /^[0-9a-f]{64}\.json$/.test(f)) : [];
  expect(files, 'the report file under ~/.deepbuild/evals/ stays, named by the digest of the two variants').toHaveLength(1);
  return JSON.parse(readFileSync(join(root, 'evals', files[0]!), 'utf8')) as { plan: { id: string }; runs: { side: string; metrics: Record<string, number | null> }[]; after: { outcome: string } };
}

describe(`AC1 ${AC1} the store holds the report's bytes and the printed handle resolves to them`, () => {
  it(`AC1 ${AC1} after a run, the handle it prints names the report in the evidence store, and the file under evals/ stays`, async () => {
    const r = await afterRun();
    expect(r.code, `the run ends 0 on a report that isn't a regression:\n${r.out}\n${r.err}`).toBe(0);
    expect(sha(r.bytes), 'the handle is the SHA-256 of the bytes it resolves to').toBe(r.handle.slice(3));
    const stored = JSON.parse(Buffer.from(r.bytes).toString('utf8')) as { plan: unknown; runs: unknown[] };
    const kept = keptFile(r.root);
    expect(stored.plan, 'the stored report holds the frozen plan the run was given').toEqual(r.plan);
    expect(stored.runs, 'and the runs of the report the run kept').toEqual(kept.runs);
    expect(stored.runs, 'every repeat of both sides of the six tasks').toHaveLength(12);
  }, 300_000);
});

describe(`AC2 ${AC2} a local-first widening citing the printed handle is judged by the report's outcome`, () => {
  it(`AC2 ${AC2} an INCONCLUSIVE report is refused naming it; the same report adopting passes`, async () => {
    const r = await afterRun();
    const kept = keptFile(r.root);
    expect(kept.after.outcome, 'precondition: both sides alike read INCONCLUSIVE').toBe('INCONCLUSIVE');

    let t = T0;
    const clock = { now: () => t, tick: (ms: number) => (t += ms) };
    const options: Parameters<typeof openRecord>[0] = { path: join(r.w.box, 'record', 'record.sqlite'), now: clock.now, evidence: r.store };
    const readers: unknown = Reflect.get(adapters, 'transcriptReaders');
    const record = await openRecord(Object.assign(options, { readers }));
    const w = { clock, store: r.store, record } as unknown as World;
    const learned = async (target: string, line: string) => {
      const first = await startSession(w, 'shop', [{ id: 'm1', text: `${line} That's how it works here.` }]);
      const change = await learn(w, 'learn.applied', { target, diff: `+ ${line}`, evidence: [{ at: said(first, 'm1'), quote: line }], scope: `session:${first}` }, LOCAL_FIRST);
      expect((await layerRow(w, change)).state, `${target} applies to the session it came from`).toBe('applied');
      return { target, line, handle: await handleOf(w, change) };
    };
    const widen = (c: { target: string; line: string; handle: string }, at: string) =>
      learn(w, 'learn.widened', { target: c.target, diff: `+ ${c.line}`, evidence: [{ at, quote: kept.plan.id }], scope: 'repo:shop', replay: { tasks: 6, regressions: 0 }, supersedes: c.handle }, LOCAL_FIRST);

    const stuck = await learned('slice:seed-first', 'Run npm run seed before the e2e tests.');
    const refused = await layerRow(w, await widen(stuck, r.handle));
    expect(refused.state, `a widening on a report that reads INCONCLUSIVE is not in force (reason: ${String(refused.reason)})`).not.toBe('applied');
    expect(String(refused.reason), 'it is refused naming the outcome').toMatch(/INCONCLUSIVE/);

    const better = JSON.parse(Buffer.from(r.bytes).toString('utf8')) as { plan: never; runs: { side: string; metrics: Record<string, number> }[] };
    better.runs.forEach((run, i) => { if (run.side === 'change') run.metrics.tokens = 60 + (i % 3); });
    expect(compareReplay(better as never).outcome, 'precondition: the cheaper change side adopts').toBe('adopt');
    const put = await r.store.connect({ role: 'deepbuild', via: 'capture' }).put({ bytes: new Uint8Array(Buffer.from(`${JSON.stringify(better, null, 2)}\n`)), kind: 'replay', source: 'deepbuild', redaction: 'complete', license: { name: 'own', allows: [] } });
    expect(put.status, 'the adopting copy is stored').toBe('stored');
    const adopting = `ev:${(put as { evidence: { sha256: string } }).evidence.sha256}`;
    const docs = await learned('slice:docs-build', 'Build the docs with make html.');
    const widened = await layerRow(w, await widen(docs, adopting));
    expect(widened.state, `a widening on a report that adopts is in force (reason: ${String(widened.reason)})`).toBe('applied');
    await record.close();
  }, 300_000);
});

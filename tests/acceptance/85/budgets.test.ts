// Criterion 12 #85.051a8df3: budgets, on the reference Mac in the local preflight, compared with the merge base: a
// task closes within 10 s of its check passing, and five stopped sessions resume within 30 s.
//
// Each measurement (README: Budgets) opens the asks core on a real record with the real clock, ticked once a second
// as the hub ticks it, stops five sessions by one revoked sign-in, waits for their one task, and then appends the
// PASS verdict of the task's check: the two readings are the time from that verdict to the task's ask.moot in the
// record, and to the fifth session's session.continued. A measurement in which no task is raised within 10 s, or the
// task never closes or the sessions never resume within the limit and a margin, has no reading and names why. The
// merge base's side runs the same driver on the base's own build; a base that raises no task has no reading, and
// nothing regresses from it. Readings count only on a reference Mac (Mac15,7 or Mac15,12), Low Power Mode off,
// thermal state nominal, not loaded past its core count; anywhere else the test skips as INCONCLUSIVE with the
// readings, never PASS.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { availableParallelism, loadavg, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, type TestContext } from 'vitest';
import { openRecord as currentOpenRecord } from '../../../packages/record/src/index.ts';
import type { RecordStore } from '../../../packages/record/src/index.ts';
import { openAsks as currentOpenAsks } from '../../../packages/asks/src/index.ts';
import type { Asks } from '../../../packages/asks/src/index.ts';
import { hook, isObj, seqAt, SETTINGS, STOPS, ulid, USAGE, YOU } from './helpers.ts';
import { FIVE } from './scenarios.ts';

const ID = '#85.051a8df3';
const FILE = 'tests/acceptance/85/budgets.test.ts';
const REPO = resolve(import.meta.dirname, '../../..');
const CLOSE_LIMIT_MS = 10_000;
const RESUME_LIMIT_MS = 30_000;
/** The hub ticks the asks core once a second. */
const TICK_MS = 1_000;

type OpenRecord = typeof currentOpenRecord;
type OpenAsks = typeof currentOpenAsks;
interface Checkout { label: string; modules(): Promise<{ openRecord: OpenRecord; openAsks: OpenAsks }> }
const CURRENT: Checkout = { label: 'this checkout', modules: async () => ({ openRecord: currentOpenRecord, openAsks: currentOpenAsks }) };

interface Reading { checkout: string; closeMs: number | null; resumeMs: number | null; failures: string[]; loads: { one: number; cores: number }[] }
const ms = (x: number | null) => (x === null ? 'none' : `${x.toFixed(0)} ms`);
const shownReading = (r: Reading) => `${r.checkout}: task closed ${ms(r.closeMs)}, five resumed ${ms(r.resumeMs)}${r.failures.length ? `; ${r.failures.join('; ').slice(0, 1200)}` : ''}; load ${r.loads.map((l) => l.one.toFixed(1)).join(' to ')} on ${r.loads[0]?.cores} cores`;

const sleep = (t: number) => new Promise((r) => setTimeout(r, t));
const load = (): { one: number; cores: number } => ({ one: loadavg()[0]!, cores: availableParallelism() });

/** One measurement of a checkout: five sessions stopped by one revoked sign-in, their task, its check passing. */
async function measure(co: Checkout): Promise<Reading> {
  const reading: Reading = { checkout: co.label, closeMs: null, resumeMs: null, failures: [], loads: [load()] };
  const { openRecord, openAsks } = await co.modules();
  const dir = mkdtempSync(join(tmpdir(), 'deep-85-budget-'));
  const home = join(dir, 'home');
  mkdirSync(home);
  writeFileSync(join(home, 'config.json'), `${JSON.stringify(SETTINGS, null, 2)}\n`);
  const now = () => Date.now();
  let record: RecordStore | undefined;
  let asks: Asks | undefined;
  let timer: NodeJS.Timeout | undefined;
  try {
    record = await openRecord({ path: join(dir, 'record.db'), now });
    asks = await openAsks({ record, now, deliver: () => undefined, home });
    const core = asks;
    timer = setInterval(() => void core.tick().catch(() => undefined), TICK_MS);
    for (const [i, s] of FIVE.entries()) {
      const at = now();
      await record.append(hook(s), { v: 1, id: ulid(at), kind: 'session.start', ts: at, seq: seqAt(at), data: { agent: 'claude-code', worktree: join(dir, 'no-repo'), branch: 'main', thread: `T${i + 1}` } });
      const stop = STOPS.signIn();
      await record.append(hook(s), { v: 4, id: ulid(at), kind: 'agent.stop', subject: `session:${s}`, ts: at, seq: seqAt(at), data: { turn: 1, did_work: false, claim: false, cause: stop.cause, usage: USAGE, outcome: 'failed', signature: stop.signature!, owner: stop.owner! } });
    }
    const events = async (kind: string) => record!.read({ after: 0, limit: 10_000, kinds: [kind] });
    const openTask = async (): Promise<{ ask: string; proves: string } | undefined> => {
      const open = (await core.inbox()).filter((r) => r.kind === 'unblock' && r.outcome === 'unanswered');
      if (open.length !== 1) return undefined;
      const created = (await events('ask.created')).find((e) => `ask:${e.id}` === open[0]!.ask);
      const proves = created && isObj(created.data) ? created.data.proves : undefined;
      return typeof proves === 'string' ? { ask: open[0]!.ask, proves } : undefined;
    };
    const raisedBy = now() + CLOSE_LIMIT_MS;
    let task = await openTask();
    while (!task && now() < raisedBy) { await sleep(200); task = await openTask(); }
    if (!task) {
      reading.failures.push(`${co.label}: no one task for the five stopped sessions within ${CLOSE_LIMIT_MS / 1000} s of their stops (open unblock tasks: ${(await core.inbox()).filter((r) => r.kind === 'unblock' && r.outcome === 'unanswered').length})`);
      return reading;
    }
    // The check passes: the runner's verdict.
    const t0 = now();
    const vid = ulid(t0);
    const commit = '0c5e145756bbdaef4d9b8bdaca2d0bd0f900ed46';
    await record.append({ writer: 'core', actor: YOU, scope: YOU }, { v: 1, id: vid, kind: 'verdict.made', subject: `claim:${ulid(t0)}`, ts: t0, data: {
      outcome: 'PASS', verdict: `verdict:${vid}`, claim: `claim:${ulid(t0)}`, reasons: [], smallest: null, points_to: null, commit,
      requirements: [{ req: 'req:01K74G0A1B2C3D4E5F6G7H8J9K#R1', outcome: 'PASS', check: task.proves, depth: 'unit', oracle: 'code', runs: { clean: 1, needed: 1, counted: [`run:${ulid(t0)}`] }, smallest: null, points_to: null, evidence: [], proof: 'test_run' }],
      key: { commit, doc_revisions: [], check_digests: [], state_digests: [], environment: 'node-24.22.0/darwin-arm64', tools: [] },
    } });
    const until = t0 + RESUME_LIMIT_MS + 5_000;
    while (now() < until && (reading.closeMs === null || reading.resumeMs === null)) {
      await sleep(100);
      const at = now();
      if (reading.closeMs === null && (await events('ask.moot')).some((e) => e.subject === task!.ask)) reading.closeMs = at - t0;
      if (reading.resumeMs === null) {
        const resumed = new Set((await events('session.continued')).filter((e) => isObj(e.data) && e.data.task === task!.ask).map((e) => String(e.subject)));
        if (FIVE.every((s) => resumed.has(`session:${s}`))) reading.resumeMs = at - t0;
      }
    }
    if (reading.closeMs === null) reading.failures.push(`${co.label}: task ${task.ask} never closed within ${(until - t0) / 1000} s of its check passing`);
    if (reading.resumeMs === null) reading.failures.push(`${co.label}: the five sessions never all resumed within ${(until - t0) / 1000} s of the check passing`);
    reading.loads.push(load());
    return reading;
  } finally {
    if (timer) clearInterval(timer);
    await record?.close().catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
  }
}
async function measured(ctx: TestContext, co: Checkout): Promise<Reading> {
  const r = await measure(co);
  if (r.failures.length) {
    inconclusiveIfLoaded(ctx, [...r.loads, load()], shownReading(r));
    throw Error(r.failures.join('\n'));
  }
  return r;
}

// ---- The reference-Mac gate and the five-run judgement, as #83's budgets read them.
const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
function environmentProblem(loads: { one: number; cores: number }[]): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number, power: string, therm: string;
  try {
    model = sh('sysctl', '-n', 'hw.model');
    chip = sh('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(sh('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    power = sh('pmset', '-g');
    therm = sh('pmset', '-g', 'therm');
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${model} / ${chip} / ${gib} GiB`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!lpm) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  const limited = [...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100);
  if (limited || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  const worst = loads.reduce((a, b) => (b.one / b.cores > a.one / a.cores ? b : a), loads[0] ?? { one: 0, cores: 1 });
  if (worst.one > worst.cores) return `heavy contention: 1-minute load ${worst.one.toFixed(1)} on ${worst.cores} cores`;
  return null;
}
function inconclusiveIfLoaded(ctx: TestContext, loads: { one: number; cores: number }[], what: string): void {
  const problem = environmentProblem(loads);
  if (!problem) return;
  console.log(`INCONCLUSIVE (${problem}): ${what}`);
  ctx.skip(`INCONCLUSIVE (${problem}): ${what}`);
}
interface Judged { verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE'; text: string }
/** The design's rule for a timing result over five runs: PASS, FAIL, or INCONCLUSIVE when the runs straddle the limit by less than their spread. */
function judge(name: string, runs: number[], limit: number): Judged {
  const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9);
  const margin = Math.max(0.05, spread);
  const text = `${name}: ${runs.map((r) => r.toFixed(0)).join(', ')} ms against under ${limit} ms (margin ${Number.isFinite(margin) && margin < 100 ? `${(margin * 100).toFixed(0)}%` : 'spread'})`;
  if (runs.every((r) => r < limit)) return { verdict: 'PASS', text };
  if (runs.every((r) => r > limit * (1 + margin))) return { verdict: 'FAIL', text };
  return { verdict: 'INCONCLUSIVE', text };
}
const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

// ---- The merge base's side (README: Budgets, the merge base), as #83's suite builds it.
const gitAt = (...args: string[]) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim();
const sameAs = (sha: string, paths: string[]) => spawnSync('git', ['diff', '--quiet', sha, '--', ...paths], { cwd: REPO }).status === 0
  && gitAt('ls-files', '--others', '--exclude-standard', '--', ...paths) === '';
/**
 * The merge base with origin/main, built: this checkout when its packages are the base's, else a copy from
 * `git archive` at /tmp/dh85-base-<sha>, kept between runs, with its workspaces built (its node_modules linked to
 * this checkout's when the lockfiles match, else `npm ci`), whose built record and asks packages the driver loads.
 */
async function mergeBase(): Promise<Checkout> {
  let sha: string;
  try { sha = gitAt('merge-base', 'HEAD', 'origin/main'); } catch (e) { throw Error(`BLOCKED: no merge base with origin/main to compare with: ${(e as Error).message.split('\n')[0]}`); }
  const label = `the merge base ${sha.slice(0, 12)}`;
  if (sameAs(sha, ['packages', 'package.json', 'package-lock.json'])) return { ...CURRENT, label: `${label} (this checkout's own code)` };
  const dir = `/tmp/dh85-base-${sha.slice(0, 12)}`;
  const co: Checkout = { label, modules: async () => ({ openRecord: (await import(join(dir, 'packages/record/dist/index.js')) as { openRecord: OpenRecord }).openRecord, openAsks: (await import(join(dir, 'packages/asks/dist/index.js')) as { openAsks: OpenAsks }).openAsks }) };
  if (existsSync(join(dir, '.built'))) return co;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  execFileSync('/bin/sh', ['-c', `git -C '${REPO}' archive ${sha} | tar -x -C '${dir}'`], { stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 });
  const step = (what: string, command: string, args: string[]) => {
    const r = spawnSync(command, args, { cwd: dir, encoding: 'utf8', timeout: 1_800_000, maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) throw Error(`BLOCKED: building ${label} for the comparison: ${what} failed: ${String(r.stderr).slice(-2000)}`);
  };
  if (gitAt('show', `${sha}:package-lock.json`) === readFileSync(join(REPO, 'package-lock.json'), 'utf8').trim()) {
    mkdirSync(join(dir, 'node_modules/@deepbuild'), { recursive: true });
    for (const entry of readdirSync(join(REPO, 'node_modules'))) if (entry !== '@deepbuild') symlinkSync(join(REPO, 'node_modules', entry), join(dir, 'node_modules', entry));
    for (const pkg of readdirSync(join(dir, 'packages'))) {
      const file = join(dir, 'packages', pkg, 'package.json');
      const name = existsSync(file) ? String((JSON.parse(readFileSync(file, 'utf8')) as { name?: string }).name ?? '') : '';
      if (name.startsWith('@deepbuild/')) symlinkSync(join(dir, 'packages', pkg), join(dir, 'node_modules/@deepbuild', name.slice('@deepbuild/'.length)));
    }
  } else {
    step('npm ci', 'npm', ['ci', '--prefer-offline', '--no-audit', '--no-fund']);
  }
  step('npm run build --workspaces', 'npm', ['run', 'build', '--workspaces']);
  writeFileSync(join(dir, '.built'), `${sha}\n`);
  return co;
}

describe(`${ID} Budgets, on the reference Mac in the local preflight, compared with the merge base: a task closes within ${CLOSE_LIMIT_MS / 1000} s of its check passing, and five stopped sessions resume within ${RESUME_LIMIT_MS / 1000} s`, () => {
  it(`${ID} the local preflight runs ${FILE}: a check lane in scripts/lanes.mjs runs it with Vitest, one file at a time, not excluded`, async () => {
    const { checks } = (await import(join(REPO, 'scripts/lanes.mjs'))) as { checks: { name: string; commands: string[][] }[] };
    const covers = (arg: string) => arg === FILE || (arg.endsWith('/') && FILE.startsWith(arg)) || (arg.endsWith('/**') && FILE.startsWith(arg.slice(0, -2)));
    const runs = checks.flatMap((lane) => lane.commands.map((command) => ({ lane: lane.name, command })))
      .filter(({ command }) => command.some((a) => /vitest/.test(a)) && command.includes('--no-file-parallelism')
        && command.some((a, i) => covers(a) && command[i - 1] !== '--exclude'));
    const vitest = checks.flatMap((lane) => lane.commands.filter((c) => c.some((a) => /vitest/.test(a))).map((c) => `${lane.name}: ${c.slice(2).join(' ').slice(0, 300)}`));
    expect(runs.map((r) => r.lane), `some lane must run ${FILE} with --no-file-parallelism (it times the asks core on the real clock); the lanes' Vitest commands are:\n${vitest.join('\n')}`).not.toEqual([]);
  });

  it(`${ID} on the reference Mac, a task closes within ${CLOSE_LIMIT_MS / 1000} s of its check passing and five stopped sessions resume within ${RESUME_LIMIT_MS / 1000} s, over a warm-up and five runs, compared with the merge base`, async (ctx) => {
    const warm = await measured(ctx, CURRENT);
    console.log(`${ID} warm-up: ${shownReading(warm)}`);
    const base = await measure(await mergeBase());
    console.log(`${ID} merge base: ${shownReading(base)}`);
    inconclusiveIfLoaded(ctx, [...warm.loads, ...base.loads], `readings only. ${shownReading(warm)}. ${shownReading(base)}`);
    const runs: Reading[] = [];
    for (let i = 0; i < 5; i++) {
      runs.push(await measured(ctx, CURRENT));
      console.log(`${ID} run ${i + 1}: ${shownReading(runs[i]!)}`);
    }
    const closed = judge(`${ID} task closed after its check passed`, runs.map((r) => r.closeMs!), CLOSE_LIMIT_MS);
    const resumed = judge(`${ID} five stopped sessions resumed after the check passed`, runs.map((r) => r.resumeMs!), RESUME_LIMIT_MS);
    for (const j of [closed, resumed]) console.log(`${j.verdict} ${j.text}`);
    const regressed: string[] = [];
    for (const [name, mine, theirs] of [['task closed', median(runs.map((r) => r.closeMs!)), base.closeMs], ['five resumed', median(runs.map((r) => r.resumeMs!)), base.resumeMs]] as const) {
      if (theirs === null) { console.log(`${ID} ${name}: median ${mine.toFixed(0)} ms; the merge base has no reading (${base.failures.join('; ').slice(0, 600)})`); continue; }
      console.log(`${ID} ${name}: median ${mine.toFixed(0)} ms against the merge base's ${theirs.toFixed(0)} ms`);
      if (mine > theirs * 1.5 && mine - theirs > TICK_MS) regressed.push(`${name} regressed: median ${mine.toFixed(0)} ms against the merge base's ${theirs.toFixed(0)} ms`);
    }
    inconclusiveIfLoaded(ctx, runs.flatMap((r) => r.loads), `readings only. ${closed.text}. ${resumed.text}`);
    expect([...[closed, resumed].filter((j) => j.verdict === 'FAIL').map((j) => `FAIL ${j.text}`), ...regressed.map((r) => `FAIL ${ID} ${r}`)], 'both budgets within their limits and no reading regressed from the merge base').toEqual([]);
    if (closed.verdict === 'INCONCLUSIVE' || resumed.verdict === 'INCONCLUSIVE') ctx.skip(`INCONCLUSIVE ${closed.text}; ${resumed.text}`);
  }, 1_800_000);
});

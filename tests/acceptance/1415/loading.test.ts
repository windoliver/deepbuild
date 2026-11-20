// #1415 AC8 through a running hub and `deep mcp`: deep_kinds asked while the hub is still loading test/forty, the test plug-in
// that takes 2 s to register 40 check kinds, and asked again once it loaded; with the planted server the criterion names (README:
// The test plug-in, Timing on a loaded machine).

import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { packageDigest } from '../../../packages/extension-host/src/index.ts';
import { CLI, NODE, REPO, childEnv, cleanup, makeHome, own, sleep, startHub, t26, type Line } from '../806/helpers.ts';

const TEST_MS = 1_200_000;
const FORTY = fileURLToPath(new URL('./fixtures/forty/', import.meta.url));
/** The planted server that answers the listing as it stands while loading, the kinds registered so far (AC8). */
const PARTIAL = 'kinds-partial-while-loading';
/** test/forty's forty check kinds, in the order it registers them. */
const KINDS = Array.from({ length: 40 }, (_, i) => `ext.forty.k${String(i + 1).padStart(2, '0')}`);
/** The listing: deep_kinds `list` of the hub slot check.kind@1, whose fills are the check kinds plug-ins registered (#200, #412). */
const LISTING: Line = { op: 'list', registry: 'check.kind@1' };
/** When the first listing is asked, after the hub's socket appears ("at 0.5 s"), and when the last ("at 3 s"). */
const FIRST_MS = 500;
const LAST_MS = 3000;
/**
 * test/forty registers its 40 kinds over 2 s from its code's start, which follows the hub's socket; so a listing answered within
 * this long of the socket appearing was answered before test/forty could have finished (README: Timing on a loaded machine).
 */
const SURELY_LOADING_MS = 1500;
const DEADLINE_MS = 120_000;

/** The test plug-in's folder: the fixture copied, `.fixture` names taken off, and its manifest's digest set. */
function forty(dir: string): string {
  cpSync(FORTY, dir, { recursive: true });
  for (const name of readdirSync(dir)) if (name.endsWith('.fixture')) renameSync(join(dir, name), join(dir, name.slice(0, -'.fixture'.length)));
  const path = join(dir, 'deepbuild.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as Line;
  manifest.digest = packageDigest(dir);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}

interface Reading { sent: number; received: number; kind: 'not_ready' | 'full' | 'partial' | 'other'; o: t26.Outcome; listed: number; firstMissing: string | null }
const isObj = (v: unknown): v is Line => typeof v === 'object' && v !== null && !Array.isArray(v);
const brief = (v: unknown, n = 600): string => (JSON.stringify(v) ?? String(v)).slice(0, n);

function classify(o: t26.Outcome, sent: number, received: number): Reading {
  const v = o.value as unknown;
  const base = { sent, received, o, listed: 0, firstMissing: null };
  if (o.protocolError) return { ...base, kind: 'other' };
  if (isObj(v) && v.code === 'not_ready') return { ...base, kind: 'not_ready' };
  if (isObj(v) && Array.isArray(v.registries)) {
    const row = (v.registries as unknown[]).filter(isObj).find((r) => r.name === 'check.kind@1');
    const fills = row && Array.isArray(row.fills) ? (row.fills as unknown[]).filter(isObj).map((f) => String(f.name)) : [];
    const missing = KINDS.filter((k) => !fills.includes(k));
    return { ...base, kind: missing.length ? 'partial' : 'full', listed: KINDS.length - missing.length, firstMissing: missing[0] ?? null };
  }
  return { ...base, kind: 'other' };
}

interface Judged { failures: string[]; inconclusive: string | null; readings: Reading[] }

/**
 * One start of the hub with test/forty installed, timed from the moment its socket appears: deep_kinds asked at 0.5 s, then every
 * 250 ms until a listing holds all 40 kinds, then once more at least 3 s in and after the hub reported ready.
 */
async function timedStart(home: string, project: string, plant?: string): Promise<Judged> {
  const mcp = t26.McpProcess.start(home, project);
  await t26.initialize(mcp);
  const socket = join(t26.rootOf(home), 'hub.sock');
  rmSync(socket, { force: true });
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: childEnv(home, { DEEP_HUB_TEST_CONFIRM: join(home, '..', 'confirm'), DEEP_HUB_PLANT: plant }), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  let readyAt: number | undefined;
  let exited = false;
  child.stdout!.setEncoding('utf8').on('data', (d: string) => { out += d; if (readyAt === undefined && /"ready":true/.test(out)) readyAt = performance.now(); });
  child.stderr!.setEncoding('utf8').on('data', (d: string) => { out = (out + d).slice(-6000); });
  child.on('exit', () => { exited = true; });
  const stop = () => t26.stopHub({ pid: child.pid!, home, socket, child, output: () => out });
  try {
    const spawned = performance.now();
    while (!existsSync(socket)) {
      if (exited) throw Error(`BLOCKED: the hub exited before its socket appeared${plant ? ` (DEEP_HUB_PLANT=${plant})` : ''}: ${out.slice(-2000)}`);
      if (performance.now() - spawned > DEADLINE_MS) throw Error(`BLOCKED: the hub's socket didn't appear within ${DEADLINE_MS} ms: ${out.slice(-2000)}`);
      await sleep(5);
    }
    const t0 = performance.now();
    const readings: Reading[] = [];
    const ask = async (): Promise<Reading> => {
      const sent = performance.now() - t0;
      const o = await t26.callTool(mcp, 'deep_kinds', LISTING, DEADLINE_MS);
      const r = classify(o, sent, performance.now() - t0);
      readings.push(r);
      return r;
    };
    await sleep(Math.max(0, t0 + FIRST_MS - performance.now()));
    let r = await ask();
    while (r.kind === 'not_ready' && performance.now() - t0 < DEADLINE_MS) {
      await sleep(250);
      r = await ask();
    }
    if (r.kind === 'full') {
      while (readyAt === undefined && !exited && performance.now() - t0 < DEADLINE_MS) await sleep(50);
      await sleep(Math.max(0, t0 + LAST_MS - performance.now()));
      await ask();
    }
    return judge(readings);
  } finally {
    await stop();
    mcp.child.kill();
  }
}

function judge(readings: Reading[]): Judged {
  const failures: string[] = [];
  let inconclusive: string | null = null;
  const at = (r: Reading) => `asked at ${Math.round(r.sent)} ms and answered at ${Math.round(r.received)} ms after the hub's socket appeared`;
  for (const r of readings) {
    const v = isObj(r.o.value) ? r.o.value : {};
    if (r.kind === 'partial') failures.push(`${at(r)}, deep_kinds listed ${r.listed} of test/forty's 40 kinds without ${String(r.firstMissing)}, the first missing kind: a listing asked before every plug-in finished loading answers not_ready, never a partial list`);
    if (r.kind === 'other') failures.push(`${at(r)}, deep_kinds answered ${brief(r.o.value)} (isError ${r.o.isError}): a listing asked before every registry, pack and plug-in finished loading answers not_ready with loaded, total and a retry time`);
    if (r.kind === 'not_ready') {
      const ints = Number.isSafeInteger(v.loaded) && Number.isSafeInteger(v.total);
      if (!r.o.isError) failures.push(`${at(r)}, not_ready came back with its error flag unset: every refusal sets it`);
      if (!ints || !((v.loaded as number) >= 0 && (v.loaded as number) < (v.total as number))) failures.push(`${at(r)}, not_ready doesn't count what loaded of the total, loaded < total: ${brief(v)}`);
      if (!Number.isSafeInteger(v.retry_after_ms) || (v.retry_after_ms as number) <= 0) failures.push(`${at(r)}, not_ready gives no retry time (retry_after_ms, ms > 0): ${brief(v)}`);
    }
  }
  const first = readings[0];
  if (first?.kind === 'full') {
    if (first.received <= SURELY_LOADING_MS) failures.push(`${at(first)}, deep_kinds listed all 40 kinds before test/forty could have registered them (2 s from its code's start, which follows the socket)`);
    else inconclusive = `the first listing was ${at(first)}, by when test/forty may have loaded, and it listed all 40: nothing was read while the plug-in loaded, so this run can't tell not_ready from waiting`;
  }
  const whole = readings.findIndex((r) => r.kind === 'full');
  if (whole < 0 && failures.length === 0) failures.push(`no listing held all 40 kinds within ${DEADLINE_MS} ms of the hub's socket appearing; the last answered ${brief(readings.at(-1)?.o.value)}`);
  const last = readings.at(-1);
  if (whole >= 0 && (readings.length < whole + 2 || last?.kind !== 'full' || (last?.sent ?? 0) < LAST_MS)) {
    failures.push(`the listing asked at least ${LAST_MS} ms in, once the hub was ready, doesn't list all 40 kinds: ${last ? `${at(last)}, ${brief(last.o.value)}` : 'none was asked'}`);
  }
  return { failures, inconclusive, readings };
}

const summary = (j: Judged): string => j.readings.map((r) => `${Math.round(r.sent)}→${Math.round(r.received)} ms ${r.kind}${r.kind === 'partial' ? ` (${r.listed}/40)` : ''}`).join('; ');

describe('#1415: a listing asked while the hub loads', () => {
  let home = '';
  let project = '';
  let error = '';
  beforeAll(async () => {
    const made = makeHome();
    home = made.home;
    project = join(made.tmp, 'proj');
    mkdirSync(project);
    try {
      const plugin = forty(join(made.tmp, 'forty'));
      const hub = await startHub(home);
      const ran = await t26.run(NODE, [CLI, 'install', plugin], { env: childEnv(home), cwd: project, timeoutMs: 600_000 });
      await t26.stopHub(hub);
      if (ran.code !== 0) error = `BLOCKED: deep install of test/forty (README: The test plug-in) exited ${ran.code}: ${ran.stdout.slice(-1500)} ${ran.stderr.slice(-1500)}`;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }, TEST_MS);
  afterAll(cleanup, 60_000);

  // AC8: "With a test plug-in that takes 2 s to register 40 kinds, a listing asked for at 0.5 s answers `not_ready` with `loaded`,
  // `total` and a retry time, and at 3 s lists all 40. A planted server that returns the partial list fails, naming the first
  // missing kind"
  it('AC8 with test/forty taking 2 s to register 40 kinds, deep_kinds asked at 0.5 s answers not_ready with loaded, total and retry_after_ms, and at 3 s lists all 40', async () => {
    expect(error, 'test/forty is installed').toBe('');
    const judged = await timedStart(home, project);
    expect(judged.failures, `the readings: ${summary(judged)}`).toEqual([]);
    if (judged.inconclusive) throw Error(`INCONCLUSIVE: ${judged.inconclusive} (readings: ${summary(judged)}); this is not a pass`);
  }, TEST_MS);

  it(`AC8 (wrong program ${PARTIAL}) a server that returns the partial list while loading fails, naming the first missing kind`, async () => {
    expect(error, 'test/forty is installed').toBe('');
    const judged = await timedStart(home, project, PARTIAL);
    const named = judged.failures.some((f) => /without ext\.forty\.k\d\d, the first missing kind/.test(f));
    if (!named && judged.inconclusive) throw Error(`INCONCLUSIVE: ${judged.inconclusive} (readings: ${summary(judged)}); the planted server wasn't read while loading`);
    expect(named, `the planted server's run fails naming the first missing kind: ${JSON.stringify(judged.failures).slice(0, 2000)}`).toBe(true);
  }, TEST_MS);
});

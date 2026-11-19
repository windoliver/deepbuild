// AC5: "Budgets, on the reference Mac in the local preflight, compared with the merge base: a tool.before whose
// handlers all reply in time gains under 0.1 ms (drafted)."
//
// Two extension hosts in this one process, on one world (record, asks core, supervisor, project trust): the change's,
// through its public entry, and the merge base's, the same entry read from `git archive <merge base>
// packages/extension-host` into a folder under the checkout's ignored target/ (so both resolve the same workspace
// packages). Each loads four packages whose tool.before handler replies at once with nothing to add, once in the hub
// (listed in the release) and once in the sandbox. Requests go to the two hosts in turn, the order alternating; a run
// is 200 requests a side after a warm-up, and its reading is the change's median request time minus the merge base's,
// floored at 0. Five runs per place are judged against 0.1 ms by the design's timing rule (scripts/benchmark.mjs's
// judgeLimit): PASS when all five are within it, FAIL when all five are over it by more than the margin, and
// INCONCLUSIVE otherwise, off a reference Mac, or when the load at a run's start or end is above the core count. An
// INCONCLUSIVE result is a skip that says so, never a pass (README, AC5).
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, expect, test } from 'vitest';
import { openAsks } from '../../../packages/asks/src/index.ts';
import { fixtures } from '../../../packages/contracts/src/index.ts';
import * as change from '../../../packages/extension-host/src/index.ts';
import type { ExtensionHost, HookRequest, ReleaseEntry } from '../../../packages/extension-host/src/index.ts';
import { openRecord, type RecordStore } from '../../../packages/record/src/index.ts';
import { openSupervisor, type Supervisor } from '../../../packages/supervisor/src/index.ts';
import { DEADLINE_MS, GAIN_MS, Inconclusive, verdict, writePackage } from './helpers.ts';

const AC5 = 'AC5 #2402.bd6cb8d9';
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const HANDLERS = 4;
const REQUESTS = 200;
const RUNS = 5;

/** A handler that replies at once, adding nothing. */
const IN_TIME = `export default function (deep: any): void {
  deep.on('tool.before', () => null);
}
`;
const data = (fixtures('tool.before@2')[0] as { data?: unknown } | undefined)?.data;
const request = (): HookRequest => ({ kind: 'tool.before', data, deadline: DEADLINE_MS, bound: 4000 });

type Entry = typeof change;
interface Judged { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'BLOCKED'; reason?: string; runs: number[] }
interface Bench { references: unknown; fingerprint(): unknown; judgeLimit(o: { limit: number; runs: number[]; fingerprint: unknown; loads: { start: number; end: number }[] }): Judged }

const cleanups: (() => Promise<void> | void)[] = [];
afterAll(async () => {
  for (const done of cleanups.reverse()) await done();
}, 180_000);

/** The merge base's extension host entry, read from git into target/ (ignored), or BLOCKED naming why it can't be. */
async function baseEntry(): Promise<{ entry: Entry; commit: string }> {
  let commit: string;
  try {
    commit = execFileSync('/usr/bin/git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
  } catch (error) {
    throw Error(`BLOCKED: ${AC5} there is no merge base with origin/main to compare with: ${error instanceof Error ? error.message : String(error)}`);
  }
  mkdirSync(join(REPO, 'target'), { recursive: true });
  const dir = mkdtempSync(join(REPO, 'target', 'dh2402-base-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  // The package and the root tsconfig.json its own extends, which the TypeScript transform reads.
  const tar = execFileSync('/usr/bin/git', ['archive', '--format=tar', commit, 'packages/extension-host', 'tsconfig.json'], { cwd: REPO, maxBuffer: 256 * 1024 * 1024 });
  execFileSync('/usr/bin/tar', ['-xf', '-', '-C', dir], { input: tar });
  const entry = (await import(pathToFileURL(join(dir, 'packages/extension-host/src/index.ts')).href)) as Entry;
  return { entry, commit };
}

interface World { dir: string; record: RecordStore; sup: Supervisor; trust: Awaited<ReturnType<Entry['openTrust']>> }
async function openWorld(): Promise<World> {
  const dir = mkdtempSync('/tmp/dh2402-bench-');
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } } });
  const trust = await change.openTrust({ record, now: Date.now });
  cleanups.push(async () => { await sup.close(); await record.close(); });
  return { dir, record, sup, trust };
}

/** A ready host of `entry` with HANDLERS in-time packages of its own, loaded in `place`. */
async function hostWith(entry: Entry, w: World, place: 'hub' | 'sandbox', side: string): Promise<ExtensionHost> {
  const dir = join(w.dir, `${side}-${place}`);
  mkdirSync(join(dir, 'home'), { recursive: true });
  const packages = Array.from({ length: HANDLERS }, (_, i) => writePackage(dir, `bench/in-time-${i + 1}`, IN_TIME));
  const release: ReleaseEntry[] = place === 'hub' ? packages.map((p) => p.entry) : [];
  const host = await entry.openExtensionHost({ record: w.record, supervisor: w.sup, trust: w.trust, home: join(dir, 'home'), release, now: Date.now });
  cleanups.push(() => host.close().catch(() => undefined));
  await host.ready();
  for (const p of packages) {
    const installed = await host.install({ from: p.folder, builtBy: null, grant: { record: ['tool.before'] } });
    const checked = await host.check(installed);
    if (!checked.passed) throw Error(`BLOCKED: ${AC5} ${p.id} must pass its conformance on the ${side}'s host: ${checked.reasons.join('; ')}`);
    const load = await host.load(installed);
    if (load.status !== 'loaded' || load.place !== place) throw Error(`BLOCKED: ${AC5} ${p.id} must load in the ${place} on the ${side}'s host: ${JSON.stringify(load)}`);
  }
  return host;
}

const median = (xs: readonly number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
/** One request's time, failing BLOCKED if any handler didn't reply in time, since then the request isn't the one AC5 times. */
async function timed(host: ExtensionHost, side: string): Promise<number> {
  const t0 = performance.now();
  const reply = await host.hook(request());
  const ms = performance.now() - t0;
  if (reply.failed.length) throw new Inconclusive(`${AC5} a handler on the ${side}'s host missed its deadline under this load (${JSON.stringify(reply.failed)}), so the request isn't one whose handlers all replied in time`);
  return ms;
}

/** Five runs in one place: each the change's median request minus the merge base's, the order alternating. */
async function measure(now: ExtensionHost, then: ExtensionHost): Promise<{ runs: number[]; loads: { start: number; end: number }[]; medians: string[] }> {
  for (let i = 0; i < 50; i++) { await timed(now, 'change'); await timed(then, 'merge base'); }
  const runs: number[] = [];
  const loads: { start: number; end: number }[] = [];
  const medians: string[] = [];
  for (let run = 0; run < RUNS; run++) {
    const start = loadavg()[0]!;
    const a: number[] = [];
    const b: number[] = [];
    for (let i = 0; i < REQUESTS; i++) {
      if (i % 2) { b.push(await timed(then, 'merge base')); a.push(await timed(now, 'change')); }
      else { a.push(await timed(now, 'change')); b.push(await timed(then, 'merge base')); }
    }
    loads.push({ start, end: loadavg()[0]! });
    runs.push(Math.max(0, median(a) - median(b)));
    medians.push(`run ${run + 1}: change ${median(a).toFixed(4)} ms, merge base ${median(b).toFixed(4)} ms`);
  }
  return { runs, loads, medians };
}

test(`${AC5} a tool.before whose handlers all reply in time gains under ${GAIN_MS} ms over the merge base, on the reference Mac, in the hub and in the sandbox`, async (ctx) => verdict(ctx, async () => {
  if (data === undefined) throw Error(`BLOCKED: ${AC5} the contracts hold no tool.before@2 fixture to send`);
  const bench = (await import(pathToFileURL(join(REPO, 'scripts/benchmark.mjs')).href)) as Bench;
  const { entry: base, commit } = await baseEntry();
  const w = await openWorld();
  const results: string[] = [];
  const failed: string[] = [];
  const unclear: string[] = [];
  for (const place of ['hub', 'sandbox'] as const) {
    const now = await hostWith(change, w, place, 'change');
    const then = await hostWith(base, w, place, 'merge base');
    const { runs, loads, medians } = await measure(now, then);
    const judged = bench.judgeLimit({ limit: GAIN_MS, runs, fingerprint: bench.fingerprint(), loads });
    const line = `${place}: ${judged.status} gains ${runs.map((r) => r.toFixed(4)).join(', ')} ms against ${GAIN_MS} ms (merge base ${commit.slice(0, 9)}; ${medians.join('; ')}; load ${loads.map((l) => `${l.start.toFixed(0)}-${l.end.toFixed(0)}`).join(', ')})${judged.reason ? `: ${judged.reason}` : ''}`;
    results.push(line);
    if (judged.status === 'FAIL') failed.push(line);
    else if (judged.status !== 'PASS') unclear.push(line);
    // The place's hosts stop before the next place is timed, so their processes don't load the next one.
    await now.close().catch(() => undefined);
    await then.close().catch(() => undefined);
  }
  console.log(`${AC5}\n${results.join('\n')}`);
  expect(failed, `${AC5} a tool.before whose handlers all reply in time gains under ${GAIN_MS} ms over the merge base`).toEqual([]);
  if (unclear.length) throw new Inconclusive(`${AC5} ${unclear.join('\n')}`);
}), 1_800_000);

// Test-side tools for the #881 acceptance tests: temp folders, a world (the record with its evidence store, the asks
// core, the supervisor that is #236's local host@1, and project trust), hosts, the test package copied from
// fixtures/, tool.before requests, the record grown by a million events, and the design's timing rule. Nothing here
// stands in for the extension host or project trust: the tests reach both only through `@deepbuild/extension-host`'s
// public entry (README, The surface under test).
//
// Safety: every folder is under /tmp/dh881-* (real paths); HOME is a temp folder for this process and every child;
// the agent's own CLAUDE_*, DEEP_* and AI_AGENT variables are removed first; no test touches the real ~/.deepbuild; no
// process is ever stopped by name or port (each host a test opens is closed, which stops what it started).
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect } from 'vitest';
import { openAsks } from '../../../packages/asks/src/index.ts';
import { fixtures as contractFixtures } from '../../../packages/contracts/src/index.ts';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import { openExtensionHost, openTrust, packageDigest, type ExtensionHost, type HookReply, type HookRequest, type Installed, type InstallFrom, type ProjectTrust } from '../../../packages/extension-host/src/index.ts';
import { openRecord, ulid, type Connection, type Event, type RecordStore } from '../../../packages/record/src/index.ts';
import { openSupervisor, type Supervisor } from '../../../packages/supervisor/src/index.ts';

export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const DAY = 86_400_000;

for (const key of Object.keys(process.env)) if (key.startsWith('CLAUDE') || key.startsWith('DEEP_') || key === 'AI_AGENT') delete process.env[key];
const HOME = realpathSync(mkdtempSync('/tmp/dh881-home-'));
process.env.HOME = HOME;

// ---- Temp folders, all removed after the file.
const made: string[] = [];
export function tempDir(tag: string): string {
  const dir = realpathSync(mkdtempSync(`/tmp/dh881-${tag}-`));
  made.push(dir);
  return dir;
}

/** Your answer on the trusted path: the app's card (#348). */
export const YOU: Connection = { writer: 'app', actor: 'you', scope: 'you' };

// ---- The world: a record with its evidence store, the asks core, the supervisor on them (#236) and project trust.
export interface World {
  dir: string;
  record: RecordStore;
  sup: Supervisor;
  /** The one project-trust reader the hub opens on its record and hands the host (packages/hub's core, at the base). */
  trust: ProjectTrust;
  events(kind: string): Promise<Event[]>;
}
const worlds: { sup: Supervisor; record: RecordStore }[] = [];
const hosts: ExtensionHost[] = [];
export async function openWorld(): Promise<World> {
  const dir = tempDir('world');
  const evidence = await openEvidenceStore({ root: join(dir, 'evidence') });
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now, evidence });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 2 * DAY } } } });
  const trust = await openTrust({ record, now: Date.now });
  worlds.push({ sup, record });
  const events = async (kind: string): Promise<Event[]> => {
    const all: Event[] = [];
    for (let after = 0; ;) {
      const page = await record.read({ after, limit: 1000, kinds: [kind] });
      all.push(...page);
      if (page.length < 1000) break;
      after = page[page.length - 1]!.log_pos;
    }
    return all;
  };
  return { dir, record, sup, trust, events };
}

/** A ready host on a world, with its own ~/.deepbuild, reading trust through the world's one reader. */
export async function openHost(w: World): Promise<ExtensionHost> {
  const home = join(w.dir, `deepbuild-${hosts.length}`);
  mkdirSync(home, { recursive: true });
  const h = await openExtensionHost({ record: w.record, supervisor: w.sup, trust: w.trust, home, release: [], now: Date.now });
  hosts.push(h);
  await h.ready();
  return h;
}

afterAll(async () => {
  for (const h of hosts.splice(0)) await h.close().catch(() => undefined);
  for (const w of worlds.splice(0)) {
    await w.sup.close().catch(() => undefined);
    await w.record.close().catch(() => undefined);
  }
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  rmSync(HOME, { recursive: true, force: true });
});

// ---- The test package.
/**
 * fixtures/denier in a temp folder, each `*.fixture` file renamed without that suffix (so neither this suite's Vitest
 * nor its type check picks the package's code up), with `id` and probe.json written, and the manifest's digest set to
 * the host's own `packageDigest`.
 */
export function denier(id: string, probe: { note?: boolean } = {}): string {
  const dir = tempDir(`pkg-${id.replace('/', '-')}`);
  cpSync(join(FIXTURES, 'denier'), dir, { recursive: true });
  for (const name of readdirSync(dir)) if (name.endsWith('.fixture')) renameSync(join(dir, name), join(dir, name.slice(0, -'.fixture'.length)));
  writeFileSync(join(dir, 'probe.json'), JSON.stringify(probe));
  const path = join(dir, 'deepbuild.json');
  const manifest: Record<string, unknown> = { ...(JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>), id };
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  manifest.digest = packageDigest(dir);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}

/** What a tool.before handler is given to read. */
const HOOK_GRANT: NonNullable<InstallFrom['grant']> = { record: ['tool.before'] };
/** Installs (by no agent), checks and loads a package, a project's when `project` names its folder; the load must succeed. */
export async function installAndLoad(h: ExtensionHost, from: string, project?: string): Promise<Installed> {
  const p = await h.install({ from, builtBy: null, grant: HOOK_GRANT, ...(project === undefined ? {} : { project }) });
  const checked = await h.check(p);
  expect(checked.passed, `${p.id}'s conformance: ${checked.reasons.join('; ')}`).toBe(true);
  const load = await h.load(p);
  expect(load.status, `${p.id} didn't load: ${JSON.stringify(load)}`).toBe('loaded');
  return p;
}

/** The task.created notes the package appends with `note` on: one per call its handler took. */
export async function asked(w: World, id: string): Promise<number> {
  return (await w.events('task.created')).filter((e) => (e.data as { title?: string }).title?.startsWith(`${id} asked `)).length;
}

// ---- Hook requests: tool.before@2's contract fixture, the issue's 500 ms deadline.
export const DEADLINE_MS = 500;
const TOOL_BEFORE = (contractFixtures('tool.before@2')[0] as { data: unknown } | undefined)?.data;
export function toolBefore(): HookRequest {
  if (TOOL_BEFORE === undefined) throw Error('no contract fixture for tool.before@2');
  return { kind: 'tool.before', data: TOOL_BEFORE, deadline: DEADLINE_MS, bound: 4000 };
}
/** One tool call's hook request to a host, timed from the request to the joined reply, in ms. */
export async function hookCall(h: ExtensionHost): Promise<{ reply: HookReply; ms: number }> {
  const start = performance.now();
  const reply = await h.hook(toolBefore());
  return { reply, ms: performance.now() - start };
}
export const deniedBy = (reply: HookReply, id: string): boolean => reply.denies.some((d) => d.extension === id);

// ---- A big record.
/**
 * `count` events appended through the record's own `append`, as one agent session's shell calls: tool.before and
 * tool.after in turn, each with a command of about 1 KB. Appends are issued 5,000 at a time, which the record commits
 * in batches (its stream path), then synced.
 */
export async function appendToolCalls(record: RecordStore, count: number): Promise<void> {
  let now = Date.now() - DAY;
  const session = ulid(now);
  const conn: Connection = { writer: 'hook', actor: 'you', scope: 'you', session, agent: 'claude-code' };
  await record.append(conn, { v: 1, id: ulid(now), kind: 'session.start', ts: now, data: { agent: 'claude-code', worktree: '~/src/shop', branch: 'main', thread: session } });
  const words = 'npm test -- src/cart/checkout.test.ts --reporter verbose --coverage ';
  const command = words.repeat(Math.ceil(1024 / words.length)).slice(0, 1000);
  let n = 1;
  while (n < count) {
    const batch: Promise<unknown>[] = [];
    for (let i = 0; i < 5000 && n < count; i++, n++) {
      now += 1;
      batch.push(record.append(conn, {
        v: 1, id: ulid(now), kind: n % 2 ? 'tool.before' : 'tool.after', ts: now,
        seq: (BigInt(now) * 1_000_000n + BigInt(n % 1_000_000)).toString(), data: { kind: 'shell', paths: [], command: `${command} #${n}` },
      }));
    }
    await Promise.all(batch);
  }
  await record.sync();
}
/** How many events the record holds after a log position. */
export async function countAfter(record: RecordStore, logPos: number): Promise<number> {
  const [row] = (await record.raw('SELECT COUNT(*) AS n FROM events WHERE log_pos > ?', [logPos])) as { n: number }[];
  return row!.n;
}

// ---- Timing: the design's rule on five runs after warm-up, judged on a reference Mac.
export function p95(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]!;
}
const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
/** Why this machine's timings are a reading only, or null on a reference Mac. Power, heat and load are printed, never gated (#857, #379). */
export function referenceMacProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  try {
    const model = sh('sysctl', '-n', 'hw.model');
    const chip = sh('sysctl', '-n', 'machdep.cpu.brand_string');
    const gib = Math.round(Number(sh('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    return REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib) ? null : `not a reference Mac: ${model} / ${chip} / ${gib} GiB`;
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
}
export function machineReading(): string {
  const read = (cmd: string, ...args: string[]): string => { try { return sh(cmd, ...args).replace(/\s+/g, ' '); } catch { return 'unknown'; } };
  return `power: ${read('pmset', '-g', 'batt').split(';')[0]}; ${/lowpowermode\s+\d/.exec(read('pmset', '-g'))?.[0] ?? 'lowpowermode unknown'}; load: ${read('sysctl', '-n', 'vm.loadavg')}`;
}
/**
 * The design's timing rule on five readings (scripts/benchmark.mjs's judgeLimit): PASS when every reading is within
 * the limit, FAIL when every reading is over it by more than the margin (the larger of 5% and the readings' spread as
 * a fraction of the limit), otherwise INCONCLUSIVE. Off a reference Mac a result is a reading, so INCONCLUSIVE.
 * Returns null on PASS, else the verdict line, which starts with FAIL or INCONCLUSIVE; the test fails with it either
 * way, as nothing unrun or undecided passes.
 */
export function judgeTiming(name: string, runs: readonly number[], limit: number): string | null {
  expect(runs.length, `${name}: five runs`).toBe(5);
  const margin = Math.max(0.05, (Math.max(...runs) - Math.min(...runs)) / limit);
  const shown = `${name}: ${runs.map((r) => r.toFixed(4)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%); ${machineReading()}`;
  console.log(shown);
  const off = referenceMacProblem();
  if (off) return `INCONCLUSIVE (a reading: ${off}) ${shown}`;
  if (runs.every((r) => r <= limit)) return null;
  if (runs.every((r) => r > limit * (1 + margin))) return `FAIL ${shown}`;
  return `INCONCLUSIVE ${shown}`;
}


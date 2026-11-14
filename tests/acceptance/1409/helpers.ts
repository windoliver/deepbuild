// Test-side tools for #1409's acceptance tests: temp folders, the planted program (fixtures/planted.c) built once per
// test process, a world (a real record, the asks core and the supervisor opened on them through its public entry,
// as #236's tests open it), a run of the planted program through host@1, and the limit stops the record holds.
// Nothing here stands in for the supervisor, the record or the command check kind (README, The surface under test).
//
// Safety: every folder is under /tmp/dh1409-*; HOME is a temp folder for this process and every child; the agent's
// own CLAUDE_* and DEEP_* variables are removed first. Each run a world started is stopped by the supervisor's own
// cleanup, which stops only what it can prove is the run's; the planted program also ends itself after two minutes.
// Nothing is ever stopped by name or port.

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll } from 'vitest';
import { openAsks } from '../../../packages/asks/src/index.ts';
import { openRecord, type Event, type RecordStore } from '../../../packages/record/src/index.ts';
import { openSupervisor, type Exit, type StartSpec, type Supervisor } from '../../../packages/supervisor/src/index.ts';

export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const MIB = 1024 * 1024;
/** The event kind a stop at a limit records (README, The surface under test). */
export const STOP = 'run.stopped_at_limit';
/** StartSpec.limits as the issue's Fields give it: both members, in MiB. */
export interface Limits { memory_mb: number; file_mb: number }

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** Resolves with the promise's value, or with `running` if it hasn't settled within ms. */
export const within = <T>(promise: Promise<T>, ms: number): Promise<T | 'running'> => Promise.race([promise, sleep(ms).then(() => 'running' as const)]);

for (const key of Object.keys(process.env)) if (key.startsWith('CLAUDE') || key.startsWith('DEEP_')) delete process.env[key];
const made: string[] = [];
/** A folder of its own under /tmp/dh1409-*, by its real path (Seatbelt matches real paths); removed after the file. */
export function tempDir(tag: string): string {
  const dir = realpathSync(mkdtempSync(`/tmp/dh1409-${tag}-`));
  made.push(dir);
  return dir;
}
process.env.HOME = tempDir('home');
afterAll(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// ---- IDs.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function base32(value: bigint, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) { s = CROCKFORD[Number(value & 31n)] + s; value >>= 5n; }
  return s;
}
export const runId = (): string => `run:${base32(BigInt(Date.now()), 10)}${base32(BigInt(`0x${randomBytes(10).toString('hex')}`), 16)}`;

// ---- The planted program, built once per test process.
let built: string | undefined;
export function planted(): string {
  if (built) return built;
  const out = join(tempDir('bin'), 'planted');
  try {
    execFileSync('cc', ['-O1', '-o', out, join(FIXTURES, 'planted.c')], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (error) {
    throw Error(`BLOCKED: cc couldn't build fixtures/planted.c: ${String((error as { stderr?: Buffer }).stderr ?? error)}`);
  }
  return (built = out);
}

/** What the planted program wrote to its folder: a stamp's ms, the last heartbeat (MiB held, ms), its RLIMIT_FSIZE. */
export function stamp(dir: string, name: 'passed'): number | undefined {
  const path = join(dir, name);
  return existsSync(path) ? Number(readFileSync(path, 'utf8').trim()) : undefined;
}
export function beat(dir: string): { mib: number; ms: number } | undefined {
  const path = join(dir, 'beat');
  if (!existsSync(path)) return undefined;
  const [mib, ms] = readFileSync(path, 'utf8').trim().split(' ').map(Number);
  return { mib: mib!, ms: ms! };
}
export function fsize(dir: string): string | undefined {
  const path = join(dir, 'fsize');
  return existsSync(path) ? readFileSync(path, 'utf8').trim() : undefined;
}

// ---- The world: a record, the asks core and the supervisor on them (#236), the local host@1.
export interface World {
  record: RecordStore;
  sup: Supervisor;
  /** The runs a test started on it: each is cleaned up when the world closes. */
  runs: string[];
  /** Every limit stop the record holds for the run, waiting up to `ms` for the first. */
  stops(run: string, ms?: number): Promise<Event[]>;
  close(): Promise<void>;
}
export async function openWorld(): Promise<World> {
  const dir = tempDir('world');
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 2 * 86_400_000 } } } });
  const runs: string[] = [];
  const stops = async (run: string, ms = 0): Promise<Event[]> => {
    const deadline = Date.now() + ms;
    for (;;) {
      const found = (await record.read({ after: 0, limit: 100_000, kinds: [STOP] })).filter((e) => (e.data as { run?: unknown }).run === run);
      if (found.length || Date.now() >= deadline) return found;
      await sleep(50);
    }
  };
  return {
    record, sup, runs, stops,
    close: async () => {
      for (const run of runs) await sup.cleanup(run).catch(() => undefined);
      await sup.close();
      await record.close();
    },
  };
}

export interface Ran { run: string; exit: Exit | 'running'; stdout: string; stderr: string }
/**
 * The planted program as a run through host@1: `planted parent <args>` in `dir`, which it may write, with `limits`
 * on its StartSpec when given; resolves once the run ends, or with `running` after `ms`.
 */
export async function runPlanted(w: World, o: { dir: string; args: string[]; limits?: Limits; ms?: number }): Promise<Ran> {
  const bin = planted();
  const run = runId();
  w.runs.push(run);
  const out = { stdout: [] as Buffer[], stderr: [] as Buffer[] };
  const spec: StartSpec = {
    run, argv: [bin, 'parent', ...o.args], cwd: o.dir, grant: { read: [dirname(bin)], write: [o.dir] },
    output: { stdout: (c) => out.stdout.push(c), stderr: (c) => out.stderr.push(c) },
    ...(o.limits ? { limits: o.limits } : {}),
  };
  const started = await w.sup.start(spec);
  if (started.status !== 'started') throw Error(`BLOCKED: the planted run didn't start: ${JSON.stringify(started)}`);
  const exit = await within(w.sup.wait(run), o.ms ?? 60_000);
  return { run, exit, stdout: Buffer.concat(out.stdout).toString('utf8'), stderr: Buffer.concat(out.stderr).toString('utf8') };
}

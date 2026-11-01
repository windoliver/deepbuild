// Shared test-side tools for #907's acceptance tests (README): the criterion tags, a check-slot world (the real record
// and the real lease table opened at 4 cores, so the cpu.slot pool is 2), the hub's real gate runner driven over it,
// and the background-command scenario for the scheduler. Nothing here stands in for the gate runner, the lease table,
// the scheduler, the adapter or the hub: every reading comes from them. The #29 suite's helpers (temp folders, git
// repositories, the scheduler's scenario builders, the planted-program judge) and the #18 mapping suite's helpers (the
// hub as a process, deep-hook, made-up Claude Code sessions) are imported, never copied.
//
// Safety: every folder is under /tmp/dh29-* or /tmp/dh18m-* (theirs) or /tmp/dh907-*; no network, no model, no real
// `claude`; a process a test starts is stopped by its PID only, never by name or port.

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll } from 'vitest';
import { openRecord, ulid, type Connection, type RecordStore } from '../../../packages/record/src/index.ts';
import { openLeases, type LeaseTable, type LeasesOptions } from '../../../packages/leases/src/index.ts';
import { slot, type ScriptEvent } from '../../../packages/gate/src/index.ts';
import { GateRunner } from '../../../packages/hub/src/gate-runner.ts';
import { NODE, sleep } from '../29/helpers.ts';

// ---- Criterion tags: `#907.<first 8 hex of the SHA-256 of the criterion's text>`, as scripts/proof-change.mjs computes them.
export const AC1 = 'AC1 #907.64d1cf68';
export const AC2 = 'AC2 #907.707637ee';
export const AC3 = 'AC3 #907.9d0dd243';

export const MINUTE = 60_000;
export const J = 'journey:checkout';
/** The background command every criterion names, as the session starts it and as the row names it. */
export const E2E = 'npm run e2e';

// ---- Temp folders of this suite's own.
const made: string[] = [];
export function tempDir907(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh907-'));
  made.push(dir);
  return dir;
}
// ---- Processes this suite started: stopped by PID only.
const owned = new Set<ChildProcess>();
afterAll(async () => {
  for (const child of owned) if (child.exitCode === null && child.signalCode === null) try { child.kill('SIGKILL'); } catch { /* gone */ }
  owned.clear();
  await sleep(50);
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// ---- The check-slot world: the real record and the real lease table.
export const CORE: Connection = { writer: 'core', actor: 'you', scope: 'you' };
export interface SlotWorld { dir: string; record: RecordStore; table: LeaseTable; close(): Promise<void> }
/**
 * The real record and lease table at 4 cores: the core's `cpu.slot` pool of 2, "check slots at 2". `plant` is handed to
 * `openLeases` as given: `fills-every-slot` is the wrong program AC1 names (README, Plants).
 */
export async function slotWorld(plant?: string): Promise<SlotWorld> {
  const dir = tempDir907();
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const table = await openLeases({ record, now: Date.now, cores: 4, ...(plant ? { plant: plant as NonNullable<LeasesOptions['plant']> } : {}) });
  return { dir, record, table, close: () => record.close() };
}
/**
 * A check's clean runs in the record, as the core appends them (`run.started`, then `run.finished` passed `ms` later), so
 * the gate runner's expected time for it, the median of its last clean runs, is `ms`.
 */
export async function cleanRuns(record: RecordStore, check: string, ms: number, n = 3): Promise<void> {
  const base = Date.now() - 86_400_000;
  for (let i = 0; i < n; i++) {
    const t = base + i * (ms + 60_000) + Math.floor(Math.random() * 1000);
    const run = `run:${ulid(t)}`;
    await record.append(CORE, { v: 1, id: ulid(t), kind: 'run.started', ts: t, subject: run, data: { run, check, claim: 'claim:01K74G1Z3X5V7T9R1P3N5M7K9H', commit: 'a'.repeat(40) } });
    await record.append(CORE, {
      v: 1, id: ulid(t + ms), kind: 'run.finished', ts: t + ms, subject: run,
      data: { run, outcome: 'passed', tests_run: 1, passed: 1, runs: 1, evidence: [], check, assertion: null, expected: null, actual: null, step: null, points_to: null, findings: [], environment: 'test' },
    });
  }
}

/** `@deepbuild/gate`'s `slot` with the lane this issue adds (README, Surfaces): 'fast' may take the slot kept for a held stop's fast-lane checks. */
type SlotWithLane = (table: LeaseTable, holder: string, run: string, lane: 'fast' | 'slow') => ReturnType<typeof slot>;
export const slotFor = slot as unknown as SlotWithLane;

/**
 * A check's process: it writes `S <check> <lane> <ms since the epoch>` to the log as it starts, then ends after `ms`, or,
 * with `ms` 0, once the go file exists; `E …` as it ends.
 */
const CHILD = "const fs=require('fs');const [log,id,lane,go,ms]=process.argv.slice(1);fs.appendFileSync(log,'S '+id+' '+lane+' '+Date.now()+'\\n');const end=()=>{fs.appendFileSync(log,'E '+id+' '+lane+' '+Date.now()+'\\n');process.exit(0)};if(Number(ms)>0)setTimeout(end,Number(ms));else{const t=setInterval(()=>{if(fs.existsSync(go)){clearInterval(t);end()}},20)}";
/** The agent's e2e, a heavy command: marks that it started, then runs until the go file exists. */
export const HEAVY = "const fs=require('fs');const [marker,go]=process.argv.slice(1);fs.writeFileSync(marker,String(Date.now()));const t=setInterval(()=>{if(fs.existsSync(go)){clearInterval(t);process.exit(0)}},20)";

export interface Started { check: string; lane: string; at: number }
export interface Gate {
  gate: GateRunner;
  /** The lease holder each claim's runs take their slot as: the claim's session. */
  holders: Map<string, string>;
  go: string;
  log: string;
  /** Each check run's start, from its own process's stamp. */
  started(): Started[];
  /** Runs asked of `start` that haven't ended and given back their slot: waiting for a slot, or running. */
  busy(): number;
}
/**
 * The hub's real gate runner on the world. Its `start` and `ended` are the host's side, done here as the core's
 * `launch` does them: the run's `cpu.slot` lease is taken first, as the claim's session and with the run's lane, then
 * its process starts; the lease is released when the process ends. `slots` is the core's own reading at the base
 * (core.ts: half the cores less the check runs going, which hold a slot), with this world's 2 for half its 4 cores.
 */
export function gateOn(w: SlotWorld, ms: Record<string, number>): Gate {
  const dir = tempDir907();
  const log = join(dir, 'log.txt');
  const go = join(dir, 'go');
  writeFileSync(log, '');
  const holders = new Map<string, string>();
  const going = new Set<string>();
  const ends = new Map<string, Promise<string>>();
  let n = 0;
  let busy = 0;
  const options = {
    raw: (query: string, params?: readonly (string | number | bigint | null)[]) => w.record.raw(query, params),
    now: Date.now,
    append: async (connection: Connection, input: Parameters<RecordStore['append']>[1]) => { await w.record.append(connection, input); },
    core: CORE,
    start: async (r: { claim: string; check: string; lane: 'fast' | 'slow' }) => {
      const run = `run:${ulid(Date.now())}${(++n).toString(36).toUpperCase()}`;
      const holder = holders.get(r.claim);
      if (!holder) throw Error(`no session for ${r.claim}`);
      busy++;
      const lease = await slotFor(w.table, holder, run, r.lane).catch((error: unknown) => { busy--; throw error; });
      going.add(run);
      const child = spawn(NODE, ['-e', CHILD, log, r.check, r.lane, go, String(ms[r.check] ?? 0)], { stdio: 'ignore' });
      owned.add(child);
      ends.set(run, new Promise<string>((done) => {
        child.on('exit', (code) => {
          void w.table.release(lease.id, []).catch(() => undefined).finally(() => {
            going.delete(run);
            busy--;
            done(code === 0 ? 'passed' : 'failed');
          });
        });
      }));
      return run;
    },
    ended: (run: string) => ends.get(run) ?? Promise.resolve('missing'),
    slots: () => ({ free: Math.max(0, 2 - going.size) }),
    budget_ms: 10_000,
    hold_ms: 60_000,
  };
  const gate = new GateRunner(options as unknown as ConstructorParameters<typeof GateRunner>[0]);
  const started = (): Started[] => (existsSync(log) ? readFileSync(log, 'utf8') : '').split('\n').filter((l) => l.startsWith('S ')).map((l) => {
    const [, check, lane, at] = l.split(' ');
    return { check: check!, lane: lane!, at: Number(at) };
  });
  return { gate, holders, go, log, started, busy: () => busy };
}
/** Polls until `ok` holds or `ms` passes; returns whether it held. */
export async function until(ok: () => boolean | Promise<boolean>, ms: number, every = 20): Promise<boolean> {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await ok()) return true;
    if (Date.now() > deadline) return false;
    await sleep(every);
  }
}

// ---- The background command in the scheduler's terms (README, Surfaces: LoopFacts.background).
/** What the session's loop facts say once a call starts work in the background: the commands still running, as the row names them. */
export const running = (at: number, commands: string[]): ScriptEvent => ({ at, kind: 'facts', facts: { background: commands } } as unknown as ScriptEvent);

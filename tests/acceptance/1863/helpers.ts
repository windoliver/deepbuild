// Shared by the #1863 acceptance tests (README): the criteria's IDs, every name the suite chose for a surface the issue
// leaves open (one place each, so another choice is a one-line change), the world (#322's world and hub, #965's
// Claude Code session with its own `deep mcp`, so a claim is made through `deep_claim` as Claude Code calls it), the
// two fixtures (a timing check over a fixed-length wait; a SQLite sample and a query file), and the readers of what
// the hub judged. Nothing stands in for DeepBuild: the hub, deep-hook and `deep mcp` are the real ones.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cleanup as cleanup322, expectTask, lastPos, lockedFor, makeWorld, must, req, settle, taskVerdicts, type Draft, type Ev, type Hub, type World } from '../322/helpers.ts';
import { cleanup as cleanup965, Session, type Clock } from '../965/helpers.ts';
import { EXPIRED } from '../323/helpers.ts';
import { CLEAN, FIX, addToBase, claimAfter, commandsGreen, judged, outcomeOf, sayVerdicts } from '../1537/helpers.ts';

export { addToBase, CLEAN, FIX, lastPos, must, outcomeOf, sayVerdicts };
export { startHub, stopHub, trustRepo } from '../322/helpers.ts';
export type { Ev, Hub, World };

export const cleanup = async (): Promise<void> => { await cleanup965(); await cleanup322(); };

// ---- The criteria: `#1863.<first 8 hex of SHA-256 of the criterion's text, trimmed, white space collapsed>`.
export const AC1 = 'AC1 #1863.2d3f3f89';
export const AC2 = 'AC2 #1863.da28004d';

// ---- Names this suite chose where the issue leaves a choice (README, Readings).
/** Where a timing check is declared: a JSON file in the repo; a claim's words cite it by this path, in plain words. */
export const TIMING_FILE = '.deepbuild/timing/speed.json';
/** The field of a handed definition that names its read-only sample: a SQLite file in the repo. */
export const SAMPLE_FIELD = 'sample';
/** The query file the claim changes: the hub runs its merge-base version ("without") and its claim version ("with") on the sample. */
export const QUERY_FILE = 'queries/paid-orders.sql';
export const SAMPLE_FILE = 'data/orders-sample.db';

// ---- The code change every claim makes (#322's world): FIX makes the spec's unit check pass, CLEAN R1's drafted check.
export const ASK = 'make the auth middleware reject expired tokens';

// ---- AC1's fixture: the timing check.
/** A side's work is a wait of DELAY seconds, read from bench.env in that side's checkout: base 6 s, change 5 s, so 1.2×. */
export const BASE_DELAY = 6;
export const CHANGE_DELAY = 5;
export const STATED = '1.8×';
export const REPEATS = 5;
const TOOLCHAIN = { compiler: 'sh-1', driver: 'none-1', runtime: 'sleep-1' };
const MACHINE = 'fixture-machine-1';
const BENCH = `#!/bin/sh
# One side of the timing check, run in that side's checkout: warmup (compile and load: nothing here), flush (exit 0:
# the caches were flushed), work (one timed repeat: a wait of DELAY seconds) and report (what this side ran with).
cd "$(dirname "$0")" || exit 2
. ./bench.env
case "$1" in
  warmup) : ;;
  flush) exit 0 ;;
  work) sleep "$DELAY" ;;
  report) printf '%s\\n' '${JSON.stringify({ toolchain: TOOLCHAIN, machine: MACHINE })}' ;;
  *) exit 2 ;;
esac
`;
/** The timing check the claim cites: no baseline named (the merge base by default), the toolchain by version on each side, the machine by its fingerprint, five repeats a side, no warm caches declared; each side's four commands run in its checkout. */
const TIMING = {
  repeats: REPEATS, machine: MACHINE, toolchain: { baseline: TOOLCHAIN, change: TOOLCHAIN },
  warmup: 'sh bench.sh warmup', flush: 'sh bench.sh flush', work: 'sh bench.sh work', report: 'sh bench.sh report',
};
export const speedFiles = (): Record<string, string> => ({ 'bench.sh': BENCH, 'bench.env': `DELAY=${BASE_DELAY}\n`, [TIMING_FILE]: `${JSON.stringify(TIMING, null, 2)}\n` });
export const SPEED_EDIT = { file: 'bench.env', from: `DELAY=${BASE_DELAY}`, to: `DELAY=${CHANGE_DELAY}` } as const;
/** The claim's words: the stated speed, citing its timing check in plain words (a backticked span would be read as a file the session must have read). */
export const SPEED_WORDS = `Expired tokens are rejected now, and the work is ${STATED} faster than the merge base (timing check ${TIMING_FILE}).`;

// ---- AC2's fixture: a query file and a SQLite sample of orders, every one paid.
const BASE_QUERY = 'SELECT id, total FROM orders WHERE total > 0 ORDER BY id\n';
export const FILTER = "status <> 'void'";
export const FILTER_EDIT = { file: QUERY_FILE, from: 'WHERE total > 0 ORDER', to: `WHERE total > 0 AND ${FILTER} ORDER` } as const;
export const FILTER_WORDS = 'Expired tokens are rejected now, and the paid-orders query skips voided orders.';
export const SAMPLE_ROWS = 40;
export const queryFiles = (): Record<string, string> => ({ [QUERY_FILE]: BASE_QUERY });
/** The sample: 40 orders, none void. Returns the rows the query gives with the filter and without it. */
export function writeSample(repo: string): { with: number; without: number } {
  mkdirSync(dirname(join(repo, SAMPLE_FILE)), { recursive: true });
  const db = new DatabaseSync(join(repo, SAMPLE_FILE));
  db.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY, total INTEGER NOT NULL, status TEXT NOT NULL)');
  const insert = db.prepare('INSERT INTO orders (total, status) VALUES (?, ?)');
  for (let i = 1; i <= SAMPLE_ROWS; i++) insert.run(i * 5, 'paid');
  const count = (where: string): number => (db.prepare(`SELECT count(*) AS n FROM orders WHERE total > 0${where}`).get() as { n: number }).n;
  const rows = { with: count(` AND ${FILTER}`), without: count('') };
  db.close();
  return rows;
}

// ---- The world: #322's, with the definition handed for ASK (R1 judged by #323's drafted check; the files the claim
// touches are its deliverables; `sample` names AC2's read-only sample).
export function claimWorld(o: { files: Record<string, string>; deliverables: string[]; sample?: string }): World {
  const draft: Draft & Record<string, unknown> = {
    ask: ASK, requirements: [req('R1', 'An expired token is rejected with 401', { check: EXPIRED.check, asserts: EXPIRED.asserts })],
    deliverables: ['src/auth.js', ...o.deliverables], budget: null, ...(o.sample ? { [SAMPLE_FIELD]: o.sample } : {}),
  };
  return makeWorld({ drafts: [draft], files: { ...EXPIRED.files, ...o.files } });
}

// ---- One Claude Code session through the real deep-hook, with its own `deep mcp` (#965's Session).
const noClock = { now: () => Date.now(), pass: async () => undefined } as unknown as Clock;
const newSession = (w: World): Session => new Session(w, noClock);
async function openTask(hub: Hub, s: Session, who: string): Promise<string> {
  await s.start();
  await s.typed(ASK);
  const as = s as unknown as Parameters<typeof expectTask>[1];
  const ok = (all: Ev[]): boolean => { try { return lockedFor(all, expectTask(all, as, ASK, who)).length > 0; } catch { return false; } };
  const events = await settle(hub, ok, 120_000);
  must(ok(events), `BLOCKED: ${who} the handed definition must lock: none was recorded`);
  return expectTask(events, as, ASK, who);
}
async function read(s: Session, file: string): Promise<void> {
  const path = join(s.cwd, file);
  const content = readFileSync(path, 'utf8');
  await s.call('Read', { file_path: path }, { response: { type: 'text', file: { filePath: path, content, numLines: content.split('\n').length, startLine: 1, totalLines: content.split('\n').length } } });
}
async function edit(s: Session, e: { file: string; from: string; to: string }): Promise<void> {
  const path = join(s.cwd, e.file);
  await s.call('Edit', { file_path: path, old_string: e.from, new_string: e.to, replace_all: false }, {
    response: { filePath: path, oldString: e.from, newString: e.to, replaceAll: false, structuredPatch: [], userModified: false },
    effect: () => writeFileSync(path, readFileSync(path, 'utf8').replace(e.from, e.to)),
  });
}

/**
 * The claim every test makes: the session reads the middleware, makes the fix (the spec's unit check and R1's drafted
 * check pass), makes `change`, claims through `deep_claim`, and stops with `words`. Returns the task's verdicts after
 * the edits and the claim they belong to, once the commands are held green (BLOCKED otherwise).
 */
export async function claimed(hub: Hub, w: World, who: string, change: { file: string; from: string; to: string }, words: string, timeoutMs: number): Promise<{ claim: string; verdicts: Ev[] }> {
  const s = newSession(w);
  const ref = await openTask(hub, s, who);
  await read(s, 'src/auth.js');
  const since = await lastPos(hub);
  await edit(s, FIX);
  await edit(s, CLEAN);
  await edit(s, change);
  await s.deepClaim(ref);
  await s.stop(words);
  const events = await judged(hub, ref, since, { timeoutMs });
  const claim = claimAfter(events, ref, since);
  must(claim !== undefined, `BLOCKED: ${who} the session's deep_claim must make a claim for ${ref}: none was recorded`);
  commandsGreen(events, ref, since, who, claim, w.base);
  return { claim, verdicts: taskVerdicts(events, ref, since) };
}

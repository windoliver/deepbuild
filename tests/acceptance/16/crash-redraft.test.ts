// AC3 (issue #16), blind redraft: "Cut at each durable write point the storage interface numbers in a scripted
// 200-event scenario, every restart keeps every FULL commit, no ID twice, no `log_pos` reused and every spooled
// event once, with projections equal to their rebuild. A check run in flight records `stopped`, cause hub
// restarted, and its claim's checks run again."
//
// One scenario: a reference pass numbers the durable write points (DEEP_HUB_TEST_VFS `points`); then, for each
// point N, a fresh home runs the same script under `cutAfter: N`, the hub ends right after point N as by
// kill -9, a hub starts again on the same root, and every clause is checked on what it serves and on its ledger.
// AC3-REDRAFT.md maps each assertion to its sentence and the wrong program it catches.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { openRecord, PROJECTIONS } from '../../../packages/record/src/index.ts';
import type { Table } from '../../../packages/record/src/index.ts';
import {
  Agent, COMMIT, FIXTURES, NODE, SECOND, alive, claimArgs, cleanup, control, fromHere, hookRequest, installedRoot, makeHome,
  newSession, ownFromFile, png, result, sendHook, settle, sleep, spawnHub, startHub, stopHub, tempDir,
} from './helpers.ts';
import type { Ev, HookRequest, HubProc, Ready, Session } from './helpers.ts';

/** The check the in-flight run belongs to (its run.started's `data.check`). */
const CHECK = 'acceptance16.ac3.sleeper';
/** The point kinds the README names, and the ones this script must reach (rules.json has no writer in the script). */
const POINT_KINDS = ['commit', 'log_pos_block', 'spool_read', 'spool_removal', 'evidence_rename', 'rules_rewrite'];
const SCRIPT_REACHES = ['commit:full', 'commit:normal', 'log_pos_block', 'spool_read', 'spool_removal', 'evidence_rename'];
/** How long the hub may stay busy after the script's last step before its point count is taken as final. */
const QUIET_MS = 1500;
const TRIES = 3;

// ---- Steps on the record's own outputs, probed against a real record at the base (AC3-REDRAFT.md, Probes).
// checks begin
interface Point { n: number; kind: string; mode?: string; ids?: string[] }
/** What the test saw before the cut: the consumer's reads and the script's requests. */
interface BeforeCut {
  observed: Map<number, string>;   // log_pos -> id, every event events.read served before the hub ended
  spooled: HookRequest[];          // requests written to the spool before the hub ended (deep-hook's spool)
  sent: HookRequest[];             // hook requests the hub acknowledged on the socket
}
/** A handle's ID: `run:01K…` and `01K…` read the same. */
const bare = (v: unknown): string | undefined => (typeof v === 'string' ? v.replace(/^[a-z_]+:/, '') : undefined);
/** A stored value as text, bigints and bytes included, for row-by-row comparison. */
function canon(value: unknown): string {
  if (typeof value === 'bigint') return `${value}n`;
  if (value === undefined) return 'undefined';
  if (value instanceof Uint8Array) return `bytes:${Buffer.from(value).toString('hex')}`;
  return JSON.stringify(value);
}
/** The first difference between two snapshots of the projections, naming table, row and column; undefined when equal. */
function firstDifference(live: Map<string, Table>, rebuilt: Map<string, Table>): string | undefined {
  for (const [name, a] of live) {
    const b = rebuilt.get(name);
    if (!b) return `${name}: missing after the rebuild`;
    const key = (t: Table, row: Table['rows'][number]) => t.primaryKey.map((k) => canon(row[k])).join('|');
    for (let i = 0; i < Math.max(a.rows.length, b.rows.length); i++) {
      const x = a.rows[i];
      const y = b.rows[i];
      if (!x || !y) return `${name}: row ${x ? key(a, x) : key(b, y!)} ${x ? 'missing after the rebuild' : 'only after the rebuild'}`;
      const column = [...new Set([...Object.keys(x), ...Object.keys(y)])].find((c) => canon(x[c]) !== canon(y[c]));
      if (column !== undefined) return `${name}: row ${key(a, x)} column ${column}: live ${canon(x[column])}, rebuilt ${canon(y[column])}`;
    }
  }
  return undefined;
}
/** Opens a copy of the ledger with @deepbuild/record, reads every projection, rebuilds, and compares. */
async function projectionsAgainstRebuild(root: string, into: string): Promise<string | undefined> {
  mkdirSync(into, { recursive: true });
  // The database and its WAL are the durable image; SQLite rebuilds the shared-memory index itself.
  for (const name of ['ledger.db', 'ledger.db-wal']) if (existsSync(join(root, name))) copyFileSync(join(root, name), join(into, name));
  if (!existsSync(join(into, 'ledger.db'))) return `no ledger.db under ${root}`;
  const record = await openRecord({ path: join(into, 'ledger.db'), now: Date.now });
  try {
    const live = new Map<string, Table>();
    for (const name of PROJECTIONS) live.set(name, await record.table(name));
    await record.rebuild();
    const rebuilt = new Map<string, Table>();
    for (const name of PROJECTIONS) rebuilt.set(name, await record.table(name));
    return firstDifference(live, rebuilt);
  } finally {
    await record.close();
  }
}
/** The commit points' event IDs: what the process that wrote them committed, durable or not. */
const committedIds = (points: readonly Point[]): Set<string> => new Set(points.flatMap((p) => (p.kind === 'commit' ? p.ids ?? [] : [])));
/** The criterion's clauses on the log a restarted hub serves, after a cut right after the last of `points`. */
function restartProblems(points: readonly Point[], before: BeforeCut, events: readonly Ev[]): { problems: string[]; inFlight: number; lostNormal: number } {
  const problems: string[] = [];
  const byId = new Map<string, Ev[]>();
  for (const e of events) byId.set(e.id, [...(byId.get(e.id) ?? []), e]);

  // Every FULL commit kept.
  for (const p of points) {
    if (p.kind !== 'commit' || p.mode !== 'full') continue;
    for (const id of p.ids ?? []) if (!byId.has(id)) problems.push(`point ${p.n}, a FULL commit, wrote ${id}; it is missing after the restart`);
  }

  // No ID twice.
  for (const [id, list] of byId) if (list.length > 1) problems.push(`${id} appears ${list.length} times, at log_pos ${list.map((e) => e.log_pos).join(', ')}`);

  // No log_pos reused: positions only grow; a position read before the cut holds the same event or nothing;
  // no event lands in a gap below the last position read before the cut; an event keeps its position.
  let last = 0;
  for (const e of events) {
    if (!(e.log_pos > last)) problems.push(`log_pos ${e.log_pos} (${e.id}) comes after ${last}`);
    last = e.log_pos;
  }
  const lastRead = Math.max(0, ...before.observed.keys());
  for (const e of events) {
    const was = before.observed.get(e.log_pos);
    if (was !== undefined && was !== e.id) problems.push(`log_pos ${e.log_pos} held ${was} before the cut and holds ${e.id} after the restart`);
    else if (was === undefined && e.log_pos <= lastRead) problems.push(`log_pos ${e.log_pos} (${e.id}) fills a gap below ${lastRead}, the last position read before the cut`);
  }
  for (const [pos, id] of before.observed) {
    const now = byId.get(id)?.[0];
    if (now && now.log_pos !== pos) problems.push(`${id} was at log_pos ${pos} before the cut and is at ${now.log_pos} after`);
  }

  // Every spooled event once: its own ID once, and no second event of its kind carrying its seq under another ID.
  for (const r of before.spooled) {
    const own = byId.get(r.id) ?? [];
    if (own.length !== 1) { problems.push(`spooled request ${r.id} (${r.event}, seq ${r.seq}) is in the log ${own.length} times`); continue; }
    const twins = events.filter((e) => e.seq === r.seq && e.kind === own[0]!.kind && e.id !== r.id);
    if (twins.length) problems.push(`spooled request ${r.id} was appended again as ${twins.map((e) => e.id).join(', ')}`);
  }

  // The test VFS's own proof: a cut right after a NORMAL commit loses it (spooled events come back from the spool).
  let lostNormal = 0;
  const at = points[points.length - 1];
  if (at?.kind === 'commit' && at.mode === 'normal') {
    const spooled = new Set(before.spooled.map((r) => r.id));
    const ids = (at.ids ?? []).filter((id) => !spooled.has(id));
    const kept = ids.filter((id) => byId.has(id));
    if (kept.length) problems.push(`the cut right after point ${at.n}, a NORMAL commit, kept ${kept.join(', ')}: the test VFS lost nothing`);
    else lostNormal = ids.length;
  }

  // A check run in flight at the cut: one run.finished, outcome stopped, finding hub restarted; its claim's check again.
  const preCut = committedIds(points);
  const started = events.filter((e) => e.kind === 'run.started' && e.data.check === CHECK);
  const finished = events.filter((e) => e.kind === 'run.finished');
  let inFlight = 0;
  for (const s of started.filter((e) => preCut.has(e.id))) {
    const run = bare(s.data.run);
    const ends = finished.filter((e) => bare(e.data.run) === run);
    if (ends.some((e) => preCut.has(e.id))) continue; // it finished before the cut: not in flight
    inFlight++;
    if (ends.length !== 1) problems.push(`run ${run}, in flight at the cut, has ${ends.length} run.finished events after the restart`);
    for (const e of ends) {
      if (e.data.outcome !== 'stopped') problems.push(`run ${run}, in flight at the cut, finished ${JSON.stringify(e.data.outcome)}, not stopped`);
      const findings = Array.isArray(e.data.findings) ? (e.data.findings as unknown[]) : [];
      if (!findings.some((f) => typeof f === 'string' && /hub restarted/i.test(f))) problems.push(`run ${run}'s run.finished names no cause hub restarted: findings ${JSON.stringify(e.data.findings)}`);
    }
    const again = started.filter((e) => !preCut.has(e.id) && bare(e.data.run) !== run && bare(e.data.claim) === bare(s.data.claim));
    if (!again.length) problems.push(`run ${run}'s claim ${String(s.data.claim)}: check ${CHECK} was not started again after the restart`);
  }
  return { problems, inFlight, lostNormal };
}
// checks end

// ---- The script: 200 events, in steps; each step's events readable before the next (README, Readings).
const readPoints = (file: string): Point[] =>
  existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as Point) : [];

/** The hub ended (the cut, or a crash the caller tells apart by the points file). */
class Ended extends Error {}

interface Pass extends BeforeCut {
  home: string;
  root: string;
  dir: string;
  pidFile: string;
  read: Ev[];
  seen: Set<string>;
  cursor: number;
  verdicts: number;
  claim?: string;
  run?: string;
}

function newPass(): Pass {
  const home = makeHome();
  const dir = tempDir();
  return { home, root: installedRoot(home), dir, pidFile: join(dir, 'sleepers'), observed: new Map(), spooled: [], sent: [], read: [], seen: new Set(), cursor: 0, verdicts: 0 };
}

/** Hook requests across sessions, each session opening with SessionStart, then PreToolUse and PostToolUse. */
function requests(sessions: Session[], opened: Set<string>, count: number): HookRequest[] {
  const out: HookRequest[] = [];
  for (let i = 0; i < count; i++) {
    const s = sessions[i % sessions.length]!;
    const event = opened.has(s.id) ? (i % 2 ? 'PostToolUse' : 'PreToolUse') : 'SessionStart';
    opened.add(s.id);
    out.push(fromHere(hookRequest(s, event)));
  }
  return out;
}
/** deep-hook's spool: one hook.request@1 line per call, as sent, in a file of its own under <root>/spool/. */
function spool(p: Pass, name: string, reqs: HookRequest[]): void {
  mkdirSync(join(p.root, 'spool'), { recursive: true });
  writeFileSync(join(p.root, 'spool', `${name}.jsonl`), reqs.map((r) => `${JSON.stringify(r)}\n`).join(''));
  p.spooled.push(...reqs);
}

/** The script's event count by source: 30 spooled, 3 + 159 hooks, 1 claim, 1 run.started, 6 verdicts. */
const SCRIPT = { spoolA: 20, establish: 3, claim: 1, hooks1: 40, verdicts1: 3, run: 1, hooks2: 60, spoolB: 10, verdicts2: 3, hooks3: 59 };

/** Spool A goes in before the hub's first start, so its replay is part of every pass. */
function prepare(p: Pass): { spoolSessions: Session[]; opened: Set<string> } {
  const spoolSessions = [newSession(p.home, 'claude-code'), newSession(p.home, 'claude-code'), newSession(p.home, 'codex')];
  const opened = new Set<string>();
  const a = requests(spoolSessions.slice(0, 2), opened, SCRIPT.spoolA);
  spool(p, 'a1', a.slice(0, 10));
  spool(p, 'a2', a.slice(10));
  return { spoolSessions, opened };
}

/** Runs the script against a started hub; throws Ended once the hub has ended, any other failure as itself. */
async function script(p: Pass, proc: HubProc, ready: Ready, spoolSessions: Session[], opened: Set<string>): Promise<void> {
  let ended = false;
  void proc.exit.then(() => { ended = true; });
  const step = async <T,>(work: () => Promise<T>): Promise<T> => {
    if (ended) throw new Ended();
    const outcome = await work().then((value) => ({ value }), (error: unknown) => ({ error }));
    if ('value' in outcome) return outcome.value;
    await Promise.race([proc.exit, sleep(2 * SECOND)]);
    if (ended) throw new Ended();
    throw outcome.error;
  };
  const cli = await step(() => control({ socket: ready.socket, root: p.root }));
  try {
    // The consumer: pages events.read after the last log_pos it holds, keeping what each position held.
    const pull = async () => {
      for (;;) {
        const events = result(await cli.call('events.read', { after: p.cursor, limit: 1000 })).events as Ev[];
        if (!events.length) return;
        for (const e of events) { p.observed.set(e.log_pos, e.id); p.read.push(e); p.seen.add(e.id); }
        p.cursor = events[events.length - 1]!.log_pos;
      }
    };
    const readable = (what: string, done: () => boolean) => step(async () => {
      const deadline = Date.now() + 20 * SECOND;
      for (;;) {
        await pull();
        if (done()) return;
        if (Date.now() > deadline) throw Error(`the hub didn't make ${what} readable through events.read within 20 s`);
        await sleep(20);
      }
    });
    const all = (ids: string[]) => () => ids.every((id) => p.seen.has(id));
    const hooks = async (reqs: HookRequest[], size = 10) => {
      for (let i = 0; i < reqs.length; i += size) {
        const group = reqs.slice(i, i + size);
        await step(async () => {
          const replies = await Promise.all(group.map((r) => sendHook(ready.socket, r)));
          group.forEach((r, j) => { if (replies[j]!.ack) p.sent.push(r); });
          const j = replies.findIndex((r) => !r.ack);
          if (j >= 0) throw Error(`the hub didn't acknowledge hook ${group[j]!.id}: ${JSON.stringify(replies[j])}`);
        });
        await readable(`hooks ${group[0]!.id}…`, all(group.map((r) => r.id)));
      }
    };
    const verdicts = async (n: number) => {
      await step(async () => result(await cli.call('test.load', { verdicts: n, checkpoint: false }, 60 * SECOND)));
      p.verdicts += n;
      await readable(`${n} verdicts`, () => p.read.filter((e) => e.kind === 'verdict.made').length >= p.verdicts);
    };

    // 1. The spool written while the hub was down is replayed at its start.
    await readable('the spooled requests', all(p.spooled.map((r) => r.id)));
    // 2. An agent's session, its deep mcp, and a claim through deep_claim.
    const session = newSession(p.home, 'claude-code');
    const agentHere = Agent.start(p.home, session.cwd);
    try {
      for (const event of ['SessionStart', 'UserPromptSubmit', 'PreToolUse']) {
        const r = hookRequest(session, event);
        await step(async () => {
          const h = await agentHere.hook(ready.socket, r);
          if (!h.ack) throw Error(`the hub didn't acknowledge the agent's ${event}: ${JSON.stringify(h)}`);
          p.sent.push(r);
        });
      }
      await readable("the agent's session", all(p.sent.slice(-3).map((r) => r.id)));
      await step(async () => {
        const role = await agentHere.mcpOpen(ready.socket);
        if (typeof role.role !== 'string' || !role.role.startsWith('mcp:')) throw Error(`deep mcp wasn't bound to the agent's session: ${JSON.stringify(role)}`);
      });
      const claimed = await step(async () => result(await agentHere.mcp('mcp.call', { tool: 'deep_claim', arguments: claimArgs() })));
      p.claim = String(claimed.event);
      await readable('the claim', all([p.claim]));

      const sessions = [newSession(p.home, 'claude-code'), newSession(p.home, 'claude-code'), newSession(p.home, 'codex')];
      // 3. Hooks.
      await hooks(requests(sessions, opened, SCRIPT.hooks1));
      // 4. Verdicts, each its own synchronous=FULL commit.
      await verdicts(SCRIPT.verdicts1);
      // 5. The claim's check, a run that stays in flight.
      const run = await step(async () => result(await cli.call('run.start', { check: CHECK, claim: `claim:${p.claim}`, commit: COMMIT, argv: [NODE, join(FIXTURES, 'sleeper.mjs'), p.pidFile] })));
      p.run = String(run.run);
      await readable('run.started', () => p.read.some((e) => e.kind === 'run.started' && bare(e.data.run) === bare(p.run)));
      // 6. A pasted image: the evidence store's rename.
      await step(async () => {
        const app = await control({ socket: ready.socket, root: p.root }, 'app');
        try {
          result(await app.call('evidence.paste', { bytes: Buffer.from(png(16, 16, p.cursor)).toString('base64'), type: 'image/png' }));
        } finally {
          app.close();
        }
      });
      // 7. Hooks.
      await hooks(requests(sessions, opened, SCRIPT.hooks2));
      // 8. deep-hook spools more calls (a reply it couldn't wait for): replayed at the next start.
      if (ended) throw new Ended();
      spool(p, 'b1', requests(spoolSessions.slice(2), opened, SCRIPT.spoolB));
      // 9. Verdicts.
      await verdicts(SCRIPT.verdicts2);
      // 10. Hooks.
      await hooks(requests(sessions, opened, SCRIPT.hooks3));
    } finally {
      await agentHere.stop();
    }
  } finally {
    cli.close();
  }
}

/** Points until none is added for QUIET_MS (at most 10 s). */
async function quietCount(file: string): Promise<number> {
  let n = readPoints(file).length;
  let since = Date.now();
  const deadline = Date.now() + 10 * SECOND;
  while (Date.now() < deadline && Date.now() - since < QUIET_MS) {
    await sleep(100);
    const m = readPoints(file).length;
    if (m !== n) { n = m; since = Date.now(); }
  }
  return n;
}

/** Stops the sleepers this pass's runs started (by the PIDs they wrote), then everything else it started. */
async function endPass(p: Pass): Promise<void> {
  for (const pid of ownFromFile(p.pidFile)) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  await cleanup();
}

/** Polls events.read on the restarted hub until `ready` holds or 20 s pass; returns the last log read. */
async function settleLog(hub: { socket: string; root: string }, ready: (events: Ev[]) => boolean): Promise<Ev[]> {
  const cli = await control(hub);
  try {
    const deadline = Date.now() + 20 * SECOND;
    for (;;) {
      const events: Ev[] = [];
      let after = 0;
      for (;;) {
        const page = result(await cli.call('events.read', { after, limit: 1000 }, 30 * SECOND)).events as Ev[];
        if (!page.length) break;
        events.push(...page);
        after = page[page.length - 1]!.log_pos;
      }
      if (ready(events) || Date.now() > deadline) return events;
      await sleep(100);
    }
  } finally {
    cli.close();
  }
}

describe('AC3 #16.dcb0bc5f cut at every durable write point of a 200-event scenario, then restart (redraft)', () => {
  afterAll(cleanup);

  it('AC3 the reference pass numbers the points; a cut after each, and a restart, keeps FULL commits, IDs and log_pos once, spooled events once, projections equal to their rebuild, and stops and reruns the in-flight check', async () => {
    expect(Object.values(SCRIPT).reduce((a, b) => a + b, 0), 'the script holds 200 events').toBe(200);

    // ---- The reference pass: the script under the test VFS with no cut, numbering every durable write point.
    const ref = newPass();
    const refPoints = join(ref.dir, 'points.jsonl');
    const { spoolSessions, opened } = prepare(ref);
    const refHub = await startHub({ home: ref.home, vfs: { points: refPoints } });
    try {
      await script(ref, refHub.proc, refHub, spoolSessions, opened);
    } catch (error) {
      if (error instanceof Ended) throw Error(`the reference pass's hub ended with no cut asked for; stderr: ${refHub.proc.stderr().slice(0, 2000)}`);
      throw error;
    }
    const total = await quietCount(refPoints);
    const points = readPoints(refPoints).slice(0, total);
    await stopHub(refHub, 'SIGKILL');
    await endPass(ref);

    // Its own checks: numbered from 1 in order, named kinds, commits with a mode and their IDs, every kind the
    // script reaches, and every event it read accounted for by a commit point.
    expect(points.map((pt) => pt.n), 'the points are numbered 1, 2, 3 … in the order they were made').toEqual(points.map((_, i) => i + 1));
    for (const pt of points) {
      expect(POINT_KINDS, `point ${pt.n}'s kind`).toContain(pt.kind);
      if (pt.kind === 'commit') {
        expect(['full', 'normal'], `point ${pt.n}'s mode`).toContain(pt.mode);
        expect(Array.isArray(pt.ids), `point ${pt.n} lists the IDs its commit wrote`).toBe(true);
      }
    }
    const kinds = new Set(points.map((pt) => (pt.kind === 'commit' ? `commit:${pt.mode}` : pt.kind)));
    expect(SCRIPT_REACHES.filter((k) => !kinds.has(k)), 'the script reaches every kind of durable write point it can').toEqual([]);
    const refCommitted = committedIds(points);
    expect(ref.read.filter((e) => !refCommitted.has(e.id)).map((e) => e.id), 'every event read in the reference pass was written by a numbered commit').toEqual([]);
    expect(ref.read.filter((e) => e.kind === 'verdict.made').length, 'the six verdicts were appended').toBeGreaterThanOrEqual(6);
    expect(ref.sent.length + ref.spooled.length, 'the script sent 162 hooks and spooled 30').toBe(SCRIPT.establish + SCRIPT.hooks1 + SCRIPT.hooks2 + SCRIPT.hooks3 + SCRIPT.spoolA + SCRIPT.spoolB);

    // ---- A cut right after each point, and a restart.
    let inFlightPasses = 0;
    let normalProofs = 0;
    for (let n = 1; n <= points.length; n++) {
      let done = false;
      for (let attempt = 1; attempt <= TRIES && !done; attempt++) {
        const p = newPass();
        const file = join(p.dir, 'points.jsonl');
        const prep = prepare(p);
        try {
          const proc = spawnHub({ home: p.home, vfs: { points: file, cutAfter: n } });
          const start = await settle(proc, 20 * SECOND);
          if (start.ready) {
            try {
              await script(p, proc, start.ready, prep.spoolSessions, prep.opened);
            } catch (error) {
              if (!(error instanceof Ended)) throw Error(`cut after point ${n}: the script failed before the cut: ${(error as Error).message}`);
            }
          } else if (start.hung) {
            throw Error(`cut after point ${n}: the hub neither got ready nor ended within 20 s; stderr: ${proc.stderr().slice(0, 1500)}`);
          }
          // The script's end: the hub may still be on its way to point n.
          await Promise.race([proc.exit, sleep(QUIET_MS + 5 * SECOND)]);
          if (alive(proc.pid)) { await stopHub({ pid: proc.pid, proc }, 'SIGKILL'); continue; }
          const cut = readPoints(file);
          expect(cut.map((pt) => pt.n), `cut after point ${n}: the hub ended right after point ${n}, not before or for another reason (stderr: ${proc.stderr().slice(0, 1500)})`)
            .toEqual(Array.from({ length: n }, (_, i) => i + 1));
          done = true;
          const label = `cut after point ${n} (${cut[n - 1]!.kind}${cut[n - 1]!.mode ? ` ${cut[n - 1]!.mode}` : ''})`;

          // The restart, on the same root, with no test VFS: the files hold only what was synced.
          const hub = await startHub({ home: p.home });
          const durableRuns = (events: Ev[]) => events.filter((e) => e.kind === 'run.started' && e.data.check === CHECK);
          const log = await settleLog(hub, (events) => {
            const ids = new Set(events.map((e) => e.id));
            if (!p.spooled.every((r) => ids.has(r.id))) return false;
            const pre = committedIds(cut);
            return durableRuns(events).filter((e) => pre.has(e.id)).every((s) =>
              events.some((e) => e.kind === 'run.finished' && bare(e.data.run) === bare(s.data.run))
              && durableRuns(events).some((e) => !pre.has(e.id) && bare(e.data.claim) === bare(s.data.claim)));
          });
          const checked = restartProblems(cut, p, log);
          expect(checked.problems, `${label}: after the restart`).toEqual([]);
          inFlightPasses += checked.inFlight > 0 ? 1 : 0;
          normalProofs += checked.lostNormal > 0 ? 1 : 0;

          // Projections equal to their rebuild, on the ledger the restarted hub leaves.
          await stopHub(hub);
          expect(await projectionsAgainstRebuild(hub.root, join(p.dir, 'check')), `${label}: every projection equals its rebuild`).toBeUndefined();
        } finally {
          await endPass(p);
        }
      }
      expect(done, `the hub never reached point ${n} of ${points.length} in ${TRIES} passes`).toBe(true);
    }

    // The clauses that need the right cut: some cut left the check run in flight, and the VFS lost a NORMAL commit.
    expect(inFlightPasses, 'some cut came while the check run was in flight and durably started').toBeGreaterThan(0);
    expect(normalProofs, 'the test VFS proved itself: a cut right after a NORMAL commit lost what it wrote').toBeGreaterThan(0);
    console.log(`AC3: ${points.length} points; ${inFlightPasses} cuts with the check in flight; ${normalProofs} cuts losing a NORMAL commit`);
  }, 45 * 60 * SECOND);
});

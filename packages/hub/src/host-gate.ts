// The gate for a session on a host (#999; design: Blocks for work on your other machines, Sessions on a host). A claim
// made at such a session's stop is judged as a local one is, by the gate runner's verdict over its checks' runs, but
// its checks run on the host as remote runs (#1942), in the session's folder there.
import type { Changes } from './claim-changes.js';
import type { Claim, DefinitionState, Entry, GateOptions, GateRunner } from './gate-runner.js';

/** What the gate runner lends: its claims, a definition's entry on a claim, a run that couldn't start, and its options. */
interface Runner {
  claims: Map<string, Claim[]>;
  definition(claim: Claim, definition: DefinitionState, snapshot: string): void;
  cantStart(e: Entry, error: unknown): void;
  o: Pick<GateOptions, 'start' | 'ended' | 'judged' | 'now' | 'hold_ms' | 'changesOn'>;
  readMs: number;
}

/**
 * A claim made at a stop of a session on a host: its checks run there as remote runs, in the session's folder at the
 * commit its HEAD held at the claim. A remote machine has no copy-on-write staging, so there is no snapshot, no
 * checkout and no run on the merge base, and each check gets one run, whose exit status is its result. The hold waits
 * for them, and no longer than the hold.
 */
export async function stopOnHost(g: Runner, r: Parameters<GateRunner['stop']>[0] & { host: string }): Promise<{ fast: string[]; slow: string[]; snapshot: string; readyAt: number; budgetCost: string[]; changed: boolean }> {
  const older = (g.claims.get(r.session) ?? []).filter((c) => c.claim !== r.claim);
  const claim: Claim = { claim: r.claim, session: r.session, task: r.task, cwd: r.cwd, base: r.base, snapshot: r.base, tree: undefined, checkout: null, requirements: r.requirements, entries: new Map(), repo: Promise.resolve(`${r.host}:${r.cwd}`), installs: Promise.resolve(''), names: Promise.resolve(''), programs: new Map(), host: r.host };
  g.claims.set(r.session, [...older, claim]);
  g.definition(claim, r.definition ?? 'locked', r.base);
  const readyAt = g.o.now();
  const unread = (why: string): Changes => ({ changed: [], configs: new Map(), scripts: false, unread: why });
  const changed = (g.o.changesOn?.(r.host, r.cwd, r.base, g.readMs) ?? Promise.resolve(unread(`this hub has no read of a folder on ${r.host}`)))
    .catch((error: unknown) => unread(error instanceof Error ? error.message : String(error))).then((changes) => { claim.changes = changes; });
  const runs = r.checks.map(async (c) => {
    // An older claim's run of the same check is outdated by this one: the folder there may have changed since.
    for (const o of older) { const was = o.entries.get(c.check); if (was) Object.assign(was, { stale: true, newer: was.newer ?? r.claim }); }
    const e: Entry = { check: c, claim: r.claim, commit: r.base, lane: 'fast', runs: [], base: null, outcome: null, running: true, stale: false };
    claim.entries.set(c.check, e);
    await changed;
    try {
      const run = await g.o.start({ claim: r.claim, check: c.check, approved: c.approved, command: c.command, commit: r.base, cwd: r.cwd, lane: 'fast', expected_ms: null, deadline_ms: c.deadline_ms ?? null, host: r.host });
      e.runs.push(run);
      e.outcome = await g.o.ended(run);
    } catch (error) {
      e.outcome = 'missing';
      g.cantStart(e, error);
    } finally {
      e.running = false;
    }
    await g.o.judged?.(r.claim);
  });
  claim.ready = true;
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([Promise.allSettled(runs), new Promise<void>((done) => { timer = setTimeout(done, Math.max(0, r.stopAt + g.o.hold_ms - g.o.now())); })]).finally(() => clearTimeout(timer));
  return { fast: r.checks.map((c) => c.check), slow: [], snapshot: r.base, readyAt, budgetCost: [], changed: r.checks.length > 0 };
}

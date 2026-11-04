// AC3 #992.45c506d1: for each of 12 recorded sessions covering every state, `deep status` and the app's row name the
// same state; a planted app that maps waiting to Working fails, naming the session. The twelve are the corpus's Claude
// Code recordings named in CASES (README: The twelve sessions), each replayed into a hub of its own and read at the
// moment its case names; the app's row is read in the replica over the same record at the hub's time (app.rs).
import { afterAll, describe, expect, test } from 'vitest';
import { AC3, type AppCase, answerOf, appRows, callOf, cleanup, deepStatus, forApp, label, mustTag, type Recorded, recorded, replay, statusOf, statusWithin, stepClock, TEN_MINUTES, type Word, wordOf } from './helpers.ts';

afterAll(cleanup);

interface Case { name: string; then?: 'kill' | 'quiet'; through?: (r: Recorded) => number; what: string }
/** The twelve recorded sessions and when each is read (README: The twelve sessions). */
const CASES: Case[] = [
  { name: 'tools', what: 'a shell call, a Write and an Edit through permission requests, a failed call and a resume, whole' },
  { name: 'subagent', what: "a background subagent's calls and its report, whole" },
  { name: 'loop', what: 'a /loop and one of its iterations, whole' },
  { name: 'compact', what: '/compact mid-session, whole' },
  { name: 'child-gates', what: 'a task completed and a subagent that stops and reports, whole' },
  { name: 'stop-failure', what: 'a turn that ends on an API error, whole' },
  { name: 'crash', then: 'kill', what: "the agent killed mid-call, its process gone" },
  { name: 'permission-terminal-closed', what: 'a permission prompt left showing, its agent alive' },
  { name: 'permission-denied-esc', then: 'quiet', what: 'a permission prompt denied with Esc, then 10 minutes with no hook' },
  { name: 'permission-answered', through: (r) => { const at = mustTag(r, 'permission-answered', 'PermissionRequest'); return answerOf(r, at, callOf(r, at)); }, what: 'a permission prompt answered, up to the call it let run' },
  { name: 'elicitation-answered', what: 'an elicitation dialog answered, whole' },
  { name: 'elicitation-cancelled', what: 'an elicitation dialog cancelled, whole' },
];
/** The states the twelve must cover between them: every word deep status gives a session its hooks alone can reach. */
const COVERS: Word[] = ['needs you', 'flagged', 'working', 'finished', 'quiet'];

interface Read { c: Case; r: Recorded; session: string; status: string | undefined; why: string; app: AppCase }
async function read(c: Case, r: Recorded): Promise<Read> {
  const rp = await replay(r, c.through ? { through: c.through(r) } : {});
  if (c.then === 'kill') {
    await rp.agent.kill();
    await statusWithin(rp.h, rp.session, 5_000, (s) => s.state === 'flagged');
  }
  if (c.then === 'quiet') {
    await stepClock(rp.hub, TEN_MINUTES);
    await statusWithin(rp.h, rp.session, 35_000, (s) => s.state === 'quiet');
  }
  const s = statusOf(await deepStatus(rp.h), rp.session);
  return { c, r, session: rp.session, status: s.state, why: s.why, app: await forApp(rp, c.name) };
}

describe(AC3, () => {
  test(`${AC3}: for each of 12 recorded sessions covering every state, deep status and the app's row name the same state; a planted app that maps waiting to Working fails, naming the session`, async () => {
    const reads: Read[] = [];
    const missing: string[] = [];
    for (const c of CASES) {
      const r = recorded(c.name);
      if (r) reads.push(await read(c, r));
      else missing.push(`${c.name} (${c.what})`);
    }
    console.log(`deep status read: ${reads.map((x) => `${x.c.name} ${x.status ?? 'no row'}${x.why ? ` (${x.why})` : ''}`).join('; ')}${missing.length ? `; not recorded: ${missing.join('; ')}` : ''}`);
    const rows = await appRows(reads.map((x) => x.app));
    const differ = (rowsOf: typeof rows) => reads.flatMap((x) => {
      const row = rowsOf.get(x.c.name)?.row ?? '';
      return wordOf(row) === x.status ? [] : [`${label(x.r)}: session ${x.session} (${x.c.what}) reads ${x.status ?? 'no row'}${x.why ? ` (${x.why})` : ''} in deep status and "${row}" (${wordOf(row)}) as the app's row`];
    });
    expect(differ(rows), 'deep status and the app name these sessions differently').toEqual([]);
    if (missing.length) throw Error(`BLOCKED: the corpus lacks ${missing.length} of the 12 recorded sessions: ${missing.join('; ')} (README: What the implementation must provide, 1)`);
    const covered = new Set(reads.map((x) => x.status));
    expect(COVERS.filter((w) => !covered.has(w)), `the 12 sessions read ${[...covered].join(', ')} between them; every state must be covered`).toEqual([]);
    // The planted app maps waiting to Working: the session that waits on you must be named.
    const planted = differ(await appRows(reads.map((x) => x.app), { plant: 'waiting-as-working' }));
    for (const x of reads.filter((y) => y.status === 'needs you')) {
      expect(planted.some((p) => p.includes(x.session)), `a planted app that maps waiting to Working must fail naming session ${x.session}, which deep status reads needs you; it found: ${JSON.stringify(planted)}`).toBe(true);
    }
  }, 1_800_000);
});

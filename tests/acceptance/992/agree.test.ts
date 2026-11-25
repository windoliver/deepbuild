// AC3 #992.45c506d1: for each of 12 recorded sessions covering every state, `deep status` and the app's row name the
// same state; a planted app that maps waiting to Working fails, naming the session. Blind redraft for #2668, in this
// file's place once a signed approval tag names the swap (tests/acceptance/2668/README.md).
//
// The twelve are the corpus's Claude Code recordings named in CASES (README: The twelve sessions), each replayed into a
// hub of its own and read at the moment its case names, as the first draft read them. What #2018 and #1461 changed is
// how each reader names the session: `deep status` lists it by its one name, with its word from the fourteen of States
// people see, its quiet ones folded into one line; `deep status --json` holds its row by its session; and the app's list
// draws it as a row with its word in the row's state-word slot, a quiet one folded into its project's quiet row. So the
// session's `deep status` word is its JSON row's word where its text line says the same, and the app's is what the
// real replica draws over a copy of the same hub's record (`deep-drive`, `launch.from: "record_copy"`). The plain app
// runs as the plant `activePlant()` names (none as shipped), so a proof lane's DEEP_HUB_PLANT reaches the app.
import { activePlant } from '@deepbuild/hub';
import { afterAll, describe, expect, test } from 'vitest';
import { cleanup as cleanup1463 } from '../1463/helpers.ts';
import { appSee, appWord, readStatus, rowOf, type StatusRead, statusWithin, statusWord } from '../2668/agree-readers.ts';
import { disagreements, type Named } from '../2668/judges.ts';
import { AC3, answerOf, callOf, cleanup, label, mustTag, type Recorded, recorded, replay, stepClock, TEN_MINUTES } from './helpers.ts';

afterAll(async () => { await cleanup(); await cleanup1463(); }, 60_000);

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
/**
 * The states the twelve must cover between them: every word of States people see that a session's own hooks reach with
 * no ask, check or verdict. A permission prompt showing reads needs you, a process gone mid-turn or a turn ended failed
 * flagged, a turn under way working, a stop says done (every stop is judged, so its claim waits on its checks), and no
 * hook in the quiet period quiet.
 */
const COVERS = ['needs you', 'flagged', 'working', 'says done', 'quiet'];
const PLANT = 'waiting-as-working';

interface Read extends Named { c: Case; r: Recorded; planted: string | undefined; plantedNode: string }
async function read(c: Case, r: Recorded): Promise<Read> {
  const rp = await replay(r, c.through ? { through: c.through(r) } : {});
  if (c.then === 'kill') {
    await rp.agent.kill();
    await statusWithin(rp.h, rp.session, 5_000, (w) => w === 'flagged');
  }
  if (c.then === 'quiet') {
    await stepClock(rp.hub, TEN_MINUTES);
    await statusWithin(rp.h, rp.session, 35_000, (w) => w === 'quiet');
  }
  // deep status around the app's copy of the record: the read at the copy's log_pos where one has it, else the later.
  const before = await readStatus(rp.h);
  const app = await appSee(rp.h, activePlant());
  const status: StatusRead = before.log_pos === app.log_pos ? before : await readStatus(rp.h);
  const s = statusWord(status, rp.session);
  const a = appWord(app.snapshot, s.row ?? rowOf(before, rp.session));
  const p = appWord((await appSee(rp.h, PLANT)).snapshot, s.row ?? rowOf(before, rp.session));
  return { c, r, name: label(r), session: rp.session, status: s.word, statusSaid: s.said, app: a.word, appNode: a.node, planted: p.word, plantedNode: p.node };
}

describe(AC3, () => {
  test(`${AC3}: for each of 12 recorded sessions covering every state, deep status and the app's row name the same state; a planted app that maps waiting to Working fails, naming the session`, async () => {
    const missing = CASES.filter((c) => !recorded(c.name)).map((c) => `${c.name} (${c.what})`);
    if (missing.length) throw Error(`BLOCKED: the corpus lacks ${missing.length} of the 12 recorded sessions: ${missing.join('; ')} (README: What the implementation must provide, 1)`);
    const reads: Read[] = [];
    for (const c of CASES) reads.push(await read(c, recorded(c.name)!));
    console.log(`read: ${reads.map((x) => `${x.c.name} session ${x.session}: deep status ${x.status ?? `none (${x.statusSaid})`}, app ${x.app ?? `none (${x.appNode})`}, planted app ${x.planted ?? 'none'}`).join('; ')}`);
    expect(disagreements(reads), 'deep status and the app name these sessions differently').toEqual([]);
    const covered = new Set(reads.map((x) => x.status));
    expect(COVERS.filter((w) => !covered.has(w)), `the 12 sessions read ${[...covered].join(', ')} between them; every state must be covered`).toEqual([]);
    // The planted app maps waiting to Working: each session deep status reads needs you must be named.
    const planted = disagreements(reads.map((x) => ({ ...x, app: x.planted, appNode: x.plantedNode })));
    for (const x of reads.filter((y) => y.status === 'needs you')) {
      expect(planted.some((p) => p.includes(x.session)), `a planted app that maps waiting to Working (DEEP_HUB_PLANT=${PLANT}) must fail naming session ${x.session}, which deep status reads needs you; it found: ${JSON.stringify(planted)}`).toBe(true);
    }
  }, 2_400_000);
});

// Test-side tools for #2028 (README). Every world is a record a real hub made (#1461's `makeWorld`: sessions, titles,
// states and asks seeded through the real record and asks core with the hub stopped, then `deep hub run` builds the
// list's rows as its first backfill). The app is the real `deep-drive` (#124) on a copy of that record
// (`launch.from: "record_copy"`), on its virtual clock: its window is the front one, its acts are your input at its
// clock, and you're present within 2 minutes of one (#1461's Pinned 4). What happens while you're away reaches it as
// the hub's stream would deliver it: AC1's changes as the core writes them (#1461's `rowSet`), AC2's as the real hub
// wrote them for real hooks, read back from its log. `deep inbox` and `deep status --json` are the real CLI on the real
// hub. The judges are this suite's own; none is taken from the implementation.
//
// Reused by import: #16's hook wire and PID cleanup; #26's ULIDs; #1463's `quiet`; #1461's world, replica, rows,
// weights and IDs of the window; #2026's reading of the three count surfaces and its oracle of open asks.
//
// Safety: HOME is a temp folder under /tmp for every process started; a process is stopped only by the PID it was
// started with; nothing touches the real ~/.deepbuild, ~/.claude or ~/Library/LaunchAgents; no network, no model.
import { spawn } from 'node:child_process';
import { hookRequest, own, sendHook, type Session } from '../16/helpers.ts';
import { ulid } from '../26/helpers.ts';
import { quiet } from '../1463/helpers.ts';
import {
  cleanup as cleanup1461, deep, FLICKS, flicks, jsonRows, makeWorld, MIN, REFERENCE, Replica, rowSet, sessionOf, weightFailures,
  type Row, type SessionSpec, type Snapshot, type World,
} from '../1461/helpers.ts';
import { eventsOf, homeNumbers, numberIn, openAsks, surfaces, type Ev, type Snap, type Surfaces } from '../2026/helpers.ts';

export { MIN };
export const cleanup = cleanup1461;
export const HOUR = 60 * MIN;

/** The criteria, by `#2028.<first 8 hex of SHA-256(text, whitespace collapsed)>` (scripts/proof-change.mjs, criterionId). */
export const ID = {
  marks: '#2028.c2f64186',
  count: '#2028.cb5e7641',
} as const;

/** The planted wrong programs, each selected with DEEP_HUB_PLANT (README, Pinned). */
export const PLANT = {
  /** AC1, the app: every row whose state changed in the last 24 hours is marked, read or not. */
  wholeDay: 'marks-whole-day',
  /** AC1, the app (#1461's, merged): an agent's message (`session.activity`) marks its session's row. */
  messages: 'unread-on-message',
  /** AC2, the app: the menu bar's count adds the list's unread rows to the open asks. */
  menuBar: 'menu-bar-adds-unread',
  /** AC2, the app: the list's Needs you heading adds the list's unread rows to the open asks. */
  list: 'list-adds-unread',
  /** AC2, the CLI's side of `deep inbox`: its count adds the list's unread rows to the open asks. */
  inbox: 'inbox-adds-unread',
} as const;

// ---- The virtual clock. The criterion's hours name moments on it: 14:00 is your last input before you leave, 17:00
// three hours of the replica's clock later. Between your inputs the clock runs a frame each second of virtual time
// (README, Pinned 1), a minute of it per call, so no reply waits long; where you act it runs a frame a 60th.

/** The virtual time a frame stands for while the clock runs between your inputs, in ms. */
export const STEP_MS = 1000;
const CALL = MIN;
const stepped = new WeakSet<Replica>();
/** `fn` on every replica at once; once all have settled, the first failure, if any, so no call is left running. */
async function each<T>(rs: readonly Replica[], fn: (r: Replica, i: number) => Promise<T> | T): Promise<T[]> {
  const settled = await Promise.allSettled(rs.map(async (r, i) => fn(r, i)));
  const failed = settled.find((x): x is PromiseRejectedResult => x.status === 'rejected');
  if (failed) throw failed.reason;
  return settled.map((x) => (x as PromiseFulfilledResult<T>).value);
}
/** Runs each replica's clock to `at(r)`, in flicks since its launch, a frame each `STEP_MS`. */
async function runTo(rs: readonly Replica[], at: (r: Replica) => number): Promise<void> {
  await each(rs, async (r) => {
    const target = at(r);
    while (r.t < target) {
      // The first call is a second long: a replica whose clock can't step says so before it runs a minute frame by frame.
      const to = Math.min(target, r.t + flicks(stepped.has(r) ? CALL : STEP_MS));
      const reply = await r.must(`running the clock to ${to}`, { call: 'wait_for', wait_for: { t: to, step_ms: STEP_MS }, timeout: Math.ceil(((to - r.t) * 1000) / FLICKS) + 1000 });
      if (reply.step_ms !== STEP_MS) blocked(`deep-drive's wait_for ran its clock a frame each 60th of a second, not each ${STEP_MS} ms (its reply says no step_ms; README, Pinned 1): three hours that way are 648,000 frames, ${said(reply).slice(0, 200)}`);
      stepped.add(r);
    }
  });
}
/** A replica of the world's record for each plant (undefined: as shipped), all at the reference size. */
async function replicas(w: World, plants: readonly (string | undefined)[]): Promise<Replica[]> {
  const rs: Replica[] = [];
  for (const plant of plants) {
    const r = await Replica.start({ home: w.home, ...(plant ? { plant } : {}) });
    rs.push(r);
    await r.launch({ from: 'record_copy', size: [REFERENCE.width, REFERENCE.height] });
  }
  return rs;
}
/**
 * A press on the row `id`, which opens its page: your input. The pointer then rests on the page's title, off the list,
 * as a person's would after reading: a pointer left on a row for 1.5 s shows its tooltip over the row below.
 */
async function open(r: Replica, id: string, what: string): Promise<void> {
  await r.click({ id }, what);
  await r.hover({ id: 'page-title' });
}
const rowOf = (rows: readonly Row[], id: string): Row => rows.find((x) => x.id === id) ?? (() => { throw Error(`BLOCKED: see's rows hold no ${id}`); })();
const sid = (w: World, key: string): string => `session:${sessionOf(w, key).id}`;
const letters = (id: string): string => id.replace(/[^0-9A-Za-z]/g, '');
const core = { writer: 'core', actor: 'you', scope: 'you' } as const;
const said = (v: unknown): string => JSON.stringify(v) ?? String(v);

// ---- AC1: five rows that changed while you were away, and three that didn't.

/** A state change and the row the core writes for it: unread, since now. */
interface Change { word: string; entry: string; why: string; waits_on: string | null }
const PASS: Change = { word: 'PASS', entry: 'pass', why: 'its claim passed its checks', waits_on: null };
const SENT_BACK: Change = { word: 'sent back', entry: 'fail', why: 'its claim was sent back, round 1 of 3', waits_on: 'agent' };
const BLOCKED: Change = { word: 'BLOCKED', entry: 'blocked', why: 'its claim is BLOCKED: a check it names couldn\'t run', waits_on: 'you' };
const WORKING: Change = { word: 'working', entry: 'running', why: 'at work', waits_on: 'agent' };
async function changeRow(r: Replica, row: Row, change: Change): Promise<void> {
  await r.feed(String(row.session), await rowSet({ ...row, ...change, since: r.now(), unread: true } as Row));
}

/**
 * AC1's world (README, The fixtures). Five sessions change between 14:00 and 17:00: three working ones reach PASS, are
 * sent back and are BLOCKED; one waiting on its ask has a decision applied for it and works on; one finished starts a
 * new turn and is still working at 17:00. Three don't: `chatty` works on, its agent reporting what it does; `morning`
 * reached PASS before 14:00 and was read then; `still` finished before 14:00 and never changes. Titles are short, so
 * none is cut beside the widest state word and time: #1461's weight reader reads only runs wholly inside a title's slot.
 */
export const MARKS_WORLD: SessionSpec[] = [
  { key: 'pass', project: 'shop', title: 'Cart' },
  { key: 'sent', project: 'shop', title: 'Checkout' },
  { key: 'blocked', project: 'shop', title: 'Billing' },
  { key: 'decided', project: 'docs', title: 'Notes', asks: [{ kind: 'choice', question: 'Keep the cart on SQLite or plain files?' }] },
  { key: 'resumed', project: 'docs', title: 'API guide', state: 'finished' },
  { key: 'chatty', project: 'search', title: 'Index' },
  { key: 'morning', project: 'search', title: 'Ranking' },
  { key: 'still', project: 'search', title: 'Synonyms', state: 'finished' },
];
/** What each of the five did while you were away, and when, in minutes after 14:00. */
export const CHANGED = [
  { key: 'pass', at: 30, what: 'reached PASS with its page left open' },
  { key: 'sent', at: 60, what: 'was sent back' },
  { key: 'blocked', at: 90, what: 'was BLOCKED' },
  { key: 'decided', at: 120, what: 'had a decision applied for you and worked on' },
  { key: 'resumed', at: 150, what: 'started a new turn and is still working' },
] as const;
/** The three that must stay unmarked, with what the failure says of each. */
export const UNMARKED = [
  { key: 'morning', what: 'the row read at 14:00 after its change earlier in the day' },
  { key: 'chatty', what: 'the row with only its agent\'s messages since 14:00' },
  { key: 'still', what: 'the row with no change all day' },
] as const;
/** When `chatty`'s agent reports something, in minutes after 14:00. */
const MESSAGES = [10, 25, 40, 55, 70, 85, 100, 115, 130, 145, 160, 175];

/**
 * The virtual-clock run for each plant (undefined: as shipped), every replica on one world and in step: what's wrong,
 * by plant, each failure naming its row. At 13:59 `morning` reaches PASS; at 14:00 you open its page for a second,
 * then `pass`'s, and leave it open; from then on you give no input until 17:00, when you come back by opening
 * `still`'s page. Then each of the five rows' page is opened for a second.
 */
export async function marksRun(plants: readonly (string | undefined)[]): Promise<Map<string | undefined, string[]>> {
  const w = await makeWorld(MARKS_WORLD);
  const decidedAsk = w.asks.find((a) => a.key === 'decided') ?? blocked('the world raised no ask for decided');
  const rs = await replicas(w, plants);
  const out = new Map<string | undefined, string[]>(plants.map((p) => [p, []]));
  const fail = (i: number, lines: string[]) => out.get(plants[i])!.push(...lines);
  try {
    const rows = await each(rs, async (r) => (await r.see()).rows);
    const row = (i: number, key: string): Row => rowOf(rows[i]!, sid(w, key));
    await each(rs, (r, i) => changeRow(r, row(i, 'morning'), PASS));
    await runTo(rs, () => flicks(MIN));
    // 14:00: you read what changed earlier, then leave `pass`'s page open.
    await each(rs, async (r, i) => {
      await open(r, sid(w, 'morning'), 'opening morning\'s page at 14:00');
      await r.wait(1200);
      fail(i, weightFailures((await r.see()).snapshot, sid(w, 'morning'), 'regular', 'at 14:00, a second after its page opened'));
      await open(r, sid(w, 'pass'), 'opening pass\'s page at 14:00 and leaving it open');
    });
    const t14 = new Map(rs.map((r) => [r, r.t]));
    type Step = { at: number; feed: (r: Replica, i: number) => Promise<unknown> };
    const plan: Step[] = [
      ...MESSAGES.map((at): Step => ({
        at,
        feed: (r: Replica) => r.feed(sessionOf(w, 'chatty').id, { v: 1, id: ulid(), kind: 'session.activity', writer: 'hook', actor: 'you', scope: 'you', subject: `session:${letters(sessionOf(w, 'chatty').id)}`, data: { activity: `Rebuilt the index, run ${MESSAGES.indexOf(at) + 1}` } }),
      })),
      { at: 30, feed: (r: Replica, i: number) => changeRow(r, row(i, 'pass'), PASS) },
      { at: 60, feed: (r: Replica, i: number) => changeRow(r, row(i, 'sent'), SENT_BACK) },
      { at: 90, feed: (r: Replica, i: number) => changeRow(r, row(i, 'blocked'), BLOCKED) },
      {
        at: 120,
        feed: async (r: Replica, i: number) => {
          // A saved decision answers the ask, as the core writes it: the decision applied, the ask's row leaving the
          // list, and the session's row moving on.
          const session = sessionOf(w, 'decided').id;
          await r.feed(session, { v: 1, id: ulid(), kind: 'decision.applied', ...core, data: { decision: `decision:${ulid()}`, ask: decidedAsk.handle } });
          await r.feed(session, { v: 1, id: ulid(), kind: 'row.set', ...core, data: { id: decidedAsk.handle, listed: false } });
          await changeRow(r, row(i, 'decided'), WORKING);
        },
      },
      { at: 150, feed: (r: Replica, i: number) => changeRow(r, row(i, 'resumed'), WORKING) },
    ].sort((a, b) => a.at - b.at);
    for (const step of plan) {
      await runTo(rs, (r) => t14.get(r)! + flicks(step.at * MIN));
      await each(rs, (r, i) => step.feed(r, i));
    }
    await runTo(rs, (r) => t14.get(r)! + flicks(3 * HOUR));
    // 17:00: you come back, by opening a row that didn't change.
    await each(rs, async (r, i) => {
      await open(r, sid(w, 'still'), 'coming back at 17:00: opening still\'s page');
      const back = (await r.see()).snapshot;
      for (const c of CHANGED) fail(i, weightFailures(back, sid(w, c.key), 'medium', `at 17:00, the row that ${c.what} while you were away`));
      for (const u of UNMARKED) fail(i, weightFailures(back, sid(w, u.key), 'regular', `at 17:00, ${u.what}`));
      for (const c of CHANGED) {
        await open(r, sid(w, c.key), `opening ${c.key}'s page at 17:00`);
        await r.wait(1200);
        fail(i, weightFailures((await r.see()).snapshot, sid(w, c.key), 'regular', `a second after the page of the row that ${c.what} opened at 17:00`));
      }
    });
  } finally {
    await each(rs, (r) => r.stop());
  }
  return out;
}

// ---- AC2: the one count before and after rows are marked, and an absence with no state change.

/** AC2's world (README, The fixtures): two asks open, on two sessions; two sessions at work; one finished, which you open. */
export const COUNT_WORLD: SessionSpec[] = [
  { key: 'q1', project: 'shop', title: 'Login', state: 'finished', asks: [{ kind: 'choice', question: 'Keep the cart on SQLite or plain files?' }] },
  { key: 'q2', project: 'shop', title: 'Header', state: 'finished', asks: [{ kind: 'taste', question: 'Which header colour on the login page?' }] },
  { key: 'w1', project: 'docs', title: 'Cart' },
  { key: 'w2', project: 'docs', title: 'Checkout' },
  { key: 'idle', project: 'search', title: 'Docs', state: 'finished' },
];
const WORKERS = ['w1', 'w2'] as const;

/** One reading of the three surfaces at a moment: the app's (one per replica) and `deep inbox`'s (plain and planted). */
interface Moment { when: string; app: Surfaces[]; inbox: { plain: string; planted: string } }
const lastLine = (text: string): string => text.split('\n').map((l) => l.trim()).filter(Boolean).at(-1) ?? '';
/** `deep inbox`'s last line, the count it ends on, as you run it, and as the planted CLI prints it. */
async function inboxLines(w: World): Promise<{ plain: string; planted: string }> {
  const [plain, planted] = await Promise.all([deep(w, ['inbox']), deep(w, ['inbox'], PLANT.inbox)]);
  if (plain.code !== 0) blocked(`deep inbox exited ${plain.code}: ${plain.stderr.slice(-600)}`);
  return { plain: lastLine(plain.stdout), planted: planted.code === 0 ? lastLine(planted.stdout) : `exit ${planted.code}: ${planted.stderr.slice(-300)}` };
}
/** Each event the hub appended after `after`, in log order. */
async function appendedAfter(w: World, after: number): Promise<Ev[]> {
  return (await eventsOf(w.hub)).filter((e) => e.log_pos > after).sort((a, b) => a.log_pos - b.log_pos);
}
/** An event from the hub's log fed to a replica as its stream delivers it. */
function feedEvent(r: Replica, e: Ev): Promise<unknown> {
  const { log_pos: _pos, ts: _ts, ...event } = e as Ev & Record<string, unknown>;
  return r.feed(e.session ?? '', event);
}
/** A real hook from the session's agent (a `sleep` standing in for its process), on the hook wire. */
async function hook(w: World, s: Session, agent: number, event: string): Promise<void> {
  const sent = await sendHook(w.hub.socket, { ...hookRequest(s, event), pid: agent, ppid: agent }, 30_000);
  if (sent.end !== 'reply' || sent.error) blocked(`the hub didn't take ${s.id}'s ${event} hook: ${sent.end} ${said(sent.error ?? '')}`);
}

/**
 * The run for AC2 (README, The fixtures), one world: a replica as shipped and one for each of the app's plants, in step;
 * `deep inbox` as shipped and planted at each moment. At 14:00 you open `idle`'s page. Until 17:00 the two working
 * sessions' agents run tool calls, real hooks the hub writes, fed to each replica through the afternoon; then you come
 * back, opening `idle`'s page again. Then both agents' turns stop, real Stop hooks: the hub marks their rows, and its
 * events are fed. Each surface is read at 14:00, at 17:00 and once the rows are marked. What's wrong, by plant (the
 * CLI's plant judged on the shipped app's readings, the app's plants on the shipped `deep inbox`).
 */
export async function countRun(): Promise<Map<string | undefined, string[]>> {
  const w = await makeWorld(COUNT_WORLD);
  const want = openAsks(await eventsOf(w.hub)).open;
  const plants = [undefined, PLANT.menuBar, PLANT.list] as const;
  const rs = await replicas(w, plants);
  const moments: Moment[] = [];
  const marks: string[][] = rs.map(() => []);
  const record: string[] = [];
  const read = async (when: string): Promise<Snapshot[]> => {
    const shots = await each(rs, async (r) => (await r.see()).snapshot);
    moments.push({ when, app: shots.map((s) => surfaces(s as unknown as Snap)), inbox: await inboxLines(w) });
    return shots;
  };
  const agents = new Map<string, number>();
  try {
    const fed = await each(rs, async (r) => (await r.see()).log_pos);
    // 14:00: you open a page, and read the three surfaces.
    await each(rs, (r) => open(r, sid(w, 'idle'), 'opening idle\'s page at 14:00'));
    const t14 = new Map(rs.map((r) => [r, r.t]));
    await read('at 14:00');

    // The afternoon: each working session's agent starts its process again and runs three tool calls. No state changes.
    // The stand-in lives a day, so no process ends while the replicas' afternoon runs.
    for (const key of WORKERS) {
      const child = spawn('/bin/sleep', ['86400'], { stdio: 'ignore' });
      own(child.pid);
      agents.set(key, child.pid!);
      const s = sessionOf(w, key).session;
      await hook(w, s, child.pid!, 'SessionStart');
      for (let n = 0; n < 3; n++) for (const event of ['PreToolUse', 'PostToolUse']) await hook(w, s, child.pid!, event);
    }
    await quiet(w.hub);
    const afternoon = await appendedAfter(w, Math.min(...fed));
    const status = (await jsonRows(w, 'status')).rows;
    for (const row of status) if (row.unread) record.push(`deep status --json reads ${row.id} ("${row.title}") unread after only its agent's tool calls, with no change in its state`);
    for (const [k, e] of afternoon.entries()) {
      await runTo(rs, (r) => t14.get(r)! + flicks(((k + 1) * 3 * HOUR) / (afternoon.length + 1)));
      await each(rs, (r, i) => (e.log_pos > fed[i]! ? feedEvent(r, e) : undefined));
    }
    await runTo(rs, (r) => t14.get(r)! + flicks(3 * HOUR));

    // 17:00: you come back. Nothing changed state, so nothing is marked.
    await each(rs, (r) => open(r, sid(w, 'idle'), 'coming back at 17:00: opening idle\'s page'));
    const back = await read('at 17:00, after an absence with no state change');
    for (const [i, shot] of back.entries()) {
      for (const key of [...WORKERS, 'idle']) marks[i]!.push(...weightFailures(shot, sid(w, key), 'regular', 'at 17:00, after an absence with no state change'));
    }

    // Then both agents' turns stop: the hub marks their rows. Whatever else it appended since the afternoon's events
    // is fed with them, in its order.
    for (const key of WORKERS) await hook(w, sessionOf(w, key).session, agents.get(key)!, 'Stop');
    await quiet(w.hub);
    const stops = (await appendedAfter(w, Math.min(...fed))).filter((e) => !afternoon.some((a) => a.log_pos === e.log_pos));
    const marked = (await jsonRows(w, 'status')).rows;
    for (const key of WORKERS) {
      if (marked.find((x) => x.id === sid(w, key))?.unread !== true) record.push(`deep status --json reads ${sid(w, key)} read after its turn stopped, a change in its state: the rows weren't marked, so the count after marks wasn't read`);
    }
    for (const e of stops) await each(rs, (r, i) => (e.log_pos > fed[i]! ? feedEvent(r, e) : undefined));
    await each(rs, (r) => r.wait(1000));
    const after = await read('after rows were marked');
    for (const [i, shot] of after.entries()) {
      for (const key of WORKERS) marks[i]!.push(...weightFailures(shot, sid(w, key), 'medium', 'after its turn stopped while you were present, with its page not open'));
    }
  } finally {
    await each(rs, (r) => r.stop());
  }
  const judged = new Map<string | undefined, string[]>();
  for (const [i, plant] of plants.entries()) {
    judged.set(plant, [...record, ...marks[i]!, ...countFailures(moments.map((m) => ({ when: m.when, app: m.app[i]!, inbox: m.inbox.plain })), want)]);
  }
  judged.set(PLANT.inbox, [...record, ...marks[0]!, ...countFailures(moments.map((m) => ({ when: m.when, app: m.app[0]!, inbox: m.inbox.planted })), want)]);
  return judged;
}

/**
 * What's wrong with the one count, each naming its surface and the moment: at every reading the menu bar, the list
 * (its Needs you heading, and the ask rows under it) and `deep inbox` each say the record's number of open asks, the
 * same at 14:00, at 17:00 and once rows are marked.
 */
export function countFailures(moments: readonly { when: string; app: Surfaces; inbox: string }[], open: ReadonlyMap<string, { question: string }>): string[] {
  const want = open.size;
  const out: string[] = [];
  for (const m of moments) {
    const says = (surface: string, n: number | undefined, shown: string) => {
      if (n === undefined) out.push(`${surface} shows no number of asks ${m.when}: ${shown}`);
      else if (n !== want) out.push(`${surface} reads ${n} ${m.when}, though the record holds ${want} open asks: ${shown}`);
    };
    says('the menu bar', numberIn(m.app.menuBar), said(m.app.menuBar));
    const home = homeNumbers(m.app.home);
    const heading = m.app.home ? `value ${said(m.app.home.value)}, words ${said(m.app.home.words)}` : '';
    if (!m.app.home) out.push(`the list's Needs you heading (heading:needs-you) isn't drawn ${m.when}`);
    else if (home.length !== 1) out.push(`the list's Needs you heading reads ${home.length ? home.join(' and ') : 'no number'} ${m.when}: ${heading}`);
    else says('the list\'s Needs you heading', home[0], heading);
    const rows = m.app.rows;
    const missing = [...open.keys()].filter((id) => !rows.includes(id));
    const extra = rows.filter((id) => !open.has(id));
    if (missing.length || extra.length || rows.length !== want) out.push(`the list's Needs you lists ${rows.length} rows ${m.when}, though the record holds ${want} open asks: ${said(rows)}`);
    says('deep inbox', numberIn(m.inbox), said(m.inbox));
  }
  return out;
}

export function blocked(why: string): never {
  throw Error(`BLOCKED: ${why}`);
}

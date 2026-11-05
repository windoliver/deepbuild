// #45 AC16 (#45.5f772137): "A check held through three goal turns, each newer snapshot taking its held place, and
// started at the goal's end reads three held places taken, the runs the loop saved, and one start, by the loop's pause,
// with its wait from its own stop; a reading that counts the held places as runs fails this test."
//
// Surface: `loopHolds(events)` from packages/readings (readings-surface.md), fed the record's events in the published
// shapes of the base (packages/contracts/schemas): user.ask@2, agent.stop@5, stop.held@1 and check.held@1.
//
// The session, after the design's loop fixture (Testing, "Loops"): an observed Codex session with an active goal makes
// five goal turns, each begun by a `continuation` prompt 1 s after the previous stop's reply, each working 60 s and
// ending on a green stop whose fast-lane checks take 2 s and whose diff makes a new snapshot. At the first four stops
// the slow journey is held in its queued place for the loop; the second, third and fourth snapshots each take the held
// place of the one before (three held places taken, three runs saved). In the fifth turn the goal turns complete, so
// the loop pauses by its facts and the held check starts there when that stop's fast-lane checks end; that stop is
// held for the journey's 300 s, as an observed Codex stop is.
//
// Open choices, each settled from the issue, the design and the base's published schemas and writer:
// 1. The held places are `check.held@1` records, appended whole each time one changes, the newest for a check and
//    snapshot standing (its schema). A place a newer snapshot took is one whose standing record has `replaced_by` set;
//    a start is one whose standing record has `started_by` set. So the record holds 8 check.held events for 4 places.
// 2. "The runs the loop saved" are the held places a newer snapshot took before they started (design: A loop's turn
//    end isn't a hand-back, "the held places a newer snapshot took before they started, the runs a loop saved"), so
//    runs_saved equals places_taken: 3.
// 3. At the goal's end the started place is the fourth snapshot's: the base's gate runner records a held place that
//    starts on its own record (`started_at`, `started_by`), and the fifth snapshot, never held, takes its queued place
//    with no check.held of its own. So "its own stop" is the fourth stop, the one that held the place that started;
//    a wait counted from the first held place's stop (254 s from its request) or from the fifth stop (0–2 s) is wrong.
// 4. How the stop is timed is left open: the design times a hold from deep-hook's stamp on the Stop request (the stop's
//    ULID and agent.stop's ts) to its reply, and check.held's `held_at` is the reply. The wait is accepted from either
//    edge of the fourth stop's own hold: 65 s from its request or 63 s from its reply, to the start 2 s into stop five.
// 5. "By the loop's pause" is the value check.held@1 publishes for it, `loop_paused`, reported as the start's `by`.
// 6. Core-written events (stop.held, check.held) carry `session: null`, as the base's gate runner appends them on the
//    core connection with no session; their session is in `data.session`. Hook events carry the session's id.
import { describe, expect, it } from 'vitest';
import { loopHolds, type RecordEvent } from '../../../packages/readings/src/index.ts';

const SESSION = '01K9A2B3C4D5E6F7G8H9J0K1M2';
const CHECK = '.deepbuild/checks/journey.sh';
const T0 = 1_760_100_000_000;
const WORK_MS = 60_000;      // each goal turn's work, from its prompt to its stop
const FAST_MS = 2_000;       // each stop's fast-lane checks
const NEXT_MS = 1_000;       // each continuation, after the stop's reply
const JOURNEY_MS = 300_000;  // the slow journey, which the fifth stop is held for

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let serial = 0;
/** A ULID whose time part is `ms`, as the record's ids are. */
function ulid(ms: number): string {
  let t = '';
  for (let n = ms, k = 0; k < 10; k++, n = Math.floor(n / 32)) t = CROCKFORD[n % 32] + t;
  let r = '';
  for (let n = ++serial, k = 0; k < 16; k++, n = Math.floor(n / 32)) r = CROCKFORD[n % 32] + r;
  return t + r;
}

interface Turn { ask: number; stop: number; ready: number; reply: number; stopId: string; claim: string; snapshot: string }

/** The five goal turns' times: the prompt, the stop's request, its fast lane's end and its reply. */
function turns(): Turn[] {
  const out: Turn[] = [];
  let ask = T0;
  for (let i = 1; i <= 5; i++) {
    const stop = ask + WORK_MS;
    const ready = stop + FAST_MS;
    const reply = i === 5 ? ready + JOURNEY_MS : ready;
    out.push({ ask, stop, ready, reply, stopId: ulid(stop), claim: `claim:${ulid(stop)}`, snapshot: String(i).repeat(40) });
    ask = reply + NEXT_MS;
  }
  return out;
}

interface Place { session: string; claim: string; check: string; snapshot: string; held_at: number; reason: string; started_at: number | null; started_by: string | null; replaced_by: string | null }

/** The record of the session, in the base's published shapes, in append order. */
function seed(): { events: RecordEvent[]; t: Turn[] } {
  const t = turns();
  const events: RecordEvent[] = [];
  const places: Place[] = [];
  const held = (ts: number, place: Place) => events.push({ id: ulid(ts), kind: 'check.held', v: 1, ts, session: null, subject: place.claim, data: { ...place } });
  t.forEach((turn, k) => {
    const i = k + 1;
    events.push({ id: ulid(turn.ask), kind: 'user.ask', v: 2, ts: turn.ask, session: SESSION, data: { msg: 2 * i - 1, text: '[redacted] continue toward the goal', tasks: [], from: 'continuation' } });
    events.push({ id: turn.stopId, kind: 'agent.stop', v: 5, ts: turn.stop, session: SESSION, subject: `session:${SESSION}`, data: { turn: i, did_work: true, claim: true, cause: 'unknown', usage: null, outcome: 'finished' } });
    if (i < 5) {
      // A green stop of a looping session whose reply ends the turn: held for its quick checks alone.
      events.push({ id: ulid(turn.reply), kind: 'stop.held', v: 1, ts: turn.reply, session: null, data: { session: `session:${SESSION}`, stop: turn.stopId, claim: turn.claim, total: FAST_MS, question: 0, slow: 0, fast: FAST_MS, snapshot_start: 0, queue_wait: 0, code_changing: true, budget_cost: [] } });
      const older = places.at(-1);
      if (older) {
        older.replaced_by = turn.snapshot;
        held(turn.reply, older);
      }
      const place: Place = { session: `session:${SESSION}`, claim: turn.claim, check: CHECK, snapshot: turn.snapshot, held_at: turn.reply, reason: 'goal active', started_at: null, started_by: null, replaced_by: null };
      places.push(place);
      held(turn.reply, place);
    } else {
      // The goal's end: the loop pauses by its facts, and the held place starts when this stop's fast lane ends.
      const older = places.at(-1)!;
      older.started_at = turn.ready;
      older.started_by = 'loop_paused';
      held(turn.ready, older);
      events.push({ id: ulid(turn.reply), kind: 'stop.held', v: 1, ts: turn.reply, session: null, data: { session: `session:${SESSION}`, stop: turn.stopId, claim: turn.claim, total: FAST_MS + JOURNEY_MS, question: 0, slow: JOURNEY_MS, fast: FAST_MS, snapshot_start: 0, queue_wait: 0, code_changing: true, budget_cost: [] } });
    }
  });
  return { events, t };
}

type Loops = ReturnType<typeof loopHolds>;

/** AC16's reading of the session, or a throw naming what it read instead. */
function assertAC16(reading: Loops, t: Turn[]): void {
  const s = reading.sessions.find((x) => x.session === SESSION);
  expect(s, `no loop reading for session ${SESSION}: ${JSON.stringify(reading.sessions.map((x) => x.session))}`).toBeDefined();
  expect(s!.places_taken, 'held places a newer snapshot took').toBe(3);
  expect(s!.runs_saved, 'runs the loop saved: the held places taken before they started').toBe(3);
  expect(s!.runs_started, 'runs started: the one start, never one per held place').toBe(1);
  expect(s!.starts.length, `starts: ${JSON.stringify(s!.starts)}`).toBe(1);
  const [start] = s!.starts;
  expect(start!.check).toBe(CHECK);
  expect(start!.by, "what started it: the loop's pause").toBe('loop_paused');
  // Its own stop is the fourth, whose held place started: from its request or from its reply (open choice 4).
  const fourth = t[3]!;
  const started = t[4]!.ready;
  expect([started - fourth.stop, started - fourth.reply], `waited_ms ${start!.waited_ms}, not from its own stop`).toContain(start!.waited_ms);
}

describe('#45 AC16: checks held for a loop, per session', () => {
  it('#45.5f772137 three goal turns each take the held place, and the goal\'s end starts it once, by the loop\'s pause, its wait from its own stop', () => {
    const { events, t } = seed();
    assertAC16(loopHolds(events), t);
  });

  it('#45.5f772137 a reading that counts the held places as runs fails this test', () => {
    const { events, t } = seed();
    // The wrong program the criterion names: each held place (a check and snapshot held) read as a run started.
    const standing = new Map<string, Place>();
    for (const e of events) if (e.kind === 'check.held') { const p = e.data as unknown as Place; standing.set(`${p.check}\0${p.snapshot}`, p); }
    const places = [...standing.values()];
    const wrong: Loops = { sessions: [{
      session: SESSION,
      places_taken: places.filter((p) => p.replaced_by !== null).length,
      runs_saved: 0,
      runs_started: places.length,
      starts: places.map((p) => ({ check: p.check, claim: p.claim, by: p.started_by ?? 'loop_paused', waited_ms: (p.started_at ?? p.held_at) - p.held_at })),
    }] };
    expect(() => assertAC16(wrong, t)).toThrow();
  });
});

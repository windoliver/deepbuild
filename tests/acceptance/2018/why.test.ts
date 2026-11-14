// AC5 #2018.63948766: for sessions reading working, quiet, says done and interrupted in a replica fixture, every fact
// `--why` names exists at its log_pos, and recomputing the state from only those facts gives the same word; a planted
// `--why` built from a separate reading, which says "quiet" for a row the table reads as working, fails, naming the
// session and the row.
//
// The fixture is a record a real hub reads, which the replica copies. `deep status <session> --why --json` is read
// beside `deep status --json` and the record's events (`events.read`); the recomputation is a real hub over a fresh
// record that holds only the events `--why` named (README, Pinned 5).
//
// Interrupted is a flag beside one of the fourteen state words, not a state (the issue's Scope): the fixture's session
// is a Codex turn you interrupted, whose state is a row of the table, with "interrupted" beside it.
import { afterAll, describe, expect, test } from 'vitest';
import {
  ageless, allEvents, blockOf, byId, cleanup, control, deep, type Ev, ID, mainWorld, MIN, none, quiet, recompute, recomputeFailures, Replica, rowOf, type Rows, type Seen, stateFailures,
  statusRows, TITLES, type Why, whyFailures, whyOf, whyTextFailures, wordsOf, type World,
} from './helpers.ts';

afterAll(cleanup, 120_000);
let made: Promise<World> | undefined;
const world = (): Promise<World> => (made ??= mainWorld());
/** `--why`, the list and the record read at one log_pos: read again, a few times, when the hub wrote between them. */
async function read(w: World, session: string, plant?: string): Promise<{ why: Why; status: Rows; events: Ev[]; asked: number }> {
  for (let tries = 0; ; tries++) {
    await quiet(w.hub);
    const status = await statusRows(w);
    const why = await whyOf(w, session, plant);
    const asked = Date.now();
    if (why.log_pos === status.log_pos || tries === 3) {
      const conn = await control(w.hub);
      return { why, status, events: await allEvents(conn).finally(() => conn.close()), asked };
    }
  }
}
/** The app's rows: the replica's, over a copy of the record as it stands now. */
async function appRows(w: World): Promise<Seen> {
  const r = await Replica.of(w);
  try { return await r.see(); } finally { await r.stop(); }
}

/** What the fixture session reads as, of the four the criterion names: a state word, or the flag beside one. */
const READS: Record<'working' | 'quiet' | 'saysdone' | 'interrupted', { reads: string; word?: string }> = {
  working: { reads: 'working', word: 'working' },
  quiet: { reads: 'quiet', word: 'quiet' },
  saysdone: { reads: 'says done', word: 'says done' },
  interrupted: { reads: 'interrupted' },
};

describe(ID.why, () => {
  for (const key of ['working', 'quiet', 'saysdone', 'interrupted'] as const) {
    const { reads, word } = READS[key];
    test(`${ID.why}: for a session reading ${reads}, every fact --why names exists at its log_pos, and recomputing the state from only those facts gives the same word`, async () => {
      const w = await world();
      const s = w.sessions[key]!;
      const { why, status, events, asked } = await read(w, s.id);
      const text = (await deep(w, ['status'])).stdout;
      const row = rowOf(status.rows, s.id);
      console.log(`${key} ${s.id}: --why ${JSON.stringify(why).slice(0, 900)}`);
      const out = whyFailures(why, row, events, s.id);
      const seen = await appRows(w);
      // The fixture session reads as the criterion names it: its state a row of the one table, and for the turn you
      // interrupted, that flag beside its state, in its line, its why or its row in the app's list.
      const line = word ? '' : blockOf(text, TITLES.interrupted);
      out.push(...stateFailures(status.rows, [s.id], 'deep status --json'));
      if (word && row?.word !== word) out.push(`the fixture's ${reads} session ${s.id} (row session:${s.id}) reads ${JSON.stringify(row?.word)}`);
      const drawn = wordsOf(seen.snapshot, byId(seen.snapshot, `session:${s.id}`));
      if (!word && !/\binterrupted\b/.test(`${line}\n${why.why}\n${drawn}`)) out.push(`the fixture's session ${s.id} (row session:${s.id}), whose turn you interrupted, doesn't read interrupted: its line is ${JSON.stringify(line)}, its why ${JSON.stringify(why.why)} and its row in the app's list ${JSON.stringify(drawn)}`);
      if (why.log_pos !== status.log_pos) out.push(`session ${s.id}: --why read log_pos ${why.log_pos} and deep status --json ${status.log_pos}, with the hub quiet`);
      // The same sentence as text, with each fact; and as the app's row has it.
      const printed = await deep(w, ['status', s.id, '--why']);
      if (printed.code !== 0) out.push(`deep status ${s.id} --why exits ${printed.code}: ${printed.stderr.slice(0, 200)}`);
      out.push(...whyTextFailures(printed.stdout, why, s.id));
      const app = rowOf(seen.rows, s.id);
      if (ageless(String(app?.why)) !== ageless(String(why.why))) out.push(`session ${s.id} (row session:${s.id}): the app's row says why ${JSON.stringify(app?.why)}, and --why ${JSON.stringify(why.why)}`);
      // Only those facts, in a record of their own, read by a hub at the moment --why was asked.
      if (Array.isArray(why.facts) && why.facts.length) out.push(...recomputeFailures(why, await recompute(w, why.facts.map((f) => f.log_pos), s.id, asked), s.id));
      none(out, `--why for the session reading ${reads}`);
    }, 30 * MIN);
  }

  test(`${ID.why}: a planted --why built from a separate reading, which says "quiet" for a row the table reads as working, fails, naming the session and the row`, async () => {
    const w = await world();
    const s = w.sessions.working!;
    const { why: planted, status, events } = await read(w, s.id, 'why-second-reading');
    const failures = whyFailures(planted, rowOf(status.rows, s.id), events, s.id);
    expect(failures.some((f) => f.startsWith(`session ${s.id} (row session:${s.id}): --why says "quiet" for a row the table reads as "working"`)), `DEEP_HUB_PLANT=why-second-reading must fail naming the session and the row: ${JSON.stringify(failures)}`).toBe(true);
  }, 30 * MIN);
});

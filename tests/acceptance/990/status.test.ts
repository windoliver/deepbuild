// AC4: a test program that sends the program-status query and then reports working, blocked and done shows those three
// readings on its session's row in order, and the session's state and verdict don't change because of them; a planted
// reading that sets the state fails, naming the reading.
//
// The session's terminal (the one the hub hosts for session alpha: `terminal_open` with `session`, #402) runs a real Node
// program on a real PTY through `deep-show serve`, with a real record (SQLite, @deepbuild/record's file, the setup's
// `record`). The record already holds alpha's start and a permission prompt from its hooks (its state: waiting) and a
// recorded verdict. The program writes OSC 7501's query and waits up to 2 s for the answer, then reports working,
// blocked and done (README: OSC 7501, the form assumed). A session's row reads its readings and its state from the
// record's session view (`record.session(id)`: `readings` from `session.reading` events, `status`), read here after the
// record replays its log (`rebuild`), so the row is what the log says.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { fixtures } from '../../../packages/contracts/src/index.ts';
import type { JsonValue } from '../../../packages/contracts/src/index.ts';
import { openRecord, ulid } from '../../../packages/record/src/index.ts';
import type { Connection, EventInput } from '../../../packages/record/src/index.ts';
import { recordVerdict, verdict } from '../../../packages/verdicts/src/index.ts';
import { check, claim, commitOf, run } from '../28/helpers.ts';
import { ALPHA, ESC, SESSIONS, fileText, openedOf, script, setupOf, tmp, useShow, waitFor, withServe, type JsonObject } from './helpers.ts';

const show = useShow();
const ST = `${ESC}\\`;
const QUERY = `${ESC}]7501;?${ST}`;
const REPORTS = [`${ESC}]7501;working${ST}`, `${ESC}]7501;blocked;waiting on your review${ST}`, `${ESC}]7501;done${ST}`];
const WORDS = ['working', 'blocked', 'done'] as const;
const STATE_KINDS = new Set(['session.attention', 'session.state', 'agent.stop', 'user.ask', 'permission.request', 'claim.made', 'verdict.made', 'verdict.stale']);

const hook: Connection = { writer: 'hook', actor: 'you', scope: 'you', session: ALPHA.id };
const data = (kind: string): Record<string, JsonValue> => (fixtures(`${kind}@1`)[0] as { data: Record<string, JsonValue> }).data;
const ev = (kind: string, at: number, seq?: string): EventInput => ({ v: 1, id: ulid(at), kind, ts: at, ...(seq ? { seq } : {}), data: data(kind) } as EventInput);

interface Ev { log_pos: number; kind: string; session_id: string | null; subject: string | null; data: string }
function eventsAfter(path: string, after: number): Ev[] {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try { return db.prepare('SELECT log_pos, kind, session_id, subject, data FROM events WHERE log_pos > ? ORDER BY log_pos').all(after) as Ev[]; } finally { db.close(); }
}
const aboutAlpha = (e: Ev): boolean => e.session_id === ALPHA.id || String(e.subject ?? '').replace(/[^0-9A-Za-z]/g, '') === `session${ALPHA.id.replace(/[^0-9A-Za-z]/g, '')}`;

interface Played { answered: string; readings: string[]; before: { status: string; verdicts: string; readings: string[] }; status: string; verdicts: string; added: Ev[] }

async function play(bin: string, planted?: string): Promise<Played> {
  const dir = tmp('status');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'record.db');
  const t0 = Date.now() - 60_000;
  const seeded = await openRecord({ path, now: () => Date.now() });
  await seeded.append(hook, ev('session.start', t0));
  await seeded.append(hook, { ...ev('permission.request', t0 + 10, `${BigInt(t0 + 10) * 1_000_000n}`), subject: `session:${ALPHA.id.replace(/[^0-9A-Za-z]/g, '')}` } as EventInput);
  const unit = check('unit:billing-totals');
  const commit = commitOf('990-status');
  await recordVerdict(seeded, verdict(claim({ commit, checks: [unit], runs: [run(unit, commit, 'passed')] })), t0 + 20);
  const view0 = await seeded.session(ALPHA.id);
  const before = { status: String(view0?.status), verdicts: JSON.stringify((await seeded.table('verdicts')).rows, (_, v) => (typeof v === 'bigint' ? Number(v) : v)), readings: view0?.readings ?? [] };
  const last = eventsAfter(path, 0).at(-1)!.log_pos;
  await seeded.close();

  const log = join(dir, 'in.log');
  const answered = await withServe(bin, { ...setupOf({ evidence: dir, sessions: SESSIONS, ...(planted ? { planted } : {}) }), record: path }, async (s) => {
    const o = openedOf(await s.call({ call: 'terminal_open', terminal: 'TS', session: ALPHA.id, cols: 120, rows: 36, program: script(dir, 'status', log, { query: QUERY, reports: REPORTS }) }, 120_000), 'alpha\'s terminal');
    for (const p of [o.host, o.program]) if (p) s.known.add(p.pid);
    await waitFor(() => fileText(`${log}.done`), (t) => t !== '', 60_000);
    // The three readings reach the record.
    await waitFor(() => eventsAfter(path, last).filter((e) => e.kind === 'session.reading' && aboutAlpha(e)).length, (n) => n >= 3, 30_000, 200);
    return fileText(`${log}.answered`);
  });

  const after = await openRecord({ path, now: () => Date.now() });
  try {
    await after.rebuild();
    const view = await after.session(ALPHA.id);
    const readings = (view?.readings ?? []).filter((r) => !before.readings.includes(r));
    return {
      answered, readings, before, status: String(view?.status),
      verdicts: JSON.stringify((await after.table('verdicts')).rows, (_, v) => (typeof v === 'bigint' ? Number(v) : v)), added: eventsAfter(path, last),
    };
  } finally {
    await after.close();
  }
}

/** The program-status readings among the new ones, by the state word each holds, in order. */
const statusWords = (readings: string[]): string[] => readings.map((r) => /\b(working|blocked|done|failed)\b/i.exec(r)?.[1]?.toLowerCase()).filter((w): w is string => !!w);

/** What "three readings in order; state and verdict unchanged" asks; a state change names the reading behind it. */
function statusProblems(p: Played): string[] {
  const f: string[] = [];
  if (p.answered !== 'yes') f.push('the program-status query (OSC 7501 ; ?) got no answer in 2 s');
  const words = statusWords(p.readings);
  if (JSON.stringify(words) !== JSON.stringify(WORDS)) f.push(`the session's row shows the readings ${JSON.stringify(p.readings)}, not working, blocked and done in order`);
  const readingsSoFar: string[] = [];
  for (const e of p.added) {
    if (e.kind === 'session.reading' && aboutAlpha(e)) { readingsSoFar.push(String((JSON.parse(e.data) as JsonObject)['reading'] ?? '')); continue; }
    if (STATE_KINDS.has(e.kind) && (aboutAlpha(e) || e.kind.startsWith('verdict.') || e.kind === 'claim.made')) {
      const behind = readingsSoFar.at(-1);
      f.push(`the reading ${behind === undefined ? '(none yet)' : JSON.stringify(behind)} was followed by ${e.kind} ${e.data.slice(0, 120)}: a reading moved the session's state or verdict`);
    }
  }
  if (p.status !== p.before.status) {
    const word = statusWords(p.readings).find((w) => p.status.toLowerCase().includes(w) || (w === 'done' && p.status === 'finished') || (w === 'blocked' && p.status === 'stuck')) ?? statusWords(p.readings).at(-1);
    f.push(`the session's state is ${p.status}, not ${p.before.status}: the reading "${word ?? '?'}" set it`);
  }
  if (p.verdicts !== p.before.verdicts) f.push('the session\'s verdicts changed while only readings arrived');
  return f;
}

describe('AC4 program status: readings on the session\'s row, signal only', () => {
  it('AC4 a program that sends the OSC 7501 query and then reports working, blocked and done gets an answer, and its session\'s row shows the three readings in order; the session\'s state (waiting) and its verdict are unchanged', async () => {
    const p = await play(show());
    expect(p.before.status, 'the session was waiting on a permission prompt before').toBe('waiting');
    expect(p.before.verdicts.length > 2, 'a verdict was recorded before').toBe(true);
    expect(statusProblems(p), 'three readings in order, nothing else moved').toEqual([]);
  }, 600_000);

  it('AC4 a planted reading that sets the state fails, naming the reading', async () => {
    const p = await play(show(), 'status_sets_state');
    const f = statusProblems(p);
    expect(f.some((m) => /the reading "[^"]*\b(working|blocked|done)\b/.test(m)), `the planted status_sets_state fails, naming the reading: ${JSON.stringify(f)}`).toBe(true);
  }, 600_000);
});

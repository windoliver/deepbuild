// AC2 #992.34978db2: a session whose terminal closed while its permission prompt showed, with the agent's process gone,
// reads flagged, process gone mid-turn, within 5 s, in `deep status` and on the sidebar; a planted reading that checks
// waiting first reads needs you. Each case runs on this suite's stand-in session and then on the corpus's recording.
// The sidebar is the app's row in the replica (app.rs, README: The app's side), which runs on macOS.
import { afterAll, describe, expect, test } from 'vitest';
import { AC2, appRows, cleanup, forApp, hookOf, label, MOVED_ON, mustRecord, mustTag, nothingAfter, type Recorded, replay, type Replay, standIn, type StatusRead, statusWithin, wordOf } from './helpers.ts';

afterAll(cleanup);

const WITHIN = 5_000;
const GONE = /process(?: is)? gone mid-turn/i;
const flagged = (s: StatusRead) => s.state === 'flagged' && GONE.test(s.why);

/** The recording is the criterion's case: a PermissionRequest tagged permission-terminal-closed, then no hook that moves on. */
function closed(r: Recorded): void {
  const at = mustTag(r, 'permission-terminal-closed', 'PermissionRequest');
  nothingAfter(r, at, (l) => MOVED_ON.includes(hookOf(l)), 'a permission prompt left open while its terminal closed');
}

/** Replays the session with its agent alive, then the terminal closes: the agent's process is killed and gone. */
async function closeUnder(r: Recorded, plant?: string): Promise<{ rp: Replay; read: StatusRead; ms: number }> {
  closed(r);
  const rp = await replay(r, { plant });
  const gone = await rp.agent.kill();
  const read = await statusWithin(rp.h, rp.session, WITHIN - (Date.now() - gone), flagged, plant);
  return { rp, read, ms: Date.now() - gone };
}

const said = (r: Recorded, rp: Replay, read: StatusRead, ms: number) =>
  `${label(r)}: session ${rp.session}, its terminal closed while its permission prompt showed and its agent's process (pid ${rp.agent.pid}) gone, reads ${read.state ?? 'no row'}${read.why ? ` (${read.why})` : ''} in deep status ${ms} ms on, not flagged, process gone mid-turn:\n${read.text}`;

describe(AC2, () => {
  test(`${AC2}: with the agent's process gone, deep status reads the session flagged, process gone mid-turn, within 5 s; a planted reading that checks waiting first reads needs you`, async () => {
    for (const r of [standIn('permission-terminal-closed'), () => mustRecord('permission-terminal-closed', 'a permission prompt left open while its terminal closed')]) {
      const session = typeof r === 'function' ? r() : r;
      const { rp, read, ms } = await closeUnder(session);
      expect(read.state, said(session, rp, read, ms)).toBe('flagged');
      expect(read.why, said(session, rp, read, ms)).toMatch(GONE);
      expect(ms, said(session, rp, read, ms)).toBeLessThanOrEqual(WITHIN + 1_000);
    }
    // The planted reading: gone is recorded, but waiting is checked first.
    const planted = await closeUnder(standIn('permission-terminal-closed'), 'waiting-first');
    expect(planted.read.state, `with DEEP_HUB_PLANT=waiting-first, session ${planted.rp.session} must read needs you in deep status, as a reading that checks waiting first does:\n${planted.read.text}`).toBe('needs you');
  }, 240_000);

  test(`${AC2}: with the agent's process gone, the sidebar reads the session flagged, process gone mid-turn, within 5 s, as deep status does; a planted reading that checks waiting first reads needs you there too`, async () => {
    for (const r of [standIn('permission-terminal-closed'), () => mustRecord('permission-terminal-closed', 'a permission prompt left open while its terminal closed')]) {
      const session = typeof r === 'function' ? r() : r;
      const { rp, read, ms } = await closeUnder(session);
      // The record as it stood once deep status read it, at most 5 s after the process went: what the app had to draw from.
      const rows = await appRows([await forApp(rp)]);
      const row = rows.get(session.name)!.row;
      const what = `${label(session)}: session ${rp.session}, its agent's process gone ${ms} ms before, reads "${row}" on the sidebar, not flagged, process gone mid-turn (deep status read ${read.state ?? 'no row'}${read.why ? ` (${read.why})` : ''})`;
      expect(wordOf(row), what).toBe('flagged');
      expect(row, what).toMatch(GONE);
    }
    const planted = await closeUnder(standIn('permission-terminal-closed'), 'waiting-first');
    const rows = await appRows([await forApp(planted.rp)], { plant: 'waiting-first' });
    const row = rows.get('permission-terminal-closed')!.row;
    expect(wordOf(row), `with DEEP_HUB_PLANT=waiting-first, session ${planted.rp.session} must read needs you on the sidebar too, as a reading that checks waiting first does: "${row}"`).toBe('needs you');
  }, 1_800_000);
});

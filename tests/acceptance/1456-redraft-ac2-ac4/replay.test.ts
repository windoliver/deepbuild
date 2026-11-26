// AC2 #1456.f70bc414: "A record written before this change, replayed, gives the same states as the merge base".
//
// fixtures/ledger.db is a record the merge base's hub wrote (README, The record): eight sessions, six of them with the
// reading text the base decides a state or a flag by (hooks that can't run, hooks that run again, a monitor waited on,
// a monitor that ended, an interrupt, a denied call that ran anyway) and two with none. Its readings carry no code:
// they were written before there was one. fixtures/base-states.json is what the merge base's `deep status --json` read
// from it at one hub clock. The hub under test opens a copy, after the record replays it (every projection rebuilt
// from the log), and its `deep status --json` at the same clock must give every session the same state: its word, its
// status-map entry, whom it waits on, whether it reads unread, its flag, and the state table's row that matched. A
// session that moved is named.
//
// With DEEPBUILD_1456_MAKE_RECORD=1 the second block writes both fixtures from the checkout it runs in; it ran once, at
// the merge base (README), and is skipped otherwise.
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { BASE_STATES, type BaseStates, cleanup, ID, makeRecord, moved, openCopy, readStates, stopHub } from './helpers.ts';

afterAll(cleanup, 60_000);

describe(ID.replay, () => {
  it(`${ID.replay}: a record the merge base wrote, replayed, gives every session the state the merge base read`, async () => {
    const base = JSON.parse(readFileSync(BASE_STATES, 'utf8')) as BaseStates;
    const hub = await openCopy(base.readAt);
    try {
      const read = await readStates(hub.home, base.sessions.map((s) => s.id));
      const states = base.sessions.map((s) => `${s.key}: ${String(read.get(s.id)?.word ?? 'no row')} by ${String(read.get(s.id)?.rule ?? 'no row')} (base ${String(s.row.word)} by ${String(s.row.rule)})`);
      console.log(`${base.sessions.length} sessions of the record ${base.base.slice(0, 9)} wrote, replayed: ${states.join('; ')}`);
      expect(moved(base, read), `the sessions whose state moved from the merge base's (${base.base.slice(0, 9)}) on replay`).toEqual([]);
    } finally {
      await stopHub(hub);
    }
  }, 180_000);
});

describe.skipIf(process.env.DEEPBUILD_1456_MAKE_RECORD !== '1')('writes fixtures/ledger.db and fixtures/base-states.json from this checkout (run once, at the merge base)', () => {
  it('writes the record and the states its deep status --json reads', async () => {
    const base = process.env.DEEPBUILD_1456_BASE;
    if (!base) throw Error('set DEEPBUILD_1456_BASE to the commit this checkout is');
    const states = await makeRecord(base);
    console.log(JSON.stringify(states.sessions.map((s) => [s.key, s.row])));
  }, 180_000);
});

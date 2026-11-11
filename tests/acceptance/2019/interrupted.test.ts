// AC1 #2019.3052d233: a session stopped by a usage limit shows as interrupted, with what it was doing and when it can
// pick up; an idle session with unpushed commits is flagged.
// AC2 #2019.92d09557: a session whose adapter can't be read reads quiet, never interrupted; one the session map shows
// exited mid-turn reads interrupted.
//
// The Proof's fixture (helpers.ts, `mainWorld`): 30 sessions across cart, docs and search, read by a real hub through
// `deep status --json`, and drawn by the replica at the reference window over a copy of its record. Each flag is the
// row's `flag` and its right slot, `session:<id>:flag` (README, Pinned 1).
import { afterAll, describe, test } from 'vitest';
import {
  cleanup, drawn, drawnFlagFailures, drawnNotFailures, exitedFailures, flagOf, ID, idOf, interruptedFailures, LIMITED, mainWorld, MIN, none, quietFailures, rowOf, statusRows,
  unpushedFailures, type Main, type Seen,
} from './helpers.ts';

afterAll(cleanup, 120_000);
let made: Promise<Main> | undefined;
const world = (): Promise<Main> => (made ??= mainWorld());
let seen: Promise<Seen> | undefined;
/** The app's list over the fixture, read once for both criteria. */
const app = (w: Main): Promise<Seen> => (seen ??= drawn(w));
const UNPUSHED = /unpushed|not pushed|not on any remote/i;

describe(ID.interrupted, () => {
  test(`${ID.interrupted}: a session stopped by a usage limit shows as interrupted, with what it was doing and when it can pick up; an idle session with unpushed commits is flagged`, async () => {
    const w = await world();
    const rows = (await statusRows(w)).rows;
    const [limited, unpushed, pushed] = (['limited', 'unpushed', 'pushed'] as const).map((key) => idOf(w, key));
    const out = [
      ...interruptedFailures(rowOf(rows, limited!), limited!, { doing: [LIMITED.prompt, LIMITED.command], until: w.resets }),
      ...unpushedFailures(rowOf(rows, unpushed!), unpushed!, true),
      ...unpushedFailures(rowOf(rows, pushed!), pushed!, false),
    ];
    // A flag comes from the session's own records: none of the other sessions met a limit or made a commit.
    for (const key of w.fillers) {
      const id = idOf(w, key);
      const code = flagOf(rowOf(rows, id))?.code;
      if (code === 'interrupted' || code === 'unpushed') out.push(`session ${id} (row session:${id}), which met no limit, didn't exit and made no commit, shows the flag ${code}`);
    }
    const s = (await app(w)).snapshot;
    out.push(...drawnFlagFailures(s, limited!, /interrupted/), ...drawnFlagFailures(s, unpushed!, UNPUSHED), ...drawnNotFailures(s, pushed!, UNPUSHED, 'its one commit is on origin/main'));
    none(out, 'the usage-limited session and the idle sessions with commits, in deep status --json and the app\'s list');
  }, 30 * MIN);
});

describe(ID.quiet, () => {
  test(`${ID.quiet}: a session whose adapter can't be read reads quiet, never interrupted; one the session map shows exited mid-turn reads interrupted`, async () => {
    const w = await world();
    const rows = (await statusRows(w)).rows;
    const [unreadable, exited] = (['unreadable', 'exited'] as const).map((key) => idOf(w, key));
    const out = [...quietFailures(rowOf(rows, unreadable!), unreadable!), ...exitedFailures(rowOf(rows, exited!), exited!)];
    const s = (await app(w)).snapshot;
    out.push(...drawnFlagFailures(s, exited!, /interrupted/), ...drawnNotFailures(s, unreadable!, /interrupted/i, 'its adapter can\'t be read, so it is never interrupted'));
    none(out, 'the session that can\'t be read and the one that exited mid-turn');
  }, 30 * MIN);
});

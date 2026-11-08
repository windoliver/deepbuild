// AC4 #1337.092487e3, its first half: "An existing one-person record opens unchanged" (the second half, the merge-base
// comparison of the one-person e2e runs, is visible.test.ts).
//
// fixtures/one-person/ledger.db is a record the base's hub wrote (README, AC4): maya alone, every event stamped as
// today, `actor: "you"`, two sessions, one in a clone of acme/shop (a remote) and one in a repo with no remote.
// fixtures/one-person/read.json is what the base's hub reads back from it when it opens it again: every event it held
// (events.read) and those sessions' rows (sessions.read). The hub under test opens a copy of the same record, and its
// owner's read must hold each of those events exactly as the base read it, and each session row's identity unchanged.
// Then the hub must be the one with people in it (a second person can be added): until then the criterion, which is
// about opening an old record with that hub, isn't yet a question, and the test reads BLOCKED, never PASS.
//
// With DEEPBUILD_1337_MAKE_RECORD=1 the second block writes the two fixtures from the checkout it runs in; it ran once,
// at the base (README, AC4), and is skipped otherwise.
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { openRecord } from '../../../packages/record/src/index.ts';
import { addPerson, cleanup, git, HERE, owner, readWith, REPO, settled, stopHub, tempDir, work, world, type Ev, type Line } from './helpers.ts';

afterAll(cleanup);

const FIXTURE = join(HERE, 'fixtures', 'one-person');
const LEDGER = join(FIXTURE, 'ledger.db');
const READ = join(FIXTURE, 'read.json');
/** A session row's identity: what opening a record must leave as it was. */
const SESSION_FIELDS = ['id', 'agent', 'project_id', 'worktree', 'branch', 'thread_id', 'parent_id'];
interface Expected { base: string; made: string; events: Ev[]; sessions: Line[] }

/** The fields of two values that differ, for a failure message. */
function differing(a: Line, b: Line | undefined): string[] {
  if (!b) return ['(missing)'];
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

describe('AC4 #1337.092487e3 an existing one-person record opens unchanged', () => {
  it('AC4 #1337.092487e3 a one-person record the base wrote opens with every event and session as the base reads them, under a hub that has people', async () => {
    const expected = JSON.parse(readFileSync(READ, 'utf8')) as Expected;
    const w = await world({ ledger: LEDGER });
    const read = await settled(w, expected.events.map((e) => e.id));
    const events = new Map(read.events.map((e) => [e.id, e]));
    for (const e of expected.events) {
      const got = events.get(e.id);
      const diff = differing(e as unknown as Line, got as unknown as Line | undefined);
      expect(got, `event ${e.id} (${e.kind}, log_pos ${e.log_pos}, actor ${JSON.stringify(e.actor)}) reads back changed in ${diff.join(', ')}: base ${JSON.stringify(Object.fromEntries(diff.map((k) => [k, (e as unknown as Line)[k]])))}, now ${JSON.stringify(got && Object.fromEntries(diff.map((k) => [k, (got as unknown as Line)[k]])))}`).toEqual(e);
    }
    const rows = new Map(read.sessions.map((r) => [String(r.id), r]));
    for (const row of expected.sessions) {
      const got = rows.get(String(row.id));
      const pick = (r: Line | undefined) => r && Object.fromEntries(SESSION_FIELDS.filter((k) => k in row).map((k) => [k, r[k]]));
      expect(pick(got), `session ${String(row.id)}'s row reads back changed`).toEqual(pick(row));
    }
    console.log(`${expected.events.length} events and ${expected.sessions.length} session rows the base wrote (${expected.base.slice(0, 8)}) read back unchanged`);

    const added = await addPerson(w, 'bob', w.repos.shop);
    if (!added.ok) throw Error(`BLOCKED: the hub under test adds no second person (person.add answered ${added.refused}), so it is not yet the hub with people the criterion opens an old record with; the record read back unchanged, which proves nothing until then`);
  }, 120_000);
});

describe.skipIf(process.env.DEEPBUILD_1337_MAKE_RECORD !== '1')('writes fixtures/one-person from this checkout (run once, at the base)', () => {
  it('writes ledger.db and read.json', async () => {
    // The record: maya alone, two sessions, every hook of a turn.
    const w = await world();
    const events = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'];
    const shop = await work(w, { home: w.maya, cwd: w.repos.shop, events });
    const scratch = await work(w, { home: w.maya, cwd: w.repos.scratch, events });
    const ids = [...shop.sent, ...scratch.sent].map((s) => s.id);
    const live = await settled(w, ids);
    for (const id of ids) expect(live.events.some((e) => e.id === id), `event ${id} reached the record`).toBe(true);
    await stopHub(w.hub);
    const ledger = join(w.hub.root, 'ledger.db');
    expect(!existsSync(`${ledger}-wal`) || statSync(`${ledger}-wal`).size === 0, 'the hub stopped cleanly, its WAL folded into ledger.db').toBe(true);
    mkdirSync(FIXTURE, { recursive: true });
    copyFileSync(ledger, LEDGER);

    // Its last log position, read with the hub down from a copy (the record's public entry).
    const copy = join(tempDir(), 'ledger.db');
    copyFileSync(LEDGER, copy);
    const record = await openRecord({ path: copy, now: () => Date.now() });
    let last = 0;
    try {
      for (;;) {
        const page = await record.read({ after: last, limit: 1000 });
        if (!page.length) break;
        last = page[page.length - 1]!.log_pos;
      }
    } finally {
      await record.close();
    }

    // What this checkout's hub reads back when it opens the record again.
    const again = await world({ ledger: LEDGER });
    const conn = await owner(again);
    let read;
    try {
      read = await readWith(conn);
    } finally {
      conn.close();
    }
    const held = read.events.filter((e) => e.log_pos <= last);
    const sessions = new Set(held.map((e) => e.session).filter(Boolean));
    const expected: Expected = {
      base: git(REPO, 'rev-parse', 'HEAD').trim(),
      made: new Date().toISOString(),
      events: held,
      sessions: read.sessions.filter((r) => sessions.has(String(r.id))),
    };
    expect(expected.events.every((e) => e.actor === 'you'), 'a one-person record: every event is stamped you').toBe(true);
    writeFileSync(READ, `${JSON.stringify(expected, null, 2)}\n`);
  }, 180_000);
});

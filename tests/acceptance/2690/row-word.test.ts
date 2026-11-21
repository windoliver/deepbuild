// Blind acceptance tests for #2690 (README.md here): an open ask's row says one word in `deep`, in the hub's list row and
// in the app's drawn row, and the app still draws the ask's kind in the row's state-word slot (#1461 AC27).
//
// The world is a record a real hub built (#1461's `makeWorld`): three open asks of three kinds, an approval (a push, with
// its plan), a taste call and a choice. The readers are the real ones: the hub's `row.set` events through `events.read`
// (#1463's `allEventsOf`), `deep status --json` and `deep` from the built CLI, and the real `deep-drive` launched with
// `launch.from: "record_copy"` in the world's HOME (#1461's `replicaOf`). The drawn row is judged by #1463's
// `drawnFailures`, the rule #1810's redraft applies, so its failure reads as the issue quotes it.
//
// Safety: every HOME is a temp folder; processes are stopped only by the PID they were started with (#16's cleanup).
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, deep, jsonRows, makeWorld, MIN, replicaOf, runsIn, slot, type Row, type SessionSpec, type Snapshot, type SNode, type World } from '../1461/helpers.ts';
import { allEventsOf, drawnFailures, shown, textRowFailures, type Snapshot as Snapshot1463 } from '../1463/helpers.ts';

afterAll(() => cleanup(), MIN);

/** The criteria, by `#2690.<first 8 hex of SHA-256(text, whitespace collapsed)>` (scripts/proof-change.mjs, criterionId). */
const ID = {
  agree: '#2690.50174a03',
  kind: '#2690.9af6aab5',
} as const;

/** Three projects' sessions, with three open asks of three kinds (#1461 AC27's two and the issue's `How it looks`). */
const SPECS: SessionSpec[] = [
  { key: 'push', project: 'shop', title: 'Release 1.4', state: 'finished', asks: [{ kind: 'authority', question: 'Push release-1.4 to origin?', plan: { does: 'git push origin release-1.4', changes: ['origin/release-1.4'] } }] },
  { key: 'login', project: 'shop', title: 'Login page', state: 'finished', asks: [{ kind: 'taste', question: 'Which header colour on the login page?' }] },
  { key: 'cart', project: 'docs', title: 'Cart store', state: 'finished', asks: [{ kind: 'choice', question: 'Keep the cart on SQLite or plain files?' }] },
  { key: 'search', project: 'search', title: 'Search index' },
];
/** Each kind's word as the app's card and row name it (crates/deep-app/copy/en.json, `kinds.plain_*`; kinds.rs `Kind::of`). */
const KIND_WORD: Record<string, string> = { authority: 'Approval', taste: 'How it looks', choice: 'Pick one' };

let made: Promise<World> | undefined;
const world = (): Promise<World> => (made ??= makeWorld(SPECS));

/** Each open ask's list row as the hub last wrote it: the latest `row.set` per ask id, while it is listed. */
async function hubAskRows(w: World): Promise<Map<string, Row>> {
  const rows = new Map<string, Row>();
  for (const e of await allEventsOf(w)) {
    if (e.kind !== 'row.set') continue;
    const data = e.data as unknown as Row & { listed?: boolean };
    if (typeof data.id !== 'string' || !data.id.startsWith('ask:')) continue;
    if (data.listed === false) rows.delete(data.id);
    else rows.set(data.id, data);
  }
  return rows;
}

/** The fixture's asks' hub rows, in the fixture's order; a missing or wordless row fails, naming the ask. */
async function fixtureRows(w: World): Promise<Row[]> {
  const hub = await hubAskRows(w);
  const missing = w.asks.filter((a) => !hub.has(a.handle)).map((a) => `ask ${a.handle} ("${a.question}") has no listed row.set in the hub's record`);
  expect(missing, 'the hub writes a list row for each open ask').toEqual([]);
  const rows = w.asks.map((a) => hub.get(a.handle)!);
  const wordless = rows.filter((r) => typeof r.word !== 'string' || !r.word.trim() || r.word === r.title).map((r) => `the hub's row ${r.id} ("${r.title}") has word ${JSON.stringify(r.word)}, no state word`);
  expect(wordless, "each open ask's hub row carries a word of its own").toEqual([]);
  return rows;
}

/** What a slot draws: the strings drawn inside its bounds, else its accessible name (#1461's redraft, Pinned 2). */
function slotWord(s: Snapshot, n: SNode | undefined): string {
  if (!n) return '';
  return (runsIn(s, n.bounds).map((r) => r.text).join(' ') || n.name || '').replace(/\s+/g, ' ').trim();
}

/** Each open ask whose row's state-word slot doesn't draw its kind's word, naming the row and what it drew. */
function kindFailures(s: Snapshot, w: World): string[] {
  return w.asks.flatMap((a) => {
    const want = KIND_WORD[a.kind]!;
    const got = slotWord(s, slot(s, a.handle, 'word'));
    return got.toLowerCase() === want.toLowerCase() ? [] : [`row ${a.handle} ("${a.question}", a ${a.kind} ask) draws "${got}" in ${a.handle}:word, not its kind "${want}"`];
  });
}

const seen = new Map<string, Promise<Snapshot>>();
/** The app's window over the world's record, half a second after launch, plain or with `plant`. */
function windowOf(w: World, plant?: string): Promise<Snapshot> {
  let got = seen.get(plant ?? '');
  if (!got) {
    got = (async () => {
      const r = await replicaOf(w, {}, plant);
      try {
        await r.wait(500);
        return (await r.see()).snapshot;
      } finally {
        await r.stop();
      }
    })();
    seen.set(plant ?? '', got);
  }
  return got;
}

describe(`${ID.agree} \`deep\`, the hub's list row and the app's drawn row agree on an open ask's word`, () => {
  it(`${ID.agree}: each open ask's word in the hub's row.set is the word deep status --json, deep and the app's drawn row give it`, async () => {
    const w = await world();
    const hub = await fixtureRows(w);
    console.log(`the hub's ask rows: ${hub.map((r) => `${r.id} "${r.title}" word "${r.word}"`).join('; ')}`);

    // deep status --json: the same word on the same row.
    const status = await jsonRows(w, 'status');
    const byId = new Map(status.rows.map((r) => [r.id, r]));
    const statusFailures = hub.flatMap((r) => {
      const o = byId.get(r.id);
      if (!o) return [`row ${r.id} ("${r.title}") is in the hub's row.set and not in deep status --json`];
      return o.word === r.word ? [] : [`row ${r.id} ("${r.title}") has word "${r.word}" in the hub's row.set and "${o.word}" in deep status --json`];
    });
    expect(statusFailures, "deep status --json and the hub's row.set, row by row").toEqual([]);

    // deep: each ask's line holds its question and the hub's word.
    const ran = await deep(w, []);
    expect(ran.code, `deep exits 0: ${shown(ran)}`).toBe(0);
    expect(textRowFailures(ran.stdout, hub, 'deep'), `deep's lines against the hub's rows: ${shown(ran)}`).toEqual([]);

    // The app's drawn row: the node carrying the ask's id holds the hub's word (macOS only; BLOCKED elsewhere).
    const s = await windowOf(w);
    expect(drawnFailures(s as unknown as Snapshot1463, hub), "the app's drawn ask rows against the hub's rows: each row's node holds the hub's word").toEqual([]);
  }, 30 * MIN);
});

describe(`${ID.kind} An open ask's row in the app still draws its kind in its state-word slot (#1461 AC27)`, () => {
  it(`${ID.kind}: each open ask's state-word slot draws its kind: Approval, How it looks, Pick one`, async () => {
    const w = await world();
    expect(kindFailures(await windowOf(w), w), "each open ask's <handle>:word slot against its kind").toEqual([]);
  }, 30 * MIN);

  it(`${ID.kind} wrong program: ask-words-alike, every ask row drawing "needs you" in its slot, fails naming each row`, async () => {
    const w = await world();
    const failures = kindFailures(await windowOf(w, 'ask-words-alike'), w);
    const unnamed = w.asks.filter((a) => !failures.some((f) => f.startsWith(`row ${a.handle} `))).map((a) => a.handle);
    expect(unnamed, `DEEP_HUB_PLANT=ask-words-alike must fail naming each ask row: ${JSON.stringify(failures)}`).toEqual([]);
  }, 30 * MIN);
});

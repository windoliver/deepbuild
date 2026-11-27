import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, deep, jsonRows, makeWorld, MIN, replicaOf, runsIn, slot, type Row, type SessionSpec, type Snapshot, type SNode, type World } from '../1461/helpers.ts';
import { allEventsOf, drawnFailures, shown, textRowFailures, type Snapshot as Snapshot1463 } from '../1463/helpers.ts';

afterAll(() => cleanup(), MIN);

const ID = {
  agree: '#2690.50174a03',
  kind: '#2690.9af6aab5',
} as const;

const SPECS: SessionSpec[] = [
  { key: 'push', project: 'shop', title: 'Release 1.4', state: 'finished', asks: [{ kind: 'authority', question: 'Push release-1.4 to origin?', plan: { does: 'git push origin release-1.4', changes: ['origin/release-1.4'] } }] },
  { key: 'login', project: 'shop', title: 'Login page', state: 'finished', asks: [{ kind: 'taste', question: 'Which header colour on the login page?' }] },
  { key: 'cart', project: 'docs', title: 'Cart store', state: 'finished', asks: [{ kind: 'choice', question: 'Keep the cart on SQLite or plain files?' }] },
  { key: 'search', project: 'search', title: 'Search index' },
];
const KIND_WORD: Record<string, string> = { authority: 'Approval', taste: 'How it looks', choice: 'Pick one' };

let made: Promise<World> | undefined;
const world = (): Promise<World> => (made ??= makeWorld(SPECS));

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

async function fixtureRows(w: World): Promise<Row[]> {
  const hub = await hubAskRows(w);
  const missing = w.asks.filter((a) => !hub.has(a.handle)).map((a) => `ask ${a.handle} ("${a.question}") has no listed row.set in the hub's record`);
  expect(missing, 'the hub writes a list row for each open ask').toEqual([]);
  const rows = w.asks.map((a) => hub.get(a.handle)!);
  const wordless = rows.filter((r) => typeof r.word !== 'string' || !r.word.trim() || r.word === r.title).map((r) => `the hub's row ${r.id} ("${r.title}") has word ${JSON.stringify(r.word)}, no state word`);
  expect(wordless, "each open ask's hub row carries a word of its own").toEqual([]);
  return rows;
}

function slotWord(s: Snapshot, n: SNode | undefined): string {
  if (!n) return '';
  return (runsIn(s, n.bounds).map((r) => r.text).join(' ') || n.name || '').replace(/\s+/g, ' ').trim();
}

function kindFailures(s: Snapshot, w: World): string[] {
  return w.asks.flatMap((a) => {
    const want = KIND_WORD[a.kind]!;
    const got = slotWord(s, slot(s, a.handle, 'word'));
    return got.toLowerCase() === want.toLowerCase() ? [] : [`row ${a.handle} ("${a.question}", a ${a.kind} ask) draws "${got}" in ${a.handle}:word, not its kind "${want}"`];
  });
}

const seen = new Map<string, Promise<Snapshot>>();
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

    const status = await jsonRows(w, 'status');
    const byId = new Map(status.rows.map((r) => [r.id, r]));
    const statusFailures = hub.flatMap((r) => {
      const o = byId.get(r.id);
      if (!o) return [`row ${r.id} ("${r.title}") is in the hub's row.set and not in deep status --json`];
      return o.word === r.word ? [] : [`row ${r.id} ("${r.title}") has word "${r.word}" in the hub's row.set and "${o.word}" in deep status --json`];
    });
    expect(statusFailures, "deep status --json and the hub's row.set, row by row").toEqual([]);

    const ran = await deep(w, []);
    expect(ran.code, `deep exits 0: ${shown(ran)}`).toBe(0);
    expect(textRowFailures(ran.stdout, hub, 'deep'), `deep's lines against the hub's rows: ${shown(ran)}`).toEqual([]);

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

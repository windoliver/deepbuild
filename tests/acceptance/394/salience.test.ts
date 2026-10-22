import { describe, expect, it } from 'vitest';
import { SALIENCE_BIN, TASTE_SOURCE, accepted, agent, arr, clone, expectBadInput, fixture, num, obj, openWorld, str, tasteAsk, useBinaries, type JsonObject } from './helpers.ts';

useBinaries('deep-salience');

const LEVEL = fixture('level-40.json');
const ITEMS = arr(LEVEL['items'], 'the fixture items').map((i) => obj(i, 'an item'));
const RANK_KEYS = ['needs_you', 'sent_back', 'failing', 'lacks_proof', 'touched', 'changed'] as const;

interface Shown { id: string; rank: number; reasons: string[] }
interface Level { shown: Shown[]; fold: { count: number; items: string[]; line: string } | null }

function level(items: JsonObject[], fits: number): Level {
  const out = accepted(SALIENCE_BIN, 'level', { level: LEVEL['level']!, fits, items });
  const shown = arr(out['shown'], 'shown').map((s, i) => {
    const o = obj(s, `shown[${i}]`);
    return { id: str(o['id'], `shown[${i}].id`), rank: num(o['rank'], `shown[${i}].rank`), reasons: arr(o['reasons'], `shown[${i}].reasons`).map((r) => str(r, 'a reason')) };
  });
  // The fold is one counted line, or null when nothing folds.
  const f = out['fold'];
  if (f === null) return { shown, fold: null };
  const fo = obj(f, 'fold');
  return { shown, fold: { count: num(fo['count'], 'fold.count'), items: arr(fo['items'], 'fold.items').map((x) => str(x, 'a folded item')), line: str(fo['line'], 'fold.line') } };
}

/** What a level shows and folds: exactly these items in this order, and the rest in one counted line. */
function expectLevel(got: Level, shown: string[], all: string[], what: string): void {
  expect(got.shown.map((s) => s.id), `${what}: shows exactly these items, ranked by what needs you`).toEqual(shown);
  for (let i = 1; i < got.shown.length; i++) {
    expect(got.shown[i]!.rank > got.shown[i - 1]!.rank, `${what}: each shown item's rank follows the one before`).toBe(true);
  }
  const rest = all.filter((id) => !shown.includes(id));
  expect(got.fold, `${what}: the rest fold into one counted line`).not.toBeNull();
  expect(got.fold!.count, `${what}: the fold counts the rest`).toBe(rest.length);
  expect([...got.fold!.items].sort(), `${what}: the fold holds exactly the rest, nothing shown twice or lost`).toEqual([...rest].sort());
  expect(got.fold!.line, `${what}: the fold's line is a sentence built from its count`).toMatch(new RegExp(`^${rest.length} more\\b`));
}

const ids = (items: JsonObject[]): string[] => items.map((i) => i['id'] as string);
const factsOf = (items: JsonObject[], id: string): JsonObject => obj(items.find((i) => i['id'] === id)!['facts'], `${id}'s facts`);

describe('AC3 a canvas level with 40 items shows exactly nine when nine fit at the minimum readable size, ranked by what needs you, and folds the rest into one counted line', () => {
  // The fixture's order by [needs you, sent back, failing, lacks proof, touched, changed, priority], then ID:
  // i-31 (needs you, failing), i-07, i-18 (needs you), i-02, i-25 (sent back), i-12 (failing, lacks proof),
  // i-09 (failing), i-33 (lacks proof, touched, changed), i-20 (lacks proof, changed), then i-04, i-27, …
  const TOP_NINE = ['i-31', 'i-07', 'i-18', 'i-02', 'i-25', 'i-12', 'i-09', 'i-33', 'i-20'];

  it('AC3 with nine fitting, the level shows exactly the top nine in rank order and folds the other 31 into one counted line', () => {
    const got = level(ITEMS, 9);
    // A program that shows items in ID or input order, ranks by how many facts hold (i-33 has three), or lists
    // all 40 fails here.
    expectLevel(got, TOP_NINE, ids(ITEMS), '40 items, nine fit');
    for (const s of got.shown) {
      const facts = factsOf(ITEMS, s.id);
      expect([...s.reasons].sort(), `${s.id}'s reasons are the rank keys that hold for it`).toEqual(RANK_KEYS.filter((k) => facts[k] === true).sort());
    }
  });

  it('AC3 room for all 40 still shows nine: show is 9 unless fewer fit', () => {
    expectLevel(level(ITEMS, 40), TOP_NINE, ids(ITEMS), '40 items, all fit');
  });

  it('AC3 with five fitting at the minimum readable size, show is lowered to five', () => {
    expectLevel(level(ITEMS, 5), TOP_NINE.slice(0, 5), ids(ITEMS), '40 items, five fit');
  });

  it('AC3 a level that lists asks still shows every open ask: seven that need you all show when only five fit', () => {
    const items = clone(ITEMS);
    for (const id of ['i-02', 'i-25', 'i-12', 'i-09']) factsOf(items, id)['needs_you'] = true;
    // Seven need you: i-02, i-25 (and sent back), i-12 (failing, lacks proof), i-09, i-31 (failing), i-07, i-18.
    // A program that lowers show below the needs-you count folds an open ask and fails here.
    expectLevel(level(items, 5), ['i-02', 'i-25', 'i-12', 'i-09', 'i-31', 'i-07', 'i-18'], ids(items), 'seven need you, five fit');
  });

  it('AC3 deep-salience level answers bad_input to a line it can\'t read', () => {
    expectBadInput(SALIENCE_BIN, 'level');
  });
});

describe('AC4 a level with 12 open asks from four sessions, three from each, and 30 other items shows all 12 asks and folds the 30 others into one counted line', () => {
  it('AC4 the 12 open asks all show, ranked by ID among themselves, and the 30 others fold into one counted line', async () => {
    const world = await openWorld();
    try {
      const sessions = ['s1', 's2', 's3', 's4'];
      for (const s of sessions) await world.start(s);
      for (const s of sessions) {
        for (let k = 1; k <= 3; k++) {
          await world.asks.raise(agent(s), TASTE_SOURCE, tasteAsk(`Which header for screen ${s}-${k}?`, [{ option: 'blue', label: 'Blue' }, { option: 'green', label: 'Green' }]));
        }
      }
      // The level's asks are the open asks Needs you lists: three a session stays under the asks core's
      // per-thread fold, so all 12 are open and listed.
      const open = (await world.asks.needsYou()).map((c) => c.ask);
      expect(open.length, 'Needs you lists 12 open asks, three from each of four sessions').toBe(12);
      const asks: JsonObject[] = open.map((handle) => ({
        id: handle,
        facts: { needs_you: true, sent_back: false, failing: false, lacks_proof: false, touched: false, changed: false, priority: 0 },
      }));
      // The 30 others: the 40-item level's first 30, none of which needs you here.
      const others = clone(ITEMS.slice(0, 30));
      for (const o of others) factsOf(others, o['id'] as string)['needs_you'] = false;
      const items = [...others, ...asks];
      // A program that caps the level at nine (or at what fits) shows nine asks and folds three; it fails here.
      expectLevel(level(items, 9), [...open].sort(), ids(items), '12 asks and 30 others, nine fit');
    } finally {
      await world.close();
    }
  });
});

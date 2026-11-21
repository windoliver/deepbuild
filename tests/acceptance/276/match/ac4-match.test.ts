// #276, criterion 4 (#276.fc1389e0), in full: "In a two-seat match each copy's record enters at step 0 as its
// player's entry and every copy's full-state hashes agree at every checkpoint; a step past `confirmed` writes no
// record; a planted copy that reads its peer's profile from its own store desyncs and fails, naming step 0"
//
// Each viewer's first session runs alone in the app's logic module (`deep-logic`'s `bake`), which writes their
// profile record into their own saves folder. Then the duel's two-seat match (`deep-show`'s `match`, over the test
// relay with every frame held back exactly 8 steps, so each copy first runs every step past `confirmed`), copy 1 on
// viewer A's folder and copy 2 on viewer B's. Wrong programs it fails: the base (no `profile` field: it fails at the
// first call, the layout probe's `check`); a copy whose own record doesn't enter, or enters as another player's, or a
// peer's that doesn't reach it; a read region that holds one block, or the copy's own record twice; a record written
// by a step run past `confirmed` (step 300 here asks only in such a run, and step 60 then holds no poke yet); no
// record from a confirmed step; and the planted twin (README: Planted twin), which reads player 2's profile on copy 1
// from copy 1's own store.

import { describe, expect, it } from 'vitest';
import {
  AC4, PANEL, PLANT, TIMEOUT, bake, copiesOf, copyFolder, desyncStep, failsNaming, none, obj, once, records, show, str, useFolders, withDoc,
  type Copy, type JsonObject, type Program, type RecordFile,
} from './helpers.ts';
import {
  ASK_AT, CHECKPOINTS, DOC_ID, LOGIC, MATCH_RECORD, PAST_AT, PLAYS, RECORD_A, RECORD_B, SEEN, SOLO_A, SOLO_B, SOLO_STEPS, STEPS, WINDOW,
  duelDoc, piece, regions, rulesProgram, type Arrays,
} from './fixtures.ts';

const folder = useFolders();

/** The program, built against the item's region map, and the duel's document. */
const built = once((): { program: Program; doc: JsonObject } => {
  const program = rulesProgram(regions());
  return { program, doc: duelDoc(program) };
});

const sameArrays = (got: Record<string, number[]>, want: Arrays): boolean =>
  JSON.stringify(Object.keys(got).sort()) === JSON.stringify(['stats', 'xp']) && JSON.stringify([got['stats'], got['xp']]) === JSON.stringify([want.stats, want.xp]);

/** A viewer's store after their first session: exactly one whole record, of step 60's arrays. */
function onlyRecord(dir: string, want: Arrays, who: string): RecordFile {
  const list = records(dir, `${who} saves folder`);
  expect(list.map((r) => ({ hash: r.hash, whole: r.whole, arrays: r.arrays })), `${who} first session writes one profile record, whole, of step ${ASK_AT}'s arrays ${show(want as unknown as JsonObject)}`)
    .toEqual([{ hash: list[0]?.hash ?? '', whole: true, arrays: { stats: want.stats, xp: want.xp } }]);
  return list[0]!;
}

interface Seeded { a: RecordFile; b: RecordFile; honest: [string, string]; planted: [string, string] }
/** Viewer A's and viewer B's first sessions, each alone in the app, each store copied for the planted match. */
const seeded = once((): Seeded => {
  const p = piece(built().program);
  const a = folder();
  const b = folder();
  bake(p, SOLO_STEPS, SOLO_A, a, "viewer A's first session");
  bake(p, SOLO_STEPS, SOLO_B, b, "viewer B's first session");
  const ra = onlyRecord(a, RECORD_A, "viewer A's");
  const rb = onlyRecord(b, RECORD_B, "viewer B's");
  const pa = folder();
  const pb = folder();
  copyFolder(a, pa);
  copyFolder(b, pb);
  return { a: ra, b: rb, honest: [a, b], planted: [pa, pb] };
});

/** The duel's match: copy 1 on `stores[0]`, copy 2 on `stores[1]`, every frame held back exactly 8 steps. */
function playMatch(stores: [string, string], planted?: string): Copy[] {
  const { program, doc } = built();
  const call: JsonObject = { call: 'match', doc: DOC_ID, steps: STEPS, plays: PLAYS, relay: { seed: 276, back: { exactly: WINDOW } }, saves_dirs: { 1: stores[0], 2: stores[1] } };
  const [reply] = withDoc(folder(), doc, [program], [call], "the duel's match", planted);
  return copiesOf(reply, `the duel's match${planted ? ` (planted ${planted})` : ''}`);
}

/** The criterion's judge over one match: every failure it finds, each naming what it found. */
function judge(copies: Copy[], s: Seeded, stores: [string, string]): string[] {
  const f: string[] = [];
  const want = [{ player: 1, profile: s.a.hash }, { player: 2, profile: s.b.hash }];
  for (const c of copies) {
    if (c.end !== null || c.desync) f.push(`copy ${c.player} ends ${c.end ?? 'with a desync'}${c.desync ? `, its desync naming step ${desyncStep(c.desync)}: ${show(c.desync, 400)}` : ''}`);
    if (c.confirmed !== STEPS - 1) f.push(`copy ${c.player} confirmed through match step ${c.confirmed}, not ${STEPS - 1}`);
    // Each copy's record enters at step 0 as its player's entry: on every copy's track, one profile entry a player.
    const entries = c.track.filter((e) => 'profile' in e);
    const got = entries.map((e) => ({ t: e['t'], player: e['player'], profile: e['profile'] }));
    if (JSON.stringify(got.slice().sort((x, y) => Number(x.player) - Number(y.player))) !== JSON.stringify(want.map((w) => ({ t: 0, ...w })))) {
      f.push(`copy ${c.player}'s track holds the profile entries ${show(got as unknown as JsonObject[], 600)}, not one at step 0 for each player: player 1's record ${s.a.hash} and player 2's ${s.b.hash}`);
    }
    // ...so every copy reads every player's profile: step 0's read region, as the program kept it.
    const seen = c.arrays.get(0)?.[`${LOGIC}.seen`];
    if (JSON.stringify(seen) !== JSON.stringify(SEEN)) f.push(`copy ${c.player}'s read region at match step 0 held ${show(seen)} (${LOGIC}.seen), not player 1's block then player 2's: ${JSON.stringify(SEEN)}`);
  }
  // Every copy's full-state hashes agree at every checkpoint.
  const [one, two] = copies as [Copy, Copy];
  for (const k of CHECKPOINTS) {
    const [h1, h2] = [one.hashes.get(k), two.hashes.get(k)];
    if (h1 === undefined || h2 === undefined) { f.push(`copy ${h1 === undefined ? 1 : 2} gives no full-state hash at the checkpoint at match step ${k}`); break; }
    if (h1 !== h2) { f.push(`the copies' full-state hashes differ first at the checkpoint at match step ${k}: ${h1} and ${h2}`); break; }
  }
  // A step past `confirmed` writes no record: each copy's store gains only the record of confirmed step 60.
  copies.forEach((c, i) => {
    const before = i === 0 ? s.a.hash : s.b.hash;
    const written = records(stores[i]!, `copy ${c.player}'s saves folder`).filter((r) => r.hash !== before);
    for (const r of written.filter((x) => !x.whole)) f.push(`copy ${c.player}'s record ${r.hash} doesn't hash to its name`);
    for (const r of written.filter((x) => !sameArrays(x.arrays, MATCH_RECORD))) {
      const k = r.arrays['stats']?.[1];
      f.push(`copy ${c.player} wrote a record of match step ${k} holding ${show(r.arrays as unknown as JsonObject)}, which no confirmed step asks for${k === PAST_AT ? ` (only a run of step ${PAST_AT} past confirmed, before player 2's poke came, asks)` : ''}`);
    }
    const good = written.filter((x) => sameArrays(x.arrays, MATCH_RECORD)).length;
    if (good !== 1) f.push(`copy ${c.player} wrote ${good} records of confirmed match step ${ASK_AT} holding ${show(MATCH_RECORD as unknown as JsonObject)}, not one`);
  });
  return f;
}

describe('#276: a profile record in a two-seat match', () => {
  it(`${AC4}: each copy's record enters at step 0 as its player's entry, the copies' hashes agree at every checkpoint, and a step past confirmed writes no record`, () => {
    const s = seeded();
    const copies = playMatch(s.honest);
    none(judge(copies, s, s.honest), 'the honest match');
    // The schedule did run steps 60 and 300 past confirmed on copy 1: it rolled back over each once player 2's poke came.
    for (const k of [ASK_AT, PAST_AT]) {
      const c1 = copies[0]!;
      expect(c1.rolledBack.some((r) => r.to <= k && r.from >= k), `copy 1 ran match step ${k} before player 2's poke for it came (past confirmed) and again after, a rollback over it; rolled_back: ${show(c1.rolledBack as unknown as JsonObject[], 800)}`).toBe(true);
    }
  }, TIMEOUT);

  it(`${AC4}: planted ${PLANT}: the copy that reads its peer's profile from its own store desyncs and fails, naming step 0`, () => {
    const s = seeded();
    const copies = playMatch(s.planted, PLANT);
    failsNaming(judge(copies, s, s.planted), /ends desync, its desync naming step 0\b/, `planted ${PLANT}`);
  }, TIMEOUT);

  it(`Scope #276: the Join prompt of a piece whose logic declares a profile says "Your profile's numbers go to the other players."`, () => {
    const { program, doc } = built();
    const [scope] = withDoc(folder(), doc, [program], [{ call: 'scope', panel: PANEL }], 'the duel on its panel');
    const join = obj(obj(obj(scope, 'scope')['state'], 'scope.state')['join'], "scope.state.join (the app's Join prompt)");
    expect(str(join['text'], 'state.join.text'), "the app's Join prompt for the duel").toContain("Your profile's numbers go to the other players.");
  }, TIMEOUT);
});

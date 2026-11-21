// This suite's fixture card duel (README: The card duel): one logic item, `duel`, in WebAssembly text assembled by
// #533's assembler (built from a copy as #555's helpers do), its catalog tables and schema, its play interface, its
// greedy bot and the playtest catalog.dominance names. The program reads its catalog by table.layout@1's documented
// bytes alone, from `assets_at` (Logic `logic@1`; Asset: tables: catalogs, As built): the table `cards` by its name's
// FNV-1a hash in the directory, and its columns `id`, `damage`, `recoil` and `offers` by theirs. Its region offsets are
// read from `deep-logic check` of a piece with its reads and writes, as #555's crawler's are. Every number an expected
// verdict rests on is set here; nothing here plays, packs or judges anything.
import { expect } from 'vitest';
import { checkCall, onLogic } from '../533/helpers.ts';
import { assemble } from '../555/helpers.ts';
import { fnv32a, i32 } from '../194/helpers.ts';
import type { Schema, Tables } from '../194/fixtures.ts';
import type { Obj } from '../184/helpers.ts';

/** The logic item's ID; its arrays are `duel.<name>`. */
const ID = 'duel';
export const PATH = {
  offered: `${ID}.offered`, taken: `${ID}.taken`, won: `${ID}.won`, lost: `${ID}.lost`, hero: `${ID}.hero`, foe: `${ID}.foe`,
  turn: `${ID}.turn`, legal: `${ID}.legal`, nlegal: `${ID}.nlegal`, score: `${ID}.score`, accepted: `${ID}.accepted`, refused: `${ID}.refused`,
} as const;

/** Cards on offer each turn, one a slot. */
const SLOTS = 3;
/** The most turns a duel lasts: a duel not won by then is lost. */
const TURNS = 12;
/** The hero's and the foe's hp at the start. */
const HERO_HP = 25;
const FOE_HP = 24;
/** The foe strikes after each turn that doesn't fell it, for 1 to 6, drawn by hash(the init seed, the turn). */
const FOE_MIN = 1;
const FOE_MAX = 6;
/** A normal card's damage; the planted card deals ten times it. */
const NORMAL_DAMAGE = 3;
const PLANTED_DAMAGE = 10 * NORMAL_DAMAGE;
/** Criterion 2's card: twice a normal card's damage, and 3 hp of recoil to the hero. */
const EDGE_DAMAGE = 6;
const EDGE_RECOIL = 3;
/** Offer attempts a slot makes before it stays empty. */
const ATTEMPTS = 64;

// ---------------------------------------------------------------------------------------------------
// The catalogs: one table, `cards`, each row a card: its damage, the recoil it deals the hero, and `offers`, the
// weight (0 to 4) by which the duel offers it (Check input: catalog kinds, As built (#832): an i32 `offers` column).

export const TABLE = 'cards';
export const SCHEMA: Schema = {
  [TABLE]: { id: 'id', columns: { damage: { type: 'i32' }, recoil: { type: 'i32' }, offers: { type: 'i32', range: [0, 4] } } },
};
/** The four normal cards every catalog holds. */
export const NORMAL = ['ash', 'fern', 'moss', 'reed'] as const;
/** Criterion 1's planted card. */
export const PLANTED = 'brute';
/** Criterion 2's card, whose difference sits on the limit. */
export const EDGE = 'edge';
const row = (id: string, damage: number, recoil = 0, offers = 4): Obj => ({ id, damage, recoil, offers });
const cards = (extra: Obj): Tables => ({
  [TABLE]: { columns: ['id', 'damage', 'recoil', 'offers'], rows: [...NORMAL.map((id) => row(id, NORMAL_DAMAGE)), extra] as never },
});
/** Criterion 1: the four normal cards and the planted card at ten times their damage. */
export const plantedCards = (): Tables => cards(row(PLANTED, PLANTED_DAMAGE));
/** Criterion 1's clean twin: the same catalog with the planted card at normal damage. */
export const normalCards = (): Tables => cards(row(PLANTED, NORMAL_DAMAGE));
/** Criterion 2 (and 3): the four normal cards and the edge card. */
export const edgeCards = (): Tables => cards(row(EDGE, EDGE_DAMAGE, EDGE_RECOIL));

// ---------------------------------------------------------------------------------------------------
// The play interface (the `none` form: no board), its greedy bot, and the playtest catalog.dominance names.

/** The duel's one control: a slider, on which the bot's pick puts the slot it takes (the row's first argument). */
const CONTROLS: Obj = { pick: { kind: 'slider' } };
const READS = ['pick'];
const WRITES: Obj = {
  offered: { type: 'i32', count: SLOTS }, taken: { type: 'i32', count: TURNS }, won: { type: 'i32' }, lost: { type: 'i32' },
  hero: { type: 'i32' }, foe: { type: 'i32' }, turn: { type: 'i32' }, legal: { type: 'i32', count: 3 * SLOTS }, nlegal: { type: 'i32' },
  score: { type: 'i32', count: SLOTS }, accepted: { type: 'i32' }, refused: { type: 'i32' },
};
/**
 * The duel's `game.play@1`, the `none` form: its values (the cards on offer and taken, won, lost, both sides' hp), its
 * turn, its one action `take` (a slot, the row's first argument, on the pick control), its legal list with a score a
 * row (the card's damage), and its accepted and refused counts.
 */
export function duelPlay(): Obj {
  return {
    turn: PATH.turn,
    values: { offered: PATH.offered, taken: PATH.taken, won: PATH.won, lost: PATH.lost, hero: PATH.hero, foe: PATH.foe },
    actions: { take: { control: 'pick', args: 'option' } },
    legal: { rows: PATH.legal, count: PATH.nlegal, score: PATH.score },
    accepted: PATH.accepted,
    refused: PATH.refused,
  };
}
/** The playtest's first (and only) bot: the greedy legal bot, which takes the listed card that deals the most damage. */
export const GREEDY: Obj = { legal: { pick: 'greedy', every: 1 } };
export const SEED = 832;
const RUNS = 20;
/** A run's span in steps: a duel is over by step TURNS + 1; three checkpoints (steps 0, 60 and 120) lie inside it. */
const SPAN_STEPS = 128;
export const GOAL = 'won';
/** The playtest catalog.dominance names (its spec's `play`): 20 runs of the greedy bot, seed 832, each run from its own seed. */
export function duelPlaytest(piece: string, play: Obj): Obj {
  return {
    piece, play, bots: [GREEDY], runs: RUNS, seed: SEED, span: { steps: SPAN_STEPS }, goals: [{ name: GOAL, when: PATH.won }],
    piece_seed: 'run', frames: { every: 0 },
  };
}

// ---------------------------------------------------------------------------------------------------
// The program.

const READS_AT = 0;
const WRITES_AT = 4096;
const STATE = 8192;
/** Where the catalog's copy lies: its u32 length, then its bytes (Logic `logic@1`). */
const ASSETS_AT = 16384;
const BASE = ASSETS_AT + 4;
const S = {
  rows: STATE, idAt: STATE + 4, dmgAt: STATE + 8, recAt: STATE + 12, offAt: STATE + 16, hero: STATE + 20, foe: STATE + 24,
  turn: STATE + 28, won: STATE + 32, lost: STATE + 36, accepted: STATE + 40, refused: STATE + 44, slots: STATE + 48, taken: STATE + 64,
};
const OFFER_TAG = 1n << 32n;
const FOE_TAG = 2n << 32n;
const i64 = (v: bigint): string => BigInt.asIntN(64, v).toString();

interface Entry { region: string; name: string; offset: number; size: number }
let layout: Entry[] | undefined;
/** The read and write regions `deep-logic check` lays out for the duel's reads and writes (its program a probe). */
function layoutOf(): Entry[] {
  if (layout) return layout;
  const probe = assemble('probe832', `(module (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const ${READS_AT}))
  (global (export "writes_at") i32 (i32.const ${WRITES_AT}))
  (func (export "init") (param $seed i64)) (func (export "step") (param $k i64)))`);
  const p = {
    seed: SEED, class: 'figure', controls: CONTROLS,
    items: { [ID]: { kind: 'logic@1', params: { program: probe.sha, step_rate: 60, reads: READS, writes: WRITES } } },
    assets: { [probe.sha]: probe.b64 },
  };
  const [reply] = onLogic([checkCall(p as never)]) as Obj[];
  expect(reply?.['ok'], `deep-logic check takes the duel's layout probe: ${JSON.stringify(reply).slice(0, 1500)}`).toBe(true);
  const entries = reply!['items'][ID]['layout']['entries'] as Entry[];
  const end = (region: string): number => Math.max(0, ...entries.filter((e) => e.region === region).map((e) => e.offset + e.size));
  expect(READS_AT + end('reads'), 'the read region ends before writes_at').toBeLessThanOrEqual(WRITES_AT);
  expect(WRITES_AT + end('writes'), 'the write region ends before the program\'s own state').toBeLessThanOrEqual(STATE);
  layout = entries;
  return entries;
}
const offset = (region: 'reads' | 'writes', name: string): number => {
  const e = layoutOf().find((x) => x.region === region && x.name === name);
  if (!e) throw Error(`the duel's layout has no ${region} entry ${name}`);
  return e.offset;
};

/**
 * The duel. `init` finds the table `cards` and its columns in the catalog's copy, sets the hero's hp to 25 and the
 * foe's to 24, and deals turn 0. Dealing a turn fills each of the 3 slots on its own: attempt a = 0, 1, … draws
 * h = hash(the init seed, the turn, the slot, a), a candidate row (h >> 32) mod rows, and takes it when the row's
 * `offers` is above h & 3; a slot no attempt fills in 64 stays empty. So a row whose `offers` is 0 is never on offer,
 * and taking it out changes only the slots that would have held it. Each step, an entry on `pick` naming a slot that
 * holds a card, while the duel runs, takes that card: the foe loses its damage and the hero its recoil; a foe at 0 hp
 * or below is felled (won); otherwise the foe strikes the hero for 1 to 6, drawn by hash(the init seed, the turn), and
 * a hero at 0 or below falls (lost); then the turn advances, a duel at turn 12 not won is lost, and a running duel
 * deals the next turn. Every other entry is refused. It publishes the cards on offer (each slot its card's ID hash, 0
 * when empty or once the duel is over), the cards taken (slot t the card taken at turn t), won, lost, both sides' hp,
 * the turn, the legal rows (take, the slot, 0) of each filled slot while the duel runs, each row's score (its card's
 * damage), and the accepted and refused counts.
 */
export function duelProgram(): { name: string; bytes: Buffer; b64: string; sha: string } {
  const PICK = READS_AT + offset('reads', 'pick');
  const W = (name: string): number => WRITES_AT + offset('writes', name);
  const c = (n: number): string => `(i32.const ${n})`;
  const ld = (a: number): string => `(i32.load (i32.const ${a}))`;
  const st = (a: number, v: string): string => `(i32.store (i32.const ${a}) ${v})`;
  const inc = (a: number): string => st(a, `(i32.add ${ld(a)} (i32.const 1))`);
  const col = (name: string): string => `(i32.const ${i32(fnv32a(name))})`;
  const text = `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const ${READS_AT}))
  (global (export "writes_at") i32 (i32.const ${WRITES_AT}))
  (global (export "assets_at") i32 (i32.const ${ASSETS_AT}))
  (global $seed (mut i64) (i64.const 0))
  (func $mix (param $k i64) (result i64) (local $z i64)
    (local.set $z (i64.add (global.get $seed) (i64.mul (local.get $k) (i64.const ${i64(0x9E3779B97F4A7C15n)}))))
    (local.set $z (i64.mul (i64.xor (local.get $z) (i64.shr_u (local.get $z) (i64.const 30))) (i64.const ${i64(0xBF58476D1CE4E5B9n)})))
    (local.set $z (i64.mul (i64.xor (local.get $z) (i64.shr_u (local.get $z) (i64.const 27))) (i64.const ${i64(0x94D049BB133111EBn)})))
    (i64.xor (local.get $z) (i64.shr_u (local.get $z) (i64.const 31))))
  (func $cell (param $at i32) (param $r i32) (result i32)
    (i32.load (i32.add (local.get $at) (i32.shl (local.get $r) (i32.const 2)))))
  (func $running (result i32)
    (i32.eqz (i32.or ${ld(S.won)} ${ld(S.lost)})))
  (func $slot (param $s i32) (result i32)
    (i32.add ${c(S.slots)} (i32.shl (local.get $s) (i32.const 2))))
  ;; Each slot of the current turn, filled on its own by its attempts' draws.
  (func $deal (local $s i32) (local $a i32) (local $h i64) (local $r i32)
    (local.set $s (i32.const 0))
    (block $slots_done (loop $slots
      (br_if $slots_done (i32.ge_u (local.get $s) ${c(SLOTS)}))
      (i32.store (call $slot (local.get $s)) (i32.const -1))
      (local.set $a (i32.const 0))
      (block $tries_done (loop $tries
        (br_if $tries_done (i32.ge_u (local.get $a) ${c(ATTEMPTS)}))
        (br_if $tries_done (i32.eqz ${ld(S.rows)}))
        (local.set $h (call $mix (i64.or (i64.const ${i64(OFFER_TAG)})
          (i64.extend_i32_u (i32.or (i32.shl ${ld(S.turn)} (i32.const 16)) (i32.or (i32.shl (local.get $s) (i32.const 8)) (local.get $a)))))))
        (local.set $r (i32.wrap_i64 (i64.rem_u (i64.shr_u (local.get $h) (i64.const 32)) (i64.extend_i32_u ${ld(S.rows)}))))
        (if (i32.gt_s (call $cell ${ld(S.offAt)} (local.get $r)) (i32.wrap_i64 (i64.and (local.get $h) (i64.const 3))))
          (then
            (i32.store (call $slot (local.get $s)) (local.get $r))
            (br $tries_done)))
        (local.set $a (i32.add (local.get $a) (i32.const 1)))
        (br $tries)))
      (local.set $s (i32.add (local.get $s) (i32.const 1)))
      (br $slots))))
  (func $clear (local $s i32)
    (local.set $s (i32.const 0))
    (block $done (loop $l
      (br_if $done (i32.ge_u (local.get $s) ${c(SLOTS)}))
      (i32.store (call $slot (local.get $s)) (i32.const -1))
      (local.set $s (i32.add (local.get $s) (i32.const 1)))
      (br $l))))
  ;; The card in row r taken at the current turn.
  (func $take (param $r i32)
    ${inc(S.accepted)}
    (i32.store (i32.add ${c(S.taken)} (i32.shl ${ld(S.turn)} (i32.const 2))) (call $cell ${ld(S.idAt)} (local.get $r)))
    ${st(S.foe, `(i32.sub ${ld(S.foe)} (call $cell ${ld(S.dmgAt)} (local.get $r)))`)}
    ${st(S.hero, `(i32.sub ${ld(S.hero)} (call $cell ${ld(S.recAt)} (local.get $r)))`)}
    (if (i32.le_s ${ld(S.foe)} (i32.const 0))
      (then ${st(S.won, c(1))})
      (else
        ${st(S.hero, `(i32.sub ${ld(S.hero)} (i32.add ${c(FOE_MIN)} (i32.wrap_i64 (i64.rem_u (i64.shr_u (call $mix (i64.or (i64.const ${i64(FOE_TAG)}) (i64.extend_i32_u ${ld(S.turn)}))) (i64.const 32)) (i64.const ${FOE_MAX - FOE_MIN + 1})))))`)}
        (if (i32.le_s ${ld(S.hero)} (i32.const 0)) (then ${st(S.lost, c(1))}))))
    ${inc(S.turn)}
    (if (i32.and (call $running) (i32.ge_s ${ld(S.turn)} ${c(TURNS)})) (then ${st(S.lost, c(1))}))
    (if (call $running) (then (call $deal)) (else (call $clear))))
  (func (export "init") (param $seed i64) (local $tc i32) (local $p i32) (local $i i32) (local $cc i32) (local $q i32) (local $j i32) (local $h i32) (local $at i32)
    (global.set $seed (local.get $seed))
    ${st(S.rows, c(0))}
    (local.set $tc (i32.load (i32.const ${BASE + 8})))
    (local.set $p (i32.const ${BASE + 20}))
    (block $found (loop $tables
      (br_if $found (i32.ge_u (local.get $i) (local.get $tc)))
      (local.set $cc (i32.load offset=8 (local.get $p)))
      (if (i32.eq (i32.load (local.get $p)) ${col(TABLE)})
        (then
          (local.set $q (i32.add (local.get $p) (i32.const 12)))
          (local.set $j (i32.const 0))
          (block $cols_done (loop $cols
            (br_if $cols_done (i32.ge_u (local.get $j) (local.get $cc)))
            (local.set $h (i32.load (local.get $q)))
            (local.set $at (i32.add (i32.const ${BASE}) (i32.load offset=8 (local.get $q))))
            (if (i32.eq (local.get $h) ${col('id')}) (then ${st(S.idAt, '(local.get $at)')}))
            (if (i32.eq (local.get $h) ${col('damage')}) (then ${st(S.dmgAt, '(local.get $at)')}))
            (if (i32.eq (local.get $h) ${col('recoil')}) (then ${st(S.recAt, '(local.get $at)')}))
            (if (i32.eq (local.get $h) ${col('offers')}) (then ${st(S.offAt, '(local.get $at)')}))
            (local.set $q (i32.add (local.get $q) (i32.const 16)))
            (local.set $j (i32.add (local.get $j) (i32.const 1)))
            (br $cols)))
          ${st(S.rows, '(i32.load offset=4 (local.get $p))')}
          (br $found)))
      (local.set $p (i32.add (local.get $p) (i32.add (i32.const 12) (i32.shl (local.get $cc) (i32.const 4)))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $tables)))
    ${st(S.hero, c(HERO_HP))}
    ${st(S.foe, c(FOE_HP))}
    (call $deal))
  (func (export "step") (param $k i64) (local $n i32) (local $j i32) (local $v f64) (local $s i32) (local $r i32) (local $i i32)
    (local.set $n ${ld(PICK)})
    (block $entries_done (loop $entries
      (br_if $entries_done (i32.ge_u (local.get $j) (local.get $n)))
      (br_if $entries_done (i32.ge_u (local.get $j) (i32.const 16)))
      (local.set $v (f64.load (i32.add (i32.const ${PICK + 16}) (i32.shl (local.get $j) (i32.const 4)))))
      (local.set $r (i32.const -1))
      (if (i32.and (call $running) (i32.and (f64.ge (local.get $v) (f64.const 0)) (f64.lt (local.get $v) (f64.const ${SLOTS}))))
        (then (local.set $r (i32.load (call $slot (i32.trunc_f64_s (local.get $v)))))))
      (if (i32.ge_s (local.get $r) (i32.const 0))
        (then (call $take (local.get $r)))
        (else ${inc(S.refused)}))
      (local.set $j (i32.add (local.get $j) (i32.const 1)))
      (br $entries)))
    ;; Publish.
    (local.set $n (i32.const 0))
    (local.set $s (i32.const 0))
    (block $pub_done (loop $pub
      (br_if $pub_done (i32.ge_u (local.get $s) ${c(SLOTS)}))
      (local.set $r (i32.load (call $slot (local.get $s))))
      (i32.store (i32.add ${c(W('offered'))} (i32.shl (local.get $s) (i32.const 2)))
        (if (result i32) (i32.ge_s (local.get $r) (i32.const 0))
          (then (call $cell ${ld(S.idAt)} (local.get $r)))
          (else (i32.const 0))))
      (i32.store (i32.add ${c(W('score'))} (i32.shl (local.get $s) (i32.const 2))) (i32.const 0))
      (i32.store (i32.add ${c(W('legal'))} (i32.mul (local.get $s) (i32.const 12))) (i32.const 0))
      (i32.store offset=4 (i32.add ${c(W('legal'))} (i32.mul (local.get $s) (i32.const 12))) (i32.const 0))
      (i32.store offset=8 (i32.add ${c(W('legal'))} (i32.mul (local.get $s) (i32.const 12))) (i32.const 0))
      (local.set $s (i32.add (local.get $s) (i32.const 1)))
      (br $pub)))
    (local.set $s (i32.const 0))
    (block $rows_done (loop $rows
      (br_if $rows_done (i32.ge_u (local.get $s) ${c(SLOTS)}))
      (local.set $r (i32.load (call $slot (local.get $s))))
      (if (i32.and (call $running) (i32.ge_s (local.get $r) (i32.const 0)))
        (then
          (i32.store offset=4 (i32.add ${c(W('legal'))} (i32.mul (local.get $n) (i32.const 12))) (local.get $s))
          (i32.store (i32.add ${c(W('score'))} (i32.shl (local.get $n) (i32.const 2))) (call $cell ${ld(S.dmgAt)} (local.get $r)))
          (local.set $n (i32.add (local.get $n) (i32.const 1)))))
      (local.set $s (i32.add (local.get $s) (i32.const 1)))
      (br $rows)))
    ${st(W('nlegal'), '(local.get $n)')}
    (local.set $i (i32.const 0))
    (block $taken_done (loop $taken
      (br_if $taken_done (i32.ge_u (local.get $i) ${c(TURNS)}))
      (i32.store (i32.add ${c(W('taken'))} (i32.shl (local.get $i) (i32.const 2))) (i32.load (i32.add ${c(S.taken)} (i32.shl (local.get $i) (i32.const 2)))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $taken)))
    ${st(W('won'), ld(S.won))}
    ${st(W('lost'), ld(S.lost))}
    ${st(W('hero'), ld(S.hero))}
    ${st(W('foe'), ld(S.foe))}
    ${st(W('turn'), ld(S.turn))}
    ${st(W('accepted'), ld(S.accepted))}
    ${st(W('refused'), ld(S.refused))}))`;
  return assemble(`duel_${PICK}_${W('offered')}_${W('refused')}`, text);
}

/** The piece as the replica and `deep-logic` take it: the duel alone, of class figure, at 60 Hz, its catalog among its data assets. */
export function duelPiece(program: { sha: string; b64: string }, catalog: { sha256: string; bytes: Buffer }): Obj {
  return {
    seed: SEED, class: 'figure', controls: CONTROLS,
    items: { [ID]: { kind: 'logic@1', params: { program: program.sha, step_rate: 60, reads: READS, writes: WRITES, assets: [catalog.sha256] } } },
    assets: { [program.sha]: program.b64, [catalog.sha256]: catalog.bytes.toString('base64') },
  };
}

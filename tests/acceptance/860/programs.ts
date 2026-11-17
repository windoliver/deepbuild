// This suite's fixtures (README: The story, The puzzle): the story and the puzzle as logic programs in WebAssembly text,
// their pieces, their recorded tracks and the documents the app and the web player take. The text is built against the
// region offsets the logic module's own `check` reports (helpers.ts reads them and assembles with #533's assembler), so
// each program reads and writes where the logic module lays its entries out. Every program exports `memory` (one page
// whose maximum is its minimum), `init(seed)`, `step(k)` and the immutable globals `reads_at` and `writes_at`. This file
// imports nothing that runs: the expected values below are the test's own, worked from the issue's numbers.

/** An object read from or sent as JSON. */
export type Obj = { [key: string]: any };

export const FLICKS = 705_600_000;
/** Both programs step at 60 Hz on a turn clock: a step runs only for an entry of a control the item reads. */
export const HZ = 60;
export const STEP = FLICKS / HZ;
/** Step k's time in flicks: every entry here is put exactly on its step. */
export const at = (k: number): number => k * STEP;
export const READS_AT = 0;
export const WRITES_AT = 8192;
/** The puzzle's own board: nine i32 past the write region, never read back from it. */
export const PRIVATE = 16384;
/** The integers from `from` to `to`, both included. */
export const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** A control entry the viewer wrote at step k (Input track: {t, seq, control, value, writer, player}). */
export const entry = (k: number, control: string, value = 1): Obj => ({ t: at(k), seq: 0, control, value, writer: 'you', player: 1 });
/** README, The surface: a rewind entry at step k, `n` stops back from the current stop (n = 1 is one press of back). */
export const rewindEntry = (k: number, n: number, writer = 'you'): Obj => ({ t: at(k), seq: 0, rewind: { to: { stop: n } }, writer, player: 1 });
/** The entries of `track` stamped at or before step k. */
export const upTo = (track: Obj[], k: number): Obj[] => track.filter((e) => Number(e['t']) <= at(k));
/** Whether an entry is a rewind (README, The surface). */
export const isRewind = (e: Obj): boolean => e !== null && typeof e === 'object' && e['rewind'] !== undefined;

// ---------------------------------------------------------------------------------------------------
// The story: 40 lines and 3 choices. Line 1 shows at step 0; `next` shows the next line, except at a line that offers a
// choice (8, 18 and 28), where `choose` (1 or 2) takes an option and shows the next line; `skip`, the skip-read control,
// shows the next lines one after another while each line's text is in `seen`, stopping at the first unread line, at a
// line that offers a choice, or at line 40. Each line shown marks its step a stop and its text read in `seen`. A line's
// text is its number, except lines 23 to 27 after option 2 of the second choice, which show texts 41 to 45. `save`
// writes slot 1 into `request` (Logic: saves). The read position and the options taken are globals the program never
// reads back from its write region; `seen` lives in the write region and is read there, so the logic module's carried
// copy is what a step reads after a rewind.

export const STORY = 'story';
export const LINES = 40;
/** The lines that offer a choice: the first, second and third. */
export const CHOICES: readonly number[] = [8, 18, 28];
/** `seen` holds one i32 a text, 0 unread and 1 read: texts 1 to 45, index 0 and 46 and 47 unused. */
export const TEXTS = 48;
export const STORY_CONTROLS: Obj = { next: { kind: 'press' }, choose: { kind: 'slider' }, skip: { kind: 'press' }, save: { kind: 'press' } };
export const STORY_READS = ['next', 'choose', 'skip', 'save'];
export const STORY_WRITES: Obj = {
  line: { type: 'i32' }, text: { type: 'i32' }, stop: { type: 'i32' }, choices: { type: 'i32', count: 3 }, seen: { type: 'i32', count: TEXTS }, request: { type: 'i32' },
};
/** README, The surface: a piece's rewind, stops at `<logic ID>.stop`, seen at `<logic ID>.seen` when it declares one. */
export const STORY_DEPTH = 64;
/** The text line `n` shows when the second choice took option `c2` (0 before it is made). */
export const textOf = (n: number, c2: number): number => (c2 === 2 && n >= 23 && n <= 27 ? n + 18 : n);

/** Absolute addresses of the story's region entries (READS_AT or WRITES_AT plus the offset `check` reports). */
export interface StoryAt { next: number; choose: number; skip: number; save: number; line: number; text: number; stop: number; choices: number; seen: number; request: number }

/** A slot's entries (Logic `logic@1`): a u32 count, 4 zero bytes, then up to 16 entries of a u32 player, 4 zero bytes and an f64. */
const eachEntry = (slot: number, label: string, body: string): string => `
    (local.set $n (i32.load (i32.const ${slot})))
    (local.set $i (i32.const 0))
    (block $${label}_done (loop $${label}_on
      (br_if $${label}_done (i32.ge_u (local.get $i) (local.get $n)))
      ${body}
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $${label}_on)))`;
const valueAt = (slot: number): string => `(f64.load (i32.add (i32.const ${slot + 16}) (i32.shl (local.get $i) (i32.const 4))))`;

export function storyText(a: StoryAt): string {
  return `(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const ${READS_AT}))
  (global (export "writes_at") i32 (i32.const ${WRITES_AT}))
  (global $pos (mut i32) (i32.const 0))
  (global $c1 (mut i32) (i32.const 0))
  (global $c2 (mut i32) (i32.const 0))
  (global $c3 (mut i32) (i32.const 0))
  (global $stop (mut i32) (i32.const 0))
  (func (export "init") (param $seed i64))
  ;; The text line p shows: lines 23 to 27 show texts 41 to 45 after option 2 of the second choice.
  (func $text (param $p i32) (result i32)
    (if (result i32)
      (i32.and (i32.eq (global.get $c2) (i32.const 2))
        (i32.and (i32.ge_s (local.get $p) (i32.const 23)) (i32.le_s (local.get $p) (i32.const 27))))
      (then (i32.add (local.get $p) (i32.const 18)))
      (else (local.get $p))))
  ;; The choice line p offers: 1, 2, 3, or 0 for none.
  (func $choice (param $p i32) (result i32)
    (if (result i32) (i32.eq (local.get $p) (i32.const 8)) (then (i32.const 1))
      (else (if (result i32) (i32.eq (local.get $p) (i32.const 18)) (then (i32.const 2))
        (else (if (result i32) (i32.eq (local.get $p) (i32.const 28)) (then (i32.const 3)) (else (i32.const 0))))))))
  (func $seen (param $t i32) (result i32)
    (i32.load (i32.add (i32.const ${a.seen}) (i32.shl (local.get $t) (i32.const 2)))))
  ;; The line at the read position shown: its text read, its step a stop.
  (func $show
    (i32.store (i32.add (i32.const ${a.seen}) (i32.shl (call $text (global.get $pos)) (i32.const 2))) (i32.const 1))
    (global.set $stop (i32.const 1)))
  (func $next
    (if (i32.and (i32.lt_s (global.get $pos) (i32.const ${LINES})) (i32.eqz (call $choice (global.get $pos))))
      (then (global.set $pos (i32.add (global.get $pos) (i32.const 1))) (call $show))))
  (func $choose (param $v f64) (local $c i32) (local $o i32)
    (local.set $c (call $choice (global.get $pos)))
    (local.set $o
      (if (result i32) (f64.eq (local.get $v) (f64.const 1)) (then (i32.const 1))
        (else (if (result i32) (f64.eq (local.get $v) (f64.const 2)) (then (i32.const 2)) (else (i32.const 0))))))
    (if (i32.and (i32.ne (local.get $c) (i32.const 0)) (i32.ne (local.get $o) (i32.const 0)))
      (then
        (if (i32.eq (local.get $c) (i32.const 1)) (then (global.set $c1 (local.get $o))))
        (if (i32.eq (local.get $c) (i32.const 2)) (then (global.set $c2 (local.get $o))))
        (if (i32.eq (local.get $c) (i32.const 3)) (then (global.set $c3 (local.get $o))))
        (global.set $pos (i32.add (global.get $pos) (i32.const 1)))
        (call $show))))
  ;; Skip-read: on past each line whose text was read, to the first unread line, a line with a choice, or line 40.
  (func $skip
    (if (i32.and (i32.lt_s (global.get $pos) (i32.const ${LINES})) (i32.eqz (call $choice (global.get $pos))))
      (then
        (block $skip_done (loop $skip_on
          (global.set $pos (i32.add (global.get $pos) (i32.const 1)))
          (br_if $skip_done (i32.eqz (call $seen (call $text (global.get $pos)))))
          (br_if $skip_done (call $choice (global.get $pos)))
          (br_if $skip_done (i32.ge_s (global.get $pos) (i32.const ${LINES})))
          (br $skip_on)))
        (call $show))))
  (func (export "step") (param $k i64) (local $i i32) (local $n i32)
    (global.set $stop (i32.const 0))
    (if (i64.eqz (local.get $k)) (then (global.set $pos (i32.const 1)) (call $show)))
    ${eachEntry(a.next, 'next', '(call $next)')}
    ${eachEntry(a.choose, 'choose', `(call $choose ${valueAt(a.choose)})`)}
    ${eachEntry(a.skip, 'skip', '(call $skip)')}
    (i32.store (i32.const ${a.request}) (i32.ne (i32.load (i32.const ${a.save})) (i32.const 0)))
    (i32.store (i32.const ${a.line}) (global.get $pos))
    (i32.store (i32.const ${a.text}) (call $text (global.get $pos)))
    (i32.store (i32.const ${a.stop}) (global.get $stop))
    (i32.store (i32.const ${a.choices}) (global.get $c1))
    (i32.store (i32.const ${a.choices + 4}) (global.get $c2))
    (i32.store (i32.const ${a.choices + 8}) (global.get $c3)))
)`;
}

/** A program's identity as a piece names it. */
export interface Named { sha: string; b64: string }
/**
 * The story as `deep-logic` takes a piece (#531's Piece): its rewind (README, The surface), `seen` declared as carried
 * state only when asked, and with `saves` slot 1 asked through `request` (Logic: saves). Checkpoints after every step
 * that runs, so each line shown has a full-state hash.
 */
export function storyPiece(p: Named, o: { seen?: boolean; saves?: boolean } = {}): Obj {
  return {
    seed: 860, class: 'figure', controls: STORY_CONTROLS,
    rewind: { stops: `${STORY}.stop`, depth: STORY_DEPTH, ...(o.seen ? { seen: `${STORY}.seen` } : {}) },
    items: {
      [STORY]: {
        kind: 'logic@1',
        params: {
          program: p.sha, step_rate: HZ, clock: 'on_input', reads: STORY_READS, writes: STORY_WRITES, checkpoint: { every: 1 },
          ...(o.saves ? { saves: { slots: 1, request: 'request' } } : {}),
        },
      },
    },
    assets: { [p.sha]: p.b64 },
  };
}

/** The first reading shows line n at step 6(n − 1). */
export const lineStep = (n: number): number => 6 * (n - 1);
export const READ_TO = 30;
/** Rewound 12 stops to line 18, which offers the second choice, at step 180, the step after line 30's. */
export const BACK = 12;
export const STOP_LINE = 18;
export const STOP_STEP = lineStep(STOP_LINE);
export const REWIND_AT = 180;
/** The other option, 2, at the second choice, at step 186; on the new branch line n shows at 186 + 6(n − 19). */
export const OTHER_AT = 186;
export const branchStep = (n: number): number => OTHER_AT + 6 * (n - 19);

/** The first reading: line 1 at step 0 to line 30 at step 174, one action every 6 steps: `next`, or option 1 at each choice. */
export function firstReading(): Obj[] {
  return range(2, READ_TO).map((n) => (CHOICES.includes(n - 1) ? entry(lineStep(n), 'choose', 1) : entry(lineStep(n), 'next')));
}
/** After the rewind: option 2 at the second choice (line 19 at step 186), then an action every 6 steps to line `to`. */
export function otherOption(to: number): Obj[] {
  return [entry(OTHER_AT, 'choose', 2), ...range(20, to).map((n) => (CHOICES.includes(n - 1) ? entry(branchStep(n), 'choose', 1) : entry(branchStep(n), 'next')))];
}
/** Criterion 1: read to line 30, rewound 12 stops, continued with the other option to line 40 (step 312). */
export const STORY_STEPS_1 = 320;
export const rewoundStory = (): Obj[] => [...firstReading(), rewindEntry(REWIND_AT, BACK), ...otherOption(LINES)];
/** A fresh play of the entries up to line 18 followed by that option, at the same steps. */
export const freshStory = (): Obj[] => [...upTo(firstReading(), STOP_STEP), ...otherOption(LINES)];

/** Criterion 2: the same rewind, option 2 at step 186, skip-read at 192 and one `next` at 198. */
export const SKIP_AT = 192;
export const STORY_STEPS_2 = 210;
export const skippingStory = (): Obj[] => [...firstReading(), rewindEntry(REWIND_AT, BACK), entry(OTHER_AT, 'choose', 2), entry(SKIP_AT, 'skip'), entry(SKIP_AT + 6, 'next')];
/** The same option and skip with no rewind: no line past 19 has been read, so the skip stops at line 20. */
export const skippingFresh = (): Obj[] => [...upTo(firstReading(), STOP_STEP), entry(OTHER_AT, 'choose', 2), entry(SKIP_AT, 'skip')];
/** On the new branch, the texts the closed branch read and the new branch hasn't: lines 20 to 30 on option 1. */
export const CLOSED_TEXTS = range(20, 30);
/** The first unread line the skip from line 19 stops at: line 23, whose text after option 2 is 41. */
export const FIRST_UNREAD = 23;

/**
 * Criterion 4: the same rewind and option 2, lines 20 to 24 (steps 192 to 216), a save at 222 (slot 1, written when step
 * 222 ends, so at step 223), then rewound 8 stops at 228, back past the branch to line 16 (step 90); `next` at 234 and
 * 240 (lines 17 and 18), option 2 at 246 (line 19) and skip-read at 252, which passes lines 20 to 24, read on both
 * branches before the save, and stops at line 25 (text 43), the first line no branch read.
 */
export const SAVE_AT = 222;
export const SAVED_STEP = SAVE_AT + 1;
export const BACK_AFTER = 8;
export const REWIND_AFTER_AT = 228;
export const BACK_AFTER_LINE = 16;
export const SKIP_AFTER_AT = 252;
export const SKIP_AFTER_LINE = 25;
export const STORY_STEPS_4 = 260;
export function savedStory(): Obj[] {
  return [
    ...firstReading(), rewindEntry(REWIND_AT, BACK), entry(OTHER_AT, 'choose', 2), ...range(20, 24).map((n) => entry(branchStep(n), 'next')),
    entry(SAVE_AT, 'save'), rewindEntry(REWIND_AFTER_AT, BACK_AFTER), entry(234, 'next'), entry(240, 'next'), entry(246, 'choose', 2), entry(SKIP_AFTER_AT, 'skip'),
  ];
}

// ---------------------------------------------------------------------------------------------------
// The puzzle: the eight-tile sliding puzzle on a 3 × 3 board, cells row-major, the blank (0) at cell 8 at the start.
// Each entry of `move` slides the blank: 1 up, 2 right, 3 down, 4 left; a move the edge stops does nothing. Each move
// made marks its step a stop. The board lives in the program's own memory and the blank and the count of moves in
// globals; `board`, `moves` and `stop` are copies the program writes and never reads.

export const PUZZLE = 'puzzle';
export const PUZZLE_CONTROLS: Obj = { move: { kind: 'slider' } };
export const PUZZLE_READS = ['move'];
export const PUZZLE_WRITES: Obj = { board: { type: 'i32', count: 9 }, moves: { type: 'i32' }, stop: { type: 'i32' } };
/** The puzzle's depth: five stops. */
export const PUZZLE_DEPTH = 5;
export interface PuzzleAt { move: number; board: number; moves: number; stop: number }

export function puzzleText(a: PuzzleAt): string {
  return `(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const ${READS_AT}))
  (global (export "writes_at") i32 (i32.const ${WRITES_AT}))
  (global $blank (mut i32) (i32.const 8))
  (global $moves (mut i32) (i32.const 0))
  (func $cell (param $i i32) (result i32) (i32.add (i32.const ${PRIVATE}) (i32.shl (local.get $i) (i32.const 2))))
  (func (export "init") (param $seed i64) (local $i i32)
    (block $fill_done (loop $fill_on
      (br_if $fill_done (i32.ge_u (local.get $i) (i32.const 8)))
      (i32.store (call $cell (local.get $i)) (i32.add (local.get $i) (i32.const 1)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $fill_on)))
    (i32.store (call $cell (i32.const 8)) (i32.const 0)))
  ;; One move of the blank: 1 when it was made, 0 when the board's edge stops it.
  (func $move (param $d f64) (result i32) (local $r i32) (local $c i32) (local $to i32)
    (local.set $r (i32.div_u (global.get $blank) (i32.const 3)))
    (local.set $c (i32.rem_u (global.get $blank) (i32.const 3)))
    (local.set $to (i32.const -1))
    (if (i32.and (f64.eq (local.get $d) (f64.const 1)) (i32.gt_u (local.get $r) (i32.const 0))) (then (local.set $to (i32.sub (global.get $blank) (i32.const 3)))))
    (if (i32.and (f64.eq (local.get $d) (f64.const 2)) (i32.lt_u (local.get $c) (i32.const 2))) (then (local.set $to (i32.add (global.get $blank) (i32.const 1)))))
    (if (i32.and (f64.eq (local.get $d) (f64.const 3)) (i32.lt_u (local.get $r) (i32.const 2))) (then (local.set $to (i32.add (global.get $blank) (i32.const 3)))))
    (if (i32.and (f64.eq (local.get $d) (f64.const 4)) (i32.gt_u (local.get $c) (i32.const 0))) (then (local.set $to (i32.sub (global.get $blank) (i32.const 1)))))
    (if (i32.lt_s (local.get $to) (i32.const 0)) (then (return (i32.const 0))))
    (i32.store (call $cell (global.get $blank)) (i32.load (call $cell (local.get $to))))
    (i32.store (call $cell (local.get $to)) (i32.const 0))
    (global.set $blank (local.get $to))
    (global.set $moves (i32.add (global.get $moves) (i32.const 1)))
    (i32.const 1))
  (func (export "step") (param $k i64) (local $i i32) (local $n i32) (local $stop i32)
    ${eachEntry(a.move, 'move', `(local.set $stop (i32.or (local.get $stop) (call $move ${valueAt(a.move)})))`)}
    (local.set $i (i32.const 0))
    (block $copy_done (loop $copy_on
      (br_if $copy_done (i32.ge_u (local.get $i) (i32.const 9)))
      (i32.store (i32.add (i32.const ${a.board}) (i32.shl (local.get $i) (i32.const 2))) (i32.load (call $cell (local.get $i))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $copy_on)))
    (i32.store (i32.const ${a.moves}) (global.get $moves))
    (i32.store (i32.const ${a.stop}) (local.get $stop)))
)`;
}

/** The puzzle as `deep-logic` and the replica take a piece, its rewind five stops deep. */
export function puzzlePiece(p: Named): Obj {
  return {
    seed: 860, class: 'figure', controls: PUZZLE_CONTROLS,
    rewind: { stops: `${PUZZLE}.stop`, depth: PUZZLE_DEPTH },
    items: { [PUZZLE]: { kind: 'logic@1', params: { program: p.sha, step_rate: HZ, clock: 'on_input', reads: PUZZLE_READS, writes: PUZZLE_WRITES, checkpoint: { every: 1 } } } },
    assets: { [p.sha]: p.b64 },
  };
}

/** Criterion 3's eight moves (up, up, left, down, left, down, right, up), each legal, no board met twice. */
export const MOVES = [1, 1, 4, 3, 4, 3, 2, 1];
/** Move i (from 0) of a list is at step 10(i + 1). */
export const moveEntries = (list: readonly number[]): Obj[] => list.map((d, i) => entry(10 * (i + 1), 'move', d));
/** The test's own model of the board after a list of moves from the start (a move the edge stops does nothing). */
export function boardAfter(list: readonly number[]): { board: number[]; moves: number } {
  const board = [1, 2, 3, 4, 5, 6, 7, 8, 0];
  let blank = 8;
  let made = 0;
  for (const d of list) {
    const r = Math.floor(blank / 3);
    const c = blank % 3;
    const to = d === 1 && r > 0 ? blank - 3 : d === 2 && c < 2 ? blank + 1 : d === 3 && r < 2 ? blank + 3 : d === 4 && c > 0 ? blank - 1 : -1;
    if (to < 0) continue;
    board[blank] = board[to]!;
    board[to] = 0;
    blank = to;
    made++;
  }
  return { board, moves: made };
}
/** Criterion 3: undo 5 of the 8 moves, at step 90; one stop past the depth is 6. */
export const UNDO = 5;
export const UNDO_AT = 90;

/**
 * Criterion 5's app and web player track, over 120 steps (2 s): the eight moves, a rewind of 3 stops at step 90 (to move
 * 5's stop, step 50), then up and right at 100 and 110, which the closed branch never made from there.
 */
export const WEB_STEPS = 120;
export const WEB_BACK = 3;
export const WEB_REWIND_AT = 90;
export const WEB_AFTER = [1, 2];
export const webAfter = (): Obj[] => WEB_AFTER.map((d, i) => entry(100 + 10 * i, 'move', d));
export const rewoundPuzzle = (): Obj[] => [...moveEntries(MOVES), rewindEntry(WEB_REWIND_AT, WEB_BACK), ...webAfter()];
export const freshPuzzle = (): Obj[] => [...moveEntries(MOVES.slice(0, MOVES.length - WEB_BACK)), ...webAfter()];

/**
 * Criterion 5's bot (README, The surface): a policy that picks a move every 0.25 s and, every 1.1 s, rewinds 0 to 3
 * stops (0 writes nothing), drawn from the run's seed.
 */
export const BOT: Obj = { policy: { pick: { move: { from: [1, 2, 3, 4], every: 0.25 } }, rewind: { every: 1.1, from: [0, 3] } } };
export const BOT_MOST = 3;
export const RUNS = 20;
export const SEED = 860;
export const SPAN_S = 10;

// ---------------------------------------------------------------------------------------------------
// The puzzle as a document the app presents and the web player plays (canvas primitives: a figure): the logic item
// `puzzle` reading the slider `move`, its rewind at the document's top level, and with `match` a lockstep match of two
// players (`net@1` item `duel`).

const LICENSE: Obj = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Made by the #860 acceptance tests at test time.' };
export const MATCH = 'duel';
export function puzzleDoc(id: string, sha: string, o: { match?: boolean } = {}): Obj {
  const items: Obj = {
    cam: { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0000', params: { projection: 'orthographic', target: [150, 150, 0], view_width: 300 } },
    back: { id: 'back', kind: 'rect@1', name: 'Back', role: 'decoration', order: 'a0001', params: { box: [0, 0, 300, 300], paint: { fill: { role: 'ground' } } }, at: { pos: [0, 0, 0] } },
    [PUZZLE]: {
      id: PUZZLE, kind: 'logic@1', name: 'Puzzle', order: 'a0002',
      params: { program: sha, step_rate: HZ, clock: 'on_input', reads: PUZZLE_READS, writes: PUZZLE_WRITES, checkpoint: { every: 1 } },
    },
  };
  if (o.match) items[MATCH] = { id: MATCH, kind: 'net@1', name: 'Duel', order: 'a0003', params: { relay: 'https://relay.test/860', players: 2, step_rate: HZ, delay: 2, window: 0 } };
  return {
    format: 1, id, profile: 'figure', title: o.match ? 'A sliding puzzle for two' : 'A sliding puzzle',
    description: 'The eight-tile sliding puzzle whose moves are stops a viewer can rewind: a #860 acceptance fixture.',
    size: [300, 300], seed: 860, camera: 'cam', transport: { span: `${WEB_STEPS / HZ}s`, frame_rate: [HZ, 1] },
    requires: { modules: { input: '^1', logic: '^1', ...(o.match ? { net: '^1' } : {}) } },
    rewind: { stops: `${PUZZLE}.stop`, depth: PUZZLE_DEPTH },
    controls: { move: { kind: 'slider', class: 'document', label: 'Move', role: 'slider', range: [0, 4], default: 0, increment: 1 } },
    items,
    assets: { puzzle_program: { sha256: sha, license: LICENSE } },
  };
}

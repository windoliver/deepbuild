// The boards of criteria 1 to 4 and the one check each is held to, in one bounded child: `cap.test.ts` runs
// `refusal` and `budgets.test.ts` runs `sheetCheck`, each once for what holds on any machine and five times more for
// the criterion's numbers. Every count below is from the packs of `fixtures/packs/` and the Recipe section's
// `<instance>.<step>[.<index>]`, by hand (README: Fixtures).

import {
  DIAL, PACKS, ROWS, SHOW_LIMITS, TOWER, WEAVE, WHOLE_LIMITS, board, design, instance, rect, runShow, scenario, show,
  type PackFixture, type Planted,
} from './helpers.ts';
import {
  REPEAT, boundFailures, capOf, checkMs, expandedFailures, installFailures, refusalFailures, repliesOf,
  type Bounded, type JsonObject, type Names,
} from './judge.ts';

/** The chain's steps, by recipe: tower.block@1, tower.floor@1, tower.room@1, tower.shelf@1. */
const TOWER_STEPS = ['floors', 'rooms', 'shelves', 'books'];

export interface Case { title: string; what: string; pack: PackFixture; item: JsonObject; names: Omit<Names, 'cap'> }
/**
 * Criterion 1 as written: four recipes that each repeat 1,024 times, three a nested recipe and the last a mark.
 * 1,024 + 1,024^2 + 1,024^3 + 1,024^4 = 1,100,586,419,200 derived items, were its IDs to fit: the first book would
 * be `t1.floors.0.rooms.0.shelves.0.books.0`, nine segments where an ID holds eight.
 */
export const BLOCK: Case = {
  title: 'A block', what: 'the board of t1, a tower.block@1 (four recipes, each repeating 1,024 times)', pack: TOWER,
  item: instance('t1', 'tower.block@1', {}, 'a0'), names: { instance: 't1', steps: TOWER_STEPS },
};
/** The same pack's last three recipes, the deepest chain whose IDs fit: 1,024 + 1,024^2 + 1,024^3 = 1,074,791,424 derived items. */
export const FLOOR: Case = {
  title: 'A floor', what: 'the board of f1, a tower.floor@1 (three recipes, each repeating 1,024 times)', pack: TOWER,
  item: instance('f1', 'tower.floor@1', {}, 'a0'), names: { instance: 'f1', steps: TOWER_STEPS.slice(1) },
};
/** Criterion 2: per_side rows of per_side cells of per_side dots; at 1,024 that is 1,024 + 1,024^2 + 1,024^3 = 1,074,791,424 derived items. */
export const DIALLED: Case = {
  title: 'A grid', what: 'the board of d1, a dial.grid@1 whose input per_side is 1,024', pack: DIAL,
  item: instance('d1', 'dial.grid@1', { per_side: REPEAT }, 'a0'), names: { instance: 'd1', input: 'per_side' },
};
/** Criterion 3: one rect whose param `threads` is 1,024 lists of 1,024 lists of 1,024 ones: 1,024 + 1,024^2 + 1,024^3 = 1,074,791,424 list elements. */
export const WOVEN: Case = {
  title: 'A mat', what: 'the board of w1, a weave.mat@1 whose step param threads holds three {repeat} lists of 1,024, one in the other', pack: WEAVE,
  item: instance('w1', 'weave.mat@1', {}, 'a0'), names: { instance: 'w1', param: 'steps/mat/params/threads' },
};

export interface Checked { failures: string[]; run: Bounded; reply: JsonObject | null }

/**
 * The check criteria 1 to 3 share, on one board in one bounded child: the child ran to its own end inside its limits
 * and its reply refuses the board with an `over_budget` error naming all the criterion says. `failures` is [] when
 * it does.
 */
export function refusal(dir: string, bin: string, c: Case, planted?: Planted): Checked {
  const stated = capOf(design());
  const failures: string[] = stated.failure === null ? [] : [stated.failure];
  const run = runShow(dir, bin, scenario(dir, [c.pack], [PACKS, show(board(c.title, [c.pack], [c.item]))], planted));
  const out = boundFailures(run, c.what, SHOW_LIMITS);
  if (out.length) return { failures: [...failures, ...out], run, reply: null };
  const { replies, failures: unread } = repliesOf(run.answers[0]?.text ?? null, 2, c.what);
  if (unread.length) return { failures: [...failures, ...unread], run, reply: null };
  const [packs, shown] = replies;
  const uninstalled = installFailures(packs!, c.pack, c.what);
  if (uninstalled.length) return { failures: [...failures, ...uninstalled], run, reply: shown! };
  return { failures: [...failures, ...refusalFailures(shown!, { ...c.names, cap: stated.cap }, c.what)], run, reply: shown! };
}

// ---------------------------------------------------------------------------------------------------
// Criterion 4: "a document of 5,000 items holding one instance whose step repeats a nested recipe 1,024 times".

/** The plain items beside the instance: 4,999 rects and `g1` are 5,000 items. */
const PLAIN = 4_999;
export const SHEET_WHAT = 'the board of 5,000 items holding g1, a rows.sheet@1 whose step repeats a nested recipe 1,024 times';
/** 4,999 rects, 16 px apart on a 40-column grid, and the instance `g1` of rows.sheet@1. */
export function sheetBoard(): JsonObject {
  const items: JsonObject[] = [];
  for (let i = 0; i < PLAIN; i++) items.push(rect(`r-${String(i).padStart(4, '0')}`, [(i % 40) * 16, (Math.floor(i / 40) % 20) * 16, 12, 12], `a${String(i).padStart(5, '0')}`));
  items.push(instance('g1', 'rows.sheet@1', {}, 'b00000'));
  return board('Five thousand items', [ROWS], items);
}
/**
 * What g1 expands to: its step `rows` repeats rows.row@1 1,024 times, so 1,024 nested instances `g1.rows.<i>`, and
 * each row's one step `dot` makes `g1.rows.<i>.dot`: 2 x 1,024 = 2,048 derived items.
 */
export const sheetDerived = (): string[] => Array.from({ length: REPEAT }, (_, i) => [`g1.rows.${i}`, `g1.rows.${i}.dot`]).flat();

export interface Timed extends Checked { ms: number | null }
/** Criterion 4's check on the 5,000-item board in one bounded child: the check ran whole, and its own time. */
export function sheetCheck(dir: string, bin: string, planted?: Planted): Timed {
  const run = runShow(dir, bin, scenario(dir, [ROWS], [PACKS, show(sheetBoard())], planted), WHOLE_LIMITS);
  const out = boundFailures(run, SHEET_WHAT, WHOLE_LIMITS);
  if (out.length) return { failures: out, run, reply: null, ms: null };
  const { replies, failures: unread } = repliesOf(run.answers[0]?.text ?? null, 2, SHEET_WHAT);
  if (unread.length) return { failures: unread, run, reply: null, ms: null };
  const [packs, shown] = replies;
  const uninstalled = installFailures(packs!, ROWS, SHEET_WHAT);
  if (uninstalled.length) return { failures: uninstalled, run, reply: shown!, ms: null };
  const failures = expandedFailures(shown!, 'g1', sheetDerived(), SHEET_WHAT);
  const time = checkMs(shown!, SHEET_WHAT);
  return { failures: time.failure === null ? failures : [...failures, time.failure], run, reply: shown!, ms: time.ms };
}

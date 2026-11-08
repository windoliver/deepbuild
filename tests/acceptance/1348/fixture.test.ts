// AC2, AC3's first sentence and AC4: the lane's fixture run, with no plant, through the dump of every string it shows.
// Every judgement on a string is made here against the repo's word list, never taken from the lane's own verdict.

import { beforeAll, describe, expect, it } from 'vitest';
import { AC2, AC3, AC4, FAILED_TASK, FOUR, TRACE_LINES, TRACE_PIECES, isPlain, lane, listedIn, rowShowing, tail, words, type LaneRun } from './helpers.ts';

let run: LaneRun;
let list: Record<string, string>;

beforeAll(async () => {
  list = words();
  run = await lane();
}, 45 * 60_000);

describe("the fixture run's strings", () => {
  it(`${AC2}: a fixture run's card, page, notifications and end notice hold no listed word in a dump of every string shown`, () => {
    for (const surface of FOUR) {
      expect(run.dump.shown.filter((item) => item.surface === surface && item.text.trim()).length, `the dump shows nothing on the ${surface}`).toBeGreaterThan(0);
    }
    const offenders = run.dump.shown
      .filter((item) => isPlain(item.surface))
      .map((item) => ({ ...item, words: listedIn(item.text, list) }))
      .filter((item) => item.words.length);
    expect(offenders, 'plain surfaces hold listed words').toEqual([]);
    // The same run's detail views hold the real names, so the run had listed words to keep off the plain surfaces.
    const real = run.dump.shown.filter((item) => !isPlain(item.surface) && listedIn(item.text, list).length);
    expect(real, "no detail view of the run holds a real name, so its plain surfaces prove nothing").not.toEqual([]);
    expect(run.status, `the lane failed the fixture run\n${tail(run.output)}`).toBe(0);
  });

  it(`${AC3}: a planted failure with a stack trace reaches the page as one plain line and what happens next`, () => {
    const { row, strings } = rowShowing(run.dump, FAILED_TASK);
    expect(row.problem, `the page row for "${FAILED_TASK}" tells no problem`).not.toBeNull();
    const { happened, next } = row.problem!;
    for (const [part, text] of [['what happened', happened], ['what happens next', next]] as const) {
      expect(text.trim(), `the row for "${FAILED_TASK}" says nothing for ${part}`).not.toBe('');
      expect(text, `${part} runs over one line`).not.toContain('\n');
      expect(strings.some((shown) => shown.includes(text)), `the page row doesn't show ${part}: "${text}"`).toBe(true);
      expect(listedIn(text, list), `${part} holds a listed word`).toEqual([]);
      // No code and no path in the plain line.
      expect(text, `${part} holds a path`).not.toMatch(/(^|[\s(])(~|\.{1,2})?\/[\w.-]+\/[\w.-]+/);
      expect(text, `${part} holds code`).not.toMatch(/`|=>|::|\w+\([^)]*\)|\w+\.\w+:\d+/);
    }
    expect(next, 'what happens next only repeats what happened').not.toBe(happened);
    // No piece of the trace on any plain surface.
    const traced = run.dump.shown.filter((item) => isPlain(item.surface) && TRACE_PIECES.some((piece) => item.text.includes(piece)));
    expect(traced, 'a plain surface shows the stack trace').toEqual([]);
    // The detail is one click away: the row's detail holds the trace's first line.
    const detail = run.dump.shown.filter((item) => item.surface === 'detail' && item.row === row.id);
    expect(detail.some((item) => item.text.includes(TRACE_LINES[0]!)), `one click on the row for "${FAILED_TASK}" doesn't show the failure's trace`).toBe(true);
  });

  it(`${AC4}: each row still opens its detail, with the real names, in one click`, () => {
    const ids = run.dump.rows.map((row) => row.id);
    expect(new Set(ids).size, 'two rows share an id').toBe(ids.length);
    expect(ids.length, 'the page shows fewer than two rows').toBeGreaterThanOrEqual(2);
    for (const id of ids) {
      const shown = run.dump.shown.filter((item) => item.surface === 'page' && item.row === id);
      expect(shown.length, `row ${id} isn't on the page`).toBeGreaterThan(0);
      const detail = run.dump.shown.filter((item) => item.surface === 'detail' && item.row === id);
      expect(detail.length, `one click on row ${id} opens nothing`).toBeGreaterThan(0);
      const real = detail.flatMap((item) => listedIn(item.text, list));
      expect(real, `row ${id}'s detail holds none of the real names (${Object.keys(list).join(', ')})`).not.toEqual([]);
    }
  });
});

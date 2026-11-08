// AC1 and AC3's second sentence: the lane run with a planted program. The plants live in the component that draws the
// surface and are selected by DEEP_HUB_PLANT (README, plants); each test first checks its plant was drawn, so a lane or
// build that ignores the plant fails here, never passes.

import { describe, expect, it } from 'vitest';
import { AC1, AC3, PR_LINE, TRACE, TRACE_LINES, isPlain, lane, listedIn, tail, words } from './helpers.ts';

const LONG = 45 * 60_000;

describe('the lane that fails a listed word', () => {
  it(`${AC1}: a planted card line holding "PR" fails the lane, naming the string and its plain word`, async () => {
    const list = words();
    const run = await lane('card-line-pr');
    // The plant reached the card the lane read.
    expect(run.dump.shown.some((item) => item.surface === 'card' && item.text.includes(PR_LINE)), `the dump's card holds no "${PR_LINE}"; the plant was never drawn`).toBe(true);
    expect(run.status, `the lane passed a card that says "${PR_LINE}"\n${tail(run.output)}`).not.toBe(0);
    // One line of its output names the string and PR's plain word from the list.
    const plain = list.PR!;
    const naming = run.output.split('\n').filter((line) => line.includes(PR_LINE) && line.replace(PR_LINE, '').includes(plain));
    expect(naming, `no line of the lane's output names "${PR_LINE}" with its plain word "${plain}"\n${tail(run.output)}`).not.toEqual([]);
  }, LONG);

  it(`${AC1}: the same word on a session's page passes`, async () => {
    words();
    const run = await lane('session-page-line-pr');
    const pages = run.dump.shown.filter((item) => item.surface === 'session_page');
    expect(pages.some((item) => item.text.includes(PR_LINE)), `the dump's session page holds no "${PR_LINE}"; the plant was never drawn`).toBe(true);
    expect(run.dump.shown.filter((item) => isPlain(item.surface) && item.text.includes(PR_LINE)), 'the session page plant reached a plain surface').toEqual([]);
    expect(run.status, `the lane failed "${PR_LINE}" on a session's page, a detail view\n${tail(run.output)}`).toBe(0);
  }, LONG);

  it(`${AC3}: a view that shows the trace fails, naming it`, async () => {
    const list = words();
    // The premise: the lane must catch the trace as a trace, not through a listed word inside it.
    expect(listedIn(TRACE, list), "the planted trace holds a listed word, so it can't show the lane reads a trace").toEqual([]);
    const run = await lane('page-shows-trace');
    const shownTrace = run.dump.shown.filter((item) => item.surface === 'page' && TRACE_LINES.some((line) => item.text.includes(line)));
    expect(shownTrace, "the dump's page shows no line of the trace; the plant was never drawn").not.toEqual([]);
    expect(run.status, `the lane passed a page that shows the stack trace\n${tail(run.output)}`).not.toBe(0);
    const naming = run.output.split('\n').filter((line) => TRACE_LINES.some((traced) => line.includes(traced)));
    expect(naming, `no line of the lane's output names the trace it found\n${tail(run.output)}`).not.toEqual([]);
  }, LONG);
});

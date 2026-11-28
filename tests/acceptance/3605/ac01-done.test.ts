// AC1 #3605.2b30a7aa: "A fixture shell has six levels in two chapters of three, with `unlocked: [0, 1, 2, 3, 4, 5]`. At
// the start all six rows are enabled and every `done` element is false. Entering level 4 first and completing it turns
// `done[4]` true at the step the level's own `done` turns true, and no other element. Its row shows its mark, and the
// two chapters' counts read "0 of 3" and "1 of 3", each a driver over `done`. A planted shell that marks a level when it
// is entered fails, naming the level and the step."
//
// The fixture shell (shell.ts) through the playtest plug-in's shell.journeys, its `moves` journey with keys at the
// reference window: from the title, the level select, then level 4 (circuits) entered first and played until it is
// completed at its step 900. The check passes. In the replica's rows: row 0's `done` is six falses; the first row on the
// level select lists row_0 to row_5 as enabled; no level is loaded before level 4; `done` first turns true at the row
// whose step ran level 4's step 900 (the row before it holds level 4 at level step 900, its own `l4.done` still 0) and
// from then on reads [0, 0, 0, 0, 1, 0]. At the play's end the level select shows row 4's "Done" child and every other
// row's "To do" child, and the counts read "0 of 3" and "1 of 3" (drivers over `game.done`, in the fixture).
// On a replica planted with DEEP_DRIVE_PLANT=done-on-enter, `done[4]` turns true while level 4 is loaded and before its
// step 900 has run, and the check fails with a failure naming level 4 (circuits, or "level 5" as the shell counts) and
// the step of the first row that holds the mark.
// The wrong programs: the base (no `done`), a shell that marks a level when entered, when its row is activated or when
// any level completes, a level select whose counts are fixed text, and a check that never judges `done`.
import { describe, expect, it } from 'vitest';
import { AC, DOC, FINISH_AT, TIMEOUT, doneOf, failed, hubOnce, journeysInput, macOnly, namesLevel, none, onePlay, passed, putShell, runJourneys, show, shown, stepped, word } from './helpers.ts';
import { LEVEL_NAMES, MARK, allPrograms, completeFromTitle, programs, shellDocument } from './shell.ts';

const clean = hubOnce();
const planted = hubOnce({ plant: 'done-on-enter' });
const L = 4;

describe(`${AC[1]} every level open from the start; completing level 4 first marks done[4] alone, at the step its own done turns true`, () => {
  it(`${AC[1]} all six rows enabled and done all false at the start; level 4 completed first turns done[4] true at its step 900, its row shows Done, and the counts read 0 of 3 and 1 of 3`, async () => {
    macOnly();
    const p = programs();
    const h = await clean();
    const piece = putShell(DOC.shell, shellDocument(p), allPrograms(p));
    const result = await runJourneys(h, journeysInput(piece, { journeys: ['moves'], moves: completeFromTitle(L) }));
    passed(result, 'the moves journey that completes level 4 first, with keys');
    const reply = onePlay(h.pool, piece, 'moves', 'keys', 'level 4 completed first');
    const rows = stepped(reply, 'level 4 completed first');
    const gaps: string[] = [];
    if (doneOf(rows[0]!) !== '000000') gaps.push(`at the start done is ${doneOf(rows[0]!)}, not six falses`);
    const select = rows.find((r) => r.screen === 'levels');
    const rowIds = LEVEL_NAMES.map((_, i) => `row_${i}`);
    if (!select) gaps.push('the level select is never shown');
    else if (!rowIds.every((id) => select.enabled.includes(id))) gaps.push(`on the level select at step ${select.step} the enabled rows are ${select.enabled.join(', ')}, not all six`);
    const first = rows.find((r) => r.level >= 0);
    if (first?.level !== L) gaps.push(`the first level loaded is ${first ? first.level : 'none'}, not level ${L}`);
    const marked = rows.findIndex((r) => r.done.some(Boolean));
    if (marked < 0) gaps.push('done never turns true');
    else {
      const before = rows[marked - 1];
      if (!before || before.level !== L || before.level_step !== FINISH_AT) gaps.push(`done first turns true at step ${rows[marked]!.step}, whose step before holds level ${before?.level} at level step ${before?.level_step}, not level ${L} at level step ${FINISH_AT} (its step ${FINISH_AT} runs at the step its own done turns true)`);
      else if (before.values[`l${L}.done`]?.[0] !== 0) gaps.push(`before its step ${FINISH_AT}, l${L}.done reads ${String(before.values[`l${L}.done`])}, not 0`);
      const wrong = rows.slice(marked).find((r) => doneOf(r) !== '000010');
      if (wrong) gaps.push(`at step ${wrong.step} done is ${doneOf(wrong)}, not only done[4]`);
    }
    const texts = reply.screens.levels?.texts ?? {};
    for (let i = 0; i < LEVEL_NAMES.length; i++) {
      const [want, not] = i === L ? [`row_${i}_done`, `row_${i}_todo`] : [`row_${i}_todo`, `row_${i}_done`];
      const shownWords = i === L ? MARK.done : MARK.todo;
      if (texts[want] !== shownWords) gaps.push(`row ${i} shows ${show(texts[want])} for ${want}, not ${shownWords}`);
      if ((texts[not] ?? '') !== '') gaps.push(`row ${i} also shows ${not}: ${show(texts[not])}`);
    }
    if (!word('0 of 3').test(texts['ch1_count'] ?? '')) gaps.push(`chapter one's count reads ${show(texts['ch1_count'])}, not 0 of 3`);
    if (!word('1 of 3').test(texts['ch2_count'] ?? '')) gaps.push(`chapter two's count reads ${show(texts['ch2_count'])}, not 1 of 3`);
    none(gaps, 'the replica\'s rows and level select of level 4 completed first');
  }, TIMEOUT);

  it(`${AC[1]} a planted shell that marks a level when it is entered fails, naming the level and the step`, async () => {
    macOnly();
    const p = programs();
    const h = await planted();
    const piece = putShell(DOC.shell, shellDocument(p), allPrograms(p));
    const result = await runJourneys(h, journeysInput(piece, { journeys: ['moves'], moves: completeFromTitle(L) }));
    const rows = onePlay(h.pool, piece, 'moves', 'keys', 'the planted shell').rows;
    const r = rows.find((x) => x.done[L]);
    expect(r && r.level === L && r.level_step <= FINISH_AT, `the planted shell marks level ${L} while it is loaded, before its step ${FINISH_AT} has run: ${show(r)}`).toBe(true);
    failed(result, 'the planted shell\'s moves journey');
    const steps = [r!.step - 1, r!.step, r!.step + 1].map((s) => `step ${s}`);
    const named = result.failures.some((f) => namesLevel(f.message, L, LEVEL_NAMES[L]) && steps.some((s) => word(s).test(f.message)));
    expect(named, `a failure names level ${L} (${LEVEL_NAMES[L]}) and the step it was marked at (${r!.step}): ${shown(result)}`).toBe(true);
  }, TIMEOUT);
});

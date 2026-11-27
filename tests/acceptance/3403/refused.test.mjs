// #3403 acceptance, criteria 1, 3 and 4: what the guard refuses under Decisions with no approval. Each test plants one
// commit in a scratch repository and runs this checkout's `node scripts/proof.mjs guard` there; it reads the exit
// status and what the guard prints. See README.md.
import test from 'node:test';
import {
  ADDED_ROW, DECIDED_LAST, DEEP_HEADING, DESIGN, HOSTED, LIMIT, NEW_ROWS, NEW_TABLE, SUB_HEADING, SUB_PARAGRAPH, WIP_ROW, WIP_ROW_CHANGED,
  below, edit, guard, lineOf, namesLine, refuses, repository, reworded, withNewTable,
} from './helpers.mjs';

test('#3403.69cb5bd7 one commit that adds a ### heading and a table of two rows after a blank line inside Decisions, with no approval, fails the guard, naming docs/technical-design.md and the line of the first added row', LIMIT, (t) => {
  const w = repository(t);
  const text = withNewTable();
  edit(w, text, 'Add the decisions for what a project learns');
  const r = guard(t, w, 'a new heading and a table of two rows after a blank line, no approval');
  refuses(r, 'rows that follow a blank line under a new heading are a guarded edit');
  // The first added line that is a row of the table, its header, or the first of the two rows the criterion counts.
  namesLine(r, 'the first added row', [lineOf(text, NEW_ROWS[0]) - 2, lineOf(text, NEW_ROWS[0])]);
});

test('#3403.69cb5bd7 a table added on the lines right after an existing ### heading inside Decisions, which follow no blank line and no row, fails the guard too, whatever line a row follows', LIMIT, (t) => {
  const w = repository(t);
  edit(w, below(DESIGN, HOSTED, NEW_TABLE), 'Add two decisions for a hosted hub');
  refuses(guard(t, w, 'a table right under an existing heading, no approval'), 'a row added anywhere inside Decisions is a guarded edit');
});

test('#3403.0dd07b16 a commit that adds one row at the end of an existing table fails the guard as on the merge base, naming its line', LIMIT, (t) => {
  const w = repository(t);
  const text = below(DESIGN, DECIDED_LAST, [ADDED_ROW]);
  edit(w, text, 'Decide how a release is published');
  const r = guard(t, w, 'one row at the end of the Decided table, no approval');
  refuses(r, 'a row added at the end of a table is refused as before');
  // The row it is added to, as the merge base names it, or the added row's own line.
  namesLine(r, 'the added row', [lineOf(text, DECIDED_LAST), lineOf(text, ADDED_ROW)]);
});

test('#3403.0dd07b16 a commit that changes a row\'s text fails the guard as on the merge base, naming its line', LIMIT, (t) => {
  const w = repository(t);
  const text = reworded(DESIGN, WIP_ROW, WIP_ROW_CHANGED);
  edit(w, text, 'Narrow when work-in-progress commits reopen');
  const r = guard(t, w, 'the Reopens if cell of one row changed, no approval');
  refuses(r, 'a changed row is refused as before');
  namesLine(r, 'the changed row', [lineOf(text, WIP_ROW_CHANGED)]);
});

test('#3403.62dbb38a a commit that adds a #### heading with a paragraph under it inside Decisions, and no row, fails the guard, naming the heading\'s line', LIMIT, (t) => {
  const w = repository(t);
  const text = below(DESIGN, HOSTED, ['', SUB_HEADING, '', SUB_PARAGRAPH]);
  edit(w, text, 'Say when the hosted hub decisions bind');
  const r = guard(t, w, 'a #### heading and a paragraph, no row, no approval');
  refuses(r, 'a heading added inside Decisions is a guarded edit');
  namesLine(r, 'the added heading', [lineOf(text, SUB_HEADING)]);
});

test('#3403.62dbb38a a commit that adds a ##### heading alone inside Decisions fails the guard too, a heading of any level', LIMIT, (t) => {
  const w = repository(t);
  edit(w, below(DESIGN, HOSTED, ['', DEEP_HEADING]), 'Open a heading for hosted hubs by region');
  refuses(guard(t, w, 'a ##### heading alone, no approval'), 'a heading of any level added inside Decisions is a guarded edit');
});

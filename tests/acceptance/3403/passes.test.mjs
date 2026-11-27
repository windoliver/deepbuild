// #3403 acceptance, criteria 5 and 6: what passes today still passes, with no approval. Each test plants its change
// in a scratch repository and runs this checkout's `node scripts/proof.mjs guard` there. See README.md.
import test from 'node:test';
import {
  ADDED_ROW, DECIDED_LAST, DESIGN, DESIGN_WITH_GLOSSARY, GLOSSARY, LIMIT, MADE_ANCHOR, NEW_HEADING, NEW_TABLE, SECTION, WEEKS, WIP_ROW, WIP_ROW_CHANGED,
  above, below, edit, git, guard, passes, repository, reworded, withNewTable,
} from './helpers.mjs';

test('#3403.88a04a1b a commit that adds a blank line inside Decisions passes the guard with no approval', LIMIT, (t) => {
  const w = repository(t);
  edit(w, below(DESIGN, MADE_ANCHOR, ['']), 'Space the Decided heading from its anchor');
  passes(guard(t, w, 'one blank line inside Decisions, no approval'), 'a blank line inside Decisions is no guarded edit');
});

test('#3403.88a04a1b a commit that adds a table under a heading outside Decisions, on the lines just before the section, passes the guard with no approval', LIMIT, (t) => {
  const w = repository(t);
  edit(w, above(DESIGN, SECTION, [NEW_HEADING, '', ...NEW_TABLE, '']), 'Add a table to the six weeks');
  passes(guard(t, w, 'criterion 1\'s heading and table, ahead of the Decisions heading, no approval'), 'a table outside Decisions is no guarded edit');
});

test('#3403.88a04a1b a commit that adds a table under a heading in the section after Decisions passes the guard with no approval', LIMIT, (t) => {
  const w = repository(t, DESIGN_WITH_GLOSSARY);
  edit(w, below(DESIGN_WITH_GLOSSARY, GLOSSARY, ['', NEW_HEADING, '', ...NEW_TABLE]), 'Add a table to the glossary');
  passes(guard(t, w, 'criterion 1\'s heading and table, under the heading that ends Decisions, no approval'), 'a table after Decisions ends is no guarded edit');
});

test('#3403.8fe962c0 a merge commit that brings in rows main already holds passes the guard, as on the merge base', LIMIT, (t) => {
  const w = repository(t);
  // The change's own commit edits the same file outside Decisions, so the merge joins two edits of one file.
  edit(w, reworded(DESIGN, WEEKS, 'Each week ends with a release that passed the preflight on every platform.'), 'Say where a week\'s release passed');
  // Main lands decisions of its own: criterion 1's heading and table, a row at the end of a table, a row's changed text.
  git(w, 'checkout', '-q', 'main');
  edit(w, below(reworded(withNewTable(), WIP_ROW, WIP_ROW_CHANGED), DECIDED_LAST, [ADDED_ROW]), 'Land new decisions');
  git(w, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(w, 'checkout', '-q', 'session/3403');
  git(w, 'merge', '-q', '--no-ff', '-m', 'Merge main', 'origin/main');
  passes(guard(t, w, 'the change merges main, which holds new rows under Decisions'), 'rows a merge takes from main as they are need no approval');
});

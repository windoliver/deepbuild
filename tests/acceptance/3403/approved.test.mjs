// #3403 acceptance, criterion 2: criterion 1's commit under an approval tag. The tag is signed for real by a
// security-key stand-in the merge base's approvers list names, and checked by the real ssh-keygen. See README.md.
import test from 'node:test';
import { DESIGN_PATH, LIMIT, approve, edit, guard, note, passes, refuses, repository, withNewTable } from './helpers.mjs';

const MESSAGE = 'Propose the decisions for what a project learns';

test('#3403.15e88fe0 the same commit, touching only docs/technical-design.md and approved by a signed tag that holds Approves: docs/technical-design.md, passes the guard', LIMIT, (t) => {
  const w = repository(t);
  const proposal = edit(w, withNewTable(), MESSAGE);
  approve(w, w.person, [DESIGN_PATH], { on: proposal });
  passes(guard(t, w, 'the new table as its own proposal, under a signed tag'), 'the new table passes as its own approved proposal');
});

test('#3403.15e88fe0 the same tag unsigned approves nothing, and the guard fails naming docs/technical-design.md', LIMIT, (t) => {
  const w = repository(t);
  const proposal = edit(w, withNewTable(), MESSAGE);
  approve(w, null, [DESIGN_PATH], { on: proposal });
  refuses(guard(t, w, 'the new table under the same tag, unsigned'), 'an unsigned tag approves nothing');
});

test('#3403.15e88fe0 the same edit in a commit that touches one more file, under the same signed tag, fails the guard, since it passes only as its own approved proposal', LIMIT, (t) => {
  const w = repository(t);
  note(w);
  const wide = edit(w, withNewTable(), MESSAGE);
  approve(w, w.person, [DESIGN_PATH], { on: wide });
  refuses(guard(t, w, 'the new table and one more file in the approved commit'), 'an approved commit that carries more than the file its tag names is no proposal of its own');
});

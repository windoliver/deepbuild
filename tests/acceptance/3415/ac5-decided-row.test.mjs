import assert from 'node:assert/strict';
import { test } from 'node:test';
import { approve, edit, guard, note, passes, refuses, repository } from '../3403/helpers.mjs';
import { DESIGN, baseFile, checkoutFile } from './helpers.mjs';

const ID = '#3415.5803b056';
const LIMIT = { timeout: 300_000 };
const NOW = 'One open PR per thread.';

function decidedRows(text) {
  const lines = text.split('\n');
  const start = lines.indexOf('### Decided');
  assert.ok(start >= 0, `BLOCKED: ${DESIGN} has no ### Decided heading`);
  const end = lines.findIndex((line, i) => i > start && /^#{1,3} /.test(line));
  return lines.slice(start, end < 0 ? undefined : end).map((line, i) => ({ line, number: start + i + 1 })).filter(({ line }) => line.startsWith('|'));
}

function theRow() {
  const was = decidedRows(baseFile(DESIGN)).filter(({ line }) => /^\| One PR per thread \|/.test(line));
  assert.equal(was.length, 1, 'BLOCKED: the merge base has no one row "One PR per thread" under Decided');
  const now = decidedRows(checkoutFile(DESIGN)).filter(({ line }) => /^\| One PR per thread \|/.test(line) || line.includes('One open PR per thread'));
  assert.equal(now.length, 1, `${DESIGN} has ${now.length} rows for one PR per thread under Decided, not one`);
  const cell = now[0].line.split('|')[2]?.trim() ?? '';
  assert.ok(cell.startsWith(NOW) && !/thread of work/.test(cell), `the row under Decided reads "${cell}", not "${NOW}"`);
  assert.notEqual(now[0].line, was[0].line, 'the row reads as on the merge base');
  const text = checkoutFile(DESIGN);
  const lines = text.split('\n');
  lines[now[0].number - 1] = was[0].line;
  return { before: lines.join('\n'), after: text, number: now[0].number };
}

test(`${ID} AC5: the row under Decided reads "${NOW}", and in a commit that touches only ${DESIGN}, approved by a signed tag, it passes the edit guard`, LIMIT, (t) => {
  const { before, after } = theRow();
  const w = repository(t, before);
  const proposal = edit(w, after, 'One open PR per thread');
  approve(w, w.person, [DESIGN], { on: proposal });
  passes(guard(t, w, 'the row as its own commit, under a signed tag naming the design'), 'the row passes as its own approved proposal');
});

test(`${ID} AC5: the same edit in a commit that touches another file fails the edit guard, naming the row, under the same signed tag`, LIMIT, (t) => {
  const { before, after, number } = theRow();
  const w = repository(t, before);
  note(w);
  const wide = edit(w, after, 'One open PR per thread, and a note');
  approve(w, w.person, [DESIGN], { on: wide });
  const r = guard(t, w, 'the row and one more file, under a signed tag naming the design');
  refuses(r, 'the row in a commit that touches another file');
  const fails = r.stdout.split('\n').filter((line) => line.startsWith('FAIL guard:'));
  assert.ok(fails.some((line) => new RegExp(`${DESIGN.replace('.', '\\.')}:${number}(?!\\d)`).test(line)), `no FAIL guard line names the row, ${DESIGN}:${number}\n${r.out}`);
});

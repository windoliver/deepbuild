// #2401 AC4: "The decision is a row under Decided with the reading's date and Claude Code's version, and it reads not
// set, or offered and off. It reads on by default only beside a link to the maker's own statement". Scope: the rule
// written before the runs; the name is on by default only on that maker's written word, linked from the row.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AC, DECISIONS, DESIGN, RECORD, dateForms, decidedRows, fromMaker, links, loadRecord, outcome, readText, recompute, runs,
} from './helpers.mjs';

// The row is the one under Decided that names the variable or this issue.
const OURS = /CLAUDE_CODE_ENTRYPOINT|#2401\b|issues\/2401\b/;

test(`${AC[4]} one row under Decided names the decision with the reading's date and Claude Code's version, reads not set or offered and off as the rule gives it, and on by default only beside a link to the maker's own statement`, () => {
  const r = loadRecord();
  const want = outcome(recompute(r, runs(r), 'five_hour'));
  const rows = decidedRows(readText(DESIGN, 'the design')).filter((row) => OURS.test(row.line));
  assert.equal(rows.length, 1, `${DESIGN}: one row under "### Decided" names CLAUDE_CODE_ENTRYPOINT or #2401; found ${rows.length}`);
  const [{ line, cells }] = rows;
  assert.ok(cells.length >= 3 && cells.slice(0, 3).every((c) => c.length), `${DESIGN}: the row has its question, decision and what reopens it: ${line.slice(0, 200)}`);
  const decision = cells[1].replace(/^\*+/, '').toLowerCase();
  const reads = DECISIONS.find((d) => decision.startsWith(d));
  assert.ok(reads, `${DESIGN}: the row's decision starts "Not set", "Offered and off" or "On by default": ${cells[1].slice(0, 120)}`);
  assert.equal(r.decision, reads, `${RECORD}: decision is the row's (${reads}): ${JSON.stringify(r.decision)}`);

  assert.ok(dateForms(r.reading.date).some((d) => line.includes(d)), `${DESIGN}: the row gives the reading's date (${r.reading.date}, or written ${dateForms(r.reading.date)[1]})`);
  assert.ok(new RegExp(`(^|[^\\d.])${r.claude_code_version.replace(/\./g, '\\.')}($|[^\\d])`).test(line), `${DESIGN}: the row gives Claude Code's version, ${r.claude_code_version}`);

  const maker = links(line).filter(fromMaker);
  if (/on by default/i.test(line)) {
    assert.ok(maker.length, `${DESIGN}: the row reads "on by default" with no link to the maker's own statement (a link on anthropic.com, claude.com or claude.ai)`);
  }
  if (reads === 'on by default') {
    assert.equal(want, 'offered and off', `${DESIGN}: on by default needs the measured gap first, but the rule gives ${want}`);
    assert.ok(maker.includes(r.maker_statement), `${RECORD}: maker_statement is the maker's statement the row links: ${JSON.stringify(r.maker_statement)}`);
  } else {
    assert.equal(reads, want, `${DESIGN}: the row reads ${reads}, but the rule on the runs' 5-hour reading gives ${want}`);
  }
});

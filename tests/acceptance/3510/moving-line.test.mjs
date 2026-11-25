// #3510: a buildBinaries call keeps its place in the build line for as long as build grants change hands
// (docs/parallel-proof.md, section 6, a wait bounded by a stall). The real buildBinaries, with DEEP_TEST_GRANT_STALL
// at 0.05 (3 s), joins a line of build holders on the test's own table whose grants change hands about every 2 s for
// 20 s: longer than the bound in all, each hand-over inside it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { builtIn, call, entriesOf, fixture, joined, LONG, movingLine, sandbox, showLog, SLOTS, tableLog, within } from './helpers.mjs';

const STALL = '0.05';

test('#3510.a06361ca with DEEP_TEST_GRANT_STALL at 0.05, a buildBinaries call behind a line of build holders whose grants change hands about every 2 s for 20 s gets its build grant and returns its bin holding the binary', LONG, async (t) => {
  const box = sandbox(t);
  const fx = fixture(box);
  // #3334's moving line: six holders a slot waiting ahead at every moment, for 20 s from its first grant.
  const line = movingLine(box, { table: box.table, home: box.home, runFor: 20_000 });
  const ready = await within(line.line(/^READY /), 2);
  assert.ok(ready, `the line of build holders never moved (no grant changed hands within 2 min)\n${line.output()}\n${showLog(box.table)}`);

  const request = call(box, fx, { env: { DEEP_TEST_GRANT_STALL: STALL } });
  const pid = await request.callerPid();
  const inLine = pid ? await joined(box, request, pid) : null;
  const grants = () => tableLog(box.table).filter((entry) => entry.event === 'granted' && entry.class === 'build');
  const before = grants().length;
  const ended = await request.ended(8);
  const all = () => `call: ${ended ? ended.text : `still running after 8 min\n${request.output()}`}\nline:\n${line.output()}\n${showLog(box.table)}`;
  assert.ok(pid, `the caller started and was about to call buildBinaries\n${all()}`);
  assert.ok(ended, `the call ended within 8 minutes of joining a line that moved for 20 s\n${all()}`);
  assert.equal(ended.threw, undefined, `a call whose line keeps moving never leaves it; buildBinaries threw: ${ended.threw}\n${all()}`);
  builtIn(assert, fx, ended, all);

  // It waited its turn: it was seen in line, and more than the bound's worth of holders' grants came before its own.
  assert.equal(inLine, true, `the call joined the line behind the holders\n${all()}`);
  const own = entriesOf(box, pid).filter((entry) => entry.event === 'granted');
  assert.equal(own.length, 1, `the log holds one granted entry for the call's build request\n${all()}`);
  const at = grants().findIndex((entry) => entry.id === own[0].id);
  assert.ok(at - before >= 3 * SLOTS, `at least ${3 * SLOTS} holders' grants (6 s of hand-overs, twice the ${STALL}-min bound) came between the call joining the line and its grant; ${at - before} did\n${all()}`);
});

// #3334: a throttle request bounded by a stall, not a clock (docs/parallel-proof.md, section 6). The real
// `node scripts/throttle.mjs build --stall 0.05 -- <command>` runs on a table of the test's own (DEEP_THROTTLE_TABLE),
// behind a line of build grants that keeps changing hands, and behind one that stands still.
import assert from 'node:assert/strict';
import test from 'node:test';
import { grantsIn, lines, movingLine, sandbox, showLog, SLOTS, STALL, stallRequest, stillLine, within } from './helpers.mjs';

const LONG = { timeout: 900_000 };

test('#3334.6c8b5837 a build --stall 0.05 request behind a line whose grants change hands about every 2 s for 20 s is granted and runs its command', LONG, async (t) => {
  const box = sandbox(t);
  // 20 s of hand-overs, longer than the 3 s bound in all; the line keeps six holders a slot waiting ahead.
  const line = movingLine(box, { table: box.table, home: box.home, runFor: 20_000 });
  const ready = await within(line.line(/^READY /), 2);
  assert.ok(ready, `the line of build holders never moved (no grant changed hands within 2 min)\n${line.output()}\n${showLog(box.table)}`);
  const before = grantsIn(box.table).length;

  const request = stallRequest(box);
  const run = await within(request.done, 6);
  const all = () => `request: ${run ? `exit ${run.status}\n${run.stdout}${run.stderr}` : 'still waiting after 6 min'}\nline:\n${line.output()}\n${showLog(box.table)}`;
  assert.ok(run, `the --stall request was still waiting 6 minutes after it joined the line\n${all()}`);
  assert.equal(run.status, 0, `the --stall request behind a moving line is granted, runs its command and exits with its status (0)\n${all()}`);
  assert.ok(lines(run.stdout).includes('COMMAND-RAN-3334'), `the request's command ran\n${all()}`);
  assert.doesNotMatch(run.stdout, /INCONCLUSIVE no grant/, `a request whose line keeps moving never leaves it\n${all()}`);
  const token = request.ran();
  assert.match(String(token), /^build:\S+$/, `the command ran under a build grant\n${all()}`);

  // It waited its turn behind the line: holders' grants came after it asked, more than the bound's worth of them.
  const grants = grantsIn(box.table);
  const at = grants.findIndex((entry) => `build:${entry.id}` === token);
  assert.ok(at >= 0, `the log holds the request's grant ${token}\n${all()}`);
  assert.ok(at - before >= 3 * SLOTS, `at least ${3 * SLOTS} holders' grants (6 s of hand-overs, past the ${STALL}-min bound) came between the request's start and its grant; ${at - before} did\n${all()}`);
});

test('#3334.ed504fe3 a build --stall 0.05 request behind build grants that never change hands ends INCONCLUSIVE no grant naming each holder, exits 3 and never runs its command', LONG, async (t) => {
  const box = sandbox(t);
  // Every build slot held for ten minutes, past the bound, and nothing else in the table.
  const holders = await stillLine(box, { table: box.table, home: box.home });
  assert.ok(holders.every(Boolean), `every holder took its build grant\n${holders.map((holder) => holder?.child.output()).join('\n')}\n${showLog(box.table)}`);

  const request = stallRequest(box);
  const run = await within(request.done, 3);
  const all = () => `request: ${run ? `exit ${run.status}\n${run.stdout}${run.stderr}` : 'still waiting after 3 min'}\n${showLog(box.table)}`;
  assert.ok(run, `the --stall request was still waiting 3 minutes behind a line that never moved\n${all()}`);
  assert.equal(run.status, 3, `a request whose line stalls exits 3, as a timed-out wait does\n${all()}`);
  const first = lines(run.stdout).find((text) => text.startsWith('INCONCLUSIVE no grant'));
  const head = `INCONCLUSIVE no grant: no build grant changed hands within ${STALL} min`;
  assert.ok(first?.startsWith(head), `the request ends "${head}"\n${all()}`);
  for (const holder of holders) {
    const named = first.match(new RegExp(`; blocked by build grant ${holder.id} held by pid ${holder.pid} since (\\S+) \\(([^)]*)\\)`));
    assert.ok(named, `the line names holder ${holder.name}: "; blocked by build grant ${holder.id} held by pid ${holder.pid} since <time> (<command>)"\n${all()}`);
    assert.ok(named[2].includes(holder.name), `the holder's command is named: (${named[2]}) holds ${holder.name}\n${all()}`);
  }
  assert.equal(request.ran(), null, `the request's command never ran\n${all()}`);
  assert.ok(!lines(run.stdout).includes('COMMAND-RAN-3334'), `the request's command never ran\n${all()}`);
});

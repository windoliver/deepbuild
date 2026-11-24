// #3297 AC1 (#3297.758dee21), the other sessions: a build request another session makes while an untimed job of a filling
// preflight runs is granted before the preflight ends, by the throttle's log. What timed grants the preflight itself holds
// is timed.test.mjs's.
//
// One scene, one run of scripts/preflight on a tree with nothing kept. One job of each untimed kind is held part way: the
// parallel block, an alone group, `cargo test` and `node --test`. While each is held another session asks for a build, and
// the job goes on once that request is granted, or once its bound has passed. Such a job takes no build grant of any
// session's (an alone group takes a turn on the pool), so the request is granted while the job still runs. `cargo test` is
// itself a build, as any session's is, and takes the Mac's one build grant, so a request made beside it may wait for it:
// that job goes on once the request is in line.
//
// The planted program that claims timed for the whole run is the merge base. The preflight's end is the log's: the release
// of the last timed grant, after which the base's requests are granted, or its exit.
import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import { aloneFile, dump, nodeFile, parallelFile, scene, seconds, timedAloneFile, until } from './helpers.mjs';

const AC1 = '#3297.758dee21';
// deadline: how long a run may take to reach the next job it is held in, on a machine at many times its cores' load.
const REACH = 900;
// deadline: how long another session's request may wait beside a held job. A free grant is dealt at the next look, a fifth
// of a second apart, so a request that has none by then is one the preflight holds back.
const GRANT = 60;

const FILES = { [parallelFile('p')]: 'p', [aloneFile(0, 'a')]: 'a', [timedAloneFile(0)]: 't', [nodeFile('n')]: 'n' };
const HELD = { p: 'the parallel block', a: 'an alone group', 'cargo test': '`cargo test`', n: '`node --test`' };
const asked = new Map();
let box, run, exit, end, shown;

before(async () => {
  box = scene({ files: FILES });
  for (const name of Object.keys(HELD)) box.flag(name, 'hold');
  run = box.preflight();
  const left = new Set(Object.keys(HELD));
  const next = () => [...left].find((name) => box.spans(name).length);
  while (left.size && await until(() => next() || !run.running(), REACH) && next()) {
    const name = next();
    left.delete(name);
    const request = box.session();
    const answered = name === 'cargo test' ? () => request.pending() || request.granted() : () => request.granted();
    await until(() => answered() || !run.running(), GRANT);
    asked.set(name, { request, beside: request.granted() !== null, holders: box.held().grants });
    box.unflag(name, 'hold');
  }
  for (const name of left) box.unflag(name, 'hold');
  exit = await run.end();
  end = Math.min(exit.at, box.timed().at(-1)?.to ?? Infinity);
  for (const entry of asked.values()) entry.granted = entry.request.granted();
  shown = dump(box, run.out());
  for (const { request } of asked.values()) request.stop();
}, { timeout: 120 * 60_000 });

for (const [name, what] of Object.entries(HELD)) {
  test(`${AC1} a build request another session makes while ${what} runs is granted before the preflight ends`, () => {
    const entry = asked.get(name);
    assert.ok(entry, `the run never reached ${box.fileOf(name)}, so no request was made beside ${what}\n${shown}`);
    const { request, granted, holders } = entry;
    const by = holders.map(({ class: cls, id, pid }) => `${cls} grant ${id} of pid ${pid}${pid === run.child.pid ? ', the preflight' : ''}`).join('; ') || 'no grant';
    const inTime = granted !== null && granted < end;
    assert.ok(inTime, `the build request another session made while ${box.fileOf(name)} ran (${what}) waited ${seconds(end - request.asked)}, to the preflight's end, and wasn't granted before it; held meanwhile: ${by}\n${shown}`);
    if (name !== 'cargo test') assert.ok(entry.beside, `the build request another session made while ${box.fileOf(name)} ran (${what}) waited ${seconds(granted - request.asked)}, until that job had ended; held meanwhile: ${by}\n${shown}`);
  });
}

// A request granted beside a run that broke off proves nothing. It passes on the merge base, whose run is whole too.
test('guard: the preflight those requests were made beside runs every file once and ends whole', () => {
  assert.equal(exit.code, 0, `the preflight exited ${exit.code ?? exit.signal}\n${shown}`);
  assert.deepEqual(Object.fromEntries(box.names().map((name) => [name, box.spans(name).length])), Object.fromEntries(box.names().map((name) => [name, 1])), `each file runs once\n${shown}`);
  assert.equal(box.record()?.state, 'PASS', `the unit lane's record reads ${box.record()?.state}\n${shown}`);
});

// #47 acceptance: recorded event logs read back against the lifecycle tables, as
// `node scripts/corpus.mjs lifecycle [--log <file>]`. Run: node --test 'tests/acceptance/47/*.test.mjs'
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { corpusScript, ID, requireCorpus, scratch, sessions, sets, show } from './helpers.mjs';

// An ask that reached its deadline and defaulted, then an answer for it. Each line is an event in
// the design's shape ({id, kind, subject, writer, actor, scope, data, ts} with the log_pos the hub
// assigned). The ask ends at a legal final state either way, so a checker that reads only final
// states passes this log; the move it must refuse is the last one.
const T0 = 1_760_013_451_000;
const ASK = { kind: 'choice', question: 'Which fix first?', options: [{ id: 'a', label: 'The parser fix', decision: 'none' }, { id: 'b', label: 'The cache fix', decision: 'none' }], recommended: 'a', deadline: new Date(T0 + 3_600_000).toISOString(), fallback: 'a', default: 'a' };
const EVENTS = [
  { id: '01K74FKZVK8Q2X5R7M3N9P4T60', log_pos: 1, kind: 'ask.created', subject: 'ask-47-planted', writer: 'core', actor: 'you', scope: 'you', data: ASK, ts: new Date(T0).toISOString() },
  { id: '01K74FKZVK8Q2X5R7M3N9P4T61', log_pos: 2, kind: 'ask.defaulted', subject: 'ask-47-planted', writer: 'core', actor: 'you', scope: 'you', data: { option: 'a', reason: 'deadline' }, ts: new Date(T0 + 3_600_000).toISOString() },
  { id: '01K74FKZVK8Q2X5R7M3N9P4T62', log_pos: 3, kind: 'ask.answered', subject: 'ask-47-planted', writer: 'core', actor: 'you', scope: 'you', data: { option: 'b', decision: 'none' }, ts: new Date(T0 + 3_660_000).toISOString() },
];
const ANSWERED = EVENTS[2].id;

function log(t, events) {
  const path = join(scratch(t), 'events.jsonl');
  writeFileSync(path, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`);
  return path;
}

test(`${ID.lifecycle} a planted log that moves an ask from defaulted to answered fails, naming the event and the table`, (t) => {
  const run = corpusScript(['lifecycle', '--log', log(t, EVENTS)]);
  assert.notEqual(run.result.status, 0, `a final-state checker passes this log, since answered is a final state\n${show(run.result)}`);
  const failures = run.result.stdout.split('\n').filter((line) => /^FAIL lifecycle: /.test(line));
  assert.ok(failures.some((line) => line.includes(ANSWERED) && line.includes('ask.machine@1')), `a FAIL line names the event ${ANSWERED} and ask.machine@1\n${show(run.result)}`);
  // The clean twin: the same ask, defaulted and left there, is a legal life.
  const clean = corpusScript(['lifecycle', '--log', log(t, EVENTS.slice(0, 2))]);
  assert.equal(clean.result.status, 0, `created then defaulted is a legal life for an ask\n${show(clean.result)}`);
});

test(`${ID.lifecycle} every recorded session in the corpus and each seeded run of the hub's simulation harness replays through the lifecycle tables`, () => {
  requireCorpus();
  const recorded = sets().reduce((count, set) => count + sessions(set).length, 0);
  const run = corpusScript(['lifecycle']);
  assert.equal(run.result.status, 0, show(run.result));
  const summary = run.summary;
  assert.equal(summary?.verdict, 'PASS', JSON.stringify(summary));
  assert.equal(summary.sessions, recorded, `every recorded session is read back: ${JSON.stringify(summary)}`);
  assert.ok(Number.isInteger(summary.simulationRuns) && summary.simulationRuns >= 1, `at least one seeded run of the hub's simulation harness is read back: ${JSON.stringify(summary)}`);
  assert.ok(Number.isInteger(summary.moves) && summary.moves > 0, `the logs hold moves the tables were asked about: ${JSON.stringify(summary)}`);
});

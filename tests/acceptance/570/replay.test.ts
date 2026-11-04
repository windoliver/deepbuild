// #570 AC6: "Each recorded session in the fixture corpus (#47), and each seeded run of the hub's simulation harness,
// replays through the lifecycle tables: every recorded move of an ask, lease, claim and session binding is one its
// table allows, and a planted log that moves an ask from defaulted to answered fails, naming the event and the table;
// a checker that reads only final states passes it and fails this test".
// Through `node scripts/lifecycle.mjs replay [<log.jsonl> ...]`. The planted log is written here; the checker that
// reads only final states is the twin twins/final-states-only (README: Wrong programs).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, corpusSessions, fixtureData, ID, lifecycle, linesOf, newId, problems, readTable, scratch, show } from './helpers.ts';

afterAll(cleanup);

const T0 = 1_760_013_451_123;
const HOUR = 3_600_000;
const base = { actor: 'you', scope: 'you', session: 'S1', evidence: [] as string[] };

/** A log as the record writes its events, one JSON object per line, in log_pos order. */
function writeLog(events: Record<string, unknown>[]): string {
  const file = join(scratch('deep-570-log-'), 'events.jsonl');
  writeFileSync(file, events.map((e, i) => JSON.stringify({ ...base, ...e, log_pos: i + 1 })).join('\n') + '\n');
  return file;
}
function askLog(after: 'defaulted' | 'open'): { file: string; ask: string; answer: string } {
  const ask = newId(T0);
  const created = { v: 4, id: ask, kind: 'ask.created', writer: 'core', ts: T0, data: { ...fixtureData('ask.created@4'), deadline: T0 + HOUR } };
  const defaulted = { v: 1, id: newId(T0 + HOUR + 1), kind: 'ask.defaulted', subject: `ask:${ask}`, writer: 'core', ts: T0 + HOUR + 1, data: { answer: 'hold', plan_hash: null, decision: 'deny' } };
  const answer = newId(T0 + HOUR + 2);
  const answered = { v: 4, id: answer, kind: 'ask.answered', subject: `ask:${ask}`, writer: 'core', ts: T0 + HOUR + 2, data: fixtureData('ask.answered@4') };
  return { file: writeLog(after === 'defaulted' ? [created, defaulted, answered] : [created, answered]), ask, answer };
}

describe(`${ID.replay} recorded logs replay through the lifecycle tables`, () => {
  it(`${ID.replay} each recorded session in the fixture corpus, and each seeded run of the hub's simulation harness, replays through the tables with every move allowed`, () => {
    for (const object of ['ask', 'lease', 'claim', 'session_binding']) readTable(object);
    const sessions = corpusSessions();
    expect(sessions.length, 'the fixture corpus holds recorded sessions').toBeGreaterThan(0);
    const r = lifecycle(['replay']);
    expect(problems(r, 'replay'), `every recorded move is one its table allows\n${show(r)}`).toEqual([]);
    expect(r.status, `exit 0\n${show(r)}`).toBe(0);
    const passes = linesOf(r, ['PASS'], 'replay');
    for (const ref of sessions) {
      expect(passes.some((l) => l.includes(`corpus ${ref}:`) && /\b\d+ moves\b/.test(l)), `a PASS line names corpus ${ref} with its move count\n${show(r)}`).toBe(true);
    }
    const seeds = passes.filter((l) => /\bseed \d+:/.test(l));
    expect(seeds.length, `a PASS line for each seeded run of the hub's simulation harness ("seed <n>: <m> moves")\n${show(r)}`).toBeGreaterThan(0);
    for (const l of seeds) expect(Number(l.match(/\b(\d+) moves\b/)?.[1] ?? 0), `a seeded run moves objects: ${l}`).toBeGreaterThan(0);
  });

  it(`${ID.replay} a planted log that moves an ask from defaulted to answered fails, naming the event and the table`, () => {
    readTable('ask');
    const { file, answer } = askLog('defaulted');
    const r = lifecycle(['replay', file]);
    expect(r.status, `exit 1\n${show(r)}`).toBe(1);
    const fails = linesOf(r, ['FAIL'], 'replay').filter((l) => l.includes('ask.machine@1'));
    expect(fails.length, `a FAIL line names the table ask.machine@1\n${show(r)}`).toBeGreaterThan(0);
    expect(fails.some((l) => l.includes(answer) || /\bask\.answered\b/.test(l)), `the FAIL line names the event: ${answer} (ask.answered)\n${show(r)}`).toBe(true);
  });

  it(`${ID.replay} the same log with the answer before any deadline is a move the table allows, and passes`, () => {
    readTable('ask');
    const { file } = askLog('open');
    const r = lifecycle(['replay', file]);
    expect(problems(r, 'replay'), show(r)).toEqual([]);
    expect(r.status, `exit 0\n${show(r)}`).toBe(0);
    expect(linesOf(r, ['PASS'], 'replay').some((l) => l.includes(file)), `a PASS line names the log\n${show(r)}`).toBe(true);
  });
});

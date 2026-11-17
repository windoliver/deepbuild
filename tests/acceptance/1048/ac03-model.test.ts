// AC3 #1048.1ea738c9: "With a recorded model at the source boundary that walks the hero into a pit cell a planted twin
// never lets it leave, the model bot's run ends stuck and the requirement fails on that run, whose track replays
// without the model to the same stuck step; with a recorded model that reaches deep on the clean fixture, deep's share
// and the verdict equal those of the same check without the model bot, and its runs show counted false; a model run
// whose track replays without it to no stuck is refused, naming the run; and a model reply that isn't a listed row
// sends no entry and its idle steps never end a run stuck"
//
// The model bot {model: {provider, every: 15, budget}} asks its model through the playtest plug-in's source
// ext.playtest.model; each hub here is given a recording of that source's answers (`replay`), an HTTP client that
// refuses and counts every call, and an empty secret store, so no test makes a live call or needs a secret (README:
// The surface). Each check gives the model bot one run. The crawler plays its own floors (piece_seed own), and the
// stuck rule reads turn, the count of entries the crawler took, within 20 steps, which for a model run counts only the
// steps at which its track holds a bot entry.
// - The calm crawler is the clean fixture for a bot that acts at most once in 15 steps: on the clean crawler the
//   wraith strikes a hero that took no move that step every 4th step, so such a hero dies before depth 3 whatever it
//   picks (played here at the base: dead at step 95). The calm crawler is #555's nofight twin, its wraith never
//   striking (README: Readings).
// - The pit: the pit twin (calm; its pit is the first cell the hero may enter from the start) and a recorded model
//   whose first reply is no row (pass), its second the move into the pit and every later one the move back to the
//   start, which the pit lists and refuses. The playtest fails on the model's run with playtest.stuck, naming the step
//   turn last moved (the pit's) and
//   the stuck step k; the run is counted false; its track, played again here in a fresh replica without the model,
//   last moves turn at that step, holds turn there to k, and holds bot entries at exactly 20 steps after it, k the
//   20th.
// - Junk: on the calm crawler a model replying "go north", then [0, 99, 99] (no listed row), then the move to the
//   start's first open neighbour, then rows never listed there: no stuck failure for its run, its outcome isn't stuck,
//   and its track holds that one move's two entries and no other bot entry.
// - Deep: a recorded model replaying, after a first reply that is no row, one row a call, the descender's track on the
//   calm crawler (it reaches depth 3).
//   Beside #555's waiting policy, banded {deep: [0, 0]}, under the goal deep: the check with the model bot has the
//   verdict and the failures (by test and code) of the check without it, deep's share of the counted runs is the same
//   (0), the model's run reached deep and is counted false, the waiting run counted true.
// - Refused: the pit again, on a hub whose replica reports each play's recorded track without its bot entries (the
//   test's own planted hub replica: the replica played them), so the run's track replays to no stuck: a failure on
//   the run starts refused: and names it, and no playtest.stuck failure stands for it.
// The wrong programs: the base (no model bot), a bot that plays an unlisted reply, a stuck rule that counts idle steps,
// a check that counts a model run toward a goal or a share, one that takes a model run's failure without its replay.
import { describe, expect, it } from 'vitest';
import { crawlerPlay, WAITING } from '../555/programs.ts';
import {
  AC, DOC, EMPTY_TRACK, Pool, TIMEOUT, emptySecrets, failuresOf, lockPlay, macOnly, named, noLiveCalls, openHub, ownPlay, playtestSpec, putPiece, runCheck, runsIn,
  show, shown, stepOf, valuesOf, type Hub, type Obj, type Recording, type Result,
} from './helpers.ts';
import { CRAWLER_SEED, SIZE, twinPiece, twinProgram } from './programs.ts';

const EVERY = 15;
const WITHIN = 20;
const SPAN = 600;
const SOURCE = 'ext.playtest.model';
const PROVIDER = 'test.recorded@1';
const P = { cell: 'crawler.cell', turn: 'crawler.turn', grid: 'crawler.grid', depth: 'crawler.depth' } as const;
const DEEP = { name: 'deep', when: 'depth >= 3' };
/** The model bot, its budget the recording's length. */
const model = (calls: number): Obj => ({ model: { provider: PROVIDER, every: EVERY, budget: { calls, tokens: 1_000_000 } } });
/** A recording of the model's answers at the source boundary, one a call, in order (README: The surface). */
const recorded = (replies: string[]): Recording => ({
  v: 1,
  calls: replies.map((body) => ({ source: SOURCE, request: { url: 'https://model.invalid/v1/pick', method: 'POST', headers: {} }, answer: { status: 200, headers: { 'content-type': 'text/plain' }, body } })),
});
const rowText = (row: number[]): string => JSON.stringify(row);
/**
 * The pit's model: a first reply that is no row (so the move into the pit comes at the second ask, whenever the first
 * is made), the move into the pit, then the move back to the start, which the pit lists and refuses.
 */
const pitReplies = (start: number[], next: number[], calls: number): string[] =>
  ['pass', rowText([0, ...next]), ...Array<string>(calls - 2).fill(rowText([0, ...start]))];
/** The calls a run of `span` steps can make, and a margin: the recording's length. */
const callsFor = (span: number): number => Math.ceil(span / EVERY) + 8;
const stuckInput = (piece: string, play: Obj, calls: number): Obj => ({
  piece, play, bots: [model(calls)], runs: 1, seed: 1048, span: { steps: SPAN }, goals: [DEEP], piece_seed: 'own',
  stuck: { measure: P.turn, by: 1, within: { steps: WITHIN } }, frames: { every: 0 },
});

let pooled: Promise<Pool> | undefined;
const poolOnce = (): Promise<Pool> => (pooled ??= Pool.open(2, { entries: true, keep: [] }));
async function hubWith(pool: Pool, replies: string[]): Promise<{ hub: Hub; live: string[] }> {
  const live = noLiveCalls();
  return { hub: await openHub(pool, { replay: recorded(replies), http: live.http, secrets: emptySecrets() }), live: live.calls };
}
/** The hero's start on the first floor and the first cell it may enter from it (north, east, south, west). */
async function firstMove(pool: Pool, at: string): Promise<{ start: number[]; next: number[] }> {
  const one = await ownPlay(pool, at, { seed: CRAWLER_SEED, span: { steps: 1 }, values: [P.cell, P.grid], frames: [] });
  const start = (valuesOf(one, P.cell)[0] as number[]).slice(0, 2);
  const grid = valuesOf(one, P.grid)[0] as number[];
  const open = ([x, y]: number[]): boolean => x! >= 0 && y! >= 0 && x! < SIZE && y! < SIZE && [0, 2, 4, 5].includes(grid[y! * SIZE + x!]!);
  const next = [[start[0]!, start[1]! - 1], [start[0]! + 1, start[1]!], [start[0]!, start[1]! + 1], [start[0]! - 1, start[1]!]].find(open);
  expect(next, `the hero's start ${show(start)} has an open neighbour`).toBeDefined();
  return { start, next: next! };
}
/** The model run of a result: its runs' entry for `test`, counted false, and its recorded entries by its track. */
function modelRun(pool: Pool, r: Result, test: string): { run: Obj; entries: Obj[] } {
  const run = runsIn(r).find((x) => x['test'] === test);
  expect(run, `the result lists the model's run ${test}: ${show(r.runs as never, 800)}`).toBeDefined();
  expect(run!['counted'], `the model's run ${test} shows counted false`).toBe(false);
  const entries = pool.entriesOf(String(run!['track']));
  expect(entries, `a replica play recorded the model run's track ${String(run!['track'])}`).toBeDefined();
  return { run: run!, entries: entries! };
}
const botSteps = (entries: Obj[]): number[] => [...new Set(entries.filter((e) => e['writer'] === 'bot').map(stepOf))].sort((a, b) => a - b);
const kindOf = (o: unknown): string => String((o as Obj | undefined)?.['kind'] ?? o);

describe(`${AC[3]} a model bot counted through replay`, () => {
  it(`${AC[3]} the pit: the model run ends stuck, the requirement fails on it, and its track replays without the model to the same stuck step`, async () => {
    macOnly();
    const pool = await poolOnce();
    const play = await lockPlay(crawlerPlay());
    const pit = putPiece(DOC.pit, twinPiece(twinProgram('pit'), 'pit'));
    const { start, next } = await firstMove(pool, pit);
    const calls = callsFor(SPAN);
    const { hub, live } = await hubWith(pool, pitReplies(start, next, calls));
    const r = await runCheck(hub, playtestSpec(stuckInput(pit, play, calls)));
    expect(r.outcome, `the requirement fails: ${shown(r)}`).toBe('failed');
    const stuck = failuresOf(r, 'playtest.stuck', 'bot 0 run 0');
    expect(stuck.length, `the model's run fails playtest.stuck: ${shown(r)}`).toBe(1);
    const a = named(stuck[0]!.message, 'last moved at step');
    const k = named(stuck[0]!.message, 'stuck at step');
    expect([a, k], `it names the step turn last moved and the stuck step: ${stuck[0]!.message}`).not.toContain(undefined);
    const { run, entries } = modelRun(pool, r, 'bot 0 run 0');
    expect(kindOf(run['outcome']), 'its outcome is stuck').toBe('stuck');
    // Its track, played again here in a fresh replica without the model.
    const replay = await ownPlay(pool, pit, { seed: Number(run['seed']), span: { steps: SPAN }, track: entries, values: [P.turn, P.cell], frames: [] });
    const turn = valuesOf(replay, P.turn).map((v) => Number((v as number[])[0]));
    expect(turn[a!], `turn moves at step ${a}`).not.toBe(turn[a! - 1]);
    expect((valuesOf(replay, P.cell)[a!] as number[]).slice(0, 2), `at step ${a} the hero stands in the pit`).toEqual(next);
    expect(turn.slice(a!, k! + 1).every((t) => t === turn[a!]), `turn holds from step ${a} to step ${k}`).toBe(true);
    const counted = botSteps(entries).filter((s) => s > a! && s <= k!);
    expect(counted.length, `the steps holding a bot entry after step ${a} up to ${k}: ${show(counted)}`).toBe(WITHIN);
    expect(counted.at(-1), `the stuck step is the ${WITHIN}th of them`).toBe(k);
    expect(live, 'no live call').toEqual([]);
  }, TIMEOUT);

  it(`${AC[3]} a reply that isn't a listed row sends no entry, and the idle steps never end the run stuck`, async () => {
    macOnly();
    const pool = await poolOnce();
    const play = await lockPlay(crawlerPlay());
    const calm = putPiece(DOC.calm, twinPiece(twinProgram('calm'), 'calm'));
    const { next } = await firstMove(pool, calm);
    const calls = callsFor(SPAN);
    const junk = ['[2, 0, 0]', '[1, 0, 0]', 'pass'];
    const replies = ['go north', rowText([0, 99, 99]), rowText([0, ...next]), ...Array.from({ length: calls - 3 }, (_, i) => junk[i % junk.length]!)];
    const { hub, live } = await hubWith(pool, replies);
    const r = await runCheck(hub, playtestSpec(stuckInput(calm, play, calls)));
    expect(failuresOf(r, 'playtest.stuck', 'bot 0 run 0'), `no stuck failure for the model's run: ${shown(r)}`).toEqual([]);
    const { run, entries } = modelRun(pool, r, 'bot 0 run 0');
    expect(kindOf(run['outcome']), 'its outcome isn\'t stuck').not.toBe('stuck');
    const bot = entries.filter((e) => e['writer'] === 'bot');
    expect(bot.map((e) => [e['control'], e['value']?.['phase'], e['value']?.['cell']]), 'its track holds one move\'s press and release at the listed cell, and nothing for the replies that weren\'t a listed row')
      .toEqual([['aim', 'press', next], ['aim', 'release', next]]);
    expect(botSteps(entries).length, 'both at one step').toBe(1);
    expect(live, 'no live call').toEqual([]);
  }, TIMEOUT);

  it(`${AC[3]} deep: deep's share and the verdict equal the check's without the model bot, and its runs show counted false`, async () => {
    macOnly();
    const pool = await poolOnce();
    const play = await lockPlay(crawlerPlay());
    const calm = putPiece(DOC.calm, twinPiece(twinProgram('calm'), 'calm'));
    // The descender's rows on the calm crawler, one a reply.
    const d = await ownPlay(pool, calm, { seed: CRAWLER_SEED, span: { steps: 1500 }, bot: { descender: { action: 'descend', every: 1 } }, play, values: [P.depth], frames: [] });
    expect(Math.max(...valuesOf(d, P.depth).map((v) => Number((v as number[])[0]))), 'the descender reaches depth 3 on the calm crawler').toBe(3);
    const rows: number[][] = [];
    for (const e of d['entries'] as Obj[]) {
      if (e['control'] === 'aim' && e['value']?.['phase'] === 'press') rows.push([0, ...(e['value']['cell'] as number[])]);
      if (e['control'] === 'stairs') rows.push([2, 0, 0]);
      if (e['control'] === 'wait_key') rows.push([1, 0, 0]);
    }
    const span = EVERY * (rows.length + 20);
    const calls = callsFor(span);
    const { hub, live } = await hubWith(pool, ['pass', ...rows.map(rowText), ...Array<string>(calls - rows.length - 1).fill('pass')]);
    const waiting = { ...WAITING, share: { deep: [0, 0] } };
    const input = (bots: Obj[]): Obj => ({ piece: calm, play, bots, runs: 1, seed: 1048, span: { steps: span }, goals: [DEEP], piece_seed: 'own', frames: { every: 0 } });
    const without = await runCheck(hub, playtestSpec(input([waiting])));
    const withModel = await runCheck(hub, playtestSpec(input([waiting, model(calls)])));
    expect(failuresOf(without, 'playtest.goal_missed').length, `without the model, no run reaches deep: ${shown(without)}`).toBeGreaterThan(0);
    expect(withModel.outcome, `the verdict with the model bot is the verdict without it: ${shown(withModel)} | ${shown(without)}`).toBe(without.outcome);
    const codes = (x: Result): string[] => x.failures.map((f) => `${f.test} | ${f.message.split(':')[0]}`).sort();
    expect(codes(withModel), 'the same failures, by test and code').toEqual(codes(without));
    const share = (x: Result): number => {
      const counted = runsIn(x).filter((run) => run['counted'] === true);
      return counted.filter((run) => kindOf(run['outcome']) === 'reached').length / counted.length;
    };
    expect(share(withModel), 'deep\'s share of the counted runs').toBe(share(without));
    expect(runsIn(without).map((run) => run['counted']), 'without the model, the waiting run counts').toEqual([true]);
    const { run } = modelRun(pool, withModel, 'bot 1 run 0');
    expect(kindOf(run['outcome']), 'the recorded model reached deep').toBe('reached');
    expect(runsIn(withModel).find((x) => x['test'] === 'bot 0 run 0')?.['counted'], 'the waiting run counts').toBe(true);
    expect(live, 'no live call').toEqual([]);
  }, TIMEOUT);

  it(`${AC[3]} a model run whose track replays without it to no stuck is refused, naming the run`, async () => {
    macOnly();
    // The test's planted hub replica: each play's reply hands back its recorded track without its bot entries.
    const stripped = (reply: Obj): Obj => {
      if (reply['ok'] !== true || !Array.isArray(reply['entries'])) return reply;
      const entries = (reply['entries'] as Obj[]).filter((e) => e['writer'] !== 'bot');
      expect(entries, 'the pit run\'s plays record only the model\'s entries').toEqual([]);
      return { ...reply, entries, track: EMPTY_TRACK };
    };
    const pool = await Pool.open(1, { entries: true, keep: [], report: stripped });
    const play = await lockPlay(crawlerPlay());
    const pit = putPiece(DOC.pit, twinPiece(twinProgram('pit'), 'pit'));
    const { start, next } = await firstMove(pool, pit);
    const calls = callsFor(SPAN);
    const { hub, live } = await hubWith(pool, pitReplies(start, next, calls));
    const r = await runCheck(hub, playtestSpec(stuckInput(pit, play, calls)));
    expect(r.outcome, `the requirement doesn't pass: ${shown(r)}`).not.toBe('passed');
    const refused = r.failures.find((f) => f.test === 'bot 0 run 0' && f.message.startsWith('refused:'));
    expect(refused, `the model's run is refused: a failure on bot 0 run 0 starts refused: ${shown(r)}`).toBeDefined();
    expect(refused!.message.includes('bot 0 run 0'), `it names the run: ${refused!.message}`).toBe(true);
    expect(failuresOf(r, 'playtest.stuck', 'bot 0 run 0'), 'no stuck failure stands for the refused run').toEqual([]);
    // The replica played the model's entries in that run, the move into the pit first.
    const first = pool.log.flatMap((p) => (p.reply['ok'] === true && Array.isArray(p.reply['entries']) ? (p.reply['entries'] as Obj[]) : [])).find((e) => e['writer'] === 'bot');
    expect(first?.['value']?.['cell'], 'a replica played the model\'s move into the pit').toEqual(next);
    expect(live, 'no live call').toEqual([]);
  }, TIMEOUT);
});

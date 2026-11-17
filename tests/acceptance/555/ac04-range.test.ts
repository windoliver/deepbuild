// AC4 #555.f6861216: "A crawler interface that declares `hp` with `range: [0, 100]` passes on the correct piece; a
// planted piece whose potion heals to 120 fails play.out_of_range at the step it drinks, naming hp, the unit's row, 120
// and the step; and a name declared with a unit the canvas doesn't name is refused when the brief is locked, naming the
// unit"
//
// - The lock: the crawler's interface with depth declared in `m`, a unit the canvas names, locks; with depth in
//   `furlong`, which it doesn't, lockPlay refuses, naming furlong.
// - The range: the crawler's interface with hp `{name, range: [0, 100]}`, locked, under a playtest of the descender
//   and the waiting policy, 3 runs each (the criterion names no count), on two debug replicas. On the correct crawler
//   it passes, and the runs' own values show hp at both ends of the range (the descender's 100 after each potion, a
//   dead hero's 0), so a range read with open ends fails it. On the potion twin it fails: each descender run whose
//   hero's hp (row 0) first reads 120 at step k, as the replica's values show, has a failure `bot 0 run <i>` that
//   starts play.out_of_range and names hp, row 0, 120 and step k; the waiting policy's runs, which never drink, have none.
// The wrong programs: the base (no lockPlay, no ranges), a lock that takes any unit, a range never read, and one read
// at another step or row.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, Pool, TIMEOUT, firstStep, lockPlay, macOnly, none, openHub, putPiece, rowOf, runPlaytest, runsOf, shown, valuesOf, word, type Hub,
} from './helpers.ts';
import { DESCENDER, HP, PATH, POTION_TWIN_HP, WAITING, crawlerInput, crawlerPiece, crawlerPlay, crawlerProgram } from './programs.ts';

const RUNS_4 = 3;
let opened: Promise<{ pool: Pool; hub: Hub }> | undefined;
const hubOnce = (): Promise<{ pool: Pool; hub: Hub }> => (opened ??= (async () => { const pool = await Pool.open(2); return { pool, hub: await openHub(pool) }; })());
const ranged = () => crawlerPlay({ hp: { name: PATH.hp, range: [0, HP] } });

describe(`${AC[4]} a declared range holds on the correct piece and fails play.out_of_range on the twin; an unknown unit is refused at the lock`, () => {
  it(`${AC[4]} a name declared with a unit the canvas doesn't name is refused when the brief is locked, naming the unit`, async () => {
    const locked = await lockPlay(crawlerPlay({ depth: { name: PATH.depth, unit: 'm' } }));
    expect(locked, 'an interface whose depth is in m, a unit the canvas names, locks').toBeTruthy();
    const refused = await lockPlay(crawlerPlay({ depth: { name: PATH.depth, unit: 'furlong' } })).then(
      (v) => `locked: ${JSON.stringify(v).slice(0, 300)}`,
      (e: unknown) => String((e as Error)?.message ?? e),
    );
    expect(refused.startsWith('locked:'), `an interface whose depth is in furlong is refused at the lock: ${refused}`).toBe(false);
    expect(word('furlong').test(refused), `the refusal names furlong: ${refused}`).toBe(true);
  }, TIMEOUT);

  it(`${AC[4]} hp in [0, 100] passes on the correct crawler`, async () => {
    macOnly();
    const play = await lockPlay(ranged());
    const piece = putPiece(DOC.crawler, crawlerPiece(crawlerProgram('clean'), 'clean'));
    const input = crawlerInput(piece, play, [DESCENDER, WAITING], { runs: RUNS_4 });
    const { pool, hub } = await hubOnce();
    const result = await runPlaytest(hub, input);
    expect(result.outcome, `the ranged interface's playtest passes on the correct crawler: ${shown(result)}`).toBe('passed');
    const hp = runsOf(pool.log, input).flatMap((r) => (valuesOf(r.play.reply, PATH.hp) ?? []).map((v) => rowOf(v, 0)));
    expect(hp.length, 'the runs\' plays asked for hp, which the interface declares with a range').toBeGreaterThan(0);
    expect([Math.min(...hp), Math.max(...hp)], 'the runs read hp at both ends of its range').toEqual([0, HP]);
  }, TIMEOUT);

  it(`${AC[4]} the twin whose potion heals to ${POTION_TWIN_HP} fails play.out_of_range at the step it drinks, naming hp, row 0, ${POTION_TWIN_HP} and the step`, async () => {
    macOnly();
    const play = await lockPlay(ranged());
    const piece = putPiece(DOC.potion, crawlerPiece(crawlerProgram('potion'), 'potion'));
    const input = crawlerInput(piece, play, [DESCENDER, WAITING], { runs: RUNS_4 });
    const { pool, hub } = await hubOnce();
    const result = await runPlaytest(hub, input);
    expect(result.outcome, `the potion twin's playtest fails: ${shown(result)}`).toBe('failed');
    const gaps: string[] = [];
    let drank = 0;
    for (const r of runsOf(pool.log, input)) {
      const name = `bot ${r.b} run ${r.i}`;
      const k = firstStep((valuesOf(r.play.reply, PATH.hp) ?? []).map((v) => rowOf(v, 0)), (v) => v > HP);
      const f = result.failures.find((x) => x.test === name && x.message.startsWith('play.out_of_range'));
      if (k < 0) {
        if (r.b === 1 && f) gaps.push(`${name}: the waiting policy's run never drinks, yet fails ${f.message}`);
        continue;
      }
      drank++;
      const value = rowOf(valuesOf(r.play.reply, PATH.hp)![k], 0);
      if (value !== POTION_TWIN_HP) gaps.push(`${name}: its hero's hp first leaves the range at ${value}, not ${POTION_TWIN_HP}`);
      if (!f) { gaps.push(`${name}: its hero drinks at step ${k} and no failure "${name}" starts play.out_of_range`); continue; }
      const said = f.message.slice('play.out_of_range'.length);
      for (const w of ['hp', 'row 0', String(POTION_TWIN_HP), `step ${k}`]) if (!word(w).test(said)) gaps.push(`${name}: its failure doesn't name ${w}: ${f.message}`);
    }
    expect(drank, 'some descender run drinks the twin\'s potion').toBeGreaterThan(0);
    none(gaps, 'the potion twin\'s runs');
  }, TIMEOUT);
});

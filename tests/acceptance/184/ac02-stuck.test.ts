// AC2 #184.f5950275: "A planted twin whose logic stops moving the token once it enters cell (3, 4), on the logic bot's
// route, fails with playtest.stuck in every logic-bot run, naming the run, the step the token entered that cell and the
// measure, with that run's frame at the step it was found stuck"
//
// The stuck twin's playtest, with criterion 1's input. For each route-bot run, the step the token entered (3, 4) is
// read from the values its replica returned; the run's failure (`bot 0 run <i>`, playtest.stuck) names that step and
// maze.cell, and a frame hash the run's plays returned for that step plus 10 s (600 steps), whose PNG the replica kept.
import { describe, expect, it } from 'vitest';
import { AC, DOC, MEASURE, Pool, STUCK_STEPS, TIMEOUT, canon, driveBin, failureOf, framesAt, macOnly, none, openHub, playInput, putPiece, runPlaytest, runsOf, sha256, shown, word } from './helpers.ts';
import { POLICY, TRAP_CELL, mazePiece, mazeProgram, routeBot, routeBotProgram } from './programs.ts';
import { readFileSync } from 'node:fs';

describe(`${AC[2]} the twin that stops at (3, 4) fails with playtest.stuck in every route-bot run`, () => {
  it(`${AC[2]} each route-bot run's playtest.stuck names the run, the step the token entered (3, 4), maze.cell, and its frame when found stuck`, async () => {
    macOnly();
    const piece = putPiece(DOC.stuck, mazePiece(mazeProgram('stuck')));
    const input = playInput(piece, [routeBot(routeBotProgram()), POLICY]);
    const pool = await Pool.open([{ bin: driveBin('debug') }, { bin: driveBin('debug') }]);
    const hub = await openHub({ pool, playtest: 'loaded' });

    const result = await runPlaytest(hub, input);
    expect(result.outcome, `the stuck twin's playtest fails: ${shown(result)}`).toBe('failed');
    const gaps: string[] = [];
    for (const r of runsOf(pool.log, input).filter((x) => x.b === 0)) {
      const name = `bot 0 run ${r.i}`;
      const cells = r.play.reply['values'][MEASURE] as unknown[];
      const entered = cells.findIndex((c) => canon(c) === canon(TRAP_CELL));
      if (entered <= 0) { gaps.push(`${name}: the token never enters (3, 4) after step 0 (${canon(cells.slice(0, 80))})`); continue; }
      const f = failureOf(result, name, 'playtest.stuck');
      if (!f) { gaps.push(`${name}: no playtest.stuck failure (${shown(result).slice(0, 400)})`); continue; }
      if (!word(`step ${entered}`).test(f.message)) gaps.push(`${name}: its failure doesn't name step ${entered}, where the token entered (3, 4): ${f.message}`);
      if (!f.message.includes(MEASURE)) gaps.push(`${name}: its failure doesn't name the measure ${MEASURE}: ${f.message}`);
      const found = entered + STUCK_STEPS;
      const frames = framesAt(r, found);
      const named = (f.message.match(/[0-9a-f]{64}/g) ?? []).filter((h) => frames.includes(h));
      if (!named.length) gaps.push(`${name}: its failure names no frame its plays returned for step ${found}, where it was found stuck (frames there: ${canon(frames)}): ${f.message}`);
      for (const h of named) {
        const file = pool.frameFile(h);
        if (!file) gaps.push(`${name}: no replica kept frames/${h}.png`);
        else if (sha256(readFileSync(file)) !== h) gaps.push(`${name}: frames/${h}.png doesn't hash to its name`);
      }
    }
    none(gaps, 'each route-bot run\'s playtest.stuck');
  }, TIMEOUT);
});

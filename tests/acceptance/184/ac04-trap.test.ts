// AC4 #184.66d5f782: "A twin whose logic divides by zero on the 40th press fails with playtest.trap in every run that
// makes 40 presses, naming the run, the item, the step and the press entries that step read"
//
// The trap twin's playtest, with criterion 1's input. The route bot stops pressing at won, after 10 presses, so its
// runs never trap; each policy run presses every 0.25 s for 120 s and traps at its 40th press. For each policy run,
// the replica's logic.trap is read from its play: the item maze, the step, and the entries that step read, which are
// the track's entries of that step, the 40th press among them. The run's failure (`bot 1 run <i>`, playtest.trap)
// names maze, that step, and each of those entries as its JSON (README: The surface).
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, Pool, STEP_60, TIMEOUT, canon, driveBin, entriesAt, failureOf, macOnly, none, openHub, playInput, putPiece, runPlaytest, runsOf, shown, word,
} from './helpers.ts';
import { POLICY, mazePiece, mazeProgram, routeBot, routeBotProgram } from './programs.ts';

describe(`${AC[4]} the twin that divides by zero on the 40th press fails with playtest.trap in every run that presses 40 times`, () => {
  it(`${AC[4]} each policy run's playtest.trap names the run, maze, the step and the press entries it read; no route-bot run traps`, async () => {
    macOnly();
    const piece = putPiece(DOC.trap, mazePiece(mazeProgram('trap')));
    const input = playInput(piece, [routeBot(routeBotProgram()), POLICY]);
    const pool = await Pool.open([{ bin: driveBin('debug') }, { bin: driveBin('debug') }]);
    const hub = await openHub({ pool, playtest: 'loaded' });

    const result = await runPlaytest(hub, input);
    expect(result.outcome, `the trap twin's playtest fails: ${shown(result)}`).toBe('failed');
    const gaps: string[] = [];
    for (const r of runsOf(pool.log, input)) {
      const name = `bot ${r.b} run ${r.i}`;
      const reply = r.play.reply;
      const presses = (reply['entries'] as unknown[]).length;
      if (presses < 40) {
        if (reply['trap'] !== null) gaps.push(`${name}: ${presses} presses, yet the maze traps: ${canon(reply['trap'])}`);
        if (failureOf(result, name, 'playtest.trap')) gaps.push(`${name}: ${presses} presses, yet it fails with playtest.trap`);
        continue;
      }
      if (r.b === 0) gaps.push(`${name}: the route bot pressed ${presses} times`);
      const trap = reply['trap'];
      if (trap === null || typeof trap !== 'object') { gaps.push(`${name}: ${presses} presses and no logic.trap from its replica`); continue; }
      if (trap['item'] !== 'maze') gaps.push(`${name}: the trap names item ${String(trap['item'])}, not maze`);
      const k = Number(trap['step']);
      const read = trap['inputs'] as unknown[];
      const before = (reply['entries'] as { t: number }[]).filter((e) => e.t <= (k - 1) * STEP_60).length;
      if (canon(read) !== canon(entriesAt(reply['entries'], k))) gaps.push(`${name}: the trap's inputs at step ${k} aren't the track's entries of that step`);
      if (!(before < 40 && before + read.length >= 40)) gaps.push(`${name}: step ${k} isn't the step of the 40th press (${before} before it, ${read.length} in it)`);
      const f = failureOf(result, name, 'playtest.trap');
      if (!f) { gaps.push(`${name}: no playtest.trap failure`); continue; }
      if (!word('maze').test(f.message)) gaps.push(`${name}: its failure doesn't name the item maze: ${f.message}`);
      if (!word(`step ${k}`).test(f.message)) gaps.push(`${name}: its failure doesn't name step ${k}: ${f.message}`);
      for (const e of read) if (!f.message.includes(JSON.stringify(e))) gaps.push(`${name}: its failure doesn't name the entry ${JSON.stringify(e)} the step read: ${f.message}`);
    }
    none(gaps, 'each run\'s presses, trap and failure');
    expect(runsOf(pool.log, input).filter((r) => r.b === 1 && r.play.reply['trap'] !== null).length, 'every policy run makes 40 presses and traps').toBe(input['runs']);
  }, TIMEOUT);
});

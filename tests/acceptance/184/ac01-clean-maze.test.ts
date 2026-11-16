// AC1 #184.5a3904f8: "A grid maze whose logic moves a token one cell per arrow press and sets won at the exit, played for
// 120 s in 20 runs by a logic bot that walks the shortest route and in 20 by a policy of seeded arrow presses every 0.25
// s, passes: every logic-bot run reaches won, no run's token stays in one cell for 10 s before won, none traps, no
// step's logic fuel passes the step ceiling for its class, and each run's track replays without its bot to the same
// full-state hash at every checkpoint and at the end"
//
// The playtest plug-in runs the clean maze's playtest through runCheck on two debug replicas. Its PASS is read with
// what the replicas played: each bot's 20 runs at hash(184, i), each judged from the values the replica returned,
// and each run's recorded track played again without its bot to the same checkpoints and final hash. The wrong
// programs: the base (no plug-in, no play call), a plug-in that passes without playing or without replaying, and a
// replica whose replay drifts (criterion 6's plant, caught there).
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, HASH, MEASURE, Pool, RUNS, STEPS_120, STUCK_STEPS, TIMEOUT, WON, canon, ceiling, driveBin, framesAt, macOnly, none,
  openHub, playInput, putPiece, runPlaytest, runsOf, scalar, shown,
} from './helpers.ts';
import { POLICY, mazePiece, mazeProgram, routeBot, routeBotProgram } from './programs.ts';

describe(`${AC[1]} the clean maze passes its playtest of 20 route-bot and 20 policy runs`, () => {
  it(`${AC[1]} every route-bot run reaches won, no token sits 10 s before won, nothing traps, no step passes its ceiling, every track replays to the same hashes`, async () => {
    macOnly();
    const piece = putPiece(DOC.clean, mazePiece(mazeProgram('clean')));
    const input = playInput(piece, [routeBot(routeBotProgram()), POLICY]);
    const pool = await Pool.open([{ bin: driveBin('debug') }, { bin: driveBin('debug') }]);
    const hub = await openHub({ pool, playtest: 'loaded' });

    const result = await runPlaytest(hub, input);
    expect(result.outcome, `the clean maze's playtest passes: ${shown(result)}`).toBe('passed');
    expect(result.testsRun, 'testsRun counts the 40 runs').toBe(2 * RUNS);

    // Each bot's runs 0 to 19, each played with its bot at hash(184, i) (runsOf fails on one the log lacks).
    const runs = runsOf(pool.log, input);
    expect(runs.length, 'both bots\' 20 runs').toBe(2 * RUNS);
    const gaps: string[] = [];
    for (const r of runs) {
      const name = `bot ${r.b} run ${r.i}`;
      const reply = r.play.reply;
      const cells = reply['values'][MEASURE] as unknown[];
      const won = (reply['values'][WON] as unknown[]).map(scalar);
      if (cells.length !== STEPS_120 || won.length !== STEPS_120) gaps.push(`${name}: values of ${cells.length} and ${won.length} steps, not ${STEPS_120}`);
      const wonAt = won.findIndex((v) => v === 1);
      if (r.b === 0 && wonAt < 0) gaps.push(`${name}: the route bot never reaches won`);
      // The token's longest stay in one cell before won.
      let stay = 1;
      for (let k = 1; k < (wonAt < 0 ? cells.length : wonAt); k++) {
        stay = canon(cells[k]) === canon(cells[k - 1]) ? stay + 1 : 1;
        if (stay >= STUCK_STEPS) { gaps.push(`${name}: the token stays in ${canon(cells[k])} for ${STUCK_STEPS} steps before won, to step ${k}`); break; }
      }
      if (reply['trap'] !== null) gaps.push(`${name}: the maze traps: ${canon(reply['trap'])}`);
      if (reply['bot_trap'] !== null) gaps.push(`${name}: the bot traps: ${canon(reply['bot_trap'])}`);
      const fuel = reply['fuel']['maze'] as number[];
      if (reply['ceilings']['maze'] !== ceiling(60)) gaps.push(`${name}: the maze's ceiling is ${String(reply['ceilings']['maze'])}, not a 60 Hz figure item's ${ceiling(60)}`);
      if (Math.max(...fuel) > ceiling(60)) gaps.push(`${name}: a step spends ${Math.max(...fuel)} fuel, over the ceiling ${ceiling(60)}`);
      if (reply['entries'].some((e: { writer?: unknown }) => e.writer !== 'bot')) gaps.push(`${name}: an entry of the recorded track isn't the writer bot's`);
      // The replay: the track without its bot, in a fresh replica, to the same hashes at every checkpoint and the end.
      if (!r.replays.length) gaps.push(`${name}: its track ${String(reply['track'])} was never played again without its bot`);
      for (const rp of r.replays) {
        if (rp.reply['ok'] !== true) { gaps.push(`${name}: its replay answered ${canon(rp.reply).slice(0, 300)}`); continue; }
        if (rp.reply['track'] !== reply['track']) gaps.push(`${name}: its replay records track ${String(rp.reply['track'])}, not ${String(reply['track'])}`);
        if (canon(rp.reply['checkpoints']) !== canon(reply['checkpoints'])) gaps.push(`${name}: its replay's checkpoints differ from the run's`);
        if (rp.reply['final'] !== reply['final']) gaps.push(`${name}: its replay ends at ${String(rp.reply['final'])}, the run at ${String(reply['final'])}`);
      }
      // Evidence: the run's track and its first frame by hash.
      if (!result.evidence.includes(String(reply['track']))) gaps.push(`${name}: its track ${String(reply['track'])} isn't in the result's evidence`);
      const first = framesAt(r, 0);
      if (!first.some((h) => HASH.test(h) && result.evidence.includes(h))) gaps.push(`${name}: no frame of its step 0 is in the result's evidence (frames at 0: ${canon(first)})`);
    }
    none(gaps, 'the clean maze\'s runs, as the replicas played and replayed them');
  }, TIMEOUT);
});

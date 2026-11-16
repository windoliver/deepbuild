// AC6 #184.9cae67c4: "A planted replica that leaves a run's first bot entry out of its recorded track fails with
// playtest.replay, naming the run and the first step whose full-state hash differs, though that run reached won"
//
// The rule ported from an upstream game library's random-simulation tests (the oracle page's one test for this
// criterion): seeded play, a history that holds every action applied, and a state rebuilt from the serialized history
// that must equal the one played. Here the history is the run's recorded track, and the rebuilt state the replay's
// full-state hashes. On replicas planted with DEEP_DRIVE_PLANT=drops-first-bot-entry, the clean maze's playtest by
// the route bot (3 runs of 120 s) records each run without its first bot entry: the recorded entries are those an
// unplanted replica records for the same seed, less the first. Each run still reaches won in its bot play; its failure
// (`bot 0 run <i>`, playtest.replay) names the first checkpoint step whose hash differs between the run's play and its
// replay, as the replicas returned them.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, Pool, SEED, SPAN_S, TIMEOUT, WON, canon, driveBin, failureOf, macOnly, none, openHub, playInput, played, putPiece, runPlaytest,
  runSeed, runsOf, scalar, shown, word,
} from './helpers.ts';
import { mazePiece, mazeProgram, routeBot, routeBotProgram } from './programs.ts';

describe(`${AC[6]} a replica that drops a run's first bot entry from its track fails with playtest.replay`, () => {
  it(`${AC[6]} each run reaches won, records its track less the first entry, and fails naming the run and the first differing step`, async () => {
    macOnly();
    const body = mazePiece(mazeProgram('clean'));
    const piece = putPiece(DOC.clean, body);
    const bot = routeBot(routeBotProgram());
    const input = playInput(piece, [bot], { runs: 3 });
    const planted = await Pool.open([{ bin: driveBin('debug'), plant: 'drops-first-bot-entry' }, { bin: driveBin('debug'), plant: 'drops-first-bot-entry' }]);
    const clean = await Pool.open([{ bin: driveBin('debug') }]);
    const hub = await openHub({ pool: planted, playtest: 'loaded' });

    const result = await runPlaytest(hub, input);
    expect(result.outcome, `the playtest on the planted replicas fails: ${shown(result)}`).toBe('failed');
    const gaps: string[] = [];
    for (const r of runsOf(planted.log, input)) {
      const name = `bot 0 run ${r.i}`;
      const reply = r.play.reply;
      if (!(reply['values'][WON] as unknown[]).some((v) => scalar(v) === 1)) gaps.push(`${name}: its bot play never reaches won`);
      const honest = played(await clean.play({ piece: body, seed: runSeed(SEED, r.i), span: SPAN_S, bot, values: [], frames: [] }), `${name} on an unplanted replica`);
      if (canon(reply['entries']) !== canon((honest['entries'] as unknown[]).slice(1))) gaps.push(`${name}: the planted track isn't the unplanted one less its first entry`);
      const rp = r.replays[0];
      if (!rp) { gaps.push(`${name}: its track was never played again`); continue; }
      const a = reply['checkpoints'] as { step: number; hash: string }[];
      const b = rp.reply['checkpoints'] as { step: number; hash: string }[];
      const differ = a.find((c, n) => b[n]?.step !== c.step || b[n]?.hash !== c.hash);
      if (!differ) { gaps.push(`${name}: its replay's checkpoints all match the run's`); continue; }
      const f = failureOf(result, name, 'playtest.replay');
      if (!f) { gaps.push(`${name}: no playtest.replay failure`); continue; }
      if (!word(`step ${differ.step}`).test(f.message)) gaps.push(`${name}: its failure doesn't name step ${differ.step}, the first whose full-state hash differs: ${f.message}`);
    }
    none(gaps, 'each run on the planted replicas');
  }, TIMEOUT);
});

// AC8 #184.8c80cb23: "With the plug-in off, every canvas module builds and passes its conformance kit, and a brief that
// names playtest leaves its requirement BLOCKED, naming the plug-in, never PASS; and a planted runner that returns PASS
// with 19 of 20 runs, or without one run's track, is refused, naming the missing run"
//
// 1. The canvas: deep-show with the full module set builds, and the canvas kit (#138) over every module its registry
//    lists passes, module by module. Nothing of the playtest is in it, so this holds with the plug-in off.
// 2. A hub where deepbuild/playtest is installed and never loaded: runCheck("playtest") ends `missing`, naming
//    deepbuild/playtest, and the verdict on a requirement that check covers is BLOCKED, naming it.
// 3. The maze player's input asks 20 runs (seed 184, 60 steps each). Its planted runners report passed: one played runs 0
//    to 18 and counts 19; one played all 20 and leaves run 7's track out of its evidence. The validator refuses each,
//    naming the missing run (`run 19`, `run 7`) and its seed; the same runner with every run's track goes through.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, PLAYTEST_ID, Pool, SEED, TIMEOUT, driveBin, judge, macOnly, none, openHub, playInput, putPiece, runPlayer, runPlaytest, runSeed, shown,
  show, word,
} from './helpers.ts';
import { mazePiece, mazeProgram, routeBot, routeBotProgram } from './programs.ts';
import { REGISTRY, deepShow, runShow, scenario } from '../533/helpers.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe(`${AC[8]} with the plug-in off, playtest is BLOCKED naming it; a PASS short of a run or a track is refused`, () => {
  it(`${AC[8]} every canvas module passes its kit; playtest's requirement is BLOCKED naming ${PLAYTEST_ID}; 19 of 20 runs, or one track short, is refused naming the run`, async () => {
    macOnly();
    // 1. The canvas modules, built and kit-checked.
    const evidence = mkdtempSync(join(tmpdir(), 'deep-184-kit-'));
    try {
      const bin = deepShow(['full']);
      const [reg] = runShow(bin, scenario(evidence, [REGISTRY]));
      const modules = (reg!['modules'] as string[]).map(String);
      expect(modules.length, `the registry lists the canvas modules: ${show(reg)}`).toBeGreaterThan(0);
      const [kit] = runShow(bin, scenario(evidence, [{ call: 'kit', modules, sequences: 100, param_sets: 50 }]));
      const ran = (kit!['modules'] as { module: string; verdict: string }[]) ?? [];
      expect(ran.map((m) => m.module).sort(), `the kit ran every module: ${show(kit)}`).toEqual([...modules].sort());
      none(ran.filter((m) => m.verdict !== 'PASS').map((m) => `${m.module}: ${m.verdict}`), 'canvas modules that fail their kit');
    } finally {
      rmSync(evidence, { recursive: true, force: true });
    }

    // 2. The plug-in off: BLOCKED, naming it.
    const piece = putPiece(DOC.clean, mazePiece(mazeProgram('clean')));
    const off = await openHub({ pool: null, playtest: 'off' });
    const result = await runPlaytest(off, playInput(piece, [routeBot(routeBotProgram())]));
    expect(result.outcome, `with the plug-in off the playtest can't run: ${shown(result)}`).toBe('missing');
    expect(result.failures.some((f) => f.message.includes(PLAYTEST_ID)), `the run names ${PLAYTEST_ID}: ${shown(result)}`).toBe(true);
    const v = judge(result, 'definition');
    expect(v.requirements[0]?.outcome, `the requirement is BLOCKED: ${show(v.reasons)}`).toBe('BLOCKED');
    expect(v.outcome, 'never PASS').not.toBe('PASS');
    expect(JSON.stringify(v.reasons), 'the verdict names the plug-in').toContain(PLAYTEST_ID);

    // 3. The planted runners.
    const pool = await Pool.open([{ bin: driveBin('debug') }]);
    const hub = await openHub({ pool, playtest: 'none', player: { docs: [DOC.clean] } });
    const input = { piece, seed: SEED, runs: 20, span: { steps: 60 } };
    const plays = (n: number): { piece: string; run: Record<string, unknown> }[] =>
      [...Array(n)].map((_, i) => ({ piece, run: { seed: runSeed(SEED, i), span: { steps: 60 }, values: ['maze.cell'], frames: [] } }));

    const short = await runPlayer(hub, input, { plays: plays(19), testsRun: 19, evidence: 'tracks' });
    expect(short.seen.every((s) => typeof s.reply['track'] === 'string'), `the 19 plays went through: ${show(short.seen.map((s) => s.reply['error'] ?? 'ok'))}`).toBe(true);
    refusedNaming(short.result, 19);

    const trackless = await runPlayer(hub, input, { plays: plays(20), testsRun: 20, evidence: 'tracks', drop: 7 });
    refusedNaming(trackless.result, 7);

    const whole = await runPlayer(hub, input, { plays: plays(20), testsRun: 20, evidence: 'tracks' });
    expect(whole.result.outcome, `with every run's track the same runner's PASS goes through: ${shown(whole.result)}`).toBe('passed');
  }, TIMEOUT);
});

function refusedNaming(result: Awaited<ReturnType<typeof runPlaytest>>, i: number): void {
  expect(result.outcome, `a PASS without run ${i} is refused: ${shown(result)}`).not.toBe('passed');
  const text = result.failures.map((f) => f.message).join('\n');
  expect(word(`run ${i}`).test(text), `the refusal names run ${i}: ${text}`).toBe(true);
  expect(word(String(runSeed(SEED, i))).test(text), `and its seed ${runSeed(SEED, i)}: ${text}`).toBe(true);
}

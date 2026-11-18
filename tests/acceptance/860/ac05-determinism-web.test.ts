// Criterion 5: "logic.determinism passes on 20 seeded playtest runs whose bots rewind at random stops, each replaying from
// its track alone to the same hashes; and a rewind in the app equals the same rewind in the web player by full-state hash"
//
// The bots: the playtest plug-in's `playtest` check, run through the extension host's runCheck with a pool of `deep-drive`
// replicas as the hub's replica (#184, #555), plays the puzzle (programs.ts) 20 times from seed 860 for 10 s with a policy
// bot that picks a move every 0.25 s and rewinds 0 to 3 stops every 1.1 s, drawn from each run's seed (README: The
// surface); the plug-in plays each run's recorded track again without its bot. Each run's track then goes to
// `deep-logic determinism` (#532's logic.determinism). The planted arrays-only rewind of criterion 1 shows the check can
// fail there. The app and the web player: `deep-show run` presents the puzzle as a document, replays its logic on a track
// of 8 moves, a rewind of 3 stops and 2 other moves (and on a fresh play of the current branch), and exports it with
// `video.codec: web` on the rewound track; the bundle plays in headless Chrome with WebGPU and `probe()` reads its
// full-state hashes. Browser files need vitest's `--hookTimeout=180000` (README: Run them).
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, cargoRuns, determinismCall, logic, logicBin, macOnly, prebuild, puzzleProgram, show } from './helpers.ts';
import {
  DOC, Pool, appRun, done, openHub, play, present, presented, putEvidence, putPiece, rowArray, runPlaytest, runShow, runsOf, scenarioOf, shown,
  useBrowsers, useShowBin, useTemp, webExport, webReceiptOf,
} from './app.ts';
import {
  BOT, BOT_MOST, MOVES, PUZZLE, RUNS, SEED, SPAN_S, WEB_AFTER, WEB_BACK, WEB_REWIND_AT, WEB_STEPS, boardAfter, freshPuzzle, isRewind, puzzleDoc, puzzlePiece,
  rewoundPuzzle, type Obj,
} from './programs.ts';

prebuild(() => { cargoRuns(); logicBin(); puzzleProgram(); });
const showBin = useShowBin(TIMEOUT);
const temp = useTemp();
const browsers = useBrowsers();

/** logic.determinism's sampled times, seconds into each 10 s run. */
const AT_TIMES = [2.5, 5, 7.5];
/** A run's rewinds: each one's step and how many stops it went back. */
const rewindsOf = (entries: Obj[]): [number, unknown][] => entries.filter(isRewind).map((e) => [Number(e['t']), e['rewind']?.['to']?.['stop']]);

describe(`${AC[5]} rewinds stay deterministic: bots' seeded runs replay, and the app and the web player agree`, () => {
  it(`${AC[5]} logic.determinism passes on 20 seeded playtest runs whose bots rewind at random stops, each replaying from its track alone to the same hashes`, async () => {
    macOnly();
    cargoRuns();
    const piece = puzzlePiece(puzzleProgram());
    const at = putPiece(DOC.puzzle, piece);
    const pool = await Pool.open(2);
    const host = await openHub(pool);
    const input: Obj = { piece: at, bots: [BOT], runs: RUNS, seed: SEED, span: SPAN_S, goals: [{ name: 'moved', when: `${PUZZLE}.moves` }], frames: { every: 0 } };
    const result = await runPlaytest(host, input);
    expect(result.outcome, `the playtest passes: every run plays and replays to the same hashes: ${shown(result)}`).toBe('passed');
    expect(result.testsRun, 'it counts its 20 runs').toBe(RUNS);
    const runs = runsOf(pool.log, input);
    for (const r of runs) {
      const entries = r.play.reply['entries'] as Obj[];
      const rewinds = entries.filter(isRewind);
      expect(rewinds.length, `run ${r.i} (seed ${r.seed}): its bot rewound at least once`).toBeGreaterThan(0);
      for (const e of rewinds) {
        expect(e['writer'], `run ${r.i}: a bot's rewind carries the writer bot: ${show(e)}`).toBe('bot');
        const n = e['rewind']?.['to']?.['stop'];
        expect(Number.isInteger(n) && n >= 1 && n <= BOT_MOST, `run ${r.i}: each rewind goes back 1 to ${BOT_MOST} stops: ${show(e)}`).toBe(true);
      }
      expect(r.replays.length, `run ${r.i}: its recorded track was played again without its bot`).toBeGreaterThan(0);
      for (const again of r.replays) {
        expect([again.reply['checkpoints'], again.reply['final']], `run ${r.i}: played from its track alone, it reaches the same full-state hash at every checkpoint and at the end`).toEqual([r.play.reply['checkpoints'], r.play.reply['final']]);
      }
    }
    expect(new Set(runs.map((r) => JSON.stringify(rewindsOf(r.play.reply['entries'] as Obj[])))).size, 'the bots rewind at stops drawn from each run\'s seed, not the same ones in every run').toBeGreaterThan(1);

    const checked = logic(runs.map((r) => determinismCall(piece, r.play.reply['entries'] as Obj[], Number(r.play.reply['steps']), AT_TIMES)));
    checked.forEach((d, i) => {
      expect([d['ok'], d['kind'], d['verdict'], d['failures']], `${AC[5]} logic.determinism on run ${i}'s track, which holds ${rewindsOf(runs[i]!.play.reply['entries'] as Obj[]).length} rewinds: ${show(d, 1500)}`).toEqual([true, 'logic.determinism', 'PASS', []]);
    });
    // The check can fail on a wrong rewind: under criterion 1's planted arrays-only rewind it fails run 0's track on a
    // comparison with a fresh play of a current branch (README: logic.determinism).
    const [planted] = logic([determinismCall(piece, runs[0]!.play.reply['entries'] as Obj[], Number(runs[0]!.play.reply['steps']), AT_TIMES)], ['rewind_restores_arrays_only']);
    expect(planted!['verdict'], `logic.determinism fails the planted rewind on run 0's track: ${show(planted, 1500)}`).toBe('FAIL');
    expect((planted!['failures'] as Obj[]).some((f) => f['run'] === 'branch'), `with a failure of the run against a fresh play of its current branch (run: branch): ${show(planted!['failures'], 1500)}`).toBe(true);
  }, TIMEOUT);

  it(`${AC[5]} a rewind in the app equals the same rewind in the web player by full-state hash`, async () => {
    macOnly();
    cargoRuns();
    const program = puzzleProgram();
    const evidence = temp();
    putEvidence(evidence, program.bytes);
    const out = join(temp(), 'bundle');
    const doc = DOC.web;
    const r = runShow(showBin(), scenarioOf({ evidence, docs: [doc], calls: [
      present(doc, puzzleDoc(doc, program.sha)),
      { call: 'logic', doc, steps: WEB_STEPS, track: freshPuzzle() },
      { call: 'logic', doc, steps: WEB_STEPS, track: rewoundPuzzle() },
      webExport(doc, out, { track: rewoundPuzzle() }),
    ] }), 'the puzzle in the app');
    presented(r[0], 'the puzzle, declaring its rewind');
    const model = boardAfter([...MOVES.slice(0, MOVES.length - WEB_BACK), ...WEB_AFTER]).board;
    const fresh = appRun(r[1], PUZZLE, 'the app\'s fresh play of the current branch');
    expect(rowArray(fresh, WEB_STEPS - 1, `${PUZZLE}.board`), 'the fresh play of the 5 moves and the 2 after them ends on the model\'s board').toEqual(model);
    const app = appRun(r[2], PUZZLE, 'the app\'s rewound run');
    // The rewind took effect in the app: after it, the app's run is the fresh play of its current branch.
    const after = (cps: { step: number; hash: string }[]): { step: number; hash: string }[] => cps.filter((c) => c.step > WEB_REWIND_AT);
    expect(after(fresh.checkpoints).map((c) => c.step), 'the fresh play checkpoints after each of the 2 moves after the rewind').toEqual([101, 111]);
    expect(after(app.checkpoints), 'the app\'s rewound run has the fresh play\'s full-state hashes after the rewind').toEqual(after(fresh.checkpoints));
    expect(rowArray(app, WEB_STEPS - 1, `${PUZZLE}.board`), 'and ends on its board').toEqual(model);

    webReceiptOf(r[3], 'the web export of the puzzle on its rewound track');
    const p = browsers(await play(out));
    try {
      await p.tab.mustBeReady('the web player');
      const probe = await p.tab.seekStep(WEB_STEPS - 1, `the web player at step ${WEB_STEPS - 1}`);
      // The current branch: every checkpoint up to the one after move 5 (step 50), the stop the rewind returned to, and
      // every one after the rewind, each (step, full-state hash) once.
      const stopCheckpoint = 10 * (MOVES.length - WEB_BACK) + 1;
      const current = (cps: { step: number; hash: string }[]): string[] =>
        [...new Set(cps.filter((c) => c.step <= stopCheckpoint || c.step > WEB_REWIND_AT).map((c) => `checkpoint ${c.step}: ${c.hash}`))].sort();
      const player = probe.checkpoint_hashes[PUZZLE] ?? [];
      expect(after(player).map((c) => c.step), 'the player holds a checkpoint after each move after the rewind').toEqual([101, 111]);
      expect(current(player), `${AC[5]} the web player's full-state hash at every checkpoint of the current branch equals the app's`).toEqual(current(app.checkpoints.filter((c) => c.step <= WEB_STEPS - 1)));
    } finally {
      await done(p);
    }
  }, TIMEOUT);
});

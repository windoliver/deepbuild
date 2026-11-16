// AC7 #184.25600094: "A logic bot that traps makes its run INVALID, and the check can't pass with it; and a policy that
// names a control the piece doesn't declare is refused before any run, naming the control". One test a clause; the
// second is read by the owner's ruling: "The replica's refusal is 'before any run': the play is refused before its
// first step and the check counts no run."
//
// Clause 1. The clean maze's playtest by the trap bot alone (3 runs of 120 s), a logic bot that divides by k − 5, so its
// own step 5 traps. Each run's play, read from the Pool's log, answers ok with the bot's trap apart from the piece's:
// `bot_trap` at step 5, `trap` null. Each run's failure (`bot 0 run <i>`) says invalid and isn't the piece's
// playtest.trap; the check doesn't pass, and the verdict on it isn't PASS.
//
// Clause 2. The clean maze declares one control, `arrow`. Its playtest by one policy whose picks name `arrow` and `jump` (3 runs
// of 120 s) is run through the hub. The first suite's Pool logs every replica call with its reply; each reply to this
// check's calls is read: a call may reach the replica, but every reply must be an error naming jump and holding only
// what an error answers (`ok`, `t`, `error`), never a played run's track, entries, steps, values, checkpoints or
// frames. The check counts no run (testsRun 0), reports no run's outcome, names jump, doesn't pass, and the verdict on
// it isn't PASS. Then the same policy without `jump` is played (1 run of 2 s) and its run is played and counted, so a
// refusal of every policy, or of every play, fails here too.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, Pool, SEED, TIMEOUT, driveBin, judge, macOnly, none, openHub, pieceOf, playInput, played, putPiece, runPlaytest, runSeed, runsOf, show, shown, word,
} from '../184/helpers.ts';
import { logicBot, mazePiece, mazeProgram, trapBotProgram } from '../184/programs.ts';

/** The trap bot's own step that divides by zero (programs.ts: k − 5). */
const BOT_TRAP_STEP = 5;

describe(`${AC[7]} a logic bot that traps makes its run INVALID, and the check can't pass with it`, () => {
  it(`${AC[7]} each trap-bot run has the bot's trap apart from the piece's, fails as invalid, and the check doesn't pass`, async () => {
    macOnly();
    const piece = putPiece(DOC.clean, mazePiece(mazeProgram('clean')));
    const input = playInput(piece, [logicBot(trapBotProgram())], { runs: 3 });
    const pool = await Pool.open([{ bin: driveBin('debug') }, { bin: driveBin('debug') }]);
    const hub = await openHub({ pool, playtest: 'loaded' });

    const result = await runPlaytest(hub, input);
    const wrong: string[] = [];
    for (const r of runsOf(pool.log, input)) {
      const reply = r.play.reply;
      const botTrap = reply['bot_trap'] as { step?: unknown } | null | undefined;
      if (!botTrap || Number(botTrap.step) !== BOT_TRAP_STEP) wrong.push(`run ${r.i}: the replica's bot_trap isn't at step ${BOT_TRAP_STEP}: ${show(botTrap ?? null, 300)}`);
      if (reply['trap'] !== null) wrong.push(`run ${r.i}: the piece's trap isn't null (the bot trapped, not the maze): ${show(reply['trap'], 300)}`);
      const f = result.failures.find((x) => x.test === `bot 0 run ${r.i}`);
      if (!f) wrong.push(`run ${r.i}: no failure names bot 0 run ${r.i}`);
      else {
        if (!/invalid/i.test(f.message)) wrong.push(`run ${r.i}: its failure doesn't say invalid: ${f.message}`);
        if (f.message.startsWith('playtest.trap')) wrong.push(`run ${r.i}: its failure is the piece's playtest.trap, not an invalid run: ${f.message}`);
      }
    }
    none(wrong, `each trap-bot run is INVALID by its bot's trap: ${shown(result)}`);
    expect(result.outcome, `the playtest doesn't pass: ${shown(result)}`).not.toBe('passed');
    const v = judge(result, 'definition');
    expect(v.requirements[0]?.outcome, `the requirement it covers isn't PASS: ${show(v.reasons)}`).not.toBe('PASS');
  }, TIMEOUT);
});

const ARROW_PICK = { from: [1, 2, 3, 4], every: 0.25 };
/** A policy that also picks `jump`, which the maze doesn't declare. */
const JUMP_POLICY = { policy: { pick: { arrow: ARROW_PICK, jump: { from: [0, 1], every: 0.25 } } } };
/** The same policy on the declared control alone. */
const ARROW_POLICY = { policy: { pick: { arrow: ARROW_PICK } } };
/** What an error reply holds (README of the first suite: The surface): nothing of a played run. */
const ERROR_KEYS = new Set(['ok', 't', 'error']);
/** The outcome codes a counted run's failure starts with. */
const RUN_CODES = ['playtest.stuck', 'playtest.goal_missed', 'playtest.trap', 'playtest.over_budget', 'playtest.replay'];

describe(`${AC[7]} a policy naming a control the piece doesn't declare is refused before its first step, naming it`, () => {
  it(`${AC[7]} the replica answers no played step, the check counts no run, names jump and doesn't pass`, async () => {
    macOnly();
    const piece = putPiece(DOC.clean, mazePiece(mazeProgram('clean')));
    expect(Object.keys(pieceOf(piece)['controls'] as object), 'the maze declares arrow and no jump').toEqual(['arrow']);
    const pool = await Pool.open([{ bin: driveBin('debug') }]);
    const hub = await openHub({ pool, playtest: 'loaded' });

    const input = playInput(piece, [JUMP_POLICY], { runs: 3 });
    const result = await runPlaytest(hub, input);
    const calls = pool.log.filter((p) => p.piece === piece);

    // Every call that reached the replica is refused before its first step: an error naming jump, nothing played.
    const notRefused: string[] = [];
    for (const [n, p] of calls.entries()) {
      const r = p.reply;
      const error = (r['error'] ?? {}) as { code?: unknown; message?: unknown };
      if (r['ok'] !== false) notRefused.push(`call ${n} (seed ${String(p.call['seed'])}) answered ok: ${show(r, 300)}`);
      else if (!word('jump').test(`${String(error.code)} ${String(error.message)}`)) notRefused.push(`call ${n}'s error doesn't name jump: ${show(r, 300)}`);
      const extra = Object.keys(r).filter((k) => !ERROR_KEYS.has(k));
      if (extra.length) notRefused.push(`call ${n}'s reply holds ${extra.join(', ')}, a played run's fields: ${show(r, 300)}`);
    }
    expect(notRefused, `the replica refused every call before its first step:\n  ${notRefused.join('\n  ')}`).toEqual([]);

    // The check counts no run, reports no run's outcome, names the control, and doesn't pass.
    expect(result.outcome, `the playtest doesn't pass: ${shown(result)}`).not.toBe('passed');
    expect(result.testsRun, `the check counts no run: ${shown(result)}`).toBe(0);
    const runFailures = result.failures.filter((f) => /\brun \d+\b/.test(f.test) || RUN_CODES.some((c) => f.message.startsWith(c)));
    expect(runFailures.map((f) => `[${f.test}] ${f.message}`), `no failure is a run's outcome: ${shown(result)}`).toEqual([]);
    expect(result.failures.some((f) => word('jump').test(`${f.test} ${f.message}`)), `a failure names jump: ${shown(result)}`).toBe(true);
    const v = judge(result, 'definition');
    expect(v.requirements[0]?.outcome, `the requirement it covers isn't PASS: ${show(v.reasons)}`).not.toBe('PASS');

    // The same policy on arrow alone is played and its run counted, so the refusal is jump's.
    const before = pool.log.length;
    const contrast = await runPlaytest(hub, playInput(piece, [ARROW_POLICY], { runs: 1, span: 2 }));
    const run0 = pool.log.slice(before).find((p) => p.piece === piece && p.call['bot'] && p.call['seed'] === runSeed(SEED, 0));
    expect(run0, `the arrow policy's run 0 (seed ${runSeed(SEED, 0)}) reached the replica: ${shown(contrast)}`).toBeDefined();
    played(run0!.reply, 'the arrow policy\'s run 0');
    expect(contrast.testsRun, `the arrow policy's playtest counts its run: ${shown(contrast)}`).toBe(1);
  }, TIMEOUT);
});

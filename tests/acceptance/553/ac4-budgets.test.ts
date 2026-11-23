// AC4 #553.b6df6698: Budgets, on the reference Mac in the local preflight, compared with the merge base: with a full
// window of 8 match steps to roll back, the two-player piece restores and steps again in under 4 ms of CPU and takes one
// match step's checkpoints in under 0.5 ms; a frame with one step outstanding and two entries is under 128 B; in
// lockstep, the 300-unit piece's busiest 20 Hz match step runs in under 4 ms of CPU with no rollback checkpoint; a
// draw's commitment and reveal add under 64 B to their messages; and a piece without the net module gains no work per
// frame
//
// The pieces are the neighbouring suites' own: #551's paddle piece (window 8) is "the two-player piece", #549's army of
// 300 units at 20 Hz (window 0) "the 300-unit piece", #552's dice piece with draw_after and without it the draws' pair,
// and the paddle piece with its net item and module taken out "a piece without the net module" (README: Fixtures).
// - Times are net.budget's own five runs after its warm-up (`match` with `check: "net.budget"`): each run's `window_ms`
//   (restoring and stepping the full window again) and this job's `checkpoint_ms` (one match step's rollback checkpoints),
//   and in lockstep each run's `step_ms` (its busiest match step). Each limit is judged by the repo's rule for a timing
//   budget (scripts/benchmark.mjs `judgeLimit`): off a reference Mac, under load or undecided by the five runs it is
//   INCONCLUSIVE, never a pass. "Compared with the merge base" is the budget window's record (docs/parallel-proof.md,
//   section 12a); this file judges the issue's limits.
// - Sizes are the wire's: each relay@1 frame the test relay carried (#550's `bytes`), read in its documented layout,
//   each step's message beside the entries the relay's log decodes in it (#552's `messages`). A frame with one step
//   outstanding is the 27-byte header and that one step; a draw entry adds to its message what the same player's message
//   for the same step lacks in the same match without draw_after.
// - Work per frame is this job's `net_ns` on each frame `frames` gives: the CPU time the net module took in it.
// Wrong programs it fails: the merge base (no checkpoint time, no `net_ns`, a commitment of 64 hex digits in JSON); a
// rollback or a checkpoint over its limit; a lockstep match that keeps a rollback checkpoint; a message format over its
// bytes; a net module that does work for a piece without a net item.
import { describe, expect, it } from 'vitest';
import {
  DICE_STEPS, armyProgram, armyScripts, attacks, diceDoc, diceProgram, lockstepDoc, paddleDoc, rally, rulesProgram, withoutNet, type Plays,
} from './fixtures.ts';
import {
  AC, FULL, Script, TIMEOUT, arr, budgetOf, entryName, framesOf, judged, messagesOf, none, num, obj, play, presented, putEvidence, runShow, show, useBuilds, useChildren,
  useTemp, withLoad, world, type JsonObject,
} from './helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
const STEPS = 600;
const RELAY = 'https://relay.test/553';
const DRAWS = new Set(['draw.commit', 'draw.reveal']);

/** The rally, with player 1's spin beside each of its paddle entries: messages of two entries. */
function twoEntries(steps: number): Plays {
  const plays = rally(2, steps);
  const extra = plays['1']!.filter((e) => e.control === 'paddle1').map((e, i) => ({ step: e.step, control: 'spin', value: i % 2 === 0 ? 0.25 : -0.25 }));
  return { ...plays, '1': [...plays['1']!, ...extra].sort((a, b) => a.step - b.step) };
}
/** Throws INCONCLUSIVE when a limit couldn't be judged here, after every failure is named. */
function settle(fail: string[], undecided: string[], what: string): void {
  none(fail, what);
  if (undecided.length) throw Error(`INCONCLUSIVE: ${undecided.join('; ')}; this is not a pass`);
}

describe(`${AC[4]} the match budgets`, () => {
  it(`${AC[4]} with a full window of 8 match steps to roll back, the two-player piece restores and steps again in under 4 ms of CPU and takes one match step's checkpoints in under 0.5 ms`, async () => {
    const { value: m, loads } = await withLoad(() => play(builds.show(), temp(), 'AC4 net.budget, window 8', {
      document: paddleDoc(), steps: STEPS, plays: rally(2, STEPS), assets: [rulesProgram()], check: 'net.budget',
    }));
    const b = budgetOf(m.reply, 'AC4 window 8');
    const f: string[] = [];
    if (b.window !== 8) f.push(`net.budget measured a window of ${b.window}, not the piece's 8`);
    b.runs.forEach((r, i) => { if (!(r.windowMs > 0 && r.checkpointMs > 0)) f.push(`run ${i + 1} restored no window or took no checkpoint: ${show(r)}`); });
    const w = await judged(4, b.runs.map((r) => r.windowMs), loads, 'restoring and stepping the full window again');
    const c = await judged(0.5, b.runs.map((r) => r.checkpointMs), loads, 'one match step\'s checkpoints');
    settle([...f, ...w.fail, ...c.fail], [...w.undecided, ...c.undecided], 'the paddle piece\'s rollback within its frame');
  }, TIMEOUT);

  it(`${AC[4]} in lockstep, the 300-unit piece's busiest 20 Hz match step runs in under 4 ms of CPU with no rollback checkpoint`, async () => {
    const { value: m, loads } = await withLoad(() => play(builds.show(), temp(), 'AC4 net.budget, lockstep', {
      document: lockstepDoc(armyProgram(), { relay: RELAY, hash_every: 60 }), steps: STEPS, plays: armyScripts(2, STEPS) as unknown as Plays, assets: [armyProgram()], check: 'net.budget',
    }));
    const b = budgetOf(m.reply, 'AC4 lockstep');
    const f: string[] = [];
    if (b.window !== 0) f.push(`net.budget measured a window of ${b.window} in lockstep`);
    b.runs.forEach((r, i) => { if (r.windowMs !== 0 || r.checkpointMs !== 0) f.push(`run ${i + 1} in lockstep restored a window or took a rollback checkpoint: ${show(r)}`); });
    if (b.raw['rollback_snapshot_bytes'] !== 0) f.push(`net.budget counts ${show(b.raw['rollback_snapshot_bytes'])} rollback snapshot bytes in lockstep`);
    const s = await judged(4, b.runs.map((r) => r.stepMs), loads, 'the busiest match step in lockstep');
    settle([...f, ...s.fail], s.undecided, 'the 300-unit piece in lockstep');
  }, TIMEOUT);

  it(`${AC[4]} a frame with one step outstanding and two entries is under 128 B, and a draw's commitment and reveal add under 64 B to their messages`, async () => {
    const f: string[] = [];
    // A frame with one step outstanding: the header and that step's length and message.
    const pair = await play(builds.show(), temp(), 'AC4 the paddle piece\'s frames', { document: paddleDoc(), steps: STEPS, plays: twoEntries(STEPS), assets: [rulesProgram()], relay: { seed: 553, log: true } });
    const frames = framesOf(pair.reply, 'AC4 the paddle piece');
    const two = [...messagesOf(frames).values()].filter((m) => m.entries.length === 2);
    if (two.length < 10) f.push(`the relay's log holds ${two.length} messages of two entries, fewer than 10`);
    const big = two.find((m) => 27 + 2 + m.bytes.length >= 128);
    if (big) f.push(`player ${big.player}'s message of two entries for step ${big.step} is ${big.bytes.length} B: a frame with that step alone outstanding is ${27 + 2 + big.bytes.length} B, not under 128`);
    const alone = frames.filter((x) => x.count === 1 && x.messages[0]!.entries.length === 2 && x.size >= 128);
    if (alone.length) f.push(`a frame of player ${alone[0]!.player} with one step outstanding and two entries is ${alone[0]!.size} B`);
    // A draw's commitment and reveal: each message that carries one draw entry, less the same message without draw_after.
    const dice = diceProgram();
    const evidence = temp();
    const with_ = await play(builds.show(), evidence, 'AC4 the dice piece', { document: diceDoc(dice), steps: DICE_STEPS, plays: attacks() as unknown as Plays, assets: [dice], relay: { seed: 553, log: true }, secure: 1 });
    const without = await play(builds.show(), evidence, 'AC4 the dice piece without draw_after', { document: diceDoc(dice, { drawAfter: false }), steps: DICE_STEPS, plays: attacks() as unknown as Plays, assets: [dice], relay: { seed: 553, log: true }, secure: 1 });
    const twin = messagesOf(framesOf(without.reply, 'AC4 without draw_after'));
    const compared = new Map<string, number>();
    for (const m of messagesOf(framesOf(with_.reply, 'AC4 with draw_after')).values()) {
      const draws = m.entries.filter((e) => DRAWS.has(entryName(e)));
      if (draws.length !== 1) continue;
      const other = twin.get(`${m.player}:${m.step}`);
      const rest = m.entries.filter((e) => !DRAWS.has(entryName(e)));
      if (!other || JSON.stringify(other.entries) !== JSON.stringify(rest) || JSON.stringify(other.members) !== JSON.stringify(m.members)) continue;
      const kind = entryName(draws[0]!);
      compared.set(kind, (compared.get(kind) ?? 0) + 1);
      const added = m.bytes.length - other.bytes.length;
      if (added >= 64) f.push(`player ${m.player}'s ${kind} adds ${added} B to its message for step ${m.step} (${m.bytes.length} B against ${other.bytes.length} B without it), not under 64`);
    }
    for (const kind of DRAWS) if (!((compared.get(kind) ?? 0) >= 10)) f.push(`only ${compared.get(kind) ?? 0} messages carrying one ${kind} could be set beside the same message without draw_after`);
    none(f.slice(0, 12), 'a frame\'s bytes and a draw\'s');
  }, TIMEOUT);

  it(`${AC[4]} a piece without the net module gains no work per frame`, async () => {
    const evidence = temp();
    putEvidence(evidence, rulesProgram().bytes);
    const document = withoutNet(paddleDoc());
    const id = String(document['id']);
    const s = new Script();
    s.present(id, document);
    const at = s.add({ call: 'frames', doc: id, step: '1f', count: 240 });
    const r = await runShow(builds.show(), world(evidence, [id], s.calls), 'AC4 a piece without the net module');
    presented(r[0], 'AC4 the paddle piece without its net item');
    const frames = arr(obj(r[at], 'AC4 frames')['frames'], 'AC4 frames.frames').map((x, i) => obj(x, `AC4 frame ${i}`));
    expect(frames.length, 'frames gives the 240 frames asked for').toBe(240);
    const f: string[] = [];
    frames.forEach((x: JsonObject, i) => {
      const ns = x['net_ns'];
      if (ns !== 0) f.push(`frame ${i}: the net module took ${show(ns)} ns of a piece with no net item (net_ns, README: frames), not 0`);
    });
    if (!(frames.reduce((n, x) => n + num(x['ran'], 'a frame\'s ran'), 0) > 0)) f.push('the frames ran no node, so no work was measured');
    none(f.slice(0, 8), 'the net module\'s work per frame for a piece without it');
  }, TIMEOUT);
});

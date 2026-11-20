// Oracle lane for #551's criteria 1, 2, 4 and 11: the upstream tests the Oracle page links, re-expressed against our
// copies (README: Sources). No upstream code is copied or run: each case is our document and our `match` call, judged
// on what our copies report.
//
// 1. Criterion 1, port: the upstream physics engine's snapshot round-trip test (`tests/snapshot_roundtrip.rs`, at
//    commit 3406750a38286a0d3c7d0f4be2f9d53153e81d90) restores a world from its snapshot and steps on, requiring the
//    same snapshot as the run that never stopped at every later step; the upstream engine's rewind tests (its headless
//    physics tests' rewind file at commit 396c9f059903aed5fec78ecd3d437a40c6415368, `RewindTest_ResimInSync` and
//    `RewindTest_ResimDesyncAfterChangingMass`) require every resimulated step in sync with the same inputs, and a change
//    during the resimulation to desync it from that step on, naming the one particle that differs. Ours: the paddle
//    piece's world and logic rolled back under held-back messages land on the run that never rolled back at every
//    confirmed step; a planted change made each time copy 2 runs step 310, re-runs included, parts the copies from
//    step 310, and net.desync names that step and one field.
// 2. Criterion 1, port: the upstream physics engine's snapshot portability test (`tests/snapshot_portability.rs`, same
//    commit) holds one world's snapshot to one digest natively and on wasm32. Ours: the app's copy (native) and the web
//    player's copy in headless Chrome (wasm32) of one live match reach the same full-state hash at every confirmed step.
// 3. Criteria 1 and 2, formula: the upstream rollback library's input queue tests (`src/input_queue.rs`, at commit
//    d8e2cf1e16abe5c761ee6b01bab2888084c5e74c): an input with a delay of 2 lands two frames later; a missing frame is
//    predicted as the player's last input; a confirmed input that differs from the prediction sets the first incorrect
//    frame a rollback restores to; confirmed inputs read back by frame. Ours: each entry is on the record 2 steps after
//    it was made and nothing predicted is; a late entry rolls the copy back to its own step.
// 4. Criterion 4, port: the same library's sync-test session (`tests/test_synctest_session.rs`, same commit): with a
//    check distance of 2 every frame rolls back and resimulates, a deterministic game passes and two sessions with the
//    same inputs agree, and a game whose checksum doesn't survive a load fails with a mismatched checksum. Ours: inputs
//    that change every step and every message held back exactly 2 steps, so each copy rolls back about every step; the
//    hashes are the on-time run's, two runs agree, and the ring that misses the page `memory.fill` writes fails
//    net.rollback.
// 5. Criterion 11, formula: the same library's sync layer (`src/sync_layer.rs`, lines 342 to 353 and 610 to 622) rolls
//    back to the earliest first incorrect frame over every player's input queue: entries for steps 640 and 636 roll back
//    to 636.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, EVERY_STEP, FULL, HASH_EVERY, Script, TIMEOUT, WINDOW, appAndWeb, copiesOf, failsNaming, firstParted, lastValue, matchCall, none, paddleDoc, play, putEvidence, rally,
  rollbacksOf, rulesProgram, runShow, sameHashes, scriptLines, show, trackFailures, trackLines, useBuilds, useCertificate, useChildren, useCleanup, useClosers, useTemp,
  withOnly, world, type Plays,
} from './helpers.ts';

const builds = useBuilds({ show: [FULL], relay: true });
const certs = useCertificate();
useCleanup();
useChildren();
const closing = useClosers();
const temp = useTemp();

describe('the upstream rollback, resimulation and snapshot tests, on our copies', () => {
  it(`${AC[1]} resimulated steps land on the run that never stopped, and a change made during the resimulation of step 310 desyncs the copies from that step, naming one field`, async () => {
    const steps = 600;
    const plays = rally(2, steps);
    const document = paddleDoc({ hash_every: EVERY_STEP });
    const held = { seed: 551, back: { up_to: WINDOW } } as const;
    const never = await play(builds.show(), temp(), 'the oracle: the run that never rolled back', { document, steps, plays });
    const rolled = await play(builds.show(), temp(), 'the oracle: rolled back and stepped again', { document, steps, plays, relay: held });
    const f: string[] = [];
    for (const c of rolled.copies) {
      if (c.rollbacks === 0) f.push(`copy ${c.player} never rolled back, so nothing was resimulated`);
      f.push(...sameHashes(c, never.copies[c.player - 1]!, `copy ${c.player} rolled back and the run that never stopped`, steps - 2 * WINDOW));
    }
    // The change during the resimulation: the plant (#550's `match` member), made each time copy 2 runs step 310.
    const evidence = temp();
    putEvidence(evidence, rulesProgram().bytes);
    const s = new Script();
    s.present(DOC.paddle, paddleDoc());
    const m = s.add({ ...matchCall(DOC.paddle, steps, { plays, relay: held }), plant: { player: 2, step: 310, field: 'rules.tally', add: 1 } });
    const r = await runShow(builds.show(), world(evidence, [DOC.paddle], s.calls), 'the oracle: a change at step 310');
    for (const c of copiesOf(r[m], 2, 'the oracle: a change at step 310')) {
      const d = c.raw['desync'] as { first_step?: unknown; field?: unknown } | null | undefined;
      if (!d || d.first_step !== 310 || typeof d.field !== 'string' || !/(^|[.:/])tally(\[0\])?$/.test(d.field)) f.push(`copy ${c.player}: net.desync must name step 310 and the one field rules.tally, got ${show(d ?? null, 400)}`);
      if (c.hashes.some((h) => h.step > 310 + HASH_EVERY)) f.push(`copy ${c.player} played on past the hash after step 310`);
    }
    none(f, 'resimulation in sync, and a change during it named');
  }, TIMEOUT);

  it(`${AC[1]} the app's copy, native, and the web player's, on wasm32, reach the same full-state hash at every confirmed step`, async () => {
    const steps = 300;
    const live = await appAndWeb({ builds, certs, temp, closing, steps, plays: { '1': rally(2, steps)['1']! }, holdSteps: 0, what: 'the oracle' });
    const before = Math.min(live.app.record?.confirmed ?? 0, live.web.record?.confirmed ?? 0);
    none(sameHashes(live.app, live.web, 'the app\'s copy and the web player\'s', before - 2 * WINDOW), 'one match\'s hashes, native and on wasm32');
  }, TIMEOUT);

  it(`${AC[2]} an entry lands 2 steps after it is made, nothing predicted reaches the record, and a late entry rolls the copy back to its own step`, async () => {
    const steps = 120;
    // Upstream's queue takes input i at frame i; ours, player 1's paddle at i / 2 for each step i under 10.
    const plays: Plays = { '1': Array.from({ length: 10 }, (_, i) => ({ step: i, control: 'paddle1', value: i / 2 })), '2': [{ step: 40, control: 'paddle2', value: 2.5 }] };
    const r = await play(builds.show(), temp(), 'the oracle: the input queue', { document: paddleDoc({ hash_every: EVERY_STEP }), steps, plays, relay: { seed: 551, deliver: [{ player: 2, step: 42, to: 1, at: 45 }] } });
    const f: string[] = [];
    for (const c of r.copies) f.push(...trackFailures(trackLines(c.record?.track ?? [], steps), scriptLines(plays, steps), `copy ${c.player}'s record and the entries, each 2 steps on`));
    const back = rollbacksOf(r.copies[0]!, 'the oracle').filter((x) => x.from >= 45);
    if (!back.length || back.some((x) => x.to !== 42)) f.push(`the late entry for step 42 must roll copy 1 back to step 42, its first incorrect step: ${JSON.stringify(back)}`);
    none(f, 'delay, prediction and the first incorrect step');
  }, TIMEOUT);

  it(`${AC[4]} with every message held back exactly 2 steps every step rolls back and lands on the on-time run, two runs agree, and a ring that misses the page memory.fill writes fails net.rollback`, async () => {
    const steps = 200;
    // Upstream's inputs: i at frame i from both players; ours, each paddle at (i mod 7) − 3, with no input delay.
    const inputs = (p: number): Plays[string] => Array.from({ length: steps }, (_, i) => ({ step: i, control: `paddle${p}`, value: (i % 7) - 3 }));
    const plays: Plays = { '1': inputs(1), '2': inputs(2) };
    const document = paddleDoc({ hash_every: EVERY_STEP, delay: 0 });
    const held = { seed: 551, back: { exactly: 2 } } as const;
    const onTime = await play(builds.show(), temp(), 'the oracle: the sync test, on time', { document, steps, plays });
    const one = await play(builds.show(), temp(), 'the oracle: the sync test, run 1', { document, steps, plays, relay: held, check: 'net.rollback' });
    const two = await play(builds.show(), temp(), 'the oracle: the sync test, run 2', { document, steps, plays, relay: held, check: 'net.rollback' });
    const f: string[] = [];
    if (one.check!.verdict !== 'PASS') f.push(`net.rollback gives ${one.check!.verdict}: ${show(one.check!.failures, 600)}`);
    for (const c of one.copies) {
      if (c.rollbacks < steps - 20) f.push(`copy ${c.player} rolled back ${c.rollbacks} times in ${steps} steps, not about every step`);
      f.push(...sameHashes(c, onTime.copies[c.player - 1]!, `copy ${c.player} and the on-time run`, steps - 10));
      f.push(...sameHashes(c, two.copies[c.player - 1]!, `copy ${c.player} in two runs`, steps - 10));
    }
    none(f, 'a rollback every step, deterministic');
    const twin = await play(builds.show(), temp(), 'the oracle: the sync test, planted', { document, steps, plays, relay: held, check: 'net.rollback', planted: 'net_ring_misses_fill' });
    const parted = firstParted(twin.copies, onTime.copies);
    expect(twin.check!.verdict, `the ring that misses the filled page fails net.rollback: ${show(twin.check!.raw, 600)}`).toBe('FAIL');
    failsNaming(twin.check!.failures.map((x) => `step ${String(x['step'])}`), [new RegExp(`^step ${String(parted)}$`)], 'the ring that misses the filled page');
  }, TIMEOUT);

  it(`${AC[11]} entries for steps 640 and 636 that reach copy 1 together roll it back to 636, the earliest over every player's queue`, async () => {
    const steps = 700;
    const document = paddleDoc({ players: 3, hash_every: EVERY_STEP }, DOC.trio);
    const base = rally(3, steps);
    const moved = lastValue(base, 2, 'paddle2', 622) === 2.5 ? -2.5 : 2.5;
    const plays = withOnly(withOnly(base, 2, 622, 656, [{ step: 638, control: 'paddle2', value: moved }]), 3, 622, 656, [{ step: 634, control: 'spin', value: 0.75 }]);
    const r = await play(builds.show(), temp(), 'the oracle: two queues', { document, steps, plays, relay: { seed: 551, deliver: [{ player: 2, step: 640, to: 1, at: 643 }, { player: 3, step: 636, to: 1, at: 643 }] } });
    const back = rollbacksOf(r.copies[0]!, 'the oracle').filter((x) => x.from >= 643);
    expect(back.length ? Math.min(...back.map((x) => x.to)) : null, `copy 1 rolls back to 636, the earlier of 640 and 636: ${JSON.stringify(back)}`).toBe(636);
  }, TIMEOUT);
});

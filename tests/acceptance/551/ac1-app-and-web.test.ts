// AC1 #551.6a2c4947: A two-player piece whose logic keeps score and whose world has a ball each player's paddle hits,
// played by a copy in the app on the reference Mac and a copy in headless Chrome's web player over a local test relay
// from recorded input tracks of 1,200 match steps, reaches the same full-state hash at every confirmed step, holds no
// occurrence from a replaced step and records the same merged track when the relay holds each player's messages back
// by up to 8 steps in a seeded order as when every message arrives on time; a planted copy that applies a late entry
// at the step it arrived fails net.rollback, naming the first step that differs
//
// The piece is fixtures.ts's paddle piece (the world `court`: a ball and two paddles; the logic item `rules`: the
// score; net: 60 Hz, delay 2, window 8), with a full-state hash at every match step. The live match: the shipped relay
// behind #549's door on 127.0.0.1, which holds each frame it forwards back by a seeded time of up to 8 match steps; the
// app's copy (a person's click on the app's Join prompt, then `play_match` with player 1's recorded script) and the web
// player's copy in headless Chrome (joined through the first player's link by a person's click; its person presses
// paddle 2's keys, one every 0.3 s, as player 2's recorded input). The run where every message arrives on time is
// `match` in one process with no relay faults, on player 1's script and player 2's entries as the records hold them.
// The planted copy is `net_applies_at_arrival` under `match` with `check: "net.rollback"` and a seeded schedule that
// holds each frame back by up to 8 steps. Wrong programs it fails: the merge base (no world in a match, no rollback);
// a rollback that keeps a replaced step's occurrence or its hash; an entry applied at its arrival; a copy whose web
// build steps the world otherwise; a check that names another step than the first that differs.
import { describe, expect, it } from 'vitest';
import { DELAY, EVERY_STEP, WINDOW, paddleDoc, rally, rulesProgram } from './fixtures.ts';
import {
  AC, FULL, TIMEOUT, appAndWeb, firstParted, lowestNamed, none, occurrenceFailures, play, playsFromRecord, sameHashes, scriptLines, trackFailures, trackLines,
  useBuilds, useCertificate, useChildren, useCleanup, useClosers, useTemp,
} from './helpers.ts';

const builds = useBuilds({ show: [FULL], relay: true });
const certs = useCertificate();
useCleanup();
useChildren();
const closing = useClosers();
const temp = useTemp();
const STEPS = 1200;
const plays = rally(2, STEPS);

describe(`${AC[1]} the paddle piece between the app and the web player, its messages held back`, () => {
  it(`${AC[1]} the app's copy and headless Chrome's reach the on-time run's full-state hash at every confirmed step, hold no occurrence from a replaced step and record its merged track`, async () => {
    const script = { '1': plays['1']! };
    const live = await appAndWeb({ builds, certs, temp, closing, steps: STEPS, plays: script, holdSteps: WINDOW, what: 'AC1' });
    const { app, web } = live;
    const f: string[] = [];
    if (app.player !== 1 || web.player !== 2) f.push(`the app's copy is player ${app.player} and the web player's player ${web.player}, not 1 and 2 in the order they joined`);
    if (app.ran !== STEPS) f.push(`the app's copy ran ${app.ran} match steps, not ${STEPS}`);
    if (!app.record || !web.record) { none([...f, 'a copy has no record'], 'AC1 the live match'); return; }
    const before = Math.min(app.record.confirmed, web.record.confirmed) + 1;
    if (before < STEPS - 3 * WINDOW) f.push(`the copies confirmed only ${before} of ${STEPS} steps`);
    for (const c of [app, web]) if (c.rollbacks === 0) f.push(`copy ${c.player} never rolled back, so the held-back messages made nothing late`);
    if (live.framesThrough < STEPS) f.push(`only ${live.framesThrough} frames crossed the door in ${STEPS} match steps`);
    // Player 2's entries on the track are the person's key presses, in order, each the value its key sets.
    const p2 = playsFromRecord(app, 2, before);
    if (p2.length < 10) f.push(`the record holds ${p2.length} entries of player 2's, fewer than 10 of the ${live.presses.length} key presses`);
    if (JSON.stringify(p2.map((e) => e.value)) !== JSON.stringify(live.presses.slice(0, p2.length))) f.push(`player 2's recorded entries ${JSON.stringify(p2.map((e) => e.value).slice(0, 12))} aren't the keys the person pressed, in order: ${JSON.stringify(live.presses.slice(0, 12))}`);
    // The run where every message arrives on time, on the same entries at the same steps.
    const onTime = await play(builds.show(), temp(), 'AC1 every message on time', { document: paddleDoc({ hash_every: EVERY_STEP }), steps: STEPS, plays: { ...script, '2': p2 }, programs: [rulesProgram()] });
    const [o1, o2] = onTime.copies;
    f.push(...sameHashes(app, o1!, 'the app\'s copy and the on-time run', before - 2 * WINDOW));
    f.push(...sameHashes(web, o2!, 'the web player\'s copy and the on-time run', before - 2 * WINDOW));
    f.push(...sameHashes(app, web, 'the app\'s copy and the web player\'s', before - 2 * WINDOW));
    f.push(...occurrenceFailures(app, o1!, before, 'the app\'s copy'), ...occurrenceFailures(web, o2!, before, 'the web player\'s copy'));
    const want = trackLines(o1!.record!.track, before);
    f.push(...trackFailures(trackLines(app.record.track, before), want, 'the app\'s record and the on-time run\'s'));
    f.push(...trackFailures(trackLines(web.record.track, before), want, 'the web player\'s record and the on-time run\'s'));
    f.push(...trackFailures(want, scriptLines({ ...script, '2': p2 }, before, DELAY), 'the on-time record and the entries made, each stamped 2 steps on'));
    none(f, 'the app and the web player under held-back messages, against every message on time');
  }, TIMEOUT);

  it(`${AC[1]} a planted copy that applies a late entry at the step it arrived fails net.rollback, naming the first step that differs`, async () => {
    const document = paddleDoc({ hash_every: EVERY_STEP });
    const onTime = await play(builds.show(), temp(), 'AC1 every message on time', { document, steps: STEPS, plays });
    const held = { seed: 551, back: { up_to: WINDOW } } as const;
    // The honest copies pass the same check under the same schedule, so what fails below is the planted copy's own.
    const honest = await play(builds.show(), temp(), 'AC1 net.rollback', { document, steps: STEPS, plays, relay: held, check: 'net.rollback' });
    expect([honest.check!.verdict, honest.check!.failures], `net.rollback passes the honest copies: ${JSON.stringify(honest.check!.raw).slice(0, 800)}`).toEqual(['PASS', []]);
    const twin = await play(builds.show(), temp(), 'AC1 net.rollback, planted', { document, steps: STEPS, plays, relay: held, check: 'net.rollback', planted: 'net_applies_at_arrival' });
    const parted = firstParted(twin.copies, onTime.copies);
    expect(parted, 'under the planted copy, a copy\'s full-state hashes part from the on-time run\'s').not.toBeNull();
    expect(twin.check!.verdict, `net.rollback fails the planted copy: ${JSON.stringify(twin.check!.raw).slice(0, 800)}`).toBe('FAIL');
    expect(lowestNamed(twin.check!), `net.rollback names step ${parted}, the first step that differs: ${JSON.stringify(twin.check!.failures).slice(0, 800)}`).toBe(parted);
  }, TIMEOUT);
});


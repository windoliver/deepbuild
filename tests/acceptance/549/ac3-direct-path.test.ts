// AC3 #549.ef287875: With two copies in the app on a network that allows a direct path, a match's messages go directly
// between them and the relay's log shows only their joining; with the direct path blocked, they go through the relay;
// both runs reach the same full-state hash at every confirmed step, and once each match ends the relay holds no
// message, match ID or hash
//
// Two copies in the app (two `deep-show run`s on this machine, each a person's click on the app's Join prompt, then
// `play_match` with its player's script, one entry a match step) play the lockstep piece for 240 match steps through
// the shipped relay behind this suite's door. The door is the relay's log: it reads every relay@1 message each copy
// sends the relay. With the door handing everything on, the copies can set up a direct path through the relay's
// signaling. With the door dropping every `signal` message, they can't, so the direct path is blocked. After each
// match this file asks the relay for that match by its ID, as a late copy would (`join` with `open` false).
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { armyProgram, lockstepDoc, scripts } from './fixtures.ts';
import {
  AC, FULL, TIMEOUT, framesThrough, hashFailures, hostOf, joinedMatches, livePair, none, once, playedOf, putEvidence, readFrame, sentThrough, startDoor, startRelay, third,
  useBuilds, useCertificate, useChildren, useCleanup, useClosers, useTemp, type Copy, type Door, type Opened,
} from './helpers.ts';

const builds = useBuilds({ show: [FULL], relay: true });
const certs = useCertificate();
useCleanup();
useChildren();
const closing = useClosers();
const temp = useTemp();
const STEPS = 240;
const PLAYS = scripts(2, STEPS);
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

interface Run { one: Copy & { match: string }; two: Copy & { match: string }; door: Door; sockets: [Opened[], Opened[]]; held: string }
async function play(what: string, signals: boolean): Promise<Run> {
  const relay = await startRelay(builds.relay(), certs());
  closing(() => relay.stop());
  const door = await startDoor(relay.host, certs(), { signals });
  closing(() => door.close());
  const program = armyProgram();
  const stores: [string, string] = [temp(), temp()];
  for (const s of stores) putEvidence(s, program.bytes);
  // A full-state hash at every match step ("at every confirmed step"); a 120 s timeout, so a slow machine ends nothing.
  const document = lockstepDoc(program, { relay: door.url, hash_every: 1, timeout: 120 });
  const pair = await livePair({ bins: [builds.show(), builds.show()], stores, linkFile: join(temp(), 'link'), document, steps: STEPS, plays: PLAYS, relayCa: certs().ca }, what);
  const one = playedOf(pair.one.reply, `${what}: copy 1`);
  const two = playedOf(pair.two.reply, `${what}: copy 2`);
  // Once the match has ended: a late copy's join to it, straight to the relay. Both copies' processes have exited; the
  // relay may take a moment to see their connections close, so the question is asked again for up to 30 s, each time
  // on a connection of its own, and the last answer is the one read.
  let held = 'null';
  for (let attempt = 0; attempt < 60 && held !== JSON.stringify({ refused: 'unknown' }); attempt++) {
    if (attempt) await sleep(500);
    const late = await third(relay.host, certs().ca);
    await late.waitFor('hello');
    late.send({ join: { match: one.match, players: 2, open: false } });
    const answer = (await late.waitFor('refused', 10_000)) ?? (await late.waitFor('joined', 1));
    late.close();
    held = JSON.stringify(answer?.json ?? null);
  }
  return { one, two, door, sockets: [pair.one.sockets, pair.two.sockets], held };
}
/** What both runs must show: the players in joining order, every step run, no rollback, one match ID, equal hashes. */
function common(run: Run, what: string): string[] {
  const f: string[] = [];
  if (run.one.player !== 1 || run.two.player !== 2) f.push(`${what}: the copies are players ${run.one.player} and ${run.two.player}, not 1 and 2 in the order the relay saw them join`);
  if (run.one.match !== run.two.match) f.push(`${what}: the copies name two match IDs`);
  if (joinedMatches(run.door).some((m) => m !== run.one.match)) f.push(`${what}: a join named a match other than ${run.one.match}: ${JSON.stringify(joinedMatches(run.door))}`);
  for (const c of [run.one, run.two]) {
    if (c.ran < STEPS - 8) f.push(`${what}: copy ${c.player} ran ${c.ran} of ${STEPS} match steps`);
    if (c.rollbacks !== 0) f.push(`${what}: copy ${c.player} rolled back ${c.rollbacks} times`);
  }
  f.push(...hashFailures(run.one, run.two, `${what}: the two copies`, { hashEvery: 1, atLeast: STEPS - 10 }));
  // Once the match ends the relay holds nothing of it: no open match by that ID.
  if (run.held !== JSON.stringify({ refused: 'unknown' })) f.push(`${what}: after the match ended, a join to its ID is answered ${run.held}, not refused unknown: the relay still holds the match`);
  return f;
}

const direct = once(() => play('AC3 a direct path allowed', true));

describe(`${AC[3]} messages go directly between two copies in the app, or through the relay when they can't`, () => {
  it(`${AC[3]} on a network that allows a direct path the relay's log shows only the copies' joining, and the relay holds nothing once the match ends`, async () => {
    const run = await direct();
    const f = common(run, 'a direct path allowed');
    // The relay's log: joins, and the signaling a direct path needs, and not one frame.
    const frames = framesThrough(run.door);
    if (frames.length) f.push(`the relay's log shows ${frames.length} frames; a match's messages go directly between the copies`);
    const members = [...new Set(sentThrough(run.door).filter((m) => m.message.kind === 'text').map((m) => String(m.message.member)))].sort();
    if (members.some((m) => m !== 'join' && m !== 'signal')) f.push(`the copies sent the relay ${members.join(', ')}: more than their joining and its signaling`);
    if (!members.includes('join')) f.push('no join crossed the door');
    if (!members.includes('signal')) f.push('no signal crossed the door, so no direct path was set up through the relay');
    // Each copy's own log: the relay, and one more connection on this machine, to the other copy.
    run.sockets.forEach((log, i) => {
      const beyond = log.filter((s) => s.host !== run.door.host);
      if (!log.some((s) => s.host === run.door.host)) f.push(`copy ${i + 1}'s sockets log shows no connection to the relay ${run.door.host}`);
      if (!beyond.length) f.push(`copy ${i + 1}'s sockets log shows no connection but the relay's: no direct path to the other copy`);
      for (const s of beyond) if (!/^127\.0\.0\.1:\d+$/.test(hostOf(`https://${s.host}`))) f.push(`copy ${i + 1} opened a connection to ${s.host}, neither the relay nor the other copy on this machine`);
    });
    none(f, 'two copies in the app with a direct path');
  }, TIMEOUT);

  it(`${AC[3]} with the direct path blocked the messages go through the relay, to the same full-state hash at every confirmed step`, async () => {
    const open = await direct();
    const run = await play('AC3 the direct path blocked', false);
    const f = common(run, 'the direct path blocked');
    // The relay's log now holds the match's frames, each naming this match.
    const frames = framesThrough(run.door);
    if (frames.length < STEPS) f.push(`only ${frames.length} frames crossed the relay in ${STEPS} match steps with the direct path blocked`);
    const other = frames.map((m, i) => readFrame(m.message.bytes, `frame ${i}`)).filter((x) => x.match !== run.one.match);
    if (other.length) f.push(`${other.length} frames name another match than ${run.one.match} (the first: ${other[0]!.match})`);
    run.sockets.forEach((log, i) => { for (const s of log) if (s.host !== run.door.host) f.push(`copy ${i + 1} opened a connection to ${s.host} with the direct path blocked`); });
    // A match ID is drawn for each match.
    expect(run.one.match, 'the second match has an ID of its own').not.toBe(open.one.match);
    // Both runs, the same script: the same full-state hash at every step both confirmed.
    f.push(...hashFailures(run.one, open.one, 'copy 1 through the relay and on the direct path', { hashEvery: 1, atLeast: STEPS - 10 }));
    f.push(...hashFailures(run.two, open.two, 'copy 2 through the relay and on the direct path', { hashEvery: 1, atLeast: STEPS - 10 }));
    none(f, 'two copies in the app with the direct path blocked');
  }, TIMEOUT);
});

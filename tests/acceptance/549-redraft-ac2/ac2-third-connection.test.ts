// AC2 #549.83ea272a: With every socket and request logged in the app and in headless Chrome, a piece whose net item
// declares a relay opens nothing to it or to any other host before a person clicks Join; a tour's entry, the piece's
// logic, deep_drive's click in a replica and a synthetic click dispatched in the page each leave the prompt unanswered
// with nothing opened; after a person's click every connection goes only to the declared relay's host or, on a direct
// path, to the other copy, with no cookie or credential; and a third connection to the relay with a guessed match ID
// receives nothing from the match
//
// A blind redraft (README.md) of one test of ../549/ac2-join-only.test.ts, its third: the app after a person's click,
// and the third connections. The surface is the first draft's, through its helpers and fixtures as they stand: two
// copies in the app (`deep-show run`, a person's click on the app's prompt, `play_match`, `sockets`) over the shipped
// relay behind this suite's door, and this suite's own relay@1 connections straight to the relay.
//
// What differs is the match IDs the third connections name. relay@1 seats a `join` whose `open` is false in a match
// another connection opened with the same ID, and sends `start` to every copy of a match once its last seat is taken
// (Net: relay protocol `relay@1`; packages/contracts/slots/relay@1.json). So two third connections that name one ID,
// one opening and one joining, fill a match of 2 between themselves and each receives that match's `start`: a message
// from their own match, which nothing tells apart from one from the copies'. Here each third connection names an ID
// of its own, so none can fill a match, and whatever one receives beyond the relay's hello and the answer to its own
// join came from a match it only guessed at.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { armyProgram, lockstepDoc, scripts } from '../549/fixtures.ts';
import {
  AC, FULL, TIMEOUT, fragmentOf, framesThrough, guess, hashFailures, joinedMatches, leakFailures, livePair, none, playedOf, putEvidence, readFrame, sentThrough,
  startDoor, startRelay, third, useBuilds, useCertificate, useChildren, useCleanup, useClosers, useTemp, type Door, type Relay, type Third,
} from '../549/helpers.ts';

const builds = useBuilds({ show: [FULL], relay: true });
const certs = useCertificate();
useCleanup();
useChildren();
const closing = useClosers();
const temp = useTemp();
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
/** A secret in the app's store, which no connection may carry (the first draft's canary). */
const SECRET = 'deep549-canary-0f3a9c27d1e84b56';

async function relayAndDoor(): Promise<{ relay: Relay; door: Door }> {
  const relay = await startRelay(builds.relay(), certs());
  closing(() => relay.stop());
  const door = await startDoor(relay.host, certs());
  closing(() => door.close());
  return { relay, door };
}
/** `id` with the hex digit at `at` changed: a guess one digit off. */
const oneOff = (id: string, at: number): string => `${id.slice(0, at)}${id[at] === '0' ? '1' : '0'}${id.slice(at + 1)}`;
/** The relay answered a connection's join: it seated it or refused it. */
const answered = (conn: Third): boolean => conn.received.some((m) => m.member === 'joined' || m.member === 'refused');

describe(`${AC[2]} nothing opens before a person clicks Join, and then only the declared relay and the other copy`, () => {
  it(`${AC[2]} in the app, after a person's click every connection goes to the declared relay or the other copy with no cookie or credential, and a third connection with a guessed match ID receives nothing from the match`, async () => {
    const { relay, door } = await relayAndDoor();
    const program = armyProgram();
    const stores: [string, string] = [temp(), temp()];
    for (const s of stores) putEvidence(s, program.bytes);
    const steps = 200;
    const document = lockstepDoc(program, { relay: door.url, hash_every: 1, timeout: 120 });
    const thirds: { what: string; match: string; conn: Third }[] = [];
    const pair = await livePair({ bins: [builds.show(), builds.show()], stores, linkFile: join(temp(), 'link'), document, steps, plays: scripts(2, steps), relayCa: certs().ca, secrets: { relay_token: SECRET } }, 'AC2 two copies', async (link) => {
      // Third connections, straight to the relay, once the match is open and before it starts: two random IDs and the
      // match's own ID with one digit changed, twice, as a copy that opens a match and as one that joins one. Every
      // guess is an ID of its own.
      const id = /[0-9a-f]{32}/.exec(fragmentOf(link, null, 'the first player\'s link'))?.[0];
      expect(id, `the link's fragment carries the match ID, 32 hex digits: ${link}`).toBeDefined();
      const guesses: [string, string, boolean][] = [
        ['a random ID, opening', guess(), true],
        ['a random ID, joining', guess(), false],
        ['the ID with its last digit changed, opening', oneOff(id!, 31), true],
        ['the ID with its first digit changed, joining', oneOff(id!, 0), false],
      ];
      expect(new Set([id!, ...guesses.map(([, match]) => match)]).size, 'the four guesses and the match\'s ID are five IDs, so no third connection names the match or another third connection\'s match').toBe(5);
      for (const [what, match, open] of guesses) {
        const conn = await third(relay.host, certs().ca);
        closing(() => conn.close());
        await conn.waitFor('hello');
        conn.send({ join: { match, players: 2, open } });
        thirds.push({ what, match, conn });
        // The relay's answer is waited for, so each connection is in place before the second copy joins and the match
        // starts. An answer that never comes is a failure below, not here.
        const until = Date.now() + 30_000;
        while (!answered(conn) && !conn.closed() && Date.now() < until) await sleep(20);
      }
    });
    const one = playedOf(pair.one.reply, 'AC2 copy 1');
    const two = playedOf(pair.two.reply, 'AC2 copy 2');
    const f: string[] = [];
    fragmentOf(pair.link, one.match, 'the first player\'s link');
    if (one.match !== two.match) f.push('the copies name two match IDs');
    if (pair.one.after?.state === 'open') f.push('after a person\'s click the first copy\'s prompt is still open and unanswered');
    f.push(...hashFailures(one, two, 'the two copies', { hashEvery: 1, atLeast: steps - 10 }));
    // The door, outside both copies: each connection's request head, and every message it sent.
    if (door.connections.length < 2) f.push(`${door.connections.length} connections reached the relay for two copies`);
    f.push(...leakFailures(door, [SECRET], 'after Join'));
    for (const m of sentThrough(door)) {
      if (m.message.kind === 'text' && m.message.member !== 'join' && m.message.member !== 'signal') f.push(`connection ${m.conn} sent the relay a ${String(m.message.member)} message: more than a join, signaling and frames`);
      if (m.message.kind === 'binary' && readFrame(m.message.bytes, 'a frame').match !== one.match) f.push(`connection ${m.conn} sent a frame for another match`);
    }
    if (joinedMatches(door).some((m) => m !== one.match)) f.push(`a join named a match other than ${one.match}`);
    // Each copy's own log: the relay, or the other copy on this machine.
    [pair.one.sockets, pair.two.sockets].forEach((log, i) => {
      if (!log.some((s) => s.host === door.host)) f.push(`copy ${i + 1}'s sockets log shows no connection to the relay ${door.host}`);
      for (const s of log) {
        if (s.host !== door.host && !/^127\.0\.0\.1:\d+$/.test(s.host)) f.push(`copy ${i + 1} opened ${s.kind} to ${s.host}, neither the declared relay nor the other copy`);
        if (JSON.stringify(s.raw).includes(SECRET) || /"(cookie|authorization)"/i.test(JSON.stringify(s.raw))) f.push(`copy ${i + 1}'s ${s.kind} to ${s.host} carries a cookie, a credential or the secret`);
      }
    });
    // The third connections stayed open through the match. Each named an ID no other connection named, so on its own
    // connection it is due the relay's hello and the answer to its own join and nothing more: no frame, no `start`,
    // `closed` or `signal`, nothing that holds the match's ID.
    await sleep(500);
    for (const t of thirds) {
      if (t.match === one.match) f.push(`the third connection with ${t.what} named the match's own ID, which is no guess`);
      for (const m of t.conn.received) {
        if (m.kind === 'binary') f.push(`the third connection with ${t.what} received a frame`);
        else if (m.kind === 'text' && !['hello', 'joined', 'refused'].includes(String(m.member))) f.push(`the third connection with ${t.what} received a ${String(m.member)} message`);
        if (m.bytes.includes(Buffer.from(one.match)) || m.bytes.includes(Buffer.from(one.match, 'hex'))) f.push(`the third connection with ${t.what} received the match's ID`);
      }
      if (!answered(t.conn)) f.push(`the relay never answered the third connection's join with ${t.what}`);
    }
    if (framesThrough(door).length === 0 && ![pair.one.sockets, pair.two.sockets].every((log) => log.some((s) => s.host !== door.host))) f.push('no frame crossed the relay and no copy shows a direct path: the match\'s messages went nowhere this file can see');
    none(f, 'the app after a person clicks Join');
  }, TIMEOUT);
});

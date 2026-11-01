// #309.3: two test clients on the macOS backend join one match ID through the shipped relay and exchange 1,200 frames,
// each read back field by field in relay@1's documented little-endian layout; and a planted client that writes a
// frame's step big-endian fails the relay suite's reader, naming the field and the client.
//
// The clients are `deep-show run`'s `relay_client` call, two processes started together on one match ID, each sending
// frame i with `first` i and `count` 1; each reply carries the bytes of every frame it sent and received, and the relay
// suite's reader's verdict on what it received (README: The surface under test). This file reads every frame itself,
// field by field, little-endian, and compares what one client sent with what the other received. At the base neither
// the relay nor the relay_client call exists.
import { describe, expect, it } from 'vitest';
import { committed, firstBigEndian, matchId, MACOS_BACKEND, readFrame, runClients, startRelay, useBins, useCerts, useCleanup, useOut, type Client } from './helpers.ts';

const bins = useBins(['deep-show', 'deep-relay']);
const certs = useCerts();
const out = useOut();
useCleanup();

const FRAMES = 1_200;

/** This file's reading of one client's sent frames: frame i is {match, its player, confirmed, first i, count 1}. */
function sentProblems(c: Client, match: string): string[] {
  const problems: string[] = [];
  let lastConfirmed = 0;
  c.sent.forEach((bytes, i) => {
    const f = readFrame(bytes, `client ${c.name}'s sent frame ${i}`);
    if (f.match !== match) problems.push(`frame ${i}: match ${f.match}, not ${match}`);
    if (f.player !== c.player) problems.push(`frame ${i}: player ${f.player}, not the client's ${c.player}`);
    if (f.first !== i) problems.push(`frame ${i}: first ${f.first} read little-endian, not ${i}`);
    if (f.count !== 1) problems.push(`frame ${i}: count ${f.count}, not 1`);
    if (f.confirmed > i + 1 || f.confirmed < lastConfirmed) problems.push(`frame ${i}: confirmed ${f.confirmed} after ${lastConfirmed} (it never passes the steps sent and never goes back)`);
    lastConfirmed = f.confirmed;
  });
  return problems;
}

describe('#309.3 two test clients on the macOS backend exchange 1,200 frames through the shipped relay, read back field by field in relay@1\'s little-endian layout', () => {
  it('#309.3 two test clients on the macOS backend join one match ID through the shipped relay and exchange 1,200 frames; this file reads every frame each sent and received field by field, little-endian, and each received the other\'s 1,200 frames as sent', async () => {
    const relay = await startRelay(bins.bin('deep-relay'), certs());
    const match = matchId();
    const [a, b] = await runClients(bins.bin('deep-show'), out(), certs().ca, [
      { name: 'a', relay: relay.url, match, frames: FRAMES },
      { name: 'b', relay: relay.url, match, frames: FRAMES },
    ]);
    for (const c of [a!, b!]) {
      expect(c.backend.name, `client ${c.name} runs on the network seam's macOS backend`).toBe(MACOS_BACKEND);
      expect(c.hello, `client ${c.name} read the shipped relay's hello: relay@1 with the committed digest`).toEqual({ protocol: 'relay@1', digest: committed().digest });
      expect(c.outcome, `client ${c.name} joined and exchanged (reason: ${c.reason})`).toBe('exchanged');
      expect(c.match, `client ${c.name} joined the match ID it was given`).toBe(match);
      expect(c.player, `client ${c.name} was given a player number`).toBeTypeOf('number');
    }
    expect(a!.player, 'the relay gave the two clients different player numbers').not.toBe(b!.player);
    for (const [from, to] of [[a!, b!], [b!, a!]] as const) {
      expect(from.sent.length, `client ${from.name} sent 1,200 frames`).toBe(FRAMES);
      expect(sentProblems(from, match), `client ${from.name}'s frames, read field by field little-endian`).toEqual([]);
      expect(to.received.length, `client ${to.name} received 1,200 frames`).toBe(FRAMES);
      const differ: string[] = [];
      to.received.forEach((bytes, i) => {
        const f = readFrame(bytes, `client ${to.name}'s received frame ${i}`);
        if (f.match !== match || f.player !== from.player || f.first !== i || f.count !== 1) differ.push(`frame ${i}: match ${f.match}, player ${f.player}, first ${f.first}, count ${f.count}`);
        if (!bytes.equals(from.sent[i]!)) differ.push(`frame ${i}: its bytes differ from what client ${from.name} sent`);
      });
      expect(differ.slice(0, 5), `client ${to.name} received client ${from.name}'s frames in order, each field as sent`).toEqual([]);
      expect(to.reader.failures, `the relay suite's reader passes what client ${to.name} received`).toEqual([]);
      expect(to.reader.status, `the relay suite's reader passes what client ${to.name} received`).toBe('PASS');
    }
    await relay.stop();
  }, 1_200_000);

  it('#309.3 a planted client that writes a frame\'s step big-endian (deep-show run --planted net_writes_step_big_endian) fails the relay suite\'s reader, naming the field first and the client', async () => {
    const relay = await startRelay(bins.bin('deep-relay'), certs());
    const match = matchId();
    const [good, planted] = await runClients(bins.bin('deep-show'), out(), certs().ca, [
      { name: 'good', relay: relay.url, match, frames: FRAMES },
      { name: 'planted', relay: relay.url, match, frames: FRAMES, planted: 'net_writes_step_big_endian' },
    ]);
    expect(planted!.player, 'the planted client joined and was given a player number').toBeTypeOf('number');
    expect(good!.received.length, 'the correct client received the planted client\'s frames').toBeGreaterThan(1);
    // This file's own reading: the planted writer put each step into `first` big-endian.
    const bigEndian = good!.received.map((bytes, i) => ({ i, le: readFrame(bytes, `received frame ${i}`).first, be: firstBigEndian(bytes) }));
    expect(bigEndian.filter((x) => x.be !== x.i).slice(0, 5), 'read big-endian, the planted frames\' first is each frame\'s step').toEqual([]);
    expect(bigEndian.filter((x) => x.le !== x.i).length, 'read little-endian, as relay@1 lays it out, it isn\'t').toBeGreaterThan(0);
    const failures = good!.reader.failures;
    expect(good!.reader.status, 'the relay suite\'s reader fails the planted client\'s frames').toBe('FAIL');
    const named = failures.filter((f) => /\bfirst\b/.test(f) && f.includes(`player ${planted!.player}`));
    expect(named.length, `a reader failure names the field first and the client, player ${planted!.player}: ${JSON.stringify(failures).slice(0, 1500)}`).toBeGreaterThan(0);
    await relay.stop();
  }, 1_200_000);
});

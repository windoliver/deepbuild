// AC10 #550.e9bf3c06: Over 3,600 match steps with no fault, the track hash adds at most 8 B to each hash message, and the
// relay's log still shows nothing but entries, the match ID and hashes
//
// Two runs of the paddle piece's honest rally over 3,600 match steps (a hash every 60):
// - in one process over the test relay, with its log: both copies play on to the end with no desync or fault, every
//   hash row carries a track hash both copies share, and the log's frames hold nothing but entries, the match ID and
//   hashes (helpers.ts `wireFailures`);
// - live, two app copies through the shipped relay behind #549's door, once on this build and once on the reference,
//   the merge base built apart (`referenceCommit`: HEAD's first parent where HEAD is the merge base), whose hash
//   messages carry no track hash: for each player and hash step, the message that carries this build's full-state hash
//   also carries its track hash, is the message for the same step as the reference's, and is at most 8 B longer.
// A message is one step's bytes in a relay@1 frame, as the door saw it. Wrong programs it fails: the merge base (no
// track hash); a track hash sent as 16 hex digits, a 32-byte digest or one per player; a message that carries state.
import { describe, it } from 'vitest';
import { STEPS_LONG, rally } from './fixtures.ts';
import {
  AC, FULL, TIMEOUT, baseBuild, carrierOf, hashFailures, hashForms, liveRun, none, play, playedOnFailures, players, useBuilds, useCertificate, useChildren, useCleanup,
  useClosers, useTemp, wireFailures, type LiveRun,
} from './helpers.ts';

const builds = useBuilds({ show: [FULL], relay: true });
const certs = useCertificate();
useCleanup();
useChildren();
const closing = useClosers();
const temp = useTemp();
const plays = rally(2, STEPS_LONG);
const MOST = 8;

/** For each player and hash step: this build's hash message carries its track hash, sits at the reference's message's
 * step, and is at most 8 B longer than the reference's. */
function sizeFailures(here: LiveRun, there: LiveRun, ref: string): string[] {
  const f: string[] = [];
  for (const [h, t] of [[here.one, there.one], [here.two, there.two]] as const) {
    let compared = 0;
    const rows = Array.isArray(h.raw['hashes']) ? h.raw['hashes'] : [];
    for (const b of t.hashes) {
      const a = h.hashes.find((x) => x.step === b.step);
      if (!a) continue;
      const mb = carrierOf(there.messages, t.player, b.hash);
      const ma = carrierOf(here.messages, h.player, a.hash);
      if (!mb) { f.push(`AC10: the reference ${ref}'s copy ${t.player} sent no message carrying its full-state hash for step ${b.step}`); continue; }
      if (!ma) { f.push(`AC10: copy ${h.player} sent no message carrying its full-state hash for step ${a.step} (${a.hash})`); continue; }
      compared += 1;
      if (ma.step !== mb.step) f.push(`AC10: copy ${h.player} carries its hash for step ${a.step} in its message for step ${ma.step}, the reference in its message for step ${mb.step}`);
      const row = rows.find((r) => typeof r === 'object' && r !== null && !Array.isArray(r) && r['step'] === a.step);
      const track = row && typeof row === 'object' && !Array.isArray(row) && typeof row['track'] === 'string' ? row['track'] : null;
      if (!track) f.push(`AC10: copy ${h.player}'s hash row for step ${a.step} carries no track hash`);
      else if (!hashForms(track).some((w) => ma.bytes.includes(w))) f.push(`AC10: copy ${h.player}'s hash message for step ${a.step} doesn't carry its track hash ${track}`);
      if (ma.bytes.length - mb.bytes.length > MOST) f.push(`AC10: copy ${h.player}'s hash message for step ${a.step} is ${ma.bytes.length} B, ${ma.bytes.length - mb.bytes.length} B more than the reference's ${mb.bytes.length} B`);
    }
    if (compared < STEPS_LONG / 60 - 2) f.push(`AC10: only ${compared} hash messages of copy ${h.player} were compared with the reference's, fewer than ${STEPS_LONG / 60 - 2}`);
  }
  return f;
}

describe(`${AC[10]} the track hash's bytes over a long match`, () => {
  it(`${AC[10]} over 3,600 match steps with no fault every hash message carries a track hash both copies share, at most 8 B more than the reference's message, and the relay's log holds nothing but entries, the match ID and hashes`, async () => {
    const { copies, log } = await play(builds.show(), temp(), 'AC10 in process', { steps: STEPS_LONG, plays, relay: { seed: 550, log: true } });
    const [one, two] = players(copies, 2, 'AC10');
    const f = [...playedOnFailures(copies, STEPS_LONG, 'AC10'), ...hashFailures(one, two, 'AC10', STEPS_LONG / 60 - 1)];
    let shared = 0;
    for (const h of one.hashes) {
      const [ta, tb] = [one.tracks.get(h.step), two.tracks.get(h.step)];
      if (ta === undefined || tb === undefined) { f.push(`AC10: a copy's hash row for step ${h.step} carries no track hash: ${String(ta)} and ${String(tb)}`); break; }
      if (!/^[0-9a-f]{16}$/.test(ta) || ta !== tb) { f.push(`AC10: the copies' track hashes at step ${h.step} are ${ta} and ${tb}, not one u64 as 16 hex digits`); break; }
      shared += 1;
    }
    if (shared < STEPS_LONG / 60 - 1) f.push(`AC10: the copies share track hashes at ${shared} hash steps, fewer than ${STEPS_LONG / 60 - 1}`);
    f.push(...wireFailures(log ?? [], copies, plays, 'AC10 the relay\'s log'));
    none(f, 'over 3,600 steps the copies share every track hash and the relay carries nothing but entries, the match ID and hashes');

    const here = await liveRun({ bin: builds.show(), relayBin: builds.relay(), certs: certs(), temp, closing, steps: STEPS_LONG, plays, what: 'AC10 this build, live' });
    const ref = baseBuild();
    const there = await liveRun({ bin: ref.bin, relayBin: builds.relay(), certs: certs(), temp, closing, steps: STEPS_LONG, plays, what: `AC10 the reference ${ref.sha.slice(0, 12)}, live` });
    none(sizeFailures(here, there, ref.sha.slice(0, 12)), 'the track hash adds at most 8 B to each hash message');
  }, 2 * TIMEOUT);
});

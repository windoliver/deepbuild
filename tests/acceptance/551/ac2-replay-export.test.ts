// AC2 #551.9b064904: A recorded two-player match of 3,600 match steps with at least 50 rollbacks replays from either
// copy's merged input track, alone and with the network off, to the same full-state hash at every hash interval; the
// two copies' tracks agree on every step both confirmed; the match exports to frames whose raw hashes equal a second
// replay's export; and a planted copy that records a predicted entry fails, naming the step
//
// The paddle piece's match (a full-state hash every 60 match steps), played by `match` over the test relay with each
// frame held back a seeded whole number of match steps up to 8. Each copy's record is then replayed alone with
// `replay` (no relay, no peer, and `sockets` shows nothing opened), and exported with #501's `export` (png_seq, 10
// frames a second, 160 × 90) from copy 1's record and again from copy 2's, up to the last step both confirmed. The
// planted copy is `net_records_predicted`, judged by the same track rule. Wrong programs it fails: the merge base; a
// record that keeps a prediction or drops a late entry; a replay that steps the world or logic otherwise than the
// match did; an export that draws from anything but the record.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DELAY, DOC, DOC_FRAME_RATE, HASH_EVERY, RATE, WINDOW, paddleDoc, rally, rulesProgram, type JsonValue } from './fixtures.ts';
import {
  AC, FULL, TIMEOUT, failsNaming, hashesOf, none, play, replayCall, sameHashes, scriptLines, trackFailures, trackLines, useBuilds, useChildren, useTemp, world,
  type Copy551,
} from './helpers.ts';
import { Script, arr, obj, putEvidence, runShow, show, socketsOf } from '../549/helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
const STEPS = 3600;
const held = { seed: 551, back: { up_to: WINDOW } } as const;
/** Export frames: 10 a second, so frame f is at match step 6 f. */
const FRAME_RATE: [number, number] = [10, 1];
const STEPS_PER_FRAME = RATE / FRAME_RATE[0];
/** A range's `"<n>f"` counts frames at the document's own frame rate (the time grammar), the paddle piece's 60/1. */
const DOC_FRAMES_PER_FRAME = DOC_FRAME_RATE[0] / DOC_FRAME_RATE[1] / FRAME_RATE[0];

/** The track rule: both copies' records agree on every step both confirmed, and hold every entry a player made, each
 * stamped 2 steps on, and nothing else. Each failure names the step where the tracks part. */
function trackRule(a: Copy551, b: Copy551, plays: ReturnType<typeof rally>, what: string): string[] {
  if (!a.record || !b.record) return [`${what}: a copy has no record`];
  const before = Math.min(a.record.confirmed, b.record.confirmed) + 1;
  return [
    ...trackFailures(trackLines(a.record.track, before), trackLines(b.record.track, before), `${what}: copy 1's record and copy 2's`),
    ...trackFailures(trackLines(a.record.track, before), scriptLines(plays, before, DELAY), `${what}: copy 1's record and the entries made`),
    ...trackFailures(trackLines(b.record.track, before), scriptLines(plays, before, DELAY), `${what}: copy 2's record and the entries made`),
  ];
}

describe(`${AC[2]} a recorded match of 3,600 steps with rollbacks, replayed and exported`, () => {
  it(`${AC[2]} either copy's merged track replays alone, with the network off, to the same full-state hash at every hash interval; the tracks agree on every step both confirmed; the export equals a second replay's`, async () => {
    const plays = rally(2, STEPS);
    const document = paddleDoc();
    const match = await play(builds.show(), temp(), 'AC2 the match', { document, steps: STEPS, plays, relay: held });
    const [a, b] = match.copies as [Copy551, Copy551];
    const f: string[] = [];
    const rollbacks = a.rollbacks + b.rollbacks;
    if (rollbacks < 50) f.push(`the match rolled back ${rollbacks} times (copy 1 ${a.rollbacks}, copy 2 ${b.rollbacks}), fewer than 50`);
    f.push(...trackRule(a, b, plays, 'AC2'));
    none(f, 'the recorded match');
    const before = Math.min(a.record!.confirmed, b.record!.confirmed) + 1;

    // Each record replayed alone, then exported, in one run with no relay; `sockets` shows what it opened.
    const evidence = temp();
    putEvidence(evidence, rulesProgram().bytes);
    const s = new Script();
    s.present(DOC.paddle, document);
    const trackOf = (c: Copy551): JsonValue[] => arr(c.record!.raw['track'], `copy ${c.player}'s record.track`);
    const replays = [a, b].map((c) => s.add(replayCall(DOC.paddle, trackOf(c), STEPS, HASH_EVERY), 0.5));
    const opened = s.sockets();
    // Export frames 0 … count − 1 (a range ends before its second time), the last at a step both copies confirmed; the
    // range's end is in the document's frames, 6 to an export frame.
    const count = Math.floor((before - 1) / STEPS_PER_FRAME) + 1;
    const out = [join(temp(), 'match'), join(temp(), 'second')];
    const exports = [a, b].map((c, i) => s.add({
      call: 'export', doc: DOC.paddle, out: out[i]!, video: { codec: 'png_seq' }, size: [160, 90], frame_rate: FRAME_RATE, track: trackOf(c), range: ['0f', `${count * DOC_FRAMES_PER_FRAME}f`],
    }, 0.5));
    const r = await runShow(builds.show(), world(evidence, [DOC.paddle], s.calls), 'AC2 the replays and exports');
    const g: string[] = [];
    const intervals = Math.floor(before / HASH_EVERY) - 1;
    for (const [i, c] of [a, b].entries()) {
      const replayed = hashesOf(r[replays[i]!], `AC2 the replay of copy ${c.player}'s record`);
      g.push(...sameHashes(c, replayed, `copy ${c.player}'s match and the replay of its record`, intervals));
      for (const step of replayed.keys()) if (step % HASH_EVERY !== 0) { g.push(`the replay of copy ${c.player}'s record gives a hash at step ${step}, not on a hash interval of ${HASH_EVERY}`); break; }
    }
    const [r1, r2] = [hashesOf(r[replays[0]!], 'AC2 replay 1'), hashesOf(r[replays[1]!], 'AC2 replay 2')];
    for (const [step, h] of r1) if (step < before && r2.has(step) && r2.get(step) !== h) { g.push(`the two records' replays differ at step ${step}: ${h} and ${r2.get(step)}`); break; }
    const log = socketsOf(r[opened], 'AC2 sockets after the replays');
    if (log.length) g.push(`the replays opened ${log.length} connections: ${show(log.map((x) => x.raw), 600)}`);
    const frames = exports.map((k, i) => {
      const e = obj(r[k], `AC2 export ${i + 1}`);
      expect(e['outcome'], `AC2 export ${i + 1} of the match is exported: ${show(e, 1500)}`).toBe('exported');
      return arr(obj(e['receipt'], `AC2 export ${i + 1}: receipt`)['frame_hashes'], `AC2 export ${i + 1}: receipt.frame_hashes`).map(String);
    });
    if (frames[0]!.length !== count) g.push(`the match's export holds ${frames[0]!.length} raw frames, not the ${count} up to step ${before - 1}`);
    const k = frames[0]!.findIndex((h, i) => h !== frames[1]![i]);
    if (k >= 0 || frames[0]!.length !== frames[1]!.length) g.push(`the match's export and the second replay's part at frame ${k} (${k / FRAME_RATE[0]} s)`);
    if (new Set(frames[0]).size < 10) g.push(`the export's ${frames[0]!.length} frames hold only ${new Set(frames[0]).size} distinct pictures, so they don't show the match`);
    none(g, 'the replays and the exports of the recorded match');
  }, TIMEOUT);

  it(`${AC[2]} a planted copy that records a predicted entry fails, naming the step`, async () => {
    const steps = 1200;
    const plays = rally(2, steps);
    const twin = await play(builds.show(), temp(), 'AC2 planted', { document: paddleDoc(), steps, plays, relay: held, planted: 'net_records_predicted' });
    const [a, b] = twin.copies as [Copy551, Copy551];
    const f = trackRule(a, b, plays, 'AC2 planted');
    const made = new Set(scriptLines(plays, steps + DELAY, DELAY));
    const kept = [a, b].flatMap((c) => trackLines(c.record?.track ?? [], steps + DELAY).filter((l) => !made.has(l)).map((l) => Number(l.split(' ')[0])));
    expect(kept.length, 'a planted copy\'s record holds an entry no player made, at a step it predicted').toBeGreaterThan(0);
    failsNaming(f, [new RegExp(`match step (${kept.join('|')})\\b`)], 'the copy that records a predicted entry');
  }, TIMEOUT);
});


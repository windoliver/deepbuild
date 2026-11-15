// AC6 #204.9d525978, Oracle lane: "A Spawn whose template plays a pluck preset … gives, for 50 recorded hits, onsets
// within one sample of their occurrences …; and a planted Spawn that starts each voice at the first block after its
// occurrence lands up to a block late and fails, naming the first hit"
//
// Ported from the upstream test the Oracle page pins for criterion 6,
// `the-audiobuffersourcenode-interface/sample-accurate-scheduling.html` at commit
// 2f57f45d21482f94b36123dfcec77ae7ab859bc1 (vendored under doneright/oracles/vendor/ on branch `doneright`). License
// of the upstream test: the 3-Clause BSD License, copyright its project's contributors; redistribution and use in
// source and binary forms, with or without modification, are permitted under that license's three conditions. No
// upstream code is copied: its setup and assertions are re-expressed against our output, keeping upstream's numbers.
//
// Upstream renders 4 s at 44.1 kHz and schedules a 512-sample impulse (1 at its first sample, 0 after) on both
// channels at each of the sample offsets 0, 3, 512, 517, 1000, 1005, 20000, 21234 and 37590, inside and across its
// 128-sample render quanta, then checks that left and right match, that every non-zero sample sits at one of those
// offsets, that it finds nine, and that none is misplaced. Ours: a Spawn on a baked list of nine hits, its template
// playing `clicks.click@1` (a 1 kHz square from phase 0, so its first sample is its full level, times 0.25) for 50 ms;
// the nine would overlap at upstream's offsets, so hit k sits at k × 49,152 + offset k, in a window of its own (49,152
// is 3 × 2^14, so each hit keeps upstream's place inside any block of up to 16,384 samples), written as flicks (sample
// × 16,000 at 44.1 kHz). Upstream's impulse becomes a voice's first sample: in each window, everything before the hit
// is silence and the hit's own sample isn't. The main suite's planted `spawn_synth_starts_next_block` must fail this
// port, naming the first misplaced hit, hit 1 at offset 3 (hit 0, at offset 0, is on a block's first sample).
import { describe, expect, it } from 'vitest';
import {
  AC, FLICKS, TIMEOUT, UPSTREAM, UPSTREAM_RATE, gain, mediaDoc, mixes, osc, pcmOf, presetOf, secs, synthSrc, useShow, useTemp, writePack, type Planted,
  type Preset,
} from './helpers.ts';

const bin = useShow();
const temp = useTemp();

/** Upstream's `sampleOffsets`. */
const OFFSETS = [0, 3, 512, 517, 1000, 1005, 20000, 21234, 37590] as const;
const SPACING = 49_152;
const hitAt = (k: number): number => k * SPACING + OFFSETS[k]!;
/** A 1 kHz square times 0.25; cost: osc 4 + gain 1. */
const CLICK: Preset = { nodes: { tone: osc('square', 1000), level: gain(0.25) }, edges: [['tone', 'level', 'in']], out: 'level', params: {}, cost: 5 };

function check(planted?: Planted): string[] {
  const root = temp();
  const evidence = temp();
  const pack = writePack(root, 'clicks', { click: CLICK });
  const total = OFFSETS.length * SPACING;
  const end = (total * FLICKS) / UPSTREAM_RATE;
  const rows = OFFSETS.map((_, k) => ({ t: (hitAt(k) * FLICKS) / UPSTREAM_RATE, kind: 'hit', a: k + 1, b: 0 }));
  const doc = mediaDoc({
    rate: UPSTREAM_RATE, span: end, packs: [pack],
    extra: {
      occurrences: { 'lab.occurrences': rows },
      spawns: { clicks: { on: { list: 'lab.occurrences', kinds: ['hit'] }, play: { src: synthSrc({ preset: presetOf(pack, 'click') }), span: secs(0.05) }, seed: 204 } },
    },
  });
  const [m] = mixes(bin(), evidence, [pack], [{ rate: UPSTREAM_RATE, doc, segments: [{ from: 0, to: end, write: true }] }], 'nine hits at upstream\'s offsets, 44.1 kHz', planted);
  const p = pcmOf(evidence, m!.segments[0]!, UPSTREAM_RATE, 'the master');
  const f: string[] = [];
  const [left, right] = p.channels;
  if (!right) return ['the master has one channel, so left and right can\'t be compared'];
  for (let n = 0; n < total; n++) if (!Object.is(left![n], right[n])) { f.push(`left and right differ at sample ${n}`); break; }
  let found = 0;
  for (let k = 0; k < OFFSETS.length; k++) {
    const from = k * SPACING;
    let first: number | null = null;
    for (let n = from; n < from + SPACING && first === null; n++) if (left![n] !== 0 || right[n] !== 0) first = n;
    if (first === null) { f.push(`hit ${k} (offset ${OFFSETS[k]}): no sound in its window`); continue; }
    found++;
    if (first !== hitAt(k)) f.push(`hit ${k} (offset ${OFFSETS[k]}): its first non-zero sample is ${first} (offset ${first - from}), not ${hitAt(k)}: misplaced`);
  }
  if (found !== OFFSETS.length) f.push(`${found} onsets found, not ${OFFSETS.length}`);
  return f;
}

describe(`${AC[6]} (Oracle: ${UPSTREAM.commit.slice(0, 10)} ${UPSTREAM.scheduling}) each spawned voice starts on exactly its sample`, () => {
  it(`${AC[6]} sample-accurate scheduling, ported: nine spawned synth voices at upstream's offsets each start on exactly their sample and nowhere earlier, left and right match, nine found and none misplaced`, () => {
    expect(check(), 'each voice starts on exactly its sample').toEqual([]);
  }, TIMEOUT);

  it(`${AC[6]} the planted Spawn that starts each voice at the first block after its occurrence fails the port, naming the first misplaced hit, hit 1 at offset 3`, () => {
    const f = check('spawn_synth_starts_next_block');
    expect(f[0] ?? '', `planted spawn_synth_starts_next_block: the first failure names hit 1, misplaced; got ${JSON.stringify(f.slice(0, 4))}`).toMatch(/^hit 1 \(offset 3\): .* misplaced$/);
  }, TIMEOUT);
});

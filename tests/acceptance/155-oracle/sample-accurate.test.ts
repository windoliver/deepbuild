// Oracle lane for #155 criterion 8 (AC8 #155.ec088f1d: "… plays a scrape for each stroke from its collection's
// material, each starting on its stroke occurrence's sample, …"), ported from the upstream test suite's file
// webaudio/the-audio-api/the-audiobuffersourcenode-interface/sample-accurate-scheduling.html at commit
// 2f57f45d21482f94b36123dfcec77ae7ab859bc1 (README). Upstream schedules a 512-sample impulse (1 at its first sample) at
// nine sample offsets, inside and across 128-sample render quanta, renders, and checks that the left and right
// channels match, that every non-zero sample sits at one of the offsets, and that exactly nine are non-zero. Here each
// offset is a stroke: a path whose build, held in steps, starts stroke k on the flick of sample 48,000 + offset k, so
// its `<item>.build` list holds nine stroke occurrences; a spawn on that list plays a generator source (Strip and track:
// generator sources), and the impulse is that source: the one stem of a score whose one note is the click library's
// impulse, rendered by score.render@1 through deep_job. The mix of the film is upstream's rendered buffer. The planted
// fault, built here from our own mix, moves each impulse to the start of its 128-sample quantum, as a mixer that starts
// voices per block would, and the ported check must reject it.
//
// Ported from web-platform-tests, under its license:
//
// The 3-Clause BSD License
//
// Copyright © web-platform-tests contributors
//
// Redistribution and use in source and binary forms, with or without modification, are permitted provided that the
// following conditions are met:
//
// 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following
//    disclaimer.
// 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the
//    following disclaimer in the documentation and/or other materials provided with the distribution.
// 3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote
//    products derived from this software without specific prior written permission.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES,
// INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
// DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
// SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
// SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
// WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
// OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CC0, film, impulseTake, planOf, planReply, ref, sampled, scoreItem, tempo, takesOf, wav16, writeLibrary, type JsonObject as Doc, type Library,
} from '../154/helpers.ts';
import {
  AC, REPO, SAMPLE, TIMEOUT, deepJob, deepKinds, done, generator, install, jobArgs, mixCall, mixOf, must, openWorld, pcmOf, proof, runShow, secs, shown, sleep,
  useShow, type JsonObject, type Line, type SegmentAsk, type World,
} from '../155/helpers.ts';

const showBin = useShow();
/** Upstream's offsets, as samples: `sampleOffsets` in sample-accurate-scheduling.html. */
const OFFSETS = [0, 3, 512, 517, 1000, 1005, 20000, 21234, 37590];
/** Upstream's render quantum. */
const QUANTUM = 128;
/** Where the offsets start in the film: sample 48,000, a multiple of the quantum, so each offset keeps its place in it. */
const S0 = 48_000;
const SPAN = secs(2);

/** test/clicks: one preset, `click`, whose one take is upstream's impulse, rooted at MIDI 60. CC0. */
const CLICKS: Library = { id: 'test/clicks', version: '1.0.0', license: CC0, presets: { click: { zones: [{ lo: 0, hi: 127, root: 60, takes: [{ path: 'click.wav', bytes: wav16(impulseTake()) }] }] } } };

/** The score: one note at 1:1 on the click, at its root, quiet, with no attack or release, and a bend from 30 ms (past
 * the 512-sample take) so score.pitch lists it as unmeasured, as #154's Oracle lane writes its clicks. Its stem `click`
 * is the impulse alone. */
const scoreOf = (): Doc => scoreItem('clicks', { click: sampled(ref(CLICKS), 'click', 'click') }, {
  c0: { at: '1:1', inst: 'click', pitch: 60, dur: '0.1s', vel: 0.25, gain: 0, pan: 0, attack: '0s', release: '0s', bend: [[0.03, 0], [0.06, 1]] },
});
const scoreFilm = (): Doc => film([scoreOf()], { tempo: tempo(90), packs: [ref(CLICKS)], span: '2s' });

/** The film: the score, and a path `pen` of nine strokes whose build steps to (k + ½) ÷ 9 on the flick of sample S0 +
 * offset k, so stroke k's occurrence is that flick; a spawn `ticks` on `pen.build` plays the score's stem. */
function strokesFilm(): JsonObject {
  const f = scoreFilm() as unknown as JsonObject;
  const d = OFFSETS.map((_, k) => `M 2 ${2 + 6 * k} L 60 ${2 + 6 * k}`).join(' ');
  const keys: JsonObject = { k0: { t: 0, value: 0, interp: 'hold' } };
  OFFSETS.forEach((off, k) => { keys[`k${k + 1}`] = { t: (S0 + off) * SAMPLE, value: (k + 0.5) / OFFSETS.length, interp: 'hold' }; });
  keys['end'] = { t: (S0 + OFFSETS[OFFSETS.length - 1]!) * SAMPLE + secs(0.1), value: 1, interp: 'hold' };
  return {
    ...f,
    transport: { ...(f['transport'] as JsonObject), span: SPAN },
    items: { ...(f['items'] as JsonObject), pen: { id: 'pen', kind: 'path@1', name: 'Pen', order: 'a6', params: { d, build: { progress: 0, emits: true } } } },
    channels: { pen_build: { target: 'items/pen/params/build/progress', type: 'f32', keys } },
    strips: {},
    spawns: { ticks: { on: { list: 'pen.build' }, play: { src: generator('clicks', 'click') }, cooldown: 0 } },
  };
}

/** Upstream's checkSampleAccuracy, ported: left and right match, every non-zero sample at an offset, exactly as many as
 * the offsets. Returns its failures, each in upstream's words. */
function checkSampleAccuracy(left: ArrayLike<number>, right: ArrayLike<number>, offsets: number[]): string[] {
  const failures: string[] = [];
  let mismatch = -1;
  for (let i = 0; i < Math.max(left.length, right.length) && mismatch < 0; i++) if ((left[i] ?? 0) !== (right[i] ?? 0)) mismatch = i;
  if (mismatch >= 0) failures.push(`Content of left and right channels match: they differ at sample ${mismatch}`);
  let impulses = 0;
  let bad = 0;
  for (let i = 0; i < left.length; i++) {
    if (left[i] === 0) continue;
    impulses++;
    if (!offsets.includes(i)) { bad++; failures.push(`Non-zero sample found at sample offset ${i}`); }
  }
  if (impulses !== offsets.length) failures.push(`Number of impulses found: ${impulses}, expected ${offsets.length}`);
  else if (bad !== 0) failures.push(`bad offset: ${bad}`);
  return failures;
}

/** A world with deepbuild/score installed and test/clicks installed and fetched under your standing rule. */
async function clicksWorld(): Promise<{ w: World; dir: string }> {
  const w = await openWorld({ shelf: true });
  const score = await install(w, join(REPO, 'packages', 'jobs', 'score'));
  expect(score.code, `deep install packages/jobs/score installs deepbuild/score: ${shown(score)}`).toBe(0);
  const dir = writeLibrary(join(w.tmp, 'clicks'), w.shelf!, CLICKS);
  const lib = await install(w, dir);
  expect(lib.code, `deep install of the library test/clicks installs it: ${shown(lib)}`).toBe(0);
  await must(w, 'pack.rule', { pack: CLICKS.id, licenses: [CC0.id] });
  for (const t of takesOf(CLICKS)) {
    let o: Awaited<ReturnType<typeof deepKinds>>;
    const deadline = Date.now() + 120_000;
    for (;;) {
      o = await deepKinds(w, { op: 'fetch', pack: ref(CLICKS), asset: t.path });
      if (o.value.status !== 'held' || Date.now() > deadline) break;
      await sleep(500);
    }
    expect(o.value.status, `test/clicks's take ${t.path} is fetched under your standing rule: ${o.text.slice(0, 800)}`).toBe('fetched');
  }
  return { w, dir };
}

describe(`${AC[8]} oracle: upstream's sample-accurate scheduling, run on spawned voices on stroke occurrences`, () => {
  it(`${AC[8]} impulses started by nine stroke occurrences inside and across 128-sample quanta land on exactly their sample and nowhere else; a mixer that starts voices per quantum is rejected`, async () => {
    const { w, dir } = await clicksWorld();
    const packs = [{ id: CLICKS.id, dir }];
    const plan = planOf(planReply(showBin(), w.evidence, scoreFilm(), 'clicks', packs, 'the clicks score'), 'the clicks score');
    const stem = plan.stems['click'];
    expect(stem, 'the score plans its stem click').toBeDefined();
    const run = await deepJob(w, jobArgs({ kind: stem!.kind, tool: stem!.tool, params: stem!.params as unknown as JsonObject, inputs: stem!.inputs as unknown as JsonObject[] }));
    expect(done(run), `score.render renders the click's stem: ${run.text.slice(0, 1200)}`).toBe(true);
    const asks: SegmentAsk[] = [{ from: 0, to: SPAN, write: true }];
    const [reply] = runShow(showBin(), { evidence: w.evidence, packs: packs as unknown as JsonObject[], jobs: [run.value as Line] as JsonObject[], calls: [mixCall(strokesFilm(), asks)] }, 'the strokes film with the click stem');
    const m = mixOf(reply, asks, 'the strokes film');
    const pcm = pcmOf(w.evidence, m.segments[0]!, 'the strokes film');
    const [left, right] = [pcm.channels[0]!, pcm.channels[1]!];
    const offsets = OFFSETS.map((o) => S0 + o);
    const ours = checkSampleAccuracy(left, right, offsets);
    // The planted fault: each impulse moved to the start of its quantum.
    const moved = new Float32Array(left.length);
    offsets.forEach((s) => { const q = Math.floor(s / QUANTUM) * QUANTUM; moved[q] = moved[q]! + left[s]!; });
    const planted = checkSampleAccuracy(moved, moved, offsets);
    proof('oracle-sample-accurate.json', { voices: m.voices.map((v) => v.raw), nonzero: Array.from(left.keys()).filter((i) => left[i] !== 0), ours, planted });
    expect(m.voices.map((v) => v.start), 'one voice per stroke, each at its stroke occurrence\'s flick').toEqual(offsets.map((s) => s * SAMPLE));
    expect(ours, `upstream's check on our mix: ${ours.join(' | ')}`).toEqual([]);
    expect(planted.length, `upstream's check rejects impulses moved to their quantum's start: ${planted.join(' | ')}`).toBeGreaterThan(0);
    expect(planted.some((f) => new RegExp(`Non-zero sample found at sample offset ${S0 + 896}\\b`).test(f)), `it names sample ${S0 + 896}, where the impulses at ${S0 + 1000} and ${S0 + 1005} land once quantized`).toBe(true);
  }, 2 * TIMEOUT);
});

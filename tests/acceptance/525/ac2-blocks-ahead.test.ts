// #525.bc91e6a4: "In a live lab with sound playing, the world has stepped at least one audio block past the first sample
// not yet written each time a block renders, over 10 minutes; a step delayed 20 ms on purpose counts one underrun in the
// device gate's stats, and the document's PCM still equals a replay's"
//
// The lab of criterion 1 (README: The lab), played live through #499's test audio backend on the virtual clock, so the
// ten minutes run faster than real time and no reading depends on load.
//
// 1. Ten minutes: the document's transport runs 601 s and its world `lab` 600 s (the world's longest span). The
//    transport's block log must hold every block whose samples lie in the document's first 600 s, in order, and before
//    each rendered the world had stepped to at least (first + 128) × 14,700 flicks, where `first` is the block's first
//    sample, the first not yet written (Phase: "runs until its time is at least one audio block past the timeline
//    position of the first sample not yet written, before that block renders"). No step is late, so the gate's stats
//    count no underrun. Wrong program (the criterion names none): `world_steps_on_frames`, the world stepped at each
//    display frame up to that frame's t, as the base steps a logic item, fails within the first second, naming a block.
// 2. The delayed step: the same lab over 12 s, its first hit's step k read from a clean play's list, then played again
//    with step k taking 20 ms of host time (the scenario's `delays`, a deliberate condition and not a wrong program).
//    The gate's stats count exactly one underrun, and the PCM handed to the gate over the document's [0.25 s, 10.25 s)
//    hashes as the replay's: `media_mix` of the same document, rendered offline as the export renders it. The replay's
//    right channel starts at the hit's own sample there, so the comparison covers the delayed step's voice. Wrong
//    program: `late_step_moves_voice`, a block whose step isn't ready rendering anyway without it, its voice moved to the
//    first block after the step is ready, which counts no underrun and differs from the replay.
import { describe, it } from 'vitest';
import {
  CRITERIA, Driver, MS, PLAY_AT, RATE, STEP, TIMEOUT, blockFailures, blocksOf, dropLab, failsNaming, firstDiff, gate,
  handed, handedOf, none, occurrences, onset, pcmOf, play, playing, replay, rowsOf, sOf, sampleOf, secs, sounds, startLab,
  statsOf, transport, useBuilds, useTemp, type Delay, type LivePlanted,
} from './helpers.ts';

const ID = CRITERIA[2];
const bin = useBuilds(['full']);
const temp = useTemp();

const TEN_MINUTES = secs(600);
const SHORT = secs(12);
const WINDOW: [number, number] = [secs(0.25), secs(10.25)];
/** The deliberate delay: 20 ms of host time. */
const LATE = 20 * MS;

describe(`${ID} a live world steps ahead of every audio block, and a late step is an underrun that moves no voice`, () => {
  it(`${ID} over 10 minutes of the lab with sound playing, before each block renders the world has stepped to at least one block (128 samples) past the block's first sample, the first not yet written, and the gate counts no underrun; a planted world that steps on the display's frames fails, naming the block`, () => {
    const what = 'the lab played live for 10 minutes';
    const evidence = temp('ev');
    const d = new Driver(bin('full'), { evidence });
    const serial = startLab(d, dropLab(sounds(evidence), TEN_MINUTES + secs(1), TEN_MINUTES), what);
    const end = PLAY_AT + TEN_MINUTES + secs(1);
    const [p, tr, g] = d.step([play(serial), transport(end), gate(end)], what);
    playing(p, what);
    const f = blockFailures(blocksOf(tr, what), 'lab', 600 * RATE, what);
    const stats = statsOf(g, what);
    if (stats.underruns !== 0) f.push(`${what}: the gate's stats count ${stats.underruns} underruns, though no step was late`);
    none(f, 'the world steps at least one audio block ahead of every block over 10 minutes');

    const planted = 'the lab played live for 2 s (planted world_steps_on_frames)';
    const ev2 = temp('ev');
    const d2 = new Driver(bin('full'), { evidence: ev2, planted: 'world_steps_on_frames' });
    const serial2 = startLab(d2, dropLab(sounds(ev2), SHORT), planted);
    const [p2, tr2] = d2.step([play(serial2), transport(PLAY_AT + secs(2))], planted);
    playing(p2, planted);
    failsNaming(blockFailures(blocksOf(tr2, planted), 'lab', RATE, planted), /block \d+ began at .* had stepped only to/, 'world_steps_on_frames');
  }, TIMEOUT);

  it(`${ID} with the step of the lab's first hit taking 20 ms on purpose, the gate's stats count one underrun and the PCM handed to the gate over [0.25 s, 10.25 s) equals the replay's by hash; a planted transport that renders past a late step and moves its voice fails, naming the underruns and the PCM`, () => {
    const evidence = temp('ev');
    const s = sounds(evidence);
    const doc = dropLab(s, SHORT);
    const end = PLAY_AT + secs(11);

    // The step of the first hit, from a clean play's own list: the step that is delayed.
    const clean = 'the lab played live (no delay), for its first hit\'s step';
    const d0 = new Driver(bin('full'), { evidence });
    const s0 = startLab(d0, doc, clean);
    const [p0, o0] = d0.step([play(s0), occurrences(PLAY_AT + secs(2))], clean);
    playing(p0, clean);
    const hit = rowsOf(o0, 'lab.occurrences', clean).find((r) => r.kind === 'hit');
    if (!hit) throw Error(`${clean}: the world lab's list holds no hit, so there is no step to delay`);
    const delays: Delay[] = [{ world: 'lab', step: hit.step, by: LATE }];

    const re = replay(bin('full'), evidence, doc, WINDOW, 'the replay (media_mix of the same document)');
    const rePcm = pcmOf(evidence, re, 'the replay\'s PCM');
    const own = sampleOf(hit.step * STEP);
    const guard = onset(rePcm, 1) === own ? [] : [`the replay's right channel doesn't start on the delayed step's hit (${sOf(own)}): the window would not cover its voice`];

    const delayed = (planted?: LivePlanted): string[] => {
      const what = `the lab played live with step ${hit.step} taking 20 ms${planted ? ` (planted ${planted})` : ''}`;
      const ev = temp('ev');
      const d = new Driver(bin('full'), { evidence: ev, delays, ...(planted ? { planted } : {}) });
      const serial = startLab(d, dropLab(sounds(ev), SHORT), what);
      const [p, g, h] = d.step([play(serial), gate(end), handed(end, ...WINDOW)], what);
      playing(p, what);
      const f: string[] = [];
      const stats = statsOf(g, what);
      if (stats.underruns !== 1) f.push(`${what}: the gate's stats count ${stats.underruns} underruns, not the one the late step makes`);
      if (!(stats.underrun_time > 0)) f.push(`${what}: the gate's underrun_time is ${stats.underrun_time}, though an underrun played silence`);
      const live = handedOf(h, ...WINDOW, what);
      if (live.sha256 !== re.sha256) {
        const at = firstDiff(pcmOf(ev, live, `${what}: the PCM handed to the gate`), rePcm);
        f.push(`${what}: the PCM handed to the gate (${live.sha256}) isn't the replay's (${re.sha256}); they first differ at ${at === null ? 'no sample' : sOf(at)}`);
      }
      return f;
    };
    none([...guard, ...delayed()], 'a late step counts one underrun and moves no voice');
    failsNaming(delayed('late_step_moves_voice'), /underruns|isn't the replay's/, 'late_step_moves_voice');
  }, TIMEOUT);
});

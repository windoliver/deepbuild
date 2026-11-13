// #525's live lab on this Mac's own sound output: a gap the blind suite (../525) leaves, since it plays every live lab
// through #499's test audio backend on a virtual clock. Written by the implementer after that suite passed, from the
// same criteria and the same lab (../525/helpers.ts: The lab), so each test here must fail on a wrong program: the base
// (whose `soak` refuses a document whose spawns read a world's list, `unbaked_list`) and the planted transport
// `late_step_moves_voice`.
//
// `deep-show run`'s `soak` (#501) plays a media document on the default output for real seconds. With a live world it
// steps the world past each block the mixer renders before rendering it, writes at most 512 frames ahead of a 256-frame
// device buffer, and answers the gate's `stats` (an underrun one stretch of short device callbacks), `blocks:
// {rendered, behind}` (blocks rendered while a world whose span goes on hadn't stepped one block past the block's first
// sample) and `handed: {frames, sha256}` (every sample rendered, from the document's 0, interleaved f32le). The replay is
// `media_mix` of the same document over the same samples.
//
// Real time counts only on a reference Mac in a fit state (../501/helpers.ts `referenceMacProblem`): anywhere else each
// test is INCONCLUSIVE. With no output device it is BLOCKED. The sound plays out loud.
import { describe, expect, it } from 'vitest';
import { blocked, inconclusive, referenceMacProblem } from '../501/helpers.ts';
import {
  CRITERIA, LANDING_STEPS, MS, RATE, SAMPLE, STEP, TIMEOUT, arr, dropLab, fOf, failsNaming, firstDiff, hex64, int, none, obj, onset,
  pcmOf, pressLab, replay, runShow, sOf, secs, show, sounds, useBuilds, useTemp, writePack, type Delay, type JsonObject,
  type LivePlanted,
} from '../525/helpers.ts';

const bin = useBuilds(['full']);
const temp = useTemp();

const TEN_MINUTES = 600;
const SHORT = secs(12);

interface Played { underruns: number; underrunTime: number; rendered: number; behind: number; frames: number; sha256: string }

/** The lab played on this Mac's default output for `seconds`, with the scenario's `delays` and `planted`. */
function soak(evidence: string, media: JsonObject, seconds: number, what: string, delays?: Delay[], planted?: LivePlanted): Played {
  const [r] = runShow(bin('full'), { evidence, ...(delays ? { delays: delays.map((d) => ({ world: d.world, step: d.step, by: d.by })) } : {}), ...(planted ? { planted } : {}), calls: [{ call: 'soak', media, seconds }] }, what);
  if (r!['outcome'] === 'refused' && r!['code'] === 'no_output') blocked(`this Mac has no sound output to play the lab on: ${show(r)}`);
  expect(r!['outcome'], `${what}: the lab played on the default output: ${show(r)}`).toBe('played');
  const stats = obj(r!['stats'], `${what}: stats`);
  const blocks = obj(r!['blocks'], `${what}: blocks`);
  const handed = obj(r!['handed'], `${what}: handed`);
  return {
    underruns: int(stats['underruns'], `${what}: stats.underruns`), underrunTime: Number(stats['underrun_time']),
    rendered: int(blocks['rendered'], `${what}: blocks.rendered`), behind: int(blocks['behind'], `${what}: blocks.behind`),
    frames: int(handed['frames'], `${what}: handed.frames`), sha256: hex64(handed['sha256'], `${what}: handed.sha256`),
  };
}

/** The replay's hash of the document's first `frames` samples, with the input track `track`. */
function replayed(evidence: string, media: JsonObject, frames: number, what: string, track?: JsonObject[], packs?: JsonObject[]): string {
  const call: JsonObject = { call: 'media_mix', doc: media, segments: [{ from: 0, to: frames * SAMPLE }], ...(track ? { track } : {}) };
  const [r] = runShow(bin('full'), { evidence, ...(packs ? { packs } : {}), calls: [call] }, what);
  const seg = obj(arr(obj(obj(r, what)['mix'], `${what}: mix`)['segments'], `${what}: segments`)[0], `${what}: segment`);
  expect(int(seg['frames'], `${what}: frames`), `${what}: the replay covers the samples played`).toBe(frames);
  return hex64(seg['sha256'], `${what}: sha256`);
}

/** The first hit's step k, read from the replay's right channel, which only the clack sounds on, at sample 400 k. */
function firstHit(evidence: string): number {
  const re = replay(bin('full'), evidence, dropLab(sounds(evidence), SHORT), [secs(0.25), secs(0.75)], 'the replay of the dropped ball');
  const at = onset(pcmOf(evidence, re, 'the replay\'s PCM'), 1);
  expect(at, 'the replay\'s first clack sounds in [0.25 s, 0.75 s)').not.toBeNull();
  const k = at! / (STEP / SAMPLE);
  expect(Number.isInteger(k) && Math.abs(k - LANDING_STEPS) <= 3, `the first clack starts on a step's own sample near the landing, not at ${sOf(at!)}`).toBe(true);
  return k;
}

describe(`${CRITERIA[2]}, ${CRITERIA[1]} and ${CRITERIA[4]} on this Mac's own output`, () => {
  it(`${CRITERIA[2]} the lab plays 10 minutes on the default output with no underrun, every block rendered after its world stepped a block past it, and the PCM equal to the replay's, so each hit sounds on its step's own sample there too`, async () => {
    const problem = await referenceMacProblem(true);
    if (problem) inconclusive(`real time counts only on a reference Mac in a fit state: ${problem}`);
    const evidence = temp('ev');
    const media = dropLab(sounds(evidence), secs(TEN_MINUTES + 1), secs(TEN_MINUTES));
    firstHit(evidence);
    const what = 'the lab played 10 minutes on the default output';
    const p = soak(evidence, media, TEN_MINUTES + 1, what);
    const f: string[] = [];
    if (p.underruns !== 0) f.push(`${what}: ${p.underruns} underruns (${p.underrunTime} s of silence), though no step was late`);
    if (p.behind !== 0) f.push(`${what}: ${p.behind} of ${p.rendered} blocks rendered before the world stepped one block past their first sample`);
    if (p.frames < TEN_MINUTES * 48_000) f.push(`${what}: only ${p.frames} samples rendered, short of 10 minutes`);
    const re = replayed(evidence, media, p.frames, 'the replay of the 10-minute lab');
    if (p.sha256 !== re) f.push(`${what}: the PCM rendered for the device (${p.sha256}) isn't the replay's (${re})`);
    console.log(`${CRITERIA[2]} device: ${p.underruns} underruns, ${p.behind}/${p.rendered} blocks behind, ${p.frames} samples, PCM ${p.sha256 === re ? 'equal to' : 'unlike'} the replay's`);
    none(f, 'the live lab on the device');
  }, TIMEOUT);

  it(`${CRITERIA[2]} with the first hit's step 20 ms late on the default output, the gate counts one underrun and the PCM still equals the replay's; a planted transport that renders past the late step counts none or moves the voice, and fails`, async () => {
    const problem = await referenceMacProblem(true);
    if (problem) inconclusive(`real time counts only on a reference Mac in a fit state: ${problem}`);
    const evidence = temp('ev');
    const media = dropLab(sounds(evidence), SHORT);
    const delays: Delay[] = [{ world: 'lab', step: firstHit(evidence), by: 20 * MS }];
    const failures = (planted?: LivePlanted): string[] => {
      const what = `the lab on the default output with its first hit's step 20 ms late${planted ? ` (planted ${planted})` : ''}`;
      const p = soak(evidence, media, 10, what, delays, planted);
      const f: string[] = [];
      if (p.underruns !== 1) f.push(`${what}: the gate counts ${p.underruns} underruns, not the one the late step makes`);
      if (!(p.underrunTime > 0)) f.push(`${what}: underrun_time is ${p.underrunTime}`);
      const re = replayed(evidence, media, p.frames, `${what}: its replay`);
      if (p.sha256 !== re) f.push(`${what}: the PCM rendered for the device isn't the replay's`);
      console.log(`${CRITERIA[2]} device delay${planted ? ` (${planted})` : ''}: ${p.underruns} underruns, ${p.underrunTime} s, PCM ${p.sha256 === re ? 'equal to' : 'unlike'} the replay's`);
      return f;
    };
    none(failures(), 'a late step on the device');
    failsNaming(failures('late_step_moves_voice'), /underruns|isn't the replay's/, 'late_step_moves_voice on the device');
  }, TIMEOUT);

  it(`${CRITERIA[4]} with the bed playing on the default output, a scripted press of go starts the recipe's ping and the ball's hit at the same samples as the replay of the recorded track, and its entry takes a flick no earlier than the first sample not yet written when it arrived; a planted entry that takes the sample the device plays fails, naming the entry`, async () => {
    const problem = await referenceMacProblem(true);
    if (problem) inconclusive(`real time counts only on a reference Mac in a fit state: ${problem}`);
    const window: [number, number] = [secs(0.25), secs(10.25)];
    const failures = (planted?: LivePlanted): string[] => {
      const what = `the press lab on the default output${planted ? ` (planted ${planted})` : ''}`;
      const evidence = temp('ev');
      const packs = [writePack(temp('pack'))];
      const doc = pressLab(sounds(evidence), SHORT);
      const call: JsonObject = { call: 'soak', media: doc, seconds: 11, presses: [{ at: secs(3), control: 'go' }] };
      const [r] = runShow(bin('full'), { evidence, packs, ...(planted ? { planted } : {}), calls: [call] }, what);
      if (r!['outcome'] === 'refused' && r!['code'] === 'no_output') blocked(`this Mac has no sound output: ${show(r)}`);
      expect(r!['outcome'], `${what}: played: ${show(r)}`).toBe('played');
      const track = arr(r!['input_track'], `${what}: input_track`).map((e, i) => obj(e, `${what}: input_track[${i}]`));
      const entries = track.filter((e) => e['control'] === 'go');
      if (entries.length !== 1) return [`${what}: the track holds ${entries.length} entries of go, not the one press`];
      const t = int(entries[0]!['t'], `${what}: the entry's t`);
      const unwritten = int(obj(arr(r!['presses'], `${what}: presses`)[0], `${what}: presses[0]`)['unwritten'], `${what}: unwritten`);
      const f: string[] = [];
      if (t < unwritten * SAMPLE) f.push(`${what}: the press's entry takes ${fOf(t)}, earlier than the first sample not yet written when it arrived, ${sOf(unwritten)}`);
      const handed = obj(r!['handed'], `${what}: handed`);
      const frames = int(handed['frames'], `${what}: handed.frames`);
      if (hex64(handed['sha256'], `${what}: handed.sha256`) !== replayed(evidence, doc, frames, `${what}: its replay`, track, packs)) f.push(`${what}: the PCM rendered for the device isn't the replay of the recorded track's`);
      const withTrack = pcmOf(evidence, replay(bin('full'), evidence, doc, window, `${what}: the replay`, track, packs), `${what}: the replay's PCM`);
      const quiet = pcmOf(evidence, replay(bin('full'), evidence, doc, window, `${what}: no input`, [], packs), `${what}: the quiet replay's PCM`);
      const ping = firstDiff(withTrack, quiet);
      if (t % SAMPLE !== 0 || ping !== t / SAMPLE) f.push(`${what}: the recipe's strip starts at ${ping === null ? 'no sample' : sOf(ping)}, not on its entry's sample (${fOf(t)})`);
      const clack = firstDiff(withTrack, quiet, t / SAMPLE + RATE / 10);
      const launch = Math.ceil(t / STEP);
      if (clack === null || Math.abs(clack / (STEP / SAMPLE) - (launch + 60)) > 5) f.push(`${what}: the hit's clack starts at ${clack === null ? 'no sample' : sOf(clack)}, not within five steps of step ${launch + 60}`);
      console.log(`${CRITERIA[4]} device: entry ${fOf(t)}, first unwritten ${sOf(unwritten)}, ping at ${ping}, clack at ${clack}`);
      return f;
    };
    none(failures(), 'a press on the device');
    failsNaming(failures('entry_stamped_at_frame'), /the press's entry takes .* earlier than the first sample not yet written/, 'entry_stamped_at_frame on the device');
  }, TIMEOUT);
});

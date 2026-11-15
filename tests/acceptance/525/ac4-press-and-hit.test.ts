// #525.316e3bea: "With sound playing, a scripted press that starts a recipe's strip, and the first hit that press causes
// in a live world, start at the same samples live and in a replay of the recorded input track (equal PCM hashes over
// 10 s), and the press's entry takes a flick no earlier than the first sample not yet written when it arrived"
//
// The press lab (README: The lab): the bed looping on the left; the press `go`; the recipe instance `chime` of the test
// pack's `lab.ping@1`, whose strip `ping` (100 ms of 2 kHz) each entry of `go` starts; the world `lab` with no gravity,
// its ball at rest 1 m above the floor, and the input `kick`, which launches it down at 2 m/s on each entry of `go`; and
// the spawn `clack` on its hits. With the bed playing, a scripted press of `go` arrives at host 3.0003 s (between two
// device callbacks), its platform timestamp 1 ms earlier.
//
// - The entry: the recorded input track holds one entry of `go`, at a flick no earlier than the first sample not yet
//   written when the press arrived, read from the transport's block log (the first sample of the first block rendered
//   after the arrival).
// - Live and replay: the PCM handed to the gate over the document's [0.25 s, 10.25 s) hashes as `media_mix` of the same
//   document with the recorded track does (#544's `track`). So equality covers the strip and the hit: the replay with
//   the track first differs from a replay with no track on the entry's own sample (the ping starts there), and, after
//   the ping, again where the hit's clack starts, within five steps of 60 steps past the launch's step (1 m at 2 m/s).
//
// Wrong program (the criterion names none; README: Planted programs): `entry_stamped_at_frame`, the entry stamped with
// the t of the first display frame at or after the press's arrival, the frame that handles it. That t is the position
// the device plays, about the write-ahead (496 samples) behind the first sample not yet written, so the check fails,
// naming the entry.
import { describe, it } from 'vitest';
import {
  CRITERIA, Driver, MS, PLAY_AT, RATE, SAMPLE, STEP, TIMEOUT, blocksOf, failsNaming, fOf, firstDiff, handed, handedOf,
  inputTrack, int, none, pcmOf, play, playing, press, pressLab, replay, sOf, sampleOf, secs, sounds, startLab, trackOf,
  transport, unwrittenAt, useBuilds, useTemp, writePack, type LivePlanted,
} from './helpers.ts';

const ID = CRITERIA[4];
const bin = useBuilds(['full']);
const temp = useTemp();

const SPAN = secs(12);
const WINDOW: [number, number] = [secs(0.25), secs(10.25)];
const END = PLAY_AT + secs(11);
/** The press reaches the app at host 3.0003 s, 144,014.4 samples: never on a device callback, which are whole samples. */
const ARRIVES = secs(3) + 211_680;
/** The platform's timestamp of the press: 1 ms before it reached the app. */
const EVENT_T = ARRIVES - MS;

function failures(planted?: LivePlanted): string[] {
  const what = `the press lab played live${planted ? ` (planted ${planted})` : ''}`;
  const evidence = temp('ev');
  const packs = [writePack(temp('pack'))];
  const doc = pressLab(sounds(evidence), SPAN);
  const d = new Driver(bin('full'), { evidence, packs, ...(planted ? { planted } : {}) });
  const serial = startLab(d, doc, what);
  const [p, , tr, it, h] = d.step([play(serial), press(ARRIVES, EVENT_T, 'go'), transport(END), inputTrack(END), handed(END, ...WINDOW)], what);
  playing(p, what);
  const f: string[] = [];

  const entries = trackOf(it, what).filter((e) => e['control'] === 'go');
  if (entries.length !== 1) return [`${what}: the recorded input track holds ${entries.length} entries of go, not the one press`];
  const t = int(entries[0]!['t'], `${what}: the press's entry's t`);
  const unwritten = unwrittenAt(blocksOf(tr, what), ARRIVES, what);
  if (t < unwritten * SAMPLE) f.push(`${what}: the press's entry takes ${fOf(t)}, earlier than the first sample not yet written when it arrived, ${sOf(unwritten)} (${fOf(unwritten * SAMPLE)})`);

  const track = trackOf(it, what);
  const withTrack = replay(bin('full'), evidence, doc, WINDOW, `${what}: the replay of the recorded track`, track, packs);
  const without = replay(bin('full'), evidence, doc, WINDOW, `${what}: the replay with no input`, [], packs);
  const live = handedOf(h, ...WINDOW, what);
  const replayed = pcmOf(evidence, withTrack, `${what}: the replay's PCM`);
  if (live.sha256 !== withTrack.sha256) {
    const at = firstDiff(pcmOf(evidence, live, `${what}: the PCM handed to the gate`), replayed);
    f.push(`${what}: the PCM handed to the gate over [0.25 s, 10.25 s) (${live.sha256}) isn't the replay's (${withTrack.sha256}); they first differ at ${at === null ? 'no sample' : sOf(at)}`);
  }
  // Equal hashes must cover the press's strip and its hit: both sound in the window, the strip on the entry's sample.
  const quiet = pcmOf(evidence, without, `${what}: the PCM of the replay with no input`);
  const ping = firstDiff(replayed, quiet);
  if (t % SAMPLE !== 0 || ping !== sampleOf(t)) f.push(`${what}: the recipe's strip starts in the replay at ${ping === null ? 'no sample' : sOf(ping)}, not on its entry's sample (${fOf(t)})`);
  const launch = Math.ceil(t / STEP);
  const clack = firstDiff(replayed, quiet, sampleOf(t) + RATE / 10);
  if (clack === null || Math.abs(clack / (STEP / SAMPLE) - (launch + 60)) > 5) f.push(`${what}: the hit's clack starts at ${clack === null ? 'no sample' : sOf(clack)}, not within five steps of step ${launch + 60}, 60 steps after the launch at step ${launch}`);
  return f;
}

describe(`${ID} a press's strip and its hit start at the same samples live and in a replay of the recorded track`, () => {
  it(`${ID} with the bed playing, a scripted press of go starts the recipe's ping and the ball's hit at the same samples live and in the replay of the recorded track (equal PCM hashes over 10 s), and its entry takes a flick no earlier than the first sample not yet written when it arrived; a planted entry stamped at the frame that handles it fails, naming the entry`, () => {
    none(failures(), 'the press and its hit sound alike live and on replay');
    failsNaming(failures('entry_stamped_at_frame'), /the press's entry takes .* earlier than the first sample not yet written/, 'entry_stamped_at_frame');
  }, TIMEOUT);
});

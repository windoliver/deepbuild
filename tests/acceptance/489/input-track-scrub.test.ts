// Criterion 6: "A follow channel on 12 entries a test writer appends to the core's input track, scrubbed back and
// forth across the timeline 50 times, keeps the input track's hash and its cached segments and reads at every time
// what a straight play reads; a planted follow channel that steps from the previous frame's value instead of its
// closed form reads a different value after the first backward scrub and fails, naming the channel"
//
// Through `deep-motion eval`. The document declares a slider control `knob`; the eval line's `input` appends 12
// entries `{t, seq, control: "knob", value, writer: "you"}` to the input track (Input track: entries), and the
// follow channel `dial` follows `controls/knob/value` with a spring. Each frame reports the track as `input: {hash,
// entries}` and the channel's cache as `channels.dial.segments` (segments cached) and `channels.dial.solves` (segment
// solves this session so far) (README: Choices where the issue is open). A scrub is one eval line whose times go
// across the 6 s timeline forward, then back, 50 times; the straight play is one line with the same times sorted.
// No upstream test (oracle page).
import { describe, expect, it } from 'vitest';
import {
  TIMEOUT, chanOr, evalOk, evalPlanted, failsNaming, film, fl, int, none, obj, rect, seeded, str, useMotion,
  type Accepted, type JsonObject,
} from './helpers.ts';

const motion = useMotion();

const DOC: JsonObject = film('knob-follow', [rect('needle', [40, 40])], {
  controls: { knob: { kind: 'slider', class: 'document', label: 'Knob', range: [0, 100], default: 20 } },
  channels: { dial: { target: 'items/needle/at/pos/0', type: 'f32', mode: 'follow', follow: { source: 'controls/knob/value', model: { spring: { freq_hz: 1.5, damping_ratio: 0.4 } } } } },
}, { span: '6s' });
const VALUES = [35, 70, 55, 90, 10, 45, 60, 25, 80, 15, 50, 65];
/** The 12 entries the test writer appends, every 0.45 s from 0.3 s. */
const ENTRIES: JsonObject[] = VALUES.map((value, seq) => ({ t: fl(0.3 + 0.45 * seq), seq, control: 'knob', value, writer: 'you' }));

/** 50 passes across [0, 6 s): forward, back, forward …, 24 jittered times each. */
function scrub(): { times: number[]; passStarts: number[] } {
  const rand = seeded(489_06);
  const times: number[] = []; const passStarts: number[] = [];
  for (let pass = 0; pass < 50; pass++) {
    passStarts.push(times.length);
    const run = Array.from({ length: 24 }, (_, i) => Math.floor(((i + rand()) / 24) * fl(6)));
    times.push(...(pass % 2 === 0 ? run : run.reverse()));
  }
  return { times, passStarts };
}
const SCRUB = scrub();
const STRAIGHT = [...new Set(SCRUB.times)].sort((a, b) => a - b);

interface Cache { hash: string; entries: number; segments: number; solves: number }
function cacheOf(a: Accepted, i: number): Cache {
  const f = a.frames[i]!;
  const input = obj(f.input, `frame ${f.t}: input`);
  const dial = obj(f.channels['dial'], `frame ${f.t}: channels.dial`);
  return { hash: str(input['hash'], `frame ${f.t}: input.hash`), entries: int(input['entries'], `frame ${f.t}: input.entries`), segments: int(dial['segments'], `frame ${f.t}: channels.dial.segments`), solves: int(dial['solves'], `frame ${f.t}: channels.dial.solves`) };
}

/** The check: at every scrubbed time the channel dial reads what the straight play read there, bit for bit; failures name the channel and the flick. */
function scrubFailures(scrubbed: Accepted | null, straight: Accepted | null, what: string): string[] {
  if (!scrubbed || !straight) return [`${what}: no frames for the channel dial`];
  const read = new Map(straight.frames.map((f) => [f.t, chanOr(f, 'dial')]));
  const failures: string[] = [];
  scrubbed.frames.forEach((f, i) => {
    const want = read.get(f.t)!; const got = chanOr(f, 'dial');
    if (!Object.is(got, want)) failures.push(`${what}: channel dial at ${f.t} flicks (pass ${SCRUB.passStarts.filter((s) => s <= i).length}) reads ${got}, the straight play ${want}`);
  });
  return failures;
}

describe('criterion 6: a follow channel on appended input entries, scrubbed 50 times, keeps the track and its segments and reads what a straight play reads', () => {
  it('criterion 6: scrubbed back and forth 50 times, the follow channel reads at every time what a straight play reads, bit for bit', () => {
    const bin = motion.bin();
    const scrubbed = evalOk(bin, { doc: DOC, times: SCRUB.times, input: ENTRIES }, 'the scrub');
    const straight = evalOk(bin, { doc: DOC, times: STRAIGHT, input: ENTRIES }, 'the straight play');
    none(scrubFailures(scrubbed, straight, 'the scrub'), 'the scrub reads what the straight play reads');
    // It follows the entries: by 0.3 s + 0.45 s × 11 + 1 s it has moved toward the last entry's value.
    const late = straight.frames.filter((f) => f.t > fl(6.0) - fl(0.3)).map((f) => chanOr(f, 'dial'));
    for (const v of late) expect(Math.abs(v - 65), `late in the timeline the dial is near the last entry's 65, got ${v}`).toBeLessThan(10);
    const early = straight.frames.filter((f) => f.t < fl(0.3)).map((f) => chanOr(f, 'dial'));
    for (const v of early) expect(v, 'before the first entry the dial rests on the control\'s default 20').toBe(20);
  }, TIMEOUT);

  it('criterion 6: through the 50 scrubs the input track keeps its hash and its 12 entries, and the follow channel keeps its cached segments, solving none twice', () => {
    const bin = motion.bin();
    const scrubbed = evalOk(bin, { doc: DOC, times: SCRUB.times, input: ENTRIES }, 'the scrub');
    const straight = evalOk(bin, { doc: DOC, times: STRAIGHT, input: ENTRIES }, 'the straight play');
    const last = cacheOf(straight, straight.frames.length - 1);
    expect(last.entries, 'the track holds the 12 appended entries').toBe(12);
    expect(last.hash, 'the track has a hash').toMatch(/^[0-9a-f]{16,}$/);
    const failures: string[] = [];
    scrubbed.frames.forEach((f, i) => {
      const c = cacheOf(scrubbed, i);
      if (c.hash !== last.hash) failures.push(`at frame ${i} (${f.t} flicks) the track's hash is ${c.hash}, the straight play's ${last.hash}`);
      if (c.entries !== 12) failures.push(`at frame ${i} the track holds ${c.entries} entries`);
      if (i > 0 && c.segments < cacheOf(scrubbed, i - 1).segments) failures.push(`at frame ${i} the cache dropped segments: ${cacheOf(scrubbed, i - 1).segments} then ${c.segments}`);
      if (c.solves > c.segments) failures.push(`at frame ${i} ${c.solves} segment solves for ${c.segments} cached segments: a scrub re-solved one`);
    });
    const end = cacheOf(scrubbed, scrubbed.frames.length - 1);
    if (end.segments !== last.segments) failures.push(`after the scrubs ${end.segments} segments are cached, the straight play caches ${last.segments}`);
    none(failures, 'the scrubs keep the track and the segments');
    expect(last.segments, 'one segment per source change at least: 12 entries').toBeGreaterThanOrEqual(12);
  }, TIMEOUT);

  it('criterion 6: a planted follow channel that steps from the previous frame\'s value reads a different value after the first backward scrub and fails, naming the channel', () => {
    const bin = motion.bin();
    const scrubbed = evalPlanted(bin, { doc: DOC, times: SCRUB.times, input: ENTRIES, planted: 'follow_steps_from_previous_frame' });
    const straight = evalPlanted(bin, { doc: DOC, times: STRAIGHT, input: ENTRIES, planted: 'follow_steps_from_previous_frame' });
    expect(scrubbed !== null && straight !== null, 'the planted program answers both lines').toBe(true);
    const failures = scrubFailures(scrubbed, straight, 'the planted follow channel');
    failsNaming(failures, ['dial'], 'the scrub check on the planted follow channel');
    // Every frame of the first forward pass came before any backward scrub; the planted program must differ after it.
    const firstBack = SCRUB.passStarts[1]!;
    const read = new Map(straight!.frames.map((f) => [f.t, chanOr(f, 'dial')]));
    const differsAfterBack = scrubbed!.frames.slice(firstBack).some((f) => !Object.is(chanOr(f, 'dial'), read.get(f.t)));
    expect(differsAfterBack, 'from the first backward scrub on, the planted channel reads a value the straight play doesn\'t').toBe(true);
  }, TIMEOUT);
});

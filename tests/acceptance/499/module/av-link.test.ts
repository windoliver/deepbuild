// #499.3a4c1fc9: "A patch that changes the rate of a video's image item and not its sound strip fails the document
// check with `av_unlinked`, naming both, and the revision before it stays current; one that changes both together
// applies; a planted check that compares only `start` lets the rate change through and fails"
//
// asserts: in the shipped `full` build, an agent presents a board whose `image@1` item `rec` plays a recording's
// frames (`frames: {start: 1s, in: 0, rate: 1}`) and whose strip `rec_sound` plays the same asset's sound with the
// same start, in and rate. A patch setting only `rec`'s frames rate to 2 is refused with an `av_unlinked` error whose
// `ids` hold `rec` and `rec_sound`, and the current revision before it is still the current one after it; a patch
// setting both rates to 2 applies, and a new revision is current. With the scenario's `planted:
// "av_link_compares_start_only"` (the check comparing only `start`), the same run lets the rate-only patch through
// and the same assertions fail, naming av_unlinked.
// Wrong programs: no link check; a check that names one side only; a refusal that still moves the current revision;
// a check that refuses the patch that moves both; a check comparing `start` alone. At the base there is no
// av_unlinked check and a patch can't set a strip's field, so the first test fails, and the planted name is
// `bad_input`, so the second fails at the run's answer.

import { describe, expect, it } from 'vitest';
import {
  FLICKS_PER_SECOND, REVISIONS, VIDEO_SECONDS, currents, errorsOf, issues, patch, present, putBytes, run, scenario, show,
  useBuilds, useDir, videoWithSound, type Build, type JsonObject,
} from './helpers.ts';

const FULL: Build = ['full'];
const builds = useBuilds([FULL]);
const dir = useDir();

const IMAGE = 'rec';
const STRIP = 'rec_sound';

/** A board with the recording's frames as an image item and its sound as a strip, linked by start, in and rate. */
const board = (sha: string): JsonObject => ({
  format: 1, profile: 'board', title: 'A recorded step',
  description: 'A screen recording placed as an image with its sound as a strip, for the media module acceptance tests.',
  size: [320, 200],
  requires: { modules: { media: '^1' } },
  transport: { span: '4s' },
  items: {
    [IMAGE]: { id: IMAGE, kind: 'image@1', name: 'Recording', order: 'a0',
      params: { asset: sha, box: [0, 0, 320, 180], fit: 'contain', alt: 'A test pattern recording', frames: { start: '1s', in: 0, rate: 1 } } },
  },
  strips: { [STRIP]: { track: 1, src: sha, start: '1s', in: 0, out: VIDEO_SECONDS * FLICKS_PER_SECOND, rate: 1 } },
});

const setImageRate = { op: 'set', id: IMAGE, path: `items/${IMAGE}/params/frames/rate`, value: 2 };
const setStripRate = { op: 'set', id: STRIP, path: `strips/${STRIP}/rate`, value: 2 };
const rateOnly: JsonObject = { patch: '01JB499P000000000000000001', base: 0, reason: 'play the recording twice as fast', ops: [setImageRate] };
const both: JsonObject = { patch: '01JB499P000000000000000002', base: 0, reason: 'play the recording and its sound twice as fast', ops: [setImageRate, setStripRate] };

/** The run the criterion describes, and every way its replies miss the criterion (empty when they meet it). */
function linkFailures(bin: string, store: string, planted?: string): string[] {
  const sha = putBytes(store, videoWithSound(store));
  const [shown, before, refused, between, applied, after] = run(bin, scenario(store, [present(board(sha)), REVISIONS, patch(rateOnly), REVISIONS, patch(both), REVISIONS], planted));
  const out: string[] = [];
  if (shown!['outcome'] !== 'presented' || errorsOf(shown!, 'revision 0').length) out.push(`revision 0 (image and strip linked) is presented with no error: ${show(shown)}`);

  const unlinked = errorsOf(refused!, 'the rate-only patch').filter((i) => i.code === 'av_unlinked');
  if (refused!['outcome'] !== 'refused') out.push(`the patch changing only ${IMAGE}'s rate is refused, got ${String(refused!['outcome'])}`);
  if (!unlinked.length) out.push(`the rate-only patch fails the document check with av_unlinked: ${show(issues(refused!, 'the rate-only patch').map((i) => i.raw))}`);
  else if (!unlinked.some((i) => i.ids.includes(IMAGE) && i.ids.includes(STRIP))) out.push(`the av_unlinked error names both ${IMAGE} and ${STRIP}: ${show(unlinked.map((i) => i.raw))}`);

  const [was] = currents(before!, 'before the rate-only patch');
  if (currents(before!, 'before').length !== 1) out.push(`one revision is current before the rate-only patch: ${show(before!['revisions'])}`);
  if (JSON.stringify(currents(between!, 'after the rate-only patch')) !== JSON.stringify(currents(before!, 'before'))) out.push(`the revision before the rate-only patch stays current: before ${show(before!['revisions'])}, after ${show(between!['revisions'])}`);

  if (applied!['outcome'] !== 'applied') out.push(`the patch changing both rates together applies, got ${String(applied!['outcome'])}: ${show(applied!['issues'])}`);
  if (issues(applied!, 'the patch of both').some((i) => i.code === 'av_unlinked')) out.push(`the patch of both raises no av_unlinked: ${show(applied!['issues'])}`);
  const now = currents(after!, 'after the patch of both');
  if (now.length !== 1 || (was && now[0]!.rev === was.rev)) out.push(`after the patch of both a new revision is current: before ${show(before!['revisions'])}, after ${show(after!['revisions'])}`);
  return out;
}

describe('#499.3a4c1fc9 a video\'s picture and its sound move together: a patch changing one rate alone never becomes current', () => {
  it('#499.3a4c1fc9 a patch changing the rate of the image item and not its sound strip fails with av_unlinked naming both, the revision before stays current, and changing both together applies', () => {
    expect(linkFailures(builds.bin(FULL), dir())).toEqual([]);
  }, 1_800_000);

  it('#499.3a4c1fc9 a planted check that compares only start lets the rate change through and fails', () => {
    const failures = linkFailures(builds.bin(FULL), dir(), 'av_link_compares_start_only');
    expect(failures.some((f) => f.includes('av_unlinked')), `the planted check lets the rate-only patch through, so the criterion fails, naming av_unlinked: ${failures.join(' | ')}`).toBe(true);
    expect(failures.some((f) => f.includes(`only ${IMAGE}'s rate is refused`)), `the planted check lets the rate-only patch apply: ${failures.join(' | ')}`).toBe(true);
  }, 1_800_000);
});

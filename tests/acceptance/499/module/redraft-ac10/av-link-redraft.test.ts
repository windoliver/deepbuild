// AC10 of #499: "A patch that changes the rate of a video's image item and not its sound strip fails the document
// check with `av_unlinked`, naming both, and the revision before it stays current; one that changes both together
// applies; a planted check that compares only `start` lets the rate change through and fails".
// A recording with a picture and a sound (made by ffmpeg, put into the evidence store) is shown in a shared film stored
// at revision 0 as an `image@1` playing its frames and a `media.strip@1` of the same asset, both at start 2 s, in 1 s,
// rate 1. The agent's patches go through `deep-show run`'s `deep_show` calls; `revisions` and `read` show which
// revision is current (#96). The suite's `judge` decides; deep-show never judges itself (REDRAFT.md).
import { describe, expect, it } from 'vitest';
import { PLANTED, judge, makeRecording, putRecording, runShow, scenario, startFailures, useOut, useShow } from './helpers.ts';

const bin = useShow();
const out = useOut();

describe("AC10 a video's picture and its sound strip move together", () => {
  it("AC10 a patch that changes only the image item's rate is refused with av_unlinked naming both, revision 0 stays current, and one that changes both rates applies as revision 1", async () => {
    const dir = out();
    const asset = await putRecording(dir, makeRecording(dir));
    const replies = runShow(bin(), scenario(dir, asset), 'the real program');
    const failures = judge(replies);
    console.log(`PROOF #499 AC10 real: rate-only reply ${JSON.stringify(replies[2]).slice(0, 600)}`);
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('AC10 planted av_link_start_only: a check that compares only start lets the rate-only patch through, and the same judgment fails naming av_unlinked and frames.rate', async () => {
    const dir = out();
    const asset = await putRecording(dir, makeRecording(dir));
    const replies = runShow(bin(), scenario(dir, asset, PLANTED), `planted ${PLANTED}`);
    // The twin is the one named: it still compares `start`, so the start-only patch is refused as the real one is.
    const twin = startFailures(replies);
    expect(twin, `planted ${PLANTED} must still refuse a start-only change:\n${twin.join('\n')}`).toEqual([]);
    const failures = judge(replies);
    console.log(`PROOF #499 AC10 planted ${PLANTED}:\n${failures.join('\n')}`);
    expect(
      failures.some((f) => f.includes("only the picture's `frames.rate`") && f.includes('`av_unlinked`')),
      `the judgment fails the planted check, naming \`av_unlinked\` on the rate-only patch; failures:\n${failures.join('\n')}`,
    ).toBe(true);
  });
});

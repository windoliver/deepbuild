// Criterion 5 (README: Criterion 5): the same journey recorded twice gives byte-equal findings. Judged in two ways, each in
// two processes that share nothing: on a recording that holds three findings, given a second time with every frame's
// elements in another order, so a check that reads a hash map's order, the process's clock or its PID gives a different
// answer; and on a real replica's journey that gives a finding, recorded twice, whose recordings must also hash alike.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Drive, cleanup, checked, el, journey, recording, requireMacos, still, triangle, type Obj, type Recording } from './helpers.ts';

beforeAll(requireMacos);
afterEach(cleanup, 60_000);

/** Three findings on three elements: a pop_in (step 30), a jump (step 50) and a flicker (from step 70). */
const THREE = (): Recording =>
  recording({
    at: (k) => [
      ...still(),
      ...(k < 30 ? [] : [el('row:new', 100, 300, 1)]),
      el('card:1', 100 + (k >= 50 ? 260 : 0), 200),
      el('badge:1', 300, 400, triangle(k, 70, 3, 4, 0.5, 0.02)),
    ],
  });

/** The recording with each frame's elements in the reverse order, and the frames' own keys in another order too. */
function reordered(r: Recording): Recording {
  return {
    ...r,
    frames: r.frames.map((f) => ({ elements: [...f.elements].reverse().map((e) => ({ text: e.text, opacity: e.opacity, bounds: e.bounds, id: e.id })), t: f.t })),
  };
}

/** What two runs of the same journey must agree on, byte for byte. */
const stable = (reply: Obj): string => JSON.stringify({ findings: reply.findings, claim: reply.claim, pacing: reply.pacing });

async function once(args: Obj): Promise<Obj> {
  const drive = await Drive.start();
  try {
    return await checked(drive, args);
  } finally {
    await drive.stop();
  }
}

describe('#1427 AC5 the same journey recorded twice gives byte-equal findings', () => {
  it('data: one recording, twice, in two processes, once with the elements in another order', async () => {
    const first = await once({ recording: THREE() });
    const second = await once({ recording: reordered(THREE()) });
    const found = first.findings as Obj[];
    expect(found.map((f) => `${f.finding} ${f.element}`).sort(), 'the recording gives its three findings').toEqual(['flicker badge:1', 'jump card:1', 'pop_in row:new']);
    expect(stable(second), 'byte for byte').toBe(stable(first));
    // And a third run in this process: the same process asked twice agrees with itself and with the others.
    const drive = await Drive.start();
    const a = await checked(drive, { recording: THREE() });
    const b = await checked(drive, { recording: reordered(THREE()) });
    await drive.stop();
    expect(stable(a)).toBe(stable(first));
    expect(stable(b)).toBe(stable(first));
  }, 600_000);

  it('a real replica: the "Flicker 3" journey recorded twice, in two processes, gives the same recording and the same findings', async () => {
    const first = await once({ journey: journey('Flicker 3') });
    const second = await once({ journey: journey('Flicker 3') });
    expect((first.findings as Obj[]).map((f) => f.finding), `the journey gives its flicker: ${JSON.stringify(first.findings)}`).toEqual(['flicker']);
    expect(first.recording.sha256, 'the recording has a hash').toMatch(/^[0-9a-f]{64}$/);
    expect(second.recording.sha256, 'the same journey records the same frames').toBe(first.recording.sha256);
    expect(second.recording.frames).toBe(first.recording.frames);
    expect(stable(second), 'byte for byte').toBe(stable(first));
  }, 600_000);

  it('a real replica: a different journey records differently, so the hash above is of the frames, not of a constant', async () => {
    const flicker = await once({ journey: journey('Flicker 3') });
    const jump = await once({ journey: journey('Jump') });
    expect(jump.recording.sha256).not.toBe(flicker.recording.sha256);
  }, 600_000);
});

// Scope line 1 (README: The recording): a replica journey can record, at each step of the virtual clock, every element's
// bounds, opacity and text, keyed by stable identity. Driven through the `motion` call of the real replica, over the lab
// panel: the steps are exactly 1/120 s apart, each frame lists its elements by an id that is the same before and after the
// element moves and never a position, a move shows as the element's bounds changing between two adjacent frames, a fade as
// its opacity, a stream as its text; the transitions and springs a panel declares are listed; and the same calls give the
// same recording byte for byte.
import { afterAll, describe, expect, it } from 'vitest';
import { Drive, FLICKS, FORMAT, LAB_WINDOW, STEP, cleanup, launchLab, must, press, requireMacos, type Obj } from './helpers.ts';

afterAll(cleanup, 60_000);

interface Frame { t: number; elements: { id: string; bounds: number[]; opacity: number; text: string }[] }

/** The lab launched, `button` pressed once, 3 s of the clock recorded around it; the recording and the press's reply. */
async function recorded(button: string, extra: Obj = {}, reader: Obj | null = null): Promise<{ recording: Obj; start: Obj; stop: Obj }> {
  requireMacos();
  const drive = await Drive.start();
  try {
    const launched = await must(drive, launchLab(extra), 'launch');
    const replica = launched.replica as string;
    const start = await must(drive, { call: 'motion', replica, motion: { action: 'start', reader } }, 'motion start');
    await must(drive, { ...press(button), replica }, `press ${button}`);
    await must(drive, { call: 'wait_for', replica, wait_for: { t: 3 * FLICKS }, timeout: 60_000 }, 'wait');
    const stop = await must(drive, { call: 'motion', replica, motion: { action: 'stop' } }, 'motion stop');
    return { recording: stop.recording as Obj, start, stop };
  } finally {
    await drive.stop();
  }
}
const frames = (r: Obj): Frame[] => r.frames as Frame[];
/** The element whose id holds `name`, in each frame: its id there, or undefined. */
const track = (r: Obj, name: string) => frames(r).map((f) => f.elements.find((e) => e.id.includes(name)));

describe('#1427 scope: a journey records every element\'s bounds, opacity and text at each 1/120 s step, keyed by stable identity', () => {
  it('the recording is 1/120 s apart, from the start of the recording to its stop, and lists each element in full', async () => {
    const { recording, start, stop } = await recorded('Jump');
    expect(recording.format).toBe(FORMAT);
    expect(recording.window, 'the window, in the device pixels bounds use').toEqual(LAB_WINDOW);
    expect(recording.step).toBe(STEP);
    expect(recording.reduced_motion).toBe(false);
    const f = frames(recording);
    expect(f.length, 'a frame each step of the 3 s').toBeGreaterThanOrEqual(3 * 120 - 2);
    expect(f[0]!.t, 'the first frame is at the start').toBeGreaterThanOrEqual(start.t);
    expect(f[0]!.t).toBeLessThanOrEqual(start.t + STEP);
    f.forEach((frame, i) => { if (i > 0) expect(frame.t - f[i - 1]!.t, `frame ${i} follows frame ${i - 1} by one step`).toBe(STEP); });
    expect(f.at(-1)!.t, 'and the last is at the stop, give or take a step').toBeGreaterThanOrEqual(stop.t - STEP);
    expect(f.at(-1)!.t).toBeLessThanOrEqual(stop.t);
    for (const frame of f) {
      const ids = frame.elements.map((e) => e.id);
      expect(new Set(ids).size, `ids are unique in a frame: ${ids.join(', ')}`).toBe(ids.length);
      for (const e of frame.elements) {
        expect(typeof e.id === 'string' && e.id.length > 0, `an id: ${JSON.stringify(e)}`).toBe(true);
        expect(e.bounds.length === 4 && e.bounds.every(Number.isInteger), `bounds are four whole device pixels: ${JSON.stringify(e)}`).toBe(true);
        expect(e.opacity >= 0 && e.opacity <= 1, `opacity is 0 to 1: ${JSON.stringify(e)}`).toBe(true);
        expect(typeof e.text, `text is a string: ${JSON.stringify(e)}`).toBe('string');
      }
    }
    const times = recording.inputs as { t: number }[];
    expect(times.length, 'the one press is an input').toBe(1);
    expect(times[0]!.t >= f[0]!.t && times[0]!.t <= f.at(-1)!.t).toBe(true);
  }, 600_000);

  it('Jump: the jumper keeps one id throughout and its bounds change once, between two adjacent frames, by 180 pt (360 px)', async () => {
    const { recording } = await recorded('Jump');
    const seen = track(recording, 'jumper');
    expect(seen.every((e) => e !== undefined), 'the jumper is in every frame').toBe(true);
    expect(new Set(seen.map((e) => e!.id)).size, 'under one id').toBe(1);
    const xs = seen.map((e) => e!.bounds[0]!);
    const changes = xs.flatMap((x, i) => (i > 0 && x !== xs[i - 1] ? [x - xs[i - 1]!] : []));
    expect(changes, `its left edge changes once, by 360 px, in one step: ${JSON.stringify(changes)}`).toEqual([360]);
    expect(new Set(seen.map((e) => e!.bounds.slice(1).join())).size, 'and its top, width and height not at all').toBe(1);
  }, 600_000);

  it('Pop in: pop-row is not in the frames before the press and is there, at opacity 1 and with its text, after', async () => {
    const { recording } = await recorded('Pop in');
    const seen = track(recording, 'pop-row');
    const first = seen.findIndex((e) => e !== undefined);
    expect(first, 'the row appears after the recording starts').toBeGreaterThan(0);
    expect(seen.slice(0, first).every((e) => e === undefined)).toBe(true);
    expect(seen.slice(first).every((e) => e !== undefined), 'and stays').toBe(true);
    expect(seen[first]!.opacity, 'at once at full opacity').toBe(1);
    expect(seen[first]!.text, 'with the text it draws').toBe('pop-row');
  }, 600_000);

  it('Fade in: fade-row\'s opacity rises a tick at a time, never more than 10% between frames', async () => {
    const { recording } = await recorded('Fade in');
    const seen = track(recording, 'fade-row').filter((e) => e !== undefined);
    const o = seen.map((e) => e!.opacity);
    expect(o[0]!, 'it starts at 10%').toBeCloseTo(0.1, 2);
    expect(o.at(-1)!, 'and ends at full').toBeCloseTo(1, 2);
    o.forEach((v, i) => { if (i > 0) { expect(v).toBeGreaterThanOrEqual(o[i - 1]!); expect(v - o[i - 1]!).toBeLessThan(0.1001); } });
  }, 600_000);

  it('Insert above: line-b keeps its id and its text while its y moves 40 px down; the new line streams in under its own id', async () => {
    const { recording } = await recorded('Insert above', {}, { text: 'Line B' });
    expect(recording.reader, 'the recording names the reader\'s line by its id').toEqual(expect.stringContaining('line-b'));
    const b = track(recording, 'line-b');
    expect(b.every((e) => e !== undefined)).toBe(true);
    expect(new Set(b.map((e) => e!.id)).size, 'one id, before and after it moved').toBe(1);
    expect(new Set(b.map((e) => e!.text)), 'one text').toEqual(new Set(['Line B']));
    const ys = b.map((e) => e!.bounds[1]!);
    expect(ys.at(-1)! - ys[0]!, 'it ends 40 px (a 20 pt line) lower').toBe(40);
    const fresh = track(recording, 'line-new').filter((e) => e !== undefined);
    expect(fresh.length, 'the streamed line is recorded').toBeGreaterThan(5);
    expect(fresh[0]!.opacity).toBeCloseTo(0.1, 2);
    const texts = fresh.map((e) => e!.text);
    expect(texts[0]!.length, 'its text grows as it streams').toBeLessThan(texts.at(-1)!.length);
    expect(texts.at(-1)!.startsWith('Streaming'), 'and is its own text').toBe(true);
  }, 600_000);

  it('the transitions and springs a panel declares are listed, by element and kind: flyer a flight, springer a spring, jumper nothing', async () => {
    const { recording } = await recorded('Fly');
    const declared = recording.declared as { element: string; kind: string }[];
    const of = (name: string) => declared.filter((d) => d.element.includes(name)).map((d) => d.kind);
    expect(of('flyer'), JSON.stringify(declared)).toEqual(['flight']);
    expect(of('springer'), JSON.stringify(declared)).toEqual(['spring']);
    expect(of('jumper'), JSON.stringify(declared)).toEqual([]);
    expect(of('overshooter')).toEqual([]);
    // And the declared flyer moves smoothly under it: more than one step to cover its 360 px.
    const xs = track(recording, 'flyer').map((e) => e!.bounds[0]!);
    expect(new Set(xs).size, 'flyer\'s left edge takes many values on the way').toBeGreaterThan(10);
    expect(xs.at(-1)! - xs[0]!, 'to its target').toBe(360);
  }, 600_000);

  it('a replica launched with reduced_motion says so in the recording', async () => {
    const { recording } = await recorded('Pop in', { reduced_motion: true });
    expect(recording.reduced_motion).toBe(true);
  }, 600_000);

  it('the same calls in two processes record the same bytes', async () => {
    const a = await recorded('Flicker 3');
    const b = await recorded('Flicker 3');
    expect(JSON.stringify(b.recording)).toBe(JSON.stringify(a.recording));
    const badge = track(a.recording, 'badge').map((e) => e!.opacity);
    expect(new Set(badge).size, 'and it holds the flicker: the badge\'s opacity takes several values').toBeGreaterThan(3);
  }, 600_000);
});

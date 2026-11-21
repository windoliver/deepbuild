// AC7 (README: The lists arm, act wheel). The replica's lists arm holds GPUI's two list elements side by side, a
// `uniform_list` and a `list`, each 1,000 rows of 32 pt, at scale 1, so a point is a device pixel. Wheel events go to
// the list one a frame of the clock; where its last row sits is read from `see`, and what the events repainted and drew
// from `close`'s frames report. A wheel past the end moves nothing, so it may notify nothing and draw nothing.
import { afterAll, describe, expect, it } from 'vitest';
import { DRIVE_PLANT, Replica, byId, cleanup, debugDrive, framesOf, nameOf, requireMacos, type Frame, type Report } from './helpers.ts';

afterAll(cleanup, 60_000);
const LONG = 1_800_000;

const KINDS = ['uniform_list', 'list'] as const;
type Kind = (typeof KINDS)[number];
const LAST = 999;
/** "120 wheel events at the end". */
const EVENTS = 120;

async function lists(plant?: string): Promise<Replica> {
  requireMacos();
  return Replica.open({ bin: debugDrive(), plant, launch: { arm: 'lists', size: [800, 600], scale: 1, read_back: 'off' } });
}
/** How far the list's last row sits below the list's bottom edge, in device pixels: 0 at the end. */
async function belowEnd(r: Replica, kind: Kind): Promise<number> {
  const snapshot = await r.see();
  const list = byId(snapshot, kind);
  const last = byId(snapshot, `${kind}:${LAST}`);
  expect(list, `the lists arm draws the ${kind} as an element with id ${kind}`).toBeTruthy();
  expect(last, `the ${kind}'s last row, ${kind}:${LAST}, is on screen`).toBeTruthy();
  return last!.bounds[1] + last!.bounds[3] - (list!.bounds[1] + list!.bounds[3]);
}
/** What a step of wheel events past the end did that it mustn't: views it repainted, and frames past the one allowed. */
function pastEndProblems(r: Report, frames: Frame[]): string[] {
  const out = frames.flatMap((f) => f.rendered.map((e) => `frame ${f.frame} repainted ${nameOf(r, e)}`));
  const drawn = frames.filter((f) => f.drawn);
  if (drawn.length > 1) {
    const notified = [...new Set(drawn.flatMap((f) => f.notified.map((e) => nameOf(r, e))))];
    out.unshift(`${drawn.length} frames drawn for ${EVENTS} wheel events at the end; notified in them: ${notified.join(', ') || 'nothing named'}`);
  }
  return out;
}
/** Wheels the list to its end and lets it settle, then 120 more events: that step's number. */
async function pastEnd(r: Replica, kind: Kind): Promise<number> {
  await r.wheel(kind, 400, 100);
  await r.settle();
  expect(await belowEnd(r, kind), `100 events of 400 pt bring the ${kind} to its end`).toBe(0);
  await r.wheel(kind, 10, EVENTS);
  return r.steps;
}

describe('#1482 AC7 wheel events at the end of a list', () => {
  for (const kind of KINDS) {
    it(`AC7 120 wheel events at the end of a ${kind} repaint 0 views and draw at most 1 frame; a wheel 1 px from the end moves exactly 1 px, then nothing`, async () => {
      const r = await lists();
      let report: Report;
      let still: number;
      let onePx: number;
      try {
        still = await pastEnd(r, kind);
        expect(await belowEnd(r, kind), 'the list stays at its end').toBe(0);
        await r.wheel(kind, -1, 1);
        await r.settle();
        expect(await belowEnd(r, kind), 'one event of 1 pt back up leaves the last row 1 px below the list\'s edge').toBe(1);
        await r.wheel(kind, 10, 12);
        onePx = r.steps;
        expect(await belowEnd(r, kind), 'a wheel 1 px from the end moves exactly 1 px, to the end').toBe(0);
        report = await r.close();
      } finally {
        await r.stop();
      }
      const frames = framesOf(report, [still]);
      expect(frames.length, `the ${EVENTS} events pass a frame of the clock each`).toBeGreaterThanOrEqual(EVENTS);
      expect(pastEndProblems(report, frames), `${EVENTS} wheel events at the end of a ${kind}`).toEqual([]);
      expect(framesOf(report, [onePx]).filter((f) => f.drawn).length, 'the 1 px move draws one frame, then nothing').toBe(1);
    }, LONG);
  }

  it('AC7 a planted notify on every wheel event fails, naming the view', async () => {
    for (const kind of KINDS) {
      const r = await lists(DRIVE_PLANT.wheelNotifiesEveryEvent);
      let report: Report;
      let step: number;
      try {
        step = await pastEnd(r, kind);
        report = await r.close();
      } finally {
        await r.stop();
      }
      const problems = pastEndProblems(report, framesOf(report, [step]));
      console.log(`AC7 planted ${kind}: ${problems.slice(0, 2).join('; ')}`);
      expect(problems.length, `the planted ${kind} draws a frame for each event`).toBeGreaterThan(0);
      expect(problems[0], 'naming the view').toContain(`lists/${kind}`);
    }
  }, LONG);
});

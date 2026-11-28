import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TestContext } from 'vitest';
import {
  AC5, FIXTURES, appShowing, capturedFrames, cleanUpAfterTheFile, docId, flicks, howTheyDiffer, hubShowing, onAReferenceMac, playheadAt, proof, reasonsPainted,
  said, screenScale, seconds, shownWithItsRenderBack, slotOnScreen, slotSize, stopHub, underTheGpuLease, useApp, type Box, type Hub, type JsonObject, type Report,
  type Size, type Staged,
} from './helpers.ts';

const app = useApp();
cleanUpAfterTheFile();

const FIXTURE = join(FIXTURES, 'sliding-box.json');
const DOCUMENT_SIZE: Size = [480, 360];
const PANEL: Box = [0, 0, 480, 360];
const DOC = docId(5);
const PAUSED_AT_SECONDS = 3;
const SEEKED_TO_SECONDS = 10;
const PAUSED_AT = flicks(PAUSED_AT_SECONDS);
const SEEKED_TO = flicks(SEEKED_TO_SECONDS);
const PAUSE_HANDED_MS = 500;
const PAUSE_JUDGED_MS: [number, number] = [5_000, 9_000];
const SEEK_HANDED_MS = 9_000;
const CAPTURE_MS = 13_000;
const RUN_MS = 14_000;
const LEAST_WINDOW_FRAMES = 60;
const PLANTED = 'keeps_own_clock';

interface Stage extends Staged { hub: Hub; paused: JsonObject; seeked: JsonObject }
let staged: Promise<Stage> | undefined;

async function stage(size: Size): Promise<Stage> {
  const hub = await hubShowing([{ doc: DOC, panel: 'main', rect: PANEL }]);
  const shown = await shownWithItsRenderBack(hub, DOC, FIXTURE, { t: `${SEEKED_TO_SECONDS}s`, size }, 'the sliding box');
  const paused = await playheadAt(hub, 'main', PAUSED_AT);
  const seeked = await playheadAt(hub, 'main', SEEKED_TO);
  await stopHub(hub);
  proof('ac5-render-back-at-10s.png', shown.back.bytes);
  return { ...shown, hub, paused, seeked };
}

async function pausedThenSeekedInTheApp(ctx: TestContext, planted?: string): Promise<{ report: Report; s: Stage }> {
  const bin = app();
  const size = slotSize(DOCUMENT_SIZE, PANEL, await screenScale(ctx, bin));
  const s = await (staged ??= stage(size));
  const report = await appShowing(ctx, bin, {
    hub: s.hub, window: [PANEL[2], PANEL[3]], runMs: RUN_MS, revisions: [s.p],
    replies: [{ atMs: PAUSE_HANDED_MS, reply: s.paused }, { atMs: SEEK_HANDED_MS, reply: s.seeked }], captureMs: [CAPTURE_MS],
    ...(planted ? { planted } : {}),
  });
  proof(`ac5${planted ? `-${planted}` : ''}-report.json`, report.raw);
  return { report, s };
}

const evaluatedAt = (t: number | null): string => (t === null ? 'a time the report doesn\'t give (slots[].t)' : `${t} flicks (${seconds(t)})`);

function findings(ctx: TestContext, report: Report, s: Stage, who: string): string[] {
  const out: string[] = [];
  const layer = s.p.layer;
  const paused = report.frames.filter((f) => f.atMs >= PAUSE_JUDGED_MS[0] && f.atMs < PAUSE_JUDGED_MS[1]);
  if (paused.length < LEAST_WINDOW_FRAMES) {
    ctx.skip(`INCONCLUSIVE: ${who}: the window drew ${paused.length} frames from ${PAUSE_JUDGED_MS[0]} to ${PAUSE_JUDGED_MS[1]} ms of the run, fewer than ${LEAST_WINDOW_FRAMES}; the machine starved it`);
  }
  const held = paused.flatMap((f) => f.slots.filter((slot) => slot.layer === layer));
  const seqs = [...new Set(held.map((slot) => slot.frameSeq))];
  const times = [...new Set(held.map((slot) => slot.t))];
  said(`AC5 ${who}, paused: ${paused.length} window frames showed ${seqs.length} view frames, evaluated at ${times.slice(0, 4).map(evaluatedAt).join(', ')}`);
  if (held.length === 0) {
    out.push(`with the session paused the window painted no GPU-layer slot for the layer "${layer}"; in its place the panel painted ${reasonsPainted(report, layer)}`);
  } else {
    if (seqs.length !== 1) {
      out.push(`with the session paused at ${evaluatedAt(PAUSED_AT)} the view drew ${seqs.length - 1} frames while the window drew ${paused.length} (${PAUSE_JUDGED_MS[0]} to ${PAUSE_JUDGED_MS[1]} ms of the run): frame_seq ${Math.min(...seqs)} to ${Math.max(...seqs)}`);
    }
    if (times.some((t) => t !== PAUSED_AT)) {
      out.push(`with the session paused at ${evaluatedAt(PAUSED_AT)} the frames on screen were evaluated at ${times.slice(0, 4).map(evaluatedAt).join(', ')}`);
    }
  }
  const on = slotOnScreen(capturedFrames(report)[0], layer, 'after the seek');
  if (typeof on === 'string') return [...out, on];
  proof(`ac5-${who.replaceAll(' ', '-')}-after-the-seek.png`, on.shown.bytes);
  said(`AC5 ${who}, after the seek: the frame on screen ${on.shown.pixelHash}, evaluated at ${evaluatedAt(on.slot.t)}; render-back's at ${SEEKED_TO_SECONDS} s ${s.back.pixelHash}`);
  if (on.slot.t !== SEEKED_TO) out.push(`after the seek the session's time is ${evaluatedAt(SEEKED_TO)} and the frame on screen was evaluated at ${evaluatedAt(on.slot.t)}`);
  if (on.shown.pixelHash !== s.back.pixelHash) {
    out.push(`after the seek to ${SEEKED_TO_SECONDS} s the frame on screen (pixel hash ${on.shown.pixelHash}) is not render-back's frame at ${SEEKED_TO_SECONDS} s (${s.back.pixelHash}): ${howTheyDiffer(on.shown.image, s.back.image)}`);
  }
  return out;
}

describe(`${AC5} with the session paused the view draws 0 frames, and after a seek to 10 s the frame on screen is the frame at 10 s`, () => {
  it(`${AC5} a sliding box paused at ${PAUSED_AT_SECONDS} s: the view draws no frame while the window draws on, and after a seek to ${SEEKED_TO_SECONDS} s the frame on screen is render-back's frame at ${SEEKED_TO_SECONDS} s`, async (ctx) => {
    await onAReferenceMac(ctx);
    await underTheGpuLease(ctx, async () => {
      const { report, s } = await pausedThenSeekedInTheApp(ctx);
      expect(findings(ctx, report, s, 'the app')).toEqual([]);
    });
  }, 3_600_000);

  it(`${AC5} planted ${PLANTED}: a view that keeps its own clock draws on through the pause and shows another time after the seek, and the check fails, naming both times`, async (ctx) => {
    await onAReferenceMac(ctx);
    await underTheGpuLease(ctx, async () => {
      const { report, s } = await pausedThenSeekedInTheApp(ctx, PLANTED);
      const found = findings(ctx, report, s, `planted ${PLANTED}`);
      const own = capturedFrames(report)[0]?.slots.find((slot) => slot.layer === s.p.layer)?.t ?? null;
      expect(own, `the planted view says the time on its own clock that its frame on screen was evaluated at (slots[].t); the check found: ${found.join('; ')}`).not.toBeNull();
      expect(own, 'the planted view\'s clock is not the session\'s').not.toBe(SEEKED_TO);
      expect(found.join('\n'), 'the failure names both times').toContain(`the session's time is ${evaluatedAt(SEEKED_TO)} and the frame on screen was evaluated at ${evaluatedAt(own)}`);
    });
  }, 3_600_000);
});

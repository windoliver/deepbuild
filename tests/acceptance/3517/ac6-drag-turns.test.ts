import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC6, FIXTURES, appShowing, asTheApp, asYouOnTheCanvas, capturedFrames, cleanUpAfterTheFile, deepShow, docId, howTheyDiffer, hubShowing, input, num, obj,
  onAReferenceMac, proof, renderBackOf, said, screenScale, shownWithItsRenderBack, slotOnScreen, slotSize, stopHub, str, underTheGpuLease, useApp, type Box, type Hub,
  type JsonObject, type JsonValue, type Size,
} from './helpers.ts';

const app = useApp();
cleanUpAfterTheFile();

const FIXTURE = join(FIXTURES, 'turned-box.json');
const TURNED_CAMERA = 'turned';
const DOCUMENT_SIZE: Size = [480, 360];
const PANEL: Box = [0, 0, 480, 360];
const TWIN_PANEL: Box = [0, 400, 480, 360];
const DOC = docId(6);
const TWIN = docId(61);
const TURN_DEGREES = 30;
const PRESS_AT: Size = [300, 180];
const DRAG_PX = -120;
const DRAG_STEPS = 6;
const BEFORE_MS = 5_000;
const DRAG_HANDED_MS = 6_000;
const AFTER_MS = 8_500;
const RUN_MS = 9_500;

const GOLDEN_STEPS = 2;

interface Held { revisions: JsonValue; track: string }

async function whatADragMustLeave(hub: Hub): Promise<Held> {
  return {
    revisions: (await asTheApp(hub, 'canvas.revisions', { doc: DOC }))['revisions'] ?? null,
    track: str((await asYouOnTheCanvas(hub, { call: 'track', doc: DOC }))['hash'], 'the input track\'s hash (the canvas core\'s track call)'),
  };
}

async function dragSideways(hub: Hub): Promise<JsonObject[]> {
  const at = (step: number): Size => [PRESS_AT[0] + (DRAG_PX * step) / DRAG_STEPS, PRESS_AT[1]];
  const replies = [await input(hub, 'main', { type: 'down', pos: at(0) })];
  for (let step = 1; step <= DRAG_STEPS; step++) replies.push(await input(hub, 'main', { type: 'move', pos: at(step) }));
  replies.push(await input(hub, 'main', { type: 'up', pos: at(DRAG_STEPS) }));
  return replies;
}

const azimuthIn = (reply: JsonObject, what: string): number => num(obj(obj(reply['state'], `${what}: state`)['camera'], `${what}: state.camera`)['azimuth'], `${what}: state.camera.azimuth`);

describe(`${AC6} a drag that turns the camera 30° changes the frame on screen to the one render-back draws from that pose, and leaves the document's revision, the input track's hash and every golden unchanged`, () => {
  it(`${AC6} a sideways drag of ${Math.abs(DRAG_PX)} px turns your view ${TURN_DEGREES}°: the frame on screen becomes render-back's from a camera at that pose, and the revision, the input track's hash and a golden of the document stay as they were`, async (ctx) => {
    await onAReferenceMac(ctx);
    const bin = app();
    await underTheGpuLease(ctx, async () => {
      const size = slotSize(DOCUMENT_SIZE, PANEL, await screenScale(ctx, bin));
      const hub = await hubShowing([{ doc: DOC, panel: 'main', rect: PANEL }, { doc: TWIN, panel: 'twin', rect: TWIN_PANEL }]);
      const { back: fromItsCamera, p } = await shownWithItsRenderBack(hub, DOC, FIXTURE, { size }, 'the document from its own camera');
      const twin = join(hub.home, 'through-the-turned-camera.json');
      writeFileSync(twin, JSON.stringify({ ...(JSON.parse(readFileSync(FIXTURE, 'utf8')) as JsonObject), camera: TURNED_CAMERA }));
      const fromThatPose = renderBackOf(hub, await deepShow(hub, TWIN, twin, { size }), size, 'the document through its camera at the turned pose');
      const before = await whatADragMustLeave(hub);
      const recorded = await asYouOnTheCanvas(hub, { call: 'golden_record', doc: DOC, steps: GOLDEN_STEPS });
      const golden = obj(recorded['golden'], `a golden of the document, recorded before the drag (golden_record); the canvas core answered ${JSON.stringify(recorded).slice(0, 400)}`);
      const drag = await dragSideways(hub);
      const after = await whatADragMustLeave(hub);
      const verified = await asYouOnTheCanvas(hub, { call: 'golden_verify', doc: DOC, golden });
      await stopHub(hub);
      const turned = azimuthIn(drag.at(-1)!, 'the reply to the release') - azimuthIn(drag[0]!, 'the reply to the press');
      expect(turned, `the drag turned the session's camera ${TURN_DEGREES}°, as the hub's replies say (state.camera.azimuth)`).toBeCloseTo(TURN_DEGREES, 6);
      expect(after.revisions, 'the drag leaves the document\'s revisions as they were (canvas.revisions)').toEqual(before.revisions);
      expect(after.track, 'the drag leaves the input track\'s hash as it was').toBe(before.track);
      expect(verified['verdict'], `the golden recorded before the drag verifies after it (golden_verify): ${JSON.stringify(verified).slice(0, 400)}`).toBe('PASS');

      const report = await appShowing(ctx, bin, {
        hub, window: [PANEL[2], PANEL[3]], runMs: RUN_MS, revisions: [p],
        replies: drag.map((reply, k) => ({ atMs: DRAG_HANDED_MS + k * 20, reply })), captureMs: [BEFORE_MS, AFTER_MS],
      });
      proof('ac6-report.json', report.raw);
      proof('ac6-render-back-from-its-camera.png', fromItsCamera.bytes);
      proof('ac6-render-back-from-the-turned-pose.png', fromThatPose.bytes);
      const captured = capturedFrames(report);
      const first = slotOnScreen(captured[0], p.layer, 'before the drag');
      const second = slotOnScreen(captured[1], p.layer, 'after the drag');
      if (typeof first === 'string') return expect.fail(first);
      if (typeof second === 'string') return expect.fail(second);
      proof('ac6-before-the-drag.png', first.shown.bytes);
      proof('ac6-after-the-drag.png', second.shown.bytes);
      said(`AC6 before the drag the frame on screen is ${first.shown.pixelHash}, after it ${second.shown.pixelHash}; render-back draws ${fromItsCamera.pixelHash} from the document's camera and ${fromThatPose.pixelHash} from the turned pose`);
      expect(second.shown.pixelHash, `the drag changes the frame on screen: after it the slot holds another frame than before it (${first.shown.pixelHash})`).not.toBe(first.shown.pixelHash);
      expect(second.shown.pixelHash, `after the drag the frame on screen is the one render-back draws from that pose, by pixel hash; ${howTheyDiffer(second.shown.image, fromThatPose.image)}`).toBe(fromThatPose.pixelHash);
    });
  }, 3_600_000);
});

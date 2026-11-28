import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TestContext } from 'vitest';
import {
  AC3, FIXTURES, appShowing, capturedFrames, cleanUpAfterTheFile, docId, flicks, framesPainting, howTheyDiffer, hubShowing, onAReferenceMac, playheadAt, proof,
  reasonsPainted, said, screenScale, shownWithItsRenderBack, slotOnScreen, slotSize, stopHub, underTheGpuLease, useApp, type Box, type Hub, type JsonObject,
  type Report, type Size, type Staged,
} from './helpers.ts';

const app = useApp();
cleanUpAfterTheFile();

const DOCUMENT_SIZE: Size = [320, 240];
const PANEL: Box = [0, 0, 320, 240];
const AT_SECONDS = 6;
const RUN_MS = 10_000;
const PAUSE_HANDED_MS = 500;
const CAPTURE_MS = 8_000;

interface Case { field: 'look' | 'shots'; doc: string; file: string; kept: string[]; planted: string; draws: string }
const CASES: Case[] = [
  { field: 'look', doc: docId(31), file: 'look-box.json', kept: ['brick.look.json'], planted: 'draws_in_default_look', draws: 'in the default look' },
  { field: 'shots', doc: docId(32), file: 'two-shots.json', kept: [], planted: 'draws_at_first_camera', draws: 'at the document\'s first camera' },
];

interface Stage extends Staged { hub: Hub; paused: JsonObject }
const staged = new Map<string, Promise<Stage>>();

async function stage(c: Case, size: Size): Promise<Stage> {
  const hub = await hubShowing([{ doc: c.doc, panel: 'main', rect: PANEL }], c.kept.map((name) => readFileSync(join(FIXTURES, name))));
  const shown = await shownWithItsRenderBack(hub, c.doc, join(FIXTURES, c.file), { t: `${AT_SECONDS}s`, size }, `the document with ${c.field}`);
  const paused = await playheadAt(hub, 'main', flicks(AT_SECONDS));
  await stopHub(hub);
  proof(`ac3-${c.field}-render-back.png`, shown.back.bytes);
  return { ...shown, hub, paused };
}

async function shownInTheApp(ctx: TestContext, c: Case, planted?: string): Promise<{ report: Report; s: Stage }> {
  const bin = app();
  const size = slotSize(DOCUMENT_SIZE, PANEL, await screenScale(ctx, bin));
  if (!staged.has(c.field)) staged.set(c.field, stage(c, size));
  const s = await staged.get(c.field)!;
  const report = await appShowing(ctx, bin, {
    hub: s.hub, window: [PANEL[2], PANEL[3]], runMs: RUN_MS, revisions: [s.p], replies: [{ atMs: PAUSE_HANDED_MS, reply: s.paused }], captureMs: [CAPTURE_MS],
    ...(planted ? { planted } : {}),
  });
  proof(`ac3-${c.field}${planted ? `-${planted}` : ''}-report.json`, report.raw);
  return { report, s };
}

interface Finding { kind: 'unpainted' | 'differs'; text: string }

function findings(c: Case, report: Report, s: Stage, who: string): Finding[] {
  if (framesPainting(report, s.p.layer).length === 0) {
    return [{ kind: 'unpainted', text: `\`${c.field}\`: the document with ${c.field} is not painted from a GPU-layer slot; in its layer's place the panel painted ${reasonsPainted(report, s.p.layer)}` }];
  }
  const on = slotOnScreen(capturedFrames(report)[0], s.p.layer, `the document with ${c.field}`);
  if (typeof on === 'string') return [{ kind: 'unpainted', text: `\`${c.field}\`: ${on}` }];
  proof(`ac3-${c.field}-${who.replaceAll(' ', '-')}-slot.png`, on.shown.bytes);
  said(`AC3 the document with ${c.field}, ${who}: the slot's frame ${on.shown.pixelHash} (t ${on.slot.t}); render-back's at ${AT_SECONDS} s ${s.back.pixelHash}`);
  if (on.shown.pixelHash === s.back.pixelHash) return [];
  return [{
    kind: 'differs',
    text: `\`${c.field}\`: the view's frame of the document with ${c.field} (pixel hash ${on.shown.pixelHash}) is not render-back's frame of revision ${s.p.rev} at ${AT_SECONDS} s (${s.back.pixelHash}): ${howTheyDiffer(on.shown.image, s.back.image)}`,
  }];
}

describe(`${AC3} a document with a look and one with shots are each painted, equal by pixel hash to render-back's frame`, () => {
  for (const c of CASES) {
    it(`${AC3} a document with ${c.field} is painted in the app's window from a GPU-layer slot whose frame is render-back's frame, by pixel hash`, async (ctx) => {
      await onAReferenceMac(ctx);
      await underTheGpuLease(ctx, async () => {
        const { report, s } = await shownInTheApp(ctx, c);
        expect(findings(c, report, s, 'the app').map((f) => f.text)).toEqual([]);
      });
    }, 3_600_000);

    it(`${AC3} planted ${c.planted}: a view that draws the document with ${c.field} ${c.draws} paints a frame that is not render-back's, and the check fails, naming the field ${c.field}`, async (ctx) => {
      await onAReferenceMac(ctx);
      await underTheGpuLease(ctx, async () => {
        const { report, s } = await shownInTheApp(ctx, c, c.planted);
        const found = findings(c, report, s, `planted ${c.planted}`);
        expect(found.map((f) => f.kind), `the planted view paints a frame, and it is not render-back's: ${found.map((f) => f.text).join('; ')}`).toEqual(['differs']);
        expect(found[0]!.text, 'the failure names the field').toContain(`\`${c.field}\``);
      });
    }, 3_600_000);
  }
});

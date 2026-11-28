import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TestContext } from 'vitest';
import {
  AC7, FIXTURES, appShowing, cleanUpAfterTheFile, deepShow, docId, hubShowing, onMacos, presentationOf, proof, reasonsPainted, recordedEventsOnce, said, screenScale, stopHub, useApp, type Box, type Presentation, type RecordedEvent, type Report,
} from './helpers.ts';

const app = useApp();
cleanUpAfterTheFile();

const FIXTURE = join(FIXTURES, 'needs-physics.json');
const REASON = 'module_missing: physics';
const REFUSAL = 'layer.refused';
const PANEL: Box = [0, 0, 480, 360];
const DOC = docId(7);
const SUBJECT = `doc:${DOC}`;
const RUN_MS = 6_000;
const PLANTED = 'paints_reason_records_nothing';

interface Refused { p: Presentation; report: Report; events: RecordedEvent[] }

async function refusedInTheApp(ctx: TestContext, planted?: string): Promise<Refused> {
  const bin = app();
  await screenScale(ctx, bin);
  const hub = await hubShowing([{ doc: DOC, panel: 'main', rect: PANEL }]);
  await deepShow(hub, DOC, FIXTURE);
  const p = await presentationOf(hub, DOC);
  const report = await appShowing(ctx, bin, { hub, window: [PANEL[2], PANEL[3]], runMs: RUN_MS, revisions: [p], follow: true, ...(planted ? { planted } : {}) });
  const events = await recordedEventsOnce(hub, REFUSAL, 5_000);
  await stopHub(hub);
  proof(`ac7${planted ? `-${planted}` : ''}-report.json`, report.raw);
  proof(`ac7${planted ? `-${planted}` : ''}-record.json`, events.map((e) => ({ kind: e.kind, subject: e.subject, data: e.data })));
  return { p, report, events };
}

function findings(r: Refused): string[] {
  const layer = r.p.layer;
  const painted = reasonsPainted(r.report, layer);
  const recorded = r.events.filter((e) => e.kind === REFUSAL && e.subject?.toLowerCase() === SUBJECT.toLowerCase() && e.data['layer'] === layer);
  said(`AC7 layer "${layer}" of ${SUBJECT}: the panel painted ${painted}; the record holds ${JSON.stringify(recorded.map((e) => e.data))}`);
  if (recorded.length === 0) {
    const kinds = [...new Set(r.events.map((e) => e.kind))].join(', ');
    return [`layer "${layer}" of ${SUBJECT}: the panel painted ${painted} in its place and the record holds no layer.refused event for it; the record's kinds: ${kinds}`];
  }
  const out: string[] = [];
  const data = recorded[0]!.data;
  if (String(data['doc']).toLowerCase() !== SUBJECT.toLowerCase() || data['rev'] !== r.p.rev || data['reason'] !== REASON) {
    out.push(`layer "${layer}" of ${SUBJECT}: the record's layer.refused holds ${JSON.stringify(data)}, not doc "${SUBJECT}", rev ${r.p.rev} and the reason "${REASON}"`);
  }
  if (painted !== `"${REASON}"`) out.push(`layer "${layer}" of ${SUBJECT}: the record gives the reason "${String(data['reason'])}" and the panel painted ${painted} (frames[].reasons)`);
  return out;
}

describe(`${AC7} a layer the app refuses is in the record with its reason`, () => {
  it(`${AC7} a document that requires physics, followed from the hub by the app's panel: the panel paints "${REASON}" in the layer's place and the hub's record holds layer.refused with that reason`, async (ctx) => {
    onMacos(ctx);
    expect(findings(await refusedInTheApp(ctx))).toEqual([]);
  }, 3_600_000);

  it(`${AC7} planted ${PLANTED}: an app that paints the reason and records nothing fails the check, naming the layer`, async (ctx) => {
    onMacos(ctx);
    const r = await refusedInTheApp(ctx, PLANTED);
    const found = findings(r);
    expect(reasonsPainted(r.report, r.p.layer), 'the planted app paints the reason in the layer\'s place (frames[].reasons)').toBe(`"${REASON}"`);
    expect(found.length, 'the check fails on the planted app').toBe(1);
    expect(found[0], 'the failure names the layer').toContain(`layer "${r.p.layer}" of ${SUBJECT}: the panel painted "${REASON}" in its place and the record holds no layer.refused event for it`);
  }, 3_600_000);
});

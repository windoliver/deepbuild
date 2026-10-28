// AC16: the two broken twins of the Claude Code adapter fail the adapter kit with "duplicate event ID", naming the
// ID, and "event after stop", naming the turn, while the adapter itself passes both cases; a kit that checks only
// reply shapes passes both twins and fails this test.
//
// The kit is the conformance package's adapter@1 kit (`kits()`), run in-process through its public runner
// (`runKit`, headless). The adapter is `shippedFill(<the Claude Code registry name>)`; each twin is the same call
// with `planted` (README, The surface under test). "Naming the ID" is read as: a failing case's message carries an
// ID the run itself used, one of the ULIDs in the hook lines the kit fed the twin or in the events the twin
// mapped; "naming the turn": it carries a turn the run used, a `prompt_id` the kit fed or a `turn` the twin mapped.
import { afterAll, describe, expect, it } from 'vitest';
import { kits, runKit } from '../../../../packages/conformance/src/index.ts';
import type { CaseResult, Fill, Kit, Report } from '../../../../packages/conformance/src/index.ts';
import type { AdapterEvent, HookRequestLine } from '../../../../packages/adapters/src/index.ts';
import { AC16, cleanup, shippedFill, type Plant } from './helpers.ts';
import { shapeOnlyKit } from './wrong.ts';

afterAll(cleanup);

const ULID = /\b[0-9A-HJKMNP-TV-Z]{26}\b/g;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function adapterKit(): Kit {
  const kit = kits().find((k) => k.name === 'adapter@1');
  if (!kit) throw Error('kits() ships no adapter@1 kit');
  return kit;
}

/** The fill with its adapter's mapHook observed: every line the kit fed it and every event it mapped. */
function observed(fill: Fill): { fill: Fill; lines: HookRequestLine[]; events: AdapterEvent[] } {
  const lines: HookRequestLine[] = [];
  const events: AdapterEvent[] = [];
  const inner = fill.adapter;
  const adapter = Object.create(inner) as typeof inner;
  adapter.mapHook = (request, version, transcript) => {
    lines.push(request);
    const mapped = inner.mapHook(request, version, transcript);
    if (isObj(mapped) && Array.isArray(mapped.events)) events.push(...(mapped.events as AdapterEvent[]));
    return mapped;
  };
  return { fill: { ...fill, adapter }, lines, events };
}

/** The IDs and the turns a run used: ULIDs anywhere in the lines and events; prompt_id values and mapped turns. */
function used(lines: HookRequestLine[], events: AdapterEvent[]): { ids: Set<string>; turns: Set<string> } {
  const ids = new Set(`${JSON.stringify(lines)}${JSON.stringify(events)}`.match(ULID) ?? []);
  const turns = new Set<string>();
  for (const l of lines) if (isObj(l.payload) && typeof l.payload.prompt_id === 'string' && l.payload.prompt_id) turns.add(l.payload.prompt_id);
  for (const e of events) if (isObj(e.data) && (typeof e.data.turn === 'string' || typeof e.data.turn === 'number') && String(e.data.turn)) turns.add(String(e.data.turn));
  return { ids, turns };
}

const TWINS: { plant: Plant; phrase: string; names: 'id' | 'turn'; other: string }[] = [
  { plant: 'duplicate-event-id', phrase: 'duplicate event ID', names: 'id', other: 'event after stop' },
  { plant: 'event-after-stop', phrase: 'event after stop', names: 'turn', other: 'duplicate event ID' },
];

const listed = (report: Report): string => report.cases.map((c) => `${c.outcome} ${c.id}${c.message ? `: ${c.message}` : ''}`).join('\n');

/**
 * The criterion's assertion, for any kit: the twin fails `kit` with its phrase, naming what it names, and never with
 * the other twin's phrase; the cases it fails are the twin's, so the adapter itself passes each of them.
 */
function expectTwinFailsKit(kit: Kit, twin: (typeof TWINS)[number]): CaseResult[] {
  const seen = observed(shippedFill(twin.plant));
  const report = runKit(kit, seen.fill, { headless: true });
  const failing = report.cases.filter((c) => c.outcome === 'FAIL' && c.message.includes(twin.phrase));
  expect(failing.length, `the twin ${twin.plant} fails a case of ${kit.name} with "${twin.phrase}"; the run read:\n${listed(report)}`).toBeGreaterThan(0);
  const { ids, turns } = used(seen.lines, seen.events);
  const named = twin.names === 'id' ? ids : turns;
  expect(named.size, `the twin ${twin.plant}'s run used some ${twin.names === 'id' ? 'event ID' : 'turn'} the message could name`).toBeGreaterThan(0);
  const naming = failing.filter((c) => [...named].some((token) => c.message.includes(token)));
  expect(naming.map((c) => c.id), `the twin ${twin.plant}: "${twin.phrase}" names the ${twin.names === 'id' ? 'ID' : 'turn'} (one of ${[...named].join(', ')}); it read: ${failing.map((c) => c.message).join(' | ')}`).not.toEqual([]);
  const crossed = report.cases.filter((c) => c.outcome === 'FAIL' && c.message.includes(twin.other));
  expect(crossed.map((c) => `${c.id}: ${c.message}`), `the twin ${twin.plant} fails with its own message, never "${twin.other}"`).toEqual([]);
  return naming;
}

describe(`${AC16} the two broken twins fail the kit with "duplicate event ID", naming the ID, and "event after stop", naming the turn, while the adapter itself passes both cases`, () => {
  for (const twin of TWINS) {
    it(`${AC16} the twin ${twin.plant} fails adapter@1 with "${twin.phrase}" naming the ${twin.names === 'id' ? 'ID' : 'turn'}, and the Claude Code adapter passes that case`, () => {
      const kit = adapterKit();
      const failed = expectTwinFailsKit(kit, twin);
      const report = runKit(kit, shippedFill(), { headless: true });
      for (const c of failed) {
        const own = report.cases.find((r) => r.id === c.id);
        expect(own?.outcome, `the Claude Code adapter passes ${c.id}, the case its twin ${twin.plant} fails; the run read:\n${listed(report)}`).toBe('PASS');
      }
    }, 120_000);
  }

  it(`${AC16} (wrong program) a kit that checks only reply shapes passes both twins, and this test's assertion fails on it, naming each twin`, () => {
    const shapes = shapeOnlyKit(adapterKit());
    for (const twin of TWINS) {
      const report = runKit(shapes, shippedFill(twin.plant), { headless: true });
      expect(report.verdict, `the shape-only kit passes the twin ${twin.plant}, as the criterion's wrong kit does:\n${listed(report)}`).toBe('PASS');
      expect(() => expectTwinFailsKit(shapes, twin), `the assertion fails on the shape-only kit for ${twin.plant}`).toThrow(new RegExp(`twin ${twin.plant}\\b`));
    }
  }, 120_000);
});

// #1725.52debd6c: "The geometry audit's scene scope (Geometry audit: scene, `support`) is reachable as a reading through
// `deep mcp`, as `deep_show`'s `audit` include or a `deep_query` row, whichever #411's surface already defines. It gives each 3D
// item's resting gap below it in m. A planted box 0.2 m above the slab reads 0.2 within 1e-6, and `deep-show run` gives the same
// number. The reading never passes a claim; `geometry.audit` through #1723 does."
//
// The surface is render-back's `audit` include, which the design's Render-back request and #411's deep_show already define
// (README: Assumed surfaces): the Claude Code session draws the red-box fixture with its box lifted 0.2 m off the slab, asking
// for `include: [issues, audit]`, and reads the box's resting gap from the reply's audit. `deep-show run`, the canvas core the
// hub runs, answers the same call with the same number. The reading is a reply, not a check: no verdict follows it.
import { afterEach, expect, test } from 'vitest';
import { AC, BOX, CLAUDE, DOC, LIFT, TEST_MS, brief, cleanup, draw, events, isObject, onCore, openWorld, redBox, showCall, type JsonObject } from './helpers.ts';

afterEach(cleanup, 60_000);

/** The resting gap the reply's audit gives `id`: its `support` row's `gap`, in m. */
function gapOf(reply: JsonObject, id: string, where: string): number {
  const audit = reply['audit'];
  const rows = isObject(audit) && Array.isArray(audit['support']) ? audit['support'].filter(isObject) : undefined;
  expect(rows, `${where}: the reply's audit reading gives each 3D item's resting gap (audit.support): audit is ${brief(audit)}`).toBeDefined();
  const row = rows!.find((r) => r['id'] === id);
  expect(typeof row?.['gap'], `${where}: the audit reading gives ${id}'s resting gap in m: ${brief(rows)}`).toBe('number');
  return row!['gap'] as number;
}

test(`${AC.gap} the scene audit's resting gap reads through deep mcp: a box 0.2 m above the slab reads 0.2, as deep-show run reads it`, async () => {
  const w = await openWorld();
  const before = (await events(w.hub)).length;
  const raised = redBox(LIFT);
  const reply = await draw(w, CLAUDE, DOC.a, raised, ['issues', 'audit']);
  const gap = gapOf(reply, BOX, 'through deep mcp');
  expect(Math.abs(gap - LIFT), `the box lifted ${LIFT} m reads ${gap} m`).toBeLessThanOrEqual(1e-6);

  const [run] = onCore([showCall(CLAUDE, DOC.a, raised, ['issues', 'audit'])]);
  const same = gapOf(run!, BOX, 'deep-show run');
  expect(Math.abs(same - gap), `deep-show run gives the same number: ${same} m beside ${gap} m`).toBeLessThanOrEqual(1e-9);

  expect(reply['result'], 'the reading passes nothing').not.toBe('PASS');
  const verdicts = (await events(w.hub)).slice(before).filter((e) => e.kind === 'verdict.made');
  expect(verdicts.map((e) => brief(e.data, 300)), 'the reading makes no verdict').toEqual([]);
}, TEST_MS);

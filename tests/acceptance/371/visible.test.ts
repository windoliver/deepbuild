// AC3: "Each deep_show snapshot reply carries a table of visible item IDs with their screen boxes, at most 200
// rows sorted by ID"
//
// asserts: a deep_show reply with a snapshot carries `visible`, rows `{id, box}`; its IDs are the items that
// draw (an item with `visible: false` is not a row), sorted by code point; each box is the item's box in the
// snapshot's pixels (within 1 px), scaling with the snapshot's size; with 250 visible items it holds 200 rows,
// sorted, each a different visible item with its box.

import { describe, expect, it } from 'vitest';
import { ALPHA, DOC, FULL, board, outcome, rect, run, scenario, show, sorted, useBuilds, useEvidence, visibleRows, type Row } from './helpers.ts';

const builds = useBuilds([FULL]);
const evidence = useEvidence();

const MAX_ROWS = 200;
const TOLERANCE_PX = 1;

function boxFailures(rows: Row[], boxes: Record<string, number[]>, scale: number): string[] {
  const out: string[] = [];
  for (const row of rows) {
    const want = boxes[row.id];
    if (!want) { out.push(`row ${row.id} is not an item that draws`); continue; }
    const scaled = want.map((v) => v * scale);
    if (row.box.some((v, k) => Math.abs(v - scaled[k]!) > TOLERANCE_PX)) out.push(`row ${row.id}'s box is ${JSON.stringify(row.box)}, not ${JSON.stringify(scaled)}`);
  }
  return out;
}

describe('AC3 each deep_show snapshot reply carries a table of visible item IDs with their screen boxes, at most 200 rows sorted by ID', () => {
  const boxes: Record<string, number[]> = { 'c-bar': [100, 40, 60, 30], 'a-head': [10, 10, 50, 20], 'b-foot': [20, 150, 280, 24] };
  const doc = board('Visible items', [320, 200], [
    rect('c-bar', 'Bar', boxes['c-bar']!, 'a0'),
    rect('a-head', 'Head', boxes['a-head']!, 'a1'),
    rect('b-foot', 'Foot', boxes['b-foot']!, 'a2'),
    rect('d-hidden', 'Hidden box', [200, 10, 40, 40], 'a3', { visible: false }),
  ]);

  it("AC3 a snapshot reply lists the items that draw, sorted by ID, each with its box in the snapshot's pixels", () => {
    const [reply] = run(builds.bin(FULL), scenario(evidence(), { [DOC.a]: 'main' }, [
      show(ALPHA.id, DOC.a, doc, { include: ['issues', 'pixels'], size: [320, 200] }),
    ]));
    expect(outcome(reply!), `the board is presented: ${JSON.stringify(reply).slice(0, 1200)}`).toBe('presented');
    const rows = visibleRows(reply!);
    expect(rows.map((r) => r.id), 'the visible items, sorted by ID; the hidden one is not a row').toEqual(['a-head', 'b-foot', 'c-bar']);
    expect(boxFailures(rows, boxes, 1), 'each row\'s box is its item\'s box on the 320 × 200 snapshot').toEqual([]);
  });

  it("AC3 the boxes are screen boxes: a snapshot at twice the document's size doubles them", () => {
    const [reply] = run(builds.bin(FULL), scenario(evidence(), { [DOC.a]: 'main' }, [
      show(ALPHA.id, DOC.a, doc, { include: ['issues', 'pixels'], size: [640, 400] }),
    ]));
    expect(outcome(reply!), `the board is presented: ${JSON.stringify(reply).slice(0, 1200)}`).toBe('presented');
    const rows = visibleRows(reply!);
    expect(rows.map((r) => r.id), 'the same rows at any size').toEqual(['a-head', 'b-foot', 'c-bar']);
    expect(boxFailures(rows, boxes, 2), 'each row\'s box on the 640 × 400 snapshot').toEqual([]);
  });

  it('AC3 with 250 visible items the table holds 200 rows, sorted by ID by code point, each a visible item with its box', () => {
    const many: Record<string, number[]> = {};
    for (let n = 1; n <= 250; n++) {
      const k = n - 1;
      many[`r-${n}`] = [8 + (k % 25) * 25, 8 + Math.floor(k / 25) * 38, 20, 30];
    }
    // Base-62 order keys with no zero digit, increasing with k.
    const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    const key = (k: number): string => `a${B62[1 + Math.floor(k / 61)]}${B62[1 + (k % 61)]}`;
    const items = Object.entries(many).map(([id, box], k) => rect(id, 'Cell', box, key(k)));
    const [reply] = run(builds.bin(FULL), scenario(evidence(), { [DOC.a]: 'main' }, [
      show(ALPHA.id, DOC.a, board('Many cells', [640, 400], items), { include: ['issues', 'pixels'], size: [640, 400] }),
    ]));
    expect(outcome(reply!), `the board is presented: ${JSON.stringify(reply).slice(0, 1200)}`).toBe('presented');
    const rows = visibleRows(reply!);
    expect(rows.length, 'at most 200 rows').toBe(MAX_ROWS);
    const ids = rows.map((r) => r.id);
    expect(ids, 'rows sorted by ID, by code point (r-10 before r-2)').toEqual(sorted(ids));
    expect(new Set(ids).size, 'each row a different item').toBe(MAX_ROWS);
    expect(boxFailures(rows, many, 1), 'each row\'s box').toEqual([]);
  });
});

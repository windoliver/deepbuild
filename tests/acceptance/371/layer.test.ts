// AC1: "An agent's `deep_show` scene appears as its own layer, outlined as the agent's"
//
// asserts: on `screen`, each agent's scene is exactly one layer owned by `{kind: agent, id: <its thread>}`, in
// the agent band, with `outline: true` and `name` its session's name; your layer of the same board is not
// outlined; `by_writer` puts the agent's items in that layer and none of them in yours.

import { describe, expect, it } from 'vitest';
import {
  ALPHA, BRAVO, DOC, FULL, arr, bands, board, obj, outcome, rect, run, scenario, show, str, strs, text, useBuilds, useEvidence,
  type JsonObject,
} from './helpers.ts';

const builds = useBuilds([FULL]);
const evidence = useEvidence();

/** A scene of parts: a path with a gradient fill and a stroke, turned and moved by its transform, text over it, a rect under it. */
const scene = (prefix: string, title: string): JsonObject => board(title, [640, 360], [
  rect(`${prefix}.back`, 'Backdrop', [0, 0, 320, 180], 'a0'),
  {
    id: `${prefix}.arrow`, kind: 'path@1', name: 'Arrow', order: 'a1',
    params: { d: 'M 0 0 L 80 0 L 80 40 Z', paint: { fill: { gradient: { kind: 'linear', stops: [{ at: 0, role: 'muted' }, { at: 1, role: 'ink' }] } }, stroke: { role: 'ink', width: 2 } } },
    at: { pos: [200, 100, 0], rot: [0, 0, 15] },
  },
  text(`${prefix}.note`, 'Note', 'Next step', [200, 160], 'a2'),
]);

/** Your board as the hub stored it: one layer of yours with one node. */
const yours: JsonObject = {
  format: 1, profile: 'board', title: 'Plan', description: 'Your plan board.', size: [640, 360],
  layers: { 'you-main': { writer: 'you:you', title: 'You', order: 'a0' } },
  items: { 'you.n1': { id: 'you.n1', kind: 'rect@1', name: 'Node one', order: 'a0', layer: 'you-main', params: { box: [16, 16, 120, 40], paint: { fill: { role: 'muted' } } } } },
};

function agentRow(rows: ReturnType<typeof bands>, thread: string, name: string, what: string): string {
  const own = rows.filter((b) => b.owner['kind'] === 'agent' && b.owner['id'] === thread);
  expect(own.length, `${what}: exactly one layer on screen is the agent's own (${thread}): ${JSON.stringify(rows)}`).toBe(1);
  const row = own[0]!;
  expect(row.band, `${what}: the agent's layer is in the agent band`).toBe('agent');
  expect(row.outline, `${what}: the agent's layer is outlined`).toBe(true);
  expect(row.name, `${what}: the outline shows the agent's name`).toBe(name);
  return row.layer;
}

describe("AC1 an agent's deep_show scene appears as its own layer, outlined as the agent's", () => {
  it("AC1 two agents' scenes, each on its own document, each appear as one layer of their own, outlined with that agent's name", () => {
    const replies = run(builds.bin(FULL), scenario(evidence(), { [DOC.a]: 'main', [DOC.b]: 'side' }, [
      show(ALPHA.id, DOC.a, scene('alpha', 'Alpha sketch')),
      show(BRAVO.id, DOC.b, scene('bravo', 'Bravo sketch')),
      { call: 'screen' },
    ]));
    expect(outcome(replies[0]!), `alpha's scene is presented: ${JSON.stringify(replies[0]).slice(0, 1500)}`).toBe('presented');
    expect(outcome(replies[1]!), `bravo's scene is presented: ${JSON.stringify(replies[1]).slice(0, 1500)}`).toBe('presented');
    const rows = bands(replies[2]!);
    const a = agentRow(rows, ALPHA.thread, ALPHA.name, "alpha's scene");
    const b = agentRow(rows, BRAVO.thread, BRAVO.name, "bravo's scene");
    expect(a, 'the two agents draw in two different layers').not.toBe(b);
  });

  it("AC1 an agent's scene on your board is its own layer beside yours: outlined as the agent's, while yours is not", () => {
    const replies = run(builds.bin(FULL), scenario(evidence(), { [DOC.a]: { panel: 'main', document: yours } }, [
      show(ALPHA.id, DOC.a, scene('alpha', 'Alpha sketch')),
      { call: 'screen' },
      { call: 'by_writer', doc: DOC.a },
    ]));
    expect(outcome(replies[0]!), `alpha's scene is presented on your board: ${JSON.stringify(replies[0]).slice(0, 1500)}`).toBe('presented');
    const rows = bands(replies[1]!);
    const layer = agentRow(rows, ALPHA.thread, ALPHA.name, "alpha's scene on your board");
    const mine = rows.filter((b) => b.owner['kind'] === 'you');
    expect(mine.length, `your layer is on screen once: ${JSON.stringify(rows)}`).toBe(1);
    expect(mine[0]!.outline, 'your layer is not outlined').toBe(false);
    expect(mine[0]!.layer, "your layer is not the agent's").not.toBe(layer);

    const writers = arr(obj(replies[2]!, 'by_writer')['writers'], 'by_writer: writers').map((w, i) => obj(w, `writers[${i}]`));
    const alpha = writers.find((w) => obj(w['writer'], 'writer')['kind'] === 'agent' && obj(w['writer'], 'writer')['id'] === ALPHA.thread);
    expect(alpha, `by_writer lists alpha: ${JSON.stringify(writers).slice(0, 1200)}`).toBeDefined();
    expect(str(alpha!['layer'], "alpha's layer"), "by_writer's layer for alpha is the one on screen").toBe(layer);
    expect(strs(alpha!['items'], "alpha's items").sort(), "alpha's layer holds alpha's scene").toEqual(['alpha.arrow', 'alpha.back', 'alpha.note']);
    const you = writers.find((w) => obj(w['writer'], 'writer')['kind'] === 'you');
    expect(strs(you?.['items'] ?? [], 'your items'), 'your layer holds only your node').toEqual(['you.n1']);
  });
});

// #1958: a document from another machine naming a pack version the hub's store lacks opens through the hub. The canvas core
// keeps that pack's instances and skips them with pack_missing; the hub no longer refuses the document whole first.
import { beforeAll, expect, it } from 'vitest';
import { onWorld, show, type World } from '../../../tests/acceptance/1731/helpers.ts';

let w: World;
beforeAll(async () => { w = await onWorld(); }, 600_000);
it('#1958 a document naming a pack version the hub lacks opens, its instance skipped with pack_missing naming the version', async () => {
  const { ran, reply } = await show(w, {
    format: 1, profile: 'board', title: 'From another machine', description: 'A board naming a pack version this hub never had.', size: [320, 200],
    packs: ['acme/shelf@9.9.9'],
    items: {
      b1: { id: 'b1', kind: 'shelf.bookcase@2', name: 'Bookcase', order: 'a0', params: { width: 1.2, levels: 3 }, at: { pos: [20, 20, 0] } },
      r1: { id: 'r1', kind: 'rect@1', name: 'Box', order: 'a1', params: { box: [200, 120, 40, 40], paint: { fill: { role: 'muted' } } } },
    },
  });
  expect(reply?.outcome, `${ran.stdout.slice(-1500)} ${ran.stderr.slice(-800)}`).toBe('presented');
  const text = JSON.stringify(reply);
  expect(text.includes('pack_missing') && text.includes('acme/shelf') && text.includes('9.9.9'), text.slice(0, 1500)).toBe(true);
}, 600_000);

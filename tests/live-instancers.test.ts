// #484's regression the blind suite doesn't reach: the suite draws through `view3d`, and `live` records its frame by
// another path. There, an instancer above 256 elements draws only once its cull runs before geometry (else its indirect
// draw's count stays 0, and it draws nothing), and an instances output draws only the rows its compact step kept (else
// the live view's first prepare, before its operators exist, leaves every row drawn). Each case counts the lit pixels
// of a `live` frame against the same document through `view3d`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { decodePng } from './acceptance/424/helpers.ts';
import {
  CROWD_SIZE, DARK_SKY, LOOK, box, crowdDoc, ortho, requireGpu, run, sceneDoc, unlit, useGpu, useOut, view3dCall, writeJson,
} from './acceptance/484/helpers.ts';

const bin = useGpu();
const dir = useOut();
const FRAMES = 200;

function litPixels(out: string, reply: unknown): number {
  const finals = [...JSON.stringify(reply).matchAll(/"final":"([0-9a-f]{64})"/g)];
  expect(finals.length, 'the frame wrote its final target').toBeGreaterThan(0);
  const { rgba } = decodePng(readFileSync(join(out, `${finals.at(-1)![1]!}.png`)));
  let lit = 0;
  for (let i = 0; i < rgba.length; i += 4) if (rgba[i]! > 40) lit += 1;
  return lit;
}

function compare(out: string, doc: string, size: [number, number]): void {
  const [view3d] = run(bin(), out, [view3dCall({ doc, size, targets: ['final'] })]);
  // A live session's layer and writer come from its connection, never the document.
  const live = JSON.parse(readFileSync(doc, 'utf8')) as { layers?: unknown; items: Record<string, { layer?: unknown }> };
  delete live.layers;
  for (const item of Object.values(live.items)) delete item.layer;
  const session = { session: 's', writer: 'agent:sess-alpha', doc: writeJson(out, 'live-doc', live as never), size };
  // A still scene draws its first frames alone, so every frame is captured and the last drawn is read.
  const capture = Array.from({ length: FRAMES }, (_, i) => i);
  const [reply] = run(bin(), out, [{ call: 'live', look: LOOK, fps: 60, frames: FRAMES, capture, report: ['hashes'], sessions: [session] }]);
  const want = litPixels(out, view3d);
  expect(want, 'the document draws through view3d').toBeGreaterThan(0);
  expect(litPixels(out, reply), 'live draws what view3d draws').toBe(want);
}

it('a live view draws a culled instancer', () => {
  requireGpu();
  const out = dir();
  const ids = Array.from({ length: 1000 }, (_, i) => i);
  const pos = ids.map((i) => [-25 + (i % 50), -10 + Math.floor(i / 50), 0]);
  compare(out, writeJson(out, 'grid', sceneDoc('grid-live', [640, 360], {
    cam: ortho(60), sky: DARK_SKY, tree_mat: unlit([0.8, 0.4, 0.2]),
    tree: box([0.5, 0.5, 0.5], [0, 0, 0], { material: 'tree_mat', visible: false }),
    trees: { kind: 'instance@1', params: { of: ['tree'], ids, pos } },
  })), [640, 360]);
}, 600_000);

it('a live view draws only the rows an instances output kept', () => {
  requireGpu();
  const out = dir();
  compare(out, crowdDoc(bin(), out), CROWD_SIZE);
}, 600_000);

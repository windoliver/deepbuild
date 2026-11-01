// Criterion 8 (#140.66011009): a render-back snapshot taken while the app shows the document has the same pixel
// hash as the one the headless worker takes with the app closed, for the same revision, view, size and t.
//
// While the app shows it: `deep-show live`, whose `live.after` plays a `render_back` call once the real, shown
// window has presented the document's revision. With the app closed: `deep-show run` in a later process, which
// opens no window, playing the same call (README: The live options; render_back). The pixel hash is the
// SHA-256 of the snapshot's pixels as 8-bit RGBA, rows top-down, read here from the evidence store's PNG.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEEP_SHOW, FIGURE, FILM, FRAME, SESSION, answers, arr, colors, decodePng, evidenceFile, isBlank, liveRun, num, obj, pixelHash, replies,
  showScenario, str, useBuilds, useDir, type JsonObject,
} from './helpers.ts';

const builds = useBuilds([DEEP_SHOW]);
const dir = useDir();

const CASES: { name: string; doc: () => JsonObject; id: string; t: string; size: [number, number] }[] = [
  { name: 'the figure at twice its size', doc: FIGURE, id: 'fig', t: '0s', size: [960, 540] },
  { name: 'the film at 1.25 s', doc: FILM, id: 'film', t: '1.25s', size: [480, 270] },
];

function snapshotOf(reply: JsonObject, evidence: string, what: string): { hash: string; w: number; h: number; rev: number } {
  const snaps = arr(reply['snapshots'], `${what}: snapshots`);
  expect(snaps.length, `${what}: one snapshot`).toBe(1);
  const s = obj(snaps[0], `${what}: snapshots[0]`);
  const image = decodePng(evidenceFile(evidence, str(s['sha256'], `${what}: sha256`), `${what}'s snapshot`));
  expect([image.width, image.height], `${what}: the PNG is the snapshot's size`).toEqual([num(s['w'], 'w'), num(s['h'], 'h')]);
  expect(isBlank(image) || colors(image) < 3, `${what}: the snapshot shows the document (not blank, several colors)`).toBe(false);
  return { hash: pixelHash(image), w: image.width, h: image.height, rev: num(reply['rev'], `${what}: rev`) };
}

describe('#140.66011009 (C8) render-back: the snapshot taken while the app shows the document equals the headless worker\'s with the app closed', () => {
  for (const c of CASES) {
    it(`#140.66011009 (C8) ${c.name}: the same pixel hash for the same revision, view, size and t`, () => {
      const bin = builds.bin(DEEP_SHOW);
      const call = { call: 'render_back', session: SESSION, doc: c.id, rev: 1, t: c.t, size: c.size, include: ['pixels'], at: 10 * FRAME };

      const shownEvidence = join(dir(), 'shown'); mkdirSync(shownEvidence);
      const { live } = liveRun(bin, showScenario(shownEvidence, c.doc(), c.id, { live: { after: [{ after_ms: 500, call }], hold_ms: 2000 } }));
      const after = arr(live['after'], 'live.after');
      expect(after.length, 'one after-call answered').toBe(1);
      const a = obj(after[0], 'live.after[0]');
      expect(obj(a['showing'], 'live.after[0].showing')[c.id], 'the app\'s window was showing the document\'s revision 1 when the snapshot was taken').toBe(1);
      expect(num(a['presented'], 'live.after[0].presented'), 'the window had presented it').toBeGreaterThanOrEqual(1);
      const app = snapshotOf(obj(a['reply'], 'live.after[0].reply'), shownEvidence, `${c.name}, app showing`);

      // The app has exited; the headless worker runs in a process of its own.
      const closedEvidence = join(dir(), 'closed'); mkdirSync(closedEvidence);
      const [run] = answers(bin, ['run'], [showScenario(closedEvidence, c.doc(), c.id, {}, [call])]);
      const headless = snapshotOf(obj(replies(run!, 'deep-show run')[1], 'the render_back reply'), closedEvidence, `${c.name}, app closed`);

      expect({ rev: app.rev, w: app.w, h: app.h }, 'the same revision and size').toEqual({ rev: 1, w: c.size[0], h: c.size[1] });
      expect(headless.rev, 'the same revision').toBe(app.rev);
      expect(headless.hash, `${c.name}: the pixel hash with the app closed equals the one taken while it showed the document`).toBe(app.hash);
    }, 900_000);
  }
});

// #399.8c38ebbf: Placed labels never overlap each other or a status mark; labels that don't fit fold and are counted.
// #399.b6d3c9ba: Label placement at a zoom bucket is the same whether the view zoomed in, zoomed out or got there by a
// seek, and labels fade between buckets by zoom, never by time.
//
// `deep-canvas-render labels` (README): the view's label placement at each stop of a camera path, in view px.
import { describe, expect, it } from 'vitest';
import {
  CROWD_STATUS, accepted, cleanLook, crowdDoc, fadeDoc, labelSteps, overlap, show, useBins, type JsonObject, type Step,
} from './helpers.ts';

const render = useBins(['deep-canvas-render']);
const SECOND = 705_600_000;

function steps(doc: JsonObject, path: { zoom: number; t?: number }[]): Step[] {
  const out = accepted(render('deep-canvas-render'), ['labels'], { doc, look: cleanLook(render('deep-canvas-render')), path }, 'labels');
  const s = labelSteps(out);
  expect(s.length, 'one step per stop of the path').toBe(path.length);
  return s;
}

describe('#399.8c38ebbf placed labels never overlap each other or a status mark; labels that don\'t fit fold and are counted', () => {
  it('#399.8c38ebbf thirty labels crowded around a status mark: the placed ones overlap nothing, the rest fold and are counted', () => {
    const [step] = steps(crowdDoc(), [{ zoom: 1 }]);
    const ids = Array.from({ length: 30 }, (_, k) => `l${k}`);
    expect(Object.keys(step!.labels).sort(), 'every label is placed or folded').toEqual([...ids].sort());
    const placed = ids.filter((id) => step!.labels[id]!.state === 'placed');
    const folded = ids.filter((id) => step!.labels[id]!.state === 'folded');
    // The cluster can't hold thirty 56 × 14 px labels, so a placer that never folds overlaps here.
    expect(folded.length, 'labels that don\'t fit fold').toBeGreaterThan(0);
    expect(placed.length, 'and some place').toBeGreaterThan(0);
    const pairs: string[] = [];
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
      if (overlap(step!.labels[placed[i]!]!.box!, step!.labels[placed[j]!]!.box!)) pairs.push(`${placed[i]} and ${placed[j]}`);
    }
    expect(pairs, 'no two placed labels overlap').toEqual([]);
    expect(placed.filter((id) => overlap(step!.labels[id]!.box!, CROWD_STATUS)), `no placed label overlaps the status mark at ${show(CROWD_STATUS)}`).toEqual([]);
    // A placer that drops labels without counting them fails here.
    expect(step!.folded, 'the folded labels are counted').toBe(folded.length);
  });
});

describe('#399.b6d3c9ba a zoom bucket\'s placement is the same however the view got there, and labels fade by zoom, never by time', () => {
  it('#399.b6d3c9ba zoomed in, zoomed out and sought to zoom 0.6 place the labels alike, and a fade at one zoom holds still over time', () => {
    const doc = fadeDoc();
    const zoomIn = steps(doc, [{ zoom: 0.25 }, { zoom: 0.35 }, { zoom: 0.5 }, { zoom: 0.6 }]).at(-1)!;
    const zoomOut = steps(doc, [{ zoom: 2 }, { zoom: 1.41 }, { zoom: 1 }, { zoom: 0.71 }, { zoom: 0.6 }]).at(-1)!;
    const seek = steps(doc, [{ zoom: 0.6 }])[0]!;
    const states = Object.values(seek.labels).map((l) => l.state);
    expect(states.includes('placed') && states.includes('folded'), 'at zoom 0.6 some labels place and some fold, so the placement has choices to make').toBe(true);
    expect([zoomIn.bucket, zoomOut.bucket], 'the three paths end in one bucket').toEqual([seek.bucket, seek.bucket]);
    // A placement that keeps the previous frame's spots, rather than the chain from the base zoom, differs here.
    expect(zoomIn.labels, 'zoomed in, the placement equals the seek\'s').toEqual(seek.labels);
    expect(zoomOut.labels, 'zoomed out, the placement equals the seek\'s').toEqual(seek.labels);

    // Near the bucket edge at zoom 1, some label is part way through its fade.
    const scan = [0.84, 0.89, 0.93, 0.96, 0.98, 0.99, 0.995, 0.998, 1, 1.002, 1.005, 1.01, 1.02, 1.04, 1.07, 1.12, 1.19];
    const swept = steps(doc, scan.map((zoom) => ({ zoom, t: 0 })));
    const fading = swept.flatMap((s) => Object.entries(s.labels).filter(([, l]) => l.opacity > 0 && l.opacity < 1).map(([id]) => ({ zoom: s.zoom, id })));
    // A program with no fade (or one only by time, at t 0) has no label part way here.
    expect(fading.length, 'labels fade between buckets by zoom: some label is part way at a zoom near the edge').toBeGreaterThan(0);
    const z = fading[0]!.zoom;
    const at = swept.find((s) => s.zoom === z)!;
    const held = steps(doc, [{ zoom: z, t: 0 }, { zoom: z, t: SECOND / 2 }, { zoom: z, t: 5 * SECOND }]);
    // A fade by time since the bucket changed gives other opacities as t moves on at the same zoom.
    for (const s of held) {
      expect(Object.fromEntries(Object.entries(s.labels).map(([id, l]) => [id, l.opacity])), `at zoom ${z}, every label's opacity is the same at any time and however it got there`)
        .toEqual(Object.fromEntries(Object.entries(at.labels).map(([id, l]) => [id, l.opacity])));
    }
  });
});

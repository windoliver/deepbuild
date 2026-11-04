// AC4: "Seeking a film whose ops animate gives the same tessellation and pixel hash as playing to it on the same
// machine, and a still path rebuilds nothing"
//
// The Proof line's "a loader and a radial burst that seek and play alike": fixtures/parity/2d/loader.film (a ring
// whose trim window grows, follows and travels round it, with an arrow at its end) and burst.film (a petal fanned by
// a repeater whose copies grow from 1 to 12, after a pucker that deepens). A play is one process drawing every frame
// at 30 fps from 0 in order (`path` with every time on one line, and `raster` with one line per frame); a seek is a
// fresh process asked for one time. Equal means the same `tessellation` digest and sub-paths, and the same RGBA
// bytes. "Rebuilds nothing" is `path`'s `rebuilt`: false on every frame after a process's first for an item whose
// geometry and ops are still, even while it moves (Path: ops: "Tessellation is cached by content key, plus t only
// when an op's field is animated").
import { describe, expect, it } from 'vitest';
import {
  TIMEOUT, clone, expectClean, firstDifference, fixture, fl, inked, items, keyed, none, obj, pathFrames, pathItem,
  raster, rasterPlay, scratch, useRenderBinary, type JsonObject,
} from './helpers.ts';

useRenderBinary();
const dir = scratch('seek-play');

/** Frames at 30 fps from 0 to 1.5 s, and 1.234 s between two of them. */
const PLAY = [...Array.from({ length: 46 }, (_, k) => fl(k / 30)), fl(1.234)].sort((a, b) => a - b);
const SEEKS = [fl(0.5), fl(1), fl(1.234), fl(1.5)];

function seekEqualsPlay(name: string, id: string): void {
  const doc = fixture(name);
  expectClean(doc, name);
  const play = pathFrames({ doc, item: id, times: PLAY }, `${name}: the play`);
  const failures: string[] = [];
  for (const t of SEEKS) {
    const seek = pathFrames({ doc, item: id, times: [t] }, `${name}: the seek to ${t}`)[0]!;
    const played = play[PLAY.indexOf(t)]!;
    if (seek.tessellation !== played.tessellation) failures.push(`${name} at ${t} flicks: the seek's tessellation ${seek.tessellation} is not the play's ${played.tessellation}`);
    if (JSON.stringify(seek.subpaths) !== JSON.stringify(played.subpaths)) failures.push(`${name} at ${t} flicks: the seek's sub-paths are not the play's`);
  }
  none(failures, `${name}: seeking against playing, tessellations`);
  const digests = new Set(SEEKS.map((t) => play[PLAY.indexOf(t)]!.tessellation));
  expect(digests.size, `${name}'s ops animate: its tessellation differs at each of the four times`).toBe(SEEKS.length);

  const drawn = rasterPlay(dir, doc, PLAY, `${name}: the play`);
  for (const t of SEEKS) {
    const seek = raster(dir, doc, `${name}: the seek to ${t}`, t);
    expect(firstDifference(seek.image, drawn[PLAY.indexOf(t)]!.image), `${name} at ${t} flicks: the seek draws the play's pixels`).toBeNull();
    expect(inked(seek.image), `${name} at ${t} flicks draws its marks`).toBeGreaterThan(200);
  }
}

describe('AC4 seeking equals playing, and a still path rebuilds nothing', () => {
  it('AC4 loader.film: seeking to 0.5, 1, 1.234 and 1.5 s gives the same tessellation and pixels as playing to them', () => {
    seekEqualsPlay('loader.film', 'loader');
  }, TIMEOUT);

  it('AC4 burst.film: seeking to 0.5, 1, 1.234 and 1.5 s gives the same tessellation and pixels as playing to them', () => {
    seekEqualsPlay('burst.film', 'burst');
  }, TIMEOUT);

  it('AC4 a still path rebuilds nothing while the loader plays beside it, and neither does a path with still ops that moves', () => {
    const doc: JsonObject = clone(fixture('loader.film'));
    items(doc)['spinner'] = pathItem('spinner', 'a02', 'M 20 220 L 60 220', { ops: [{ trim: { start: 0, end: 0.5 } }] });
    obj(doc['channels'], 'channels')['spinner-x'] = keyed('items/spinner/at/pos/0', [[0, 0], [2, 100]]);
    expectClean(doc, 'the loader with a moving spinner');
    const failures: string[] = [];
    for (const id of ['hub', 'spinner']) {
      const frames = pathFrames({ doc, item: id, times: PLAY }, `${id} during the play`);
      if (!frames[0]!.rebuilt) failures.push(`${id}: the process's first frame reports no build`);
      frames.slice(1).forEach((f) => {
        if (f.rebuilt) failures.push(`${id} rebuilt its tessellation at ${f.t} flicks`);
        if (f.tessellation !== frames[0]!.tessellation) failures.push(`${id}'s tessellation changed at ${f.t} flicks`);
      });
    }
    const loader = pathFrames({ doc, item: 'loader', times: PLAY }, 'the loader during the play');
    loader.slice(1).forEach((f) => { if (!f.rebuilt) failures.push(`the loader, whose trim's offset moves every frame, reused its tessellation at ${f.t} flicks`); });
    none(failures, 'what each frame of the play rebuilt');
  }, TIMEOUT);
});

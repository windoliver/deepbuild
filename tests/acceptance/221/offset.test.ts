// AC6 (its last clause): "a placed item with a keyed `at.pos` lands at its relation's place plus that offset within
// 0.5 px at 120 sampled times"
//
// The tag is placed beside a ball that keyed channels move (side e, the default gap 16, align center), and its own
// at.pos is keyed too. Its expected box is computed from the fixture's numbers alone: the ball's east side and centre,
// plus 16, plus the tag's keyed offset. The same document without the tag's channels shows the relation's place alone.
// No upstream test (the oracle page: criterion 6 is ours).
import { describe, expect, it } from 'vitest';
import { FLICKS, PX, TIMEOUT, clone, evenTimes, expectClean, fmt, fmtBox, geometryAt, loadDoc, none, scratch, trackAt, trackOf, useRenderBinary, type Box, type JsonObject } from './helpers.ts';

useRenderBinary();
const store = scratch('store');

describe('AC6 at.pos adds after the relation', () => {
  it('AC6 a placed item with a keyed at.pos lands at its relation\'s place plus that offset within 0.5 px at 120 sampled times', () => {
    const doc = loadDoc('offset.json');
    // The relation's place alone: the same document, the tag's at.pos channels removed.
    const still = clone(doc);
    still['id'] = 'rel-221-offset-free';
    const channels = still['channels'] as JsonObject;
    delete channels['tag-x'];
    delete channels['tag-y'];
    expectClean([doc, still], store);
    const times = evenTimes(4 * FLICKS, 120);
    const [bx, by, tx, ty] = ['ball-x', 'ball-y', 'tag-x', 'tag-y'].map((c) => trackOf(doc, c));
    const nudged = geometryAt(doc, 'tag', store, times);
    const placed = geometryAt(still, 'tag', store, times);
    const failures: string[] = [];
    times.forEach((t, k) => {
      const east = 250 + trackAt(bx!, t);
      const ballCy = 540 + trackAt(by!, t);
      const place: Box = [east + 16, ballCy - 20, 100, 40];
      const offset = [trackAt(tx!, t), trackAt(ty!, t)];
      const want: Box = [place[0] + offset[0]!, place[1] + offset[1]!, 100, 40];
      const got = nudged[k]!.box;
      if (want.some((v, i) => Math.abs(v - got[i]!) > PX)) failures.push(`at ${t} flicks: the nudged tag is at ${fmtBox(got)}, want the place ${fmtBox(place)} plus (${offset.map(fmt).join(', ')}) = ${fmtBox(want)}`);
      const alone = placed[k]!.box;
      if (place.some((v, i) => Math.abs(v - alone[i]!) > PX)) failures.push(`at ${t} flicks: without its at.pos channels the tag is at ${fmtBox(alone)}, not the relation's place ${fmtBox(place)}`);
    });
    none(failures, 'the relation, then at.pos');
    // The offset is non-zero over most of the run, so a channel ignored on a placed item can't pass.
    expect(times.filter((t) => Math.abs(trackAt(tx!, t)) > 1 || Math.abs(trackAt(ty!, t)) > 1).length).toBeGreaterThan(100);
  }, TIMEOUT);
});

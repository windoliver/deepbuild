// #1721: through a running hub with no world file, the document an agent drew as a whole revision takes patches as #96 defines
// them: the drawing session's, a second session's in a writer layer of its own, and one sent after a hub restart.
import { describe, expect, it } from 'vitest';
import { AC, BOX, CREATE, MOVE, SECOND, TEST_MS, aboutDoc, draw, events, expectShiftedRight, patched, readDoc, readEvidence, restartHub, t26, t96, useWorld, visibleBox } from './helpers.ts';

describe('a patch to the document the session drew', () => {
  const world = useWorld('first');

  it(`${AC.patch} a session draws a one-box scene as a whole revision, then patches the same doc ID on base 1: applied at rev 2, and a render-back at rev 2 shows the box's visible box shifted right against rev 1's`, async () => {
    const [first] = world().sessions;
    const doc = t26.ulid();
    await draw(first!, doc);
    const before = await visibleBox(first!, doc, 1, BOX);
    await patched(first!, doc, 1, [MOVE], 2);
    expectShiftedRight(before, await visibleBox(first!, doc, 2, BOX), 'a render-back of revision 2');
  }, TEST_MS);
});

describe('a second session\'s patch', () => {
  const world = useWorld('first', 'second');

  it(`${AC.layers} a second session's patch to that document lands in its own writer layer, and read lists both layers`, async () => {
    const w = world();
    const [first, second] = w.sessions;
    expect(second!.writer, 'two sessions, two writers').not.toBe(first!.writer);
    const doc = t26.ulid();
    await draw(first!, doc);
    await patched(second!, doc, 1, [CREATE], 2);
    const read = await readDoc(w, doc);
    expect(read.rev, 'read is of the revision the patch made').toBe(2);
    const layers = [first!, second!].map((s) => t96.layerOf(read.document, s.writer));
    expect(t96.writerOf(read.document, SECOND), 'the second session\'s item is in the second session\'s layer').toBe(second!.writer);
    expect(t96.writerOf(read.document, BOX), 'the first session\'s box is in the first session\'s layer still').toBe(first!.writer);
    for (const layer of layers) expect(Object.keys(read.files), `read's files list layer ${layer}`).toContain(layer);
    for (const id of [BOX, SECOND]) expect(read.draws, `${id} draws`).toContain(id);
  }, TEST_MS);
});

describe('a hub restart between the revision and the patch', () => {
  const world = useWorld('first');

  it(`${AC.restart} the hub is stopped and started again on the same home after the whole revision: the patch is still applied at rev 2, from the record, and a render-back at rev 2 draws the moved box`, async () => {
    const w = world();
    const [first] = w.sessions;
    const doc = t26.ulid();
    await draw(first!, doc);
    const before = await visibleBox(first!, doc, 1, BOX);
    const recorded = async () => aboutDoc(await events(w.hub), doc).filter((e) => e.kind === 'doc.patched');
    const [revision] = await recorded();
    expect(revision?.data.rev, 'the record holds revision 1').toBe(1);
    await readEvidence(w.home, String(revision!.data.hash));

    await restartHub(w);
    // The agent's process lived through the restart; its next hook comes before its next call, as an agent's does.
    await first!.stand.hook(w.hub, 'PreToolUse');
    const id = await patched(first!, doc, 1, [MOVE], 2);
    expectShiftedRight(before, await visibleBox(first!, doc, 2, BOX), 'a render-back of revision 2 after the restart');
    const newest = (await recorded()).at(-1);
    expect([newest?.data.rev, newest?.data.patch], 'the record\'s newest revision is the one the patch made').toEqual([2, id]);
  }, TEST_MS);
});

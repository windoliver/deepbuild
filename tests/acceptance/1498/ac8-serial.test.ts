// AC8: a synthetic input without a serial writes nothing to the clipboard, and no agent tool returns the selection
// (README, AC8). Three copy paths, one page: kit text (a failure line), a document's text and a cell grid.
import { describe, expect, it } from 'vitest';
import { checkArguments } from '../../../packages/hub/src/tools.ts';
import {
  acrossString, carets, cellPoint, copyFailure, doc, FAILURE_LINE, gridShows, jsonDifference, type Obj, openTerminalTab, type Point, Replica,
  SESSION, TAG, textOf, useDrive, wroteFailure,
} from './helpers.ts';

useDrive();

const NOTE = doc('note');
const TEXT = textOf(NOTE, 'dd-note');
const DOC_FROM = TEXT.indexOf('rose');
const DOC_TO = TEXT.indexOf('held') + 'held'.length;
const SIZE: [number, number] = [40, 4];
const GRID_ROW = 'Uploaded harbor assets';

interface Surface { name: string; expected: string; select: (r: Replica) => Promise<{ from: Point; to: Point; mods: string[] }> }
const SURFACES: Surface[] = [
  { name: 'the failure line (kit text)', expected: FAILURE_LINE, select: async (r) => ({ ...(await acrossString(r, FAILURE_LINE)), mods: [] }) },
  { name: 'the note (a document\'s text)', expected: TEXT.slice(DOC_FROM, DOC_TO), select: async (r) => ({ ...(await carets(r, 'dd-note', DOC_FROM, 'dd-note', DOC_TO)), mods: ['alt'] }) },
  {
    name: 'the terminal grid',
    expected: GRID_ROW.slice(0, 8),
    select: async (r) => ({ from: await cellPoint(r, SIZE, 0, 1, 'start'), to: await cellPoint(r, SIZE, 7, 1, 'end'), mods: [] }),
  },
];

/** What an agent's `see` returns, less where the keyboard is, which a press may move. */
const seen = (reply: Obj): Obj => {
  const rest: Obj = { ...(reply.snapshot as Obj) };
  delete rest.focus;
  return rest;
};

describe(`${TAG.ac8} AC8: a synthetic input without a serial writes nothing, and no agent tool returns the selection`, () => {
  it('your selection copies only with your ⌘C, and what an agent sees and the hub gets hold none of it', async () => {
    const r = await Replica.launch();
    await r.show(SESSION.fail, NOTE);
    await r.terminal(SESSION.fail, { size: SIZE, output: `Deploy log for harbor\r\n${GRID_ROW}\r\n` });
    await r.openSession(SESSION.fail);
    await r.visible({ text: FAILURE_LINE }, 'the failure line');
    await r.visible({ item: 'dd-note' }, 'the note');
    await openTerminalTab(r);
    await gridShows(r, 1, GRID_ROW);
    const failures: string[] = [];

    for (const surface of SURFACES) {
      const marker = `dd1498-ac8-${surface.name}`;
      const { from, to, mods } = await surface.select(r);
      await r.mark(marker);
      await r.hover(to);
      const before = seen(await r.see());
      await r.drag(from, to, 'hid', mods);
      // An agent's see of the window holds nothing of the selection: the snapshot is as it was.
      const changed = jsonDifference(before, seen(await r.see()));
      if (changed) failures.push(`${surface.name}: your selection changed what an agent's see returns, at ${changed}`);
      // A synthetic ⌘C carries no serial and writes nothing.
      const synthetic = wroteFailure(`${surface.name}: a synthetic ⌘C, with no serial`, marker, await r.copy('synthetic', marker));
      if (synthetic) failures.push(synthetic);
      // Your ⌘C does, so the selection was live and only the serial differed.
      const yours = copyFailure(`${surface.name}: your ⌘C after the synthetic one`, surface.expected, await r.copy('hid', marker));
      if (yours) failures.push(yours);
    }

    // Nothing the app sent its hub, where agents' tools read, holds a selection's text.
    const calls = JSON.stringify((await r.see()).hub ?? []);
    for (const surface of SURFACES) if (calls.includes(JSON.stringify(surface.expected).slice(1, -1))) failures.push(`the app sent its hub ${surface.name}'s selected text: ${calls.slice(0, 600)}`);
    // An agent's deep_drive can neither read the replica's clipboard nor give its input a serial.
    for (const [what, call] of [
      ['a clipboard read', { call: 'clipboard', replica: 'replica:1x1' }],
      ['an act with source hid', { call: 'act', replica: 'replica:1x1', act: { kind: 'press', keys: 'cmd-c', source: 'hid' } }],
    ] as const) {
      let refused = false;
      try {
        checkArguments('deep_drive', call);
      } catch {
        refused = true;
      }
      if (!refused) failures.push(`the hub's deep_drive tool takes ${what} from an agent (packages/hub/src/tools.ts)`);
    }

    expect(failures).toEqual([]);
  });
});

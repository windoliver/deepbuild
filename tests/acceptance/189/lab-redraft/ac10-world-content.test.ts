// Criterion 10: "A lab with a world and logic, saved at step 1,800, after a fix that moves one static wall of its world
// and keeps its program's layout, is refused, naming the world; a planted binding that leaves worlds out of the content
// opens it with the wall where the save had it while the document draws it moved, and fails, naming the world"
//
// The lab (helpers: labWorld) is saved at step 1,800 by `deep-show` in the full set, its wall's centre at x 12.2; the
// fix moves the wall to x 12.7 and changes nothing else, so the program, and with it the layout (it exports none, so
// its layout is its program hash), stays. Each save is written by one process and opened by another, as the app quit
// and reopened. The planted binding is `--planted content_leaves_out_worlds`, given to the process that writes the save
// and the one that opens it. "Opens it with the wall where the save had it while the document draws it moved" is read
// from the opened world's bodies (README: Opened's `worlds`) against the document's poses: the judge `judgeStatics`,
// which passes the real program's straight open of the unmoved lab and must fail the planted one, naming the world.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, MOVED_WALL_X, SAVE_STEP, TIMEOUT, WALL, WALL_X, WORLD, arr, caughtNaming, copyOf, judgeStatics, labDoc, none, obj,
  openSave, openedOf, saveFiles, show, useBuilds, useFolders, vec3, writeSave, type JsonObject, type JsonValue, type Written,
} from './helpers.ts';

const bins = useBuilds(['full']);
const folder = useFolders();

let evidence = '';
const store = (): string => (evidence ||= folder());
let docs: { before: JsonObject; moved: JsonObject } | undefined;
/** The lab as saved, and after the fix that moves its wall. */
function labs(): { before: JsonObject; moved: JsonObject } {
  if (docs) return docs;
  const before = labDoc(bins('full'), store());
  const moved = labDoc(bins('full'), store(), MOVED_WALL_X);
  const program = (d: JsonObject): unknown => obj(obj(obj(d['items'], 'items')['rules'], 'items.rules')['params'], 'rules.params')['program'];
  expect(program(moved), 'the fix keeps the program, so its layout').toBe(program(before));
  docs = { before, moved };
  return docs;
}
let written: Written | undefined;
const saved = (): Written => (written ??= writeSave(bins('full'), store(), labs().before, folder(), `the lab saved at step ${SAVE_STEP}`));
const wallOf = (worlds: JsonObject, what: string): number[] => vec3(obj(obj(worlds[WORLD], `${what}: worlds.${WORLD}`)[WALL], `${what}: worlds.${WORLD}.${WALL}`)['pos'], `${what}: the wall's position`);

describe(`${AC[10]} a save binds each world its state holds, by hash`, () => {
  it(`${AC[10]} after a fix that moves one static wall of its world and keeps its program's layout, the lab's save at step ${SAVE_STEP} is refused, naming the world`, () => {
    const w = saved();
    const dir = copyOf(w.dir, join(folder(), 'saves'));
    const r = openSave(bins('full'), store(), labs().moved, dir, 'the save opened after the wall moved').reply;
    expect([r['ok'], r['code'], r['save']], `the save is refused: ${show(r, 2500)}`).toEqual([false, 'save_refused', w.hash]);
    const differs = arr(r['differs'], 'the refusal\'s differs').map((d, i) => obj(d, `differs[${i}]`));
    expect(differs.filter((d) => d['what'] !== 'content').map((d) => show(d)), 'only the content differs: the layout and the module set are the save\'s').toEqual([]);
    expect(differs.some((d) => d['what'] === 'content' && d['world'] === WORLD), `the refusal names the world ${WORLD}: ${show(differs as JsonValue[])}`).toBe(true);
    const files = saveFiles(dir);
    expect([...files.keys()], 'the slot keeps its save').toEqual([w.hash]);
    expect(files.get(w.hash)?.equals(w.bytes), 'with its bytes as they were').toBe(true);
  }, TIMEOUT);

  it(`${AC[10]} a planted binding that leaves worlds out of the content (content_leaves_out_worlds) opens the save with the wall where the save had it while the document draws it moved, and fails, naming the world`, () => {
    const { before, moved } = labs();
    // The judge passes the real program: the save opened straight in the lab it was written in holds every static body where the document draws it.
    const real = openedOf(openSave(bins('full'), store(), before, copyOf(saved().dir, join(folder(), 'saves')), 'the save reopened in the unmoved lab').reply, 'the save reopened in the unmoved lab');
    expect(real.via, 'the save reopens straight in the lab it was written in').toBe('straight');
    none(judgeStatics(real.worlds, before, WORLD), 'the reopened world against the document');

    const wp = writeSave(bins('full'), store(), before, folder(), 'the lab saved under the planted binding', 'content_leaves_out_worlds');
    const p = openedOf(openSave(bins('full'), store(), moved, copyOf(wp.dir, join(folder(), 'saves')), 'the planted binding\'s open after the wall moved', 'content_leaves_out_worlds').reply, 'the planted binding\'s open');
    expect(p.via, 'the planted binding opens the save straight').toBe('straight');
    const at = wallOf(p.worlds, 'the planted binding\'s open');
    expect(Math.abs(at[0]! - WALL_X) < 1e-4 && Math.abs(at[1]! - 1) < 1e-4, `the opened world holds the wall where the save had it, x ${WALL_X}; it holds it at ${show(at)}`).toBe(true);
    const drawn = obj(obj(obj(obj(moved['worlds'], 'worlds')[WORLD], WORLD)['bodies'], 'bodies')[WALL], WALL);
    expect(vec3(obj(drawn['pose'], 'the moved wall\'s pose')['pos'], 'the moved wall\'s position')[0], 'while the document draws it moved').toBe(MOVED_WALL_X);
    caughtNaming(judgeStatics(p.worlds, moved, WORLD), [`world ${WORLD}`, WALL], 'the planted binding\'s opened world against the document');
  }, TIMEOUT);
});

// Scope: the same views rendered at the merge base beside the change, as the proof for a change that promises nothing
// visible changes. A merge base is another build and, for a panel, another copy of its files, so `ui_check.base` names
// them: `drive`, a deep-drive built at the merge base, and `panel`, the panel's folder there. Here `drive` is a wrapper
// around this checkout's binary that leaves a mark when it runs and, for the wrong program, plants a different row; the
// panel at the base is a real copy of the fixture, with or without a word changed. The pairs of PNGs are compared here,
// pixel by pixel, whatever the check says about them.
import { chmodSync, cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DRIVE_BIN, buildDrive, cleanup, requireMacos, tempDir, type Obj } from './helpers.ts';
import { CLEAN, CLEAN_PANEL, ROW_FILE, SIDEBAR, STRESS_FILE, checked, differing, shotOf, viewOf } from './ui-helpers.ts';

afterEach(cleanup, 60_000);

const PAIR_KEYS = ['path', 'sha256', 'same'];

/** A deep-drive "built at the merge base": this binary, leaving a mark, with `plant` when given. */
function baseDrive(plant?: string): { drive: string; mark: string } {
  buildDrive();
  const dir = tempDir();
  const drive = join(dir, 'base-drive.sh');
  const mark = join(dir, 'ran');
  writeFileSync(drive, `#!/bin/sh\necho ran >> '${mark}'\n${plant ? `DEEP_DRIVE_PLANT='${plant}' ` : ''}exec '${DRIVE_BIN}' "$@"\n`);
  chmodSync(drive, 0o755);
  return { drive, mark };
}

/** The panel's folder as it stood at the merge base: a copy, with `words.js` rewritten when given. */
function panelAtBase(words?: string): string {
  const dir = join(tempDir(), 'audit-clean');
  cpSync(CLEAN_PANEL, dir, { recursive: true });
  if (words) writeFileSync(join(dir, 'words.js'), words);
  return dir;
}

/** Each render against its pair at the merge base: both files real, and `same` what the pixels say. */
function pairs(view: Obj): { same: boolean; differs: number }[] {
  return (view.renders as Obj[]).map((r) => {
    expect(r.base, `the ${r.theme} ${r.size.join('x')} render stands beside the merge base's: ${JSON.stringify(r).slice(0, 300)}`).toBeTruthy();
    expect(Object.keys(r.base as Obj), 'with its file, its hash and whether they match').toEqual(expect.arrayContaining(PAIR_KEYS));
    const differs = differing(shotOf(r as { path: string; sha256: string }), shotOf(r.base as { path: string; sha256: string }));
    expect(r.base.same, `the check says what the pixels say at ${r.theme} ${r.size.join('x')}: ${differs} differ`).toBe(differs === 0);
    return { same: r.base.same as boolean, differs };
  });
}

const CHANGED = [CLEAN.main, CLEAN.words];

describe('scope: the same views rendered at the merge base beside the change', () => {
  it('a change that promises nothing visible changes passes on four matching pairs, rendered by the merge base\'s own build', async () => {
    requireMacos();
    const base = baseDrive();
    const reply = await checked({ changed: CHANGED, panel: CLEAN_PANEL, promise: 'nothing_visible', base: { drive: base.drive, panel: panelAtBase() } });
    expect(existsSync(base.mark) && readFileSync(base.mark, 'utf8').trim().length > 0, 'the merge base\'s build rendered its side').toBe(true);
    expect(reply.views.length).toBe(1);
    const got = pairs(reply.views[0]);
    expect(got.map((p) => p.same), 'all four match').toEqual([true, true, true, true]);
    expect(reply.differs, 'nothing is listed as changed').toEqual([]);
    expect(reply.claim).toBe('PASS');
  }, 900_000);

  it('a visible change under that promise fails, naming the view and each pair that differs', async () => {
    requireMacos();
    const base = baseDrive();
    const reply = await checked({ changed: CHANGED, panel: CLEAN_PANEL, promise: 'nothing_visible', base: { drive: base.drive, panel: panelAtBase('export const SAVE = "Save edits";\n') } });
    const [view] = reply.views as [Obj];
    const got = pairs(view);
    expect(got.map((p) => p.same), 'all four differ').toEqual([false, false, false, false]);
    expect(reply.claim, 'the promise is broken').toBe('FAIL');
    expect((reply.differs as Obj[]).map((d) => `${d.view} ${d.theme} ${d.size.join('x')}`).sort(), 'each pair is named').toEqual((view.renders as Obj[]).map((r) => `${view.view} ${r.theme} ${r.size.join('x')}`).sort());
  }, 900_000);

  it('the promise with no merge base rendered is INCONCLUSIVE, never PASS', async () => {
    requireMacos();
    const reply = await checked({ changed: CHANGED, panel: CLEAN_PANEL, promise: 'nothing_visible' });
    expect(reply.claim).toBe('INCONCLUSIVE');
  }, 900_000);

  it('the real session row: the same build matches at the merge base, and a row that draws differently there differs in all four', async () => {
    requireMacos();
    const same = await checked({ changed: [ROW_FILE], fixture: STRESS_FILE, base: { drive: baseDrive().drive } });
    expect(pairs(viewOf(same, SIDEBAR)).map((p) => p.same), 'two renders of one row match pixel for pixel').toEqual([true, true, true, true]);
    const other = await checked({ changed: [ROW_FILE], fixture: STRESS_FILE, base: { drive: baseDrive('row-label-past-frame').drive } });
    expect(pairs(viewOf(other, SIDEBAR)).map((p) => p.same), 'the row at the base draws differently').toEqual([false, false, false, false]);
  }, 900_000);
});

// AC6: no thread local holds selection, and a planted `OPENED` fails the lint, naming the file. The lint is
// `scripts/selection-lint.mjs` (README, Pinned 8), run with `--root` on a copy of `crates/deep-app/src`. It must pass the
// app as it stands, and fail each plant, naming the file the plant is in: `OPENED` as the base declares it, in views.rs
// and in another file, and the base's other selection statics (`POPPED`, `DOCK` and the view handed to a slot) in a file
// of their own, since the issue's Scope removes them with `OPENED`.
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ID, MIN, REPO } from './helpers.ts';

const LINT = 'scripts/selection-lint.mjs';
const SOURCE = 'crates/deep-app/src';
/** The base's `OPENED`, as views.rs declared it at 96b462a6. */
const OPENED = [
  'thread_local! {',
  '    /// The session the page and the line draw: the one you clicked, else the first.',
  '    static OPENED: RefCell<Option<String>> = const { RefCell::new(None) };',
  '}',
].join('\n');
/** The base's other selection statics, as views.rs declared them at 96b462a6. */
const OTHERS = [
  'use std::{cell::Cell, cell::RefCell};',
  'use gpui_kit::*;',
  'use gpui_kit::base::dock::DockArea;',
  'thread_local! {',
  '    /// The view popped out into a window of its own.',
  '    static POPPED: Cell<Option<crate::views::Kind>> = const { Cell::new(None) };',
  '    /// The shell\'s dock, which a click shows a panel in.',
  '    static DOCK: RefCell<Option<WeakEntity<DockArea>>> = const { RefCell::new(None) };',
  '}',
  'thread_local! {',
  '    static NEXT_EXTENSION: RefCell<Option<AnyView>> = const { RefCell::new(None) };',
  '}',
].join('\n');

function lint(root: string): { code: number | null; out: string } {
  const ran = spawnSync(process.execPath, [join(REPO, LINT), '--root', root], { cwd: REPO, encoding: 'utf8', timeout: 120_000 });
  return { code: ran.status, out: `${ran.stdout ?? ''}${ran.stderr ?? ''}` };
}
const made: string[] = [];
afterAll(() => { for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true }); });
/** A copy of the app's source under a folder that stands for a checkout. */
function copy(): string {
  const root = mkdtempSync('/tmp/dd1460-lint-');
  made.push(root);
  mkdirSync(join(root, 'crates/deep-app'), { recursive: true });
  cpSync(join(REPO, SOURCE), join(root, SOURCE), { recursive: true });
  return root;
}

describe(`AC6 ${ID.lint} No thread local holds selection. A planted \`OPENED\` fails the lint, naming the file`, () => {
  it(`AC6 ${ID.lint} ${LINT} passes the app's source as it stands, and fails a planted OPENED in views.rs and in commands.rs, and the base's POPPED, DOCK and slot view, each naming its file`, () => {
    expect(existsSync(join(REPO, LINT)), `${LINT} exists (README, Pinned 8)`).toBe(true);
    const failures: string[] = [];
    const clean = lint(copy());
    if (clean.code !== 0 || /^FAIL/m.test(clean.out)) failures.push(`the lint fails the app as it stands (exit ${clean.code}): a thread local still holds selection: ${clean.out.slice(0, 800)}`);
    const plants: { name: string; file: string; plant: (path: string) => void }[] = [
      { name: 'OPENED in views.rs', file: 'views.rs', plant: (path) => appendFileSync(path, `\n${OPENED}\n`) },
      { name: 'OPENED in commands.rs', file: 'commands.rs', plant: (path) => appendFileSync(path, `\n${OPENED}\n`) },
      { name: 'POPPED, DOCK and the slot\'s view in a file of their own', file: 'planted_selection.rs', plant: (path) => writeFileSync(path, `${OTHERS}\n`) },
    ];
    for (const p of plants) {
      const root = copy();
      p.plant(join(root, SOURCE, p.file));
      const ran = lint(root);
      if (ran.code !== 1) failures.push(`the lint doesn't fail ${p.name} (exit ${ran.code}): ${ran.out.slice(0, 400)}`);
      else if (!new RegExp(`^FAIL selection: ${SOURCE}/${p.file.replace('.', '\\.')}:\\d+`, 'm').test(ran.out)) failures.push(`the lint fails ${p.name} without naming ${SOURCE}/${p.file} in a FAIL line: ${ran.out.slice(0, 400)}`);
    }
    expect(failures).toEqual([]);
  }, 5 * MIN);
});

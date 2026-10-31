// #882 AC4: what the app's surface inventory must do, as judges that inventory.test.mjs runs on
// scripts/app-inventory.mjs and wrong.test.mjs runs on the wrong inventory scripts under wrong/.
//
// `node <script> --root <dir>` writes <dir>/crates/deep-app/inventory.json from the app's source under <dir>;
// `node <script> --check --root <dir>` compares the committed file with a fresh one: exit 0 when they're the same,
// else exit 1 with a line starting `FAIL ` naming each panel whose row differs, is missing or is extra. A panel is
// added the way the app's shipped views are, by a register_panel call in views.rs's register_views.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { remove, repoRoot } from './common.mjs';
import { appCopy } from './lint-judge.mjs';

export const SCRIPT = 'scripts/app-inventory.mjs';
export const INVENTORY = 'crates/deep-app/inventory.json';
/** The panels the base's register_views registers for the shipped views (crates/deep-app/src/views.rs). */
export const SHIPPED = ['deepbuild/sidebar', 'deepbuild/home', 'deepbuild/needs-you', 'deepbuild/session', 'deepbuild/line'];
export const PLANTED = 'deepbuild/planted-882';
const ANCHOR = 'pub fn register_views(cx: &mut App) {';

const run = (script, args, root) => {
  const r = spawnSync(process.execPath, [script, ...args, '--root', root], { cwd: root, encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, output: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim(), error: r.error };
};
const failLines = (output) => output.split('\n').filter((l) => l.startsWith('FAIL'));

/** Registers one more panel in the copy's register_views, as the shipped views are registered. */
function addPanel(root) {
  const file = join(root, 'crates/deep-app/src/views.rs');
  const text = readFileSync(file, 'utf8');
  if (!text.includes(ANCHOR)) return false;
  writeFileSync(file, text.replace(ANCHOR, `${ANCHOR}\n    // Planted by #882's acceptance tests: one more panel.\n    register_panel(cx, "${PLANTED}", |_, _, cx| Arc::new(cx.new(|cx| Shipped::new(Kind::Home, cx))));`));
  return true;
}

/** The rows of an inventory file, or the reason it has none. */
export function rows(file) {
  if (!existsSync(file)) return { error: `no inventory at ${file}` };
  try {
    const panels = JSON.parse(readFileSync(file, 'utf8')).panels;
    return Array.isArray(panels) ? { panels } : { error: `${file} has no panels array` };
  } catch (error) {
    return { error: `${file} isn't JSON: ${error.message}` };
  }
}

/** What's wrong with the committed inventory's rows: one per shipped panel, each with its entry, roles and literals. */
export function shapeProblems(file) {
  const { panels, error } = rows(file);
  if (error) return [error];
  const problems = [];
  for (const name of SHIPPED) {
    const row = panels.filter((p) => p?.panel === name);
    if (row.length !== 1) {
      problems.push(`${row.length} rows for ${name}, not 1`);
      continue;
    }
    const [{ entry, roles, literals }] = row;
    if (typeof entry !== 'string' || !entry) problems.push(`${name}: no entry`);
    if (!Array.isArray(roles) || !roles.every((r) => typeof r === 'string')) problems.push(`${name}: roles isn't a list of role names`);
    if (!Array.isArray(literals)) problems.push(`${name}: literals isn't a list`);
  }
  return problems;
}

/**
 * The ways `script` falls short on a copy of the app at `source`: its check passes the copy as it is; with a panel
 * added and the inventory not regenerated, the check fails naming the panel; once regenerated, it passes again and
 * the inventory has the panel's row.
 */
export function judgeInventory(script, { source = repoRoot } = {}) {
  if (!existsSync(script)) return [`no inventory script at ${script}`];
  const failures = [];
  const root = appCopy(source, 'inventory');
  try {
    const clean = run(script, ['--check'], root);
    if (clean.error) return [`the script couldn't run: ${clean.error.message}`];
    if (clean.status !== 0 || failLines(clean.output).length) failures.push(`the check fails the app as it stands (exit ${clean.status}): ${clean.output.slice(0, 800)}`);
    if (!addPanel(root)) return [...failures, `the copy's views.rs has no "${ANCHOR}"`];
    const stale = run(script, ['--check'], root);
    if (stale.status === 0) failures.push(`with ${PLANTED} added and the inventory not regenerated, the check passes`);
    else if (stale.status !== 1) failures.push(`with ${PLANTED} added, the check ends with exit ${stale.status}, not 1: ${stale.output.slice(0, 600)}`);
    else if (!failLines(stale.output).some((l) => l.includes(PLANTED))) failures.push(`with ${PLANTED} added, the check fails without a FAIL line naming it: ${stale.output.slice(0, 600)}`);
    const write = run(script, [], root);
    if (write.status !== 0) failures.push(`regenerating ends with exit ${write.status}: ${write.output.slice(0, 600)}`);
    const again = run(script, ['--check'], root);
    if (again.status !== 0 || failLines(again.output).length) failures.push(`after regenerating, the check fails (exit ${again.status}): ${again.output.slice(0, 600)}`);
    const { panels, error } = rows(join(root, INVENTORY));
    if (error) failures.push(`after regenerating: ${error}`);
    else if (!panels.some((p) => p?.panel === PLANTED)) failures.push(`the regenerated inventory has no row for ${PLANTED}`);
  } finally {
    remove(root);
  }
  return failures;
}

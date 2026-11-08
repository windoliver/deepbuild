// AC5 #1454.cbcbeda8: `render` holds no branch on fixture state. A planted `decorations.is_none()` fails the lint, naming the line.
//
// The lint is `scripts/render-lint.mjs` (README, Pinned 7), run with `--root` on a copy of `crates/deep-app/src`. It must pass
// the app as it stands, fail each plant naming its file and line, and run in the local preflight. The plants are lines in a
// `render`, and the base's own views.rs, which is the wrong program the issue names: each `decorations.is_none()` it holds
// must be named by its line. A view's own state, `self.terminal.is_none()`, must pass, so a lint that fails every
// `.is_none()` fails here as one that greps one spelling does (fixtures/wrong-lints).
//
// The second half is the same thing as behavior, on the replica: the issue says `decorations.is_none()` hides the count, Pop
// out and the Terminal tab there. The replica draws the app's tree, so over a fixture it must show all three.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { childProcess, LINT, MINUTES, REPO, replicaBinary, SUITE, supportBinaries, t26, t806, useCleanup } from './helpers.ts';

useCleanup();
const SOURCE = 'crates/deep-app/src';
/** The lines of `fixtures/views-at-base.rs.txt`, the base's views.rs, that read `decorations.is_none()`. */
const AT_BASE = [613, 631, 715, 787];

interface Ran { code: number | null; out: string }
function lint(script: string, root: string): Ran {
  const ran = spawnSync(process.execPath, [script, '--root', root], { cwd: REPO, encoding: 'utf8', timeout: 60_000 });
  return { code: ran.status, out: `${ran.stdout ?? ''}${ran.stderr ?? ''}` };
}
/** A copy of the app's source, under a folder that stands for a checkout. */
function copy(): string {
  const root = join(t806.tempDir(), 'checkout');
  mkdirSync(join(root, 'crates/deep-app'), { recursive: true });
  cpSync(join(REPO, SOURCE), join(root, SOURCE), { recursive: true });
  return root;
}
/** Puts `line` as the first statement of the first `render` of `impl Render for <view>` in `file`; the line it landed on, from 1. */
function plant(root: string, file: string, view: string, line: string): number {
  const path = join(root, SOURCE, file);
  const lines = readFileSync(path, 'utf8').split('\n');
  const start = lines.findIndex((l) => l.includes(`impl Render for ${view}`));
  if (start < 0) throw Error(`BLOCKED: ${file} has no \`impl Render for ${view}\` to plant in; the suite's plants need one (README, Pinned 7)`);
  const render = start + lines.slice(start).findIndex((l) => /\bfn render\b/.test(l));
  const open = render + lines.slice(render).findIndex((l) => l.trimEnd().endsWith('{'));
  lines.splice(open + 1, 0, `        ${line}`);
  writeFileSync(path, lines.join('\n'));
  return open + 2;
}
const PLANTS: { name: string; file: string; view: string; line: string }[] = [
  { name: 'the issue\'s own `decorations.is_none()`', file: 'views.rs', view: 'Shipped', line: 'let decorations = crate::views::current_state(); let hidden = decorations.is_none();' },
  { name: 'the same branch under another name, the other way round', file: 'views.rs', view: 'Shipped', line: 'let fixture = crate::views::current_state(); let shown = fixture.is_some();' },
  { name: 'a read of fixture state in another view\'s render', file: 'commands.rs', view: 'Palette', line: 'if let Some(_fixture) = crate::views::current_state() { return div().id("commands"); }' },
];

/** What's wrong with a lint: passing the app, each plant named by its file and line, a view's own state let through. */
function lintFailures(script: string): string[] {
  const out: string[] = [];
  const clean = lint(script, copy());
  if (clean.code !== 0) out.push(`${script} fails the app as it stands (exit ${clean.code}): ${clean.out.slice(0, 800)}`);
  for (const p of PLANTS) {
    const root = copy();
    const at = plant(root, p.file, p.view, p.line);
    const ran = lint(script, root);
    if (ran.code !== 1) out.push(`${script} doesn't fail ${p.name} (exit ${ran.code})`);
    if (!new RegExp(`^FAIL .*${SOURCE}/${p.file}:${at}\\b`, 'm').test(ran.out)) out.push(`${script} doesn't name ${p.name} at ${SOURCE}/${p.file}:${at}: ${ran.out.slice(0, 400)}`);
  }
  const own = copy();
  plant(own, 'views.rs', 'Shipped', 'let closed = self.terminal.is_none();');
  const ran = lint(script, own);
  if (ran.code !== 0) out.push(`${script} fails a view's own state, \`self.terminal.is_none()\` (exit ${ran.code}): ${ran.out.slice(0, 400)}`);
  const base = copy();
  cpSync(join(SUITE, 'fixtures/views-at-base.rs.txt'), join(base, SOURCE, 'views.rs'));
  const old = lint(script, base);
  if (old.code !== 1) out.push(`${script} passes the base's views.rs (exit ${old.code})`);
  for (const line of AT_BASE) if (!new RegExp(`^FAIL .*${SOURCE}/views\\.rs:${line}\\b`, 'm').test(old.out)) out.push(`${script} doesn't name the base's views.rs:${line}: ${old.out.slice(0, 400)}`);
  return out;
}

/** The replica's snapshot of `view`, over its fixture, as the names on its tree. */
async function replicaNames(view: string): Promise<string[]> {
  await supportBinaries();
  const { home } = t26.makeHome();
  mkdirSync(t26.rootOf(home), { recursive: true });
  writeFileSync(join(t26.rootOf(home), 'setup-finished.json'), '{}');
  const out = join(t806.tempDir(), 'replica');
  await childProcess(replicaBinary(), ['--view', view, '--out', out], home);
  const walk = (node: { name: string | null; children: never[] }): string[] => [...(node.name ? [node.name] : []), ...node.children.flatMap(walk)];
  return walk((JSON.parse(readFileSync(join(out, 'snapshots', `${view}.json`), 'utf8')) as { tree: never }).tree);
}

describe('#1454 `render` holds no branch on fixture state', () => {
  it('AC5 #1454.cbcbeda8 `render` holds no branch on fixture state, and a planted `decorations.is_none()` fails the lint, naming the line', () => {
    const script = join(REPO, LINT);
    expect(existsSync(script), `${LINT} exists (README, Pinned 7)`).toBe(true);
    expect(lintFailures(script)).toEqual([]);
  }, 5 * MINUTES);

  it('AC5 #1454.cbcbeda8 the lint runs in the local preflight, on the app as it stands', async () => {
    const { checks } = await import(pathToFileURL(join(REPO, 'scripts/lanes.mjs')).href) as { checks: { name: string; paths?: string[]; commands: string[][] }[] };
    const lanes = checks.filter((lane) => lane.commands.some((argv) => argv.some((arg) => String(arg).endsWith(LINT))));
    expect(lanes.map((l) => l.name), `a lane of scripts/lanes.mjs's \`checks\` runs ${LINT}`).not.toEqual([]);
    expect(lanes.some((l) => !l.paths || l.paths.some((p) => p.startsWith('crates/deep-app') || p.startsWith('crates/**'))), `the lane runs on a change to ${SOURCE}`).toBe(true);
  });

  it('AC5 #1454.cbcbeda8 the judge fails the wrong lints: one that finds nothing, one that greps the one spelling, one that fails every `.is_none()`', () => {
    for (const wrong of ['always-pass', 'literal-grep', 'every-option']) {
      expect(lintFailures(join(SUITE, 'fixtures/wrong-lints', `${wrong}.mjs`)), `${wrong} fails the judge`).not.toEqual([]);
    }
  }, 5 * MINUTES);

  it('AC5 #1454.cbcbeda8 the replica draws the app\'s tree over a fixture: the count and Pop out on Needs you, and the Terminal tab on a session\'s page', async () => {
    const needsYou = await replicaNames('needs-you');
    expect(needsYou, 'Pop out shows over a fixture, as in the app').toContain('Pop out Needs you');
    expect(needsYou.filter((n) => /^\d+ asks? needs? you$/.test(n)), `the sidebar's count shows over a fixture, as in the app; the tree holds ${JSON.stringify(needsYou.slice(0, 12))}`).toHaveLength(1);
    const session = await replicaNames('session');
    expect(session, 'the Terminal tab shows over a fixture, as in the app').toContain('Terminal');
  }, 10 * MINUTES);
});

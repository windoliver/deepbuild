// AC4's `--json` part, redrafted blind (README): "`deep doctor` on a healthy fixture prints no `Fix:` line and one
// summary line, and `--json` is byte-equal to the merge base's." The healthy fixture is #19's world, as in the
// original suite's doctor.test.ts, whose no-`Fix:`/summary and planted tests stand as they are.
//
// What is compared is each program's own output, not the folder it runs from:
// - every CLI names its own checkout root (canvas.gpu and canvas.headless say "no deep-gpu is built under
//   <root>/target"), so both roots, as named and as resolved, read as one token on both sides; every other byte stays;
// - the merge base's tree is extracted with `git archive`, which carries no target/, so it is given this checkout's
//   target/ and both CLIs see one set of builds, as they already see one home, hub and deep-hook;
// - the base orders its claude.* and codex.* items as their checks finish (doctor.ts, Promise.all), so one program
//   prints more than one byte string. A try runs this checkout, the merge base, and this checkout again; it passes when
//   this checkout printed the same bytes twice and the merge base printed those bytes in any try.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as t19 from '../../19/doctor/helpers.ts';
import { AC4, blocked, cleanup, deepHook, inconclusive, mergeBase, MINUTES, NODE, REPO, run, sha256, shown } from '../helpers.ts';

const LONG = 30 * MINUTES;
const TRIES = 10;
const ROOT = '<checkout root>';

/**
 * The merge base's CLI, built in a tree of its own under $TMPDIR, kept by its commit and this checkout (its
 * node_modules links to this checkout's, the workspace's own packages to the base's), with this checkout's target/.
 */
async function mergeBaseTree(sha: string): Promise<{ root: string; cli: string }> {
  const root = join(tmpdir(), `da1455-ac4-base-${sha.slice(0, 12)}-${sha256(REPO).slice(0, 8)}`);
  const cli = join(root, 'packages/cli/dist/main.js');
  if (!existsSync(join(root, '.built'))) {
    rmSync(root, { recursive: true, force: true });
    mkdirSync(join(root, 'node_modules', '@deepbuild'), { recursive: true });
    execFileSync('/bin/sh', ['-c', `git archive --format=tar ${sha} | tar -x -C '${root}'`], { cwd: REPO, maxBuffer: 1 << 30 });
    for (const entry of readdirSync(join(REPO, 'node_modules'))) {
      if (entry === '@deepbuild' || entry.startsWith('.package-lock')) continue;
      symlinkSync(join(REPO, 'node_modules', entry), join(root, 'node_modules', entry));
    }
    for (const pkg of readdirSync(join(root, 'packages'))) {
      const manifest = join(root, 'packages', pkg, 'package.json');
      if (!existsSync(manifest)) continue;
      const name = (JSON.parse(readFileSync(manifest, 'utf8')) as { name: string }).name;
      if (name.startsWith('@deepbuild/')) symlinkSync(join(root, 'packages', pkg), join(root, 'node_modules', name));
    }
    const built = await run('npm', ['run', 'build', '--workspaces', '--if-present'], { cwd: root, timeoutMs: LONG });
    if (built.code !== 0 || !existsSync(cli)) blocked(`the merge base ${sha.slice(0, 8)}'s CLI didn't build: ${shown(built)}`);
    writeFileSync(join(root, '.built'), `${sha}\n`);
  }
  const target = join(root, 'target');
  let link: string | undefined;
  try { link = readlinkSync(target); } catch { /* none yet */ }
  if (link !== join(REPO, 'target')) {
    rmSync(target, { force: true });
    symlinkSync(join(REPO, 'target'), target);
  }
  return { root, cli };
}

/** Each root as named and as it resolves, without its trailing slash. */
const rootsOf = (...dirs: string[]): string[] =>
  [...new Set(dirs.flatMap((d) => { const named = d.replace(/\/+$/, ''); return [named, realpathSync(named)]; }))];
/** `text` with every whole occurrence of a root (not inside a longer path name) as ROOT; every other byte as it was. */
function rooted(text: string, roots: readonly string[]): string {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return roots.reduce((out, r) => out.replace(new RegExp(`(?<![\\w.-])${escape(r)}(?![\\w.-])`, 'g'), ROOT), text);
}
const firstDifference = (a: string, b: string): string => {
  const [x, y] = [a.split('\n'), b.split('\n')];
  const at = x.findIndex((line, i) => line !== y[i]);
  const i = at < 0 ? Math.min(x.length, y.length) : at;
  return `line ${i + 1}: ${JSON.stringify(x[i] ?? '(none)')} against ${JSON.stringify(y[i] ?? '(none)')}`;
};
const differing = (a: string, b: string): number => {
  const [x, y] = [a.split('\n'), b.split('\n')];
  return Array.from({ length: Math.max(x.length, y.length) }, (_, i) => x[i] !== y[i]).filter(Boolean).length;
};

let w: t19.World;
afterAll(async () => { await cleanup(); await t19.cleanup(); }, 60_000);
beforeAll(async () => { await deepHook(); w = await t19.world(); }, LONG);

describe('#1455 deep doctor --json, redraft', () => {
  it(`${AC4}: --json is byte-equal to the merge base's, each CLI's checkout root read as one token`, async () => {
    const sha = mergeBase();
    const base = await mergeBaseTree(sha);
    const roots = rootsOf(REPO, base.root);
    const json = async (cli: string, who: string): Promise<string> => {
      const r = await t19.run(NODE, [cli, 'doctor', '--json'], { env: t19.childEnv(w.h), cwd: w.h.work, timeoutMs: 180_000 });
      if (r.code === null || r.timedOut) blocked(`${who}'s deep doctor --json didn't finish: ${t19.shown(r)}`);
      if (!t19.jsonLines(r.stdout).length) {
        if (who === 'this checkout') expect.fail(`this checkout's deep doctor --json prints no item: ${t19.shown(r)}`);
        blocked(`the merge base's deep doctor --json prints no item, so there is nothing to lay this checkout's against: ${t19.shown(r)}`);
      }
      return rooted(r.stdout, roots);
    };
    // Two runs of this checkout either side of the merge base's: an item reads the machine (free disk, a free port), and
    // the item order races, so only bytes this checkout printed twice running are laid against the merge base's.
    const stable: string[] = [];
    const bases: string[] = [];
    let unstable = '';
    for (let tries = 1; tries <= TRIES; tries++) {
      const head = await json(t19.CLI, 'this checkout');
      bases.push(await json(base.cli, 'the merge base'));
      const again = await json(t19.CLI, 'this checkout');
      if (head === again) stable.push(head);
      else unstable = firstDifference(head, again);
      const match = stable.find((s) => bases.includes(s));
      if (match) {
        console.log(`${AC4}: equal on try ${tries}: ${match.split('\n').filter(Boolean).length} items, sha256 ${sha256(match)} with roots as ${ROOT}`);
        return;
      }
    }
    if (!stable.length) inconclusive(`AC4: deep doctor --json differs between two runs of this same program on all ${TRIES} tries (${unstable}), so byte equality with the merge base can't be judged`);
    const head = stable.at(-1)!;
    const nearest = [...bases].sort((a, b) => differing(head, a) - differing(head, b))[0]!;
    expect.fail(`deep doctor --json differs from the merge base ${sha.slice(0, 8)}'s, each CLI's checkout root read as ${ROOT}, on all ${TRIES} tries (${stable.length} with this checkout's two runs equal): ${firstDifference(head, nearest)}`);
  }, LONG);
});

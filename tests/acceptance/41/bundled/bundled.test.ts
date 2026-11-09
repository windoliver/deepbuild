// AC20 #41.3f0c28ab With one bundled data file removed from the installed tree, the still export fails naming that
// file's installed path; a planted install that falls back to the checkout's copy passes the export and fails this test.
//
// Surface assumed (the issue and the design name no command line for either step, so this is the one the tests pin):
//   - Laying out the installed tree: `node scripts/install-prefix.mjs --prefix <dir> [--plant checkout-fallback]`
//     installs the `deepbuild` npm package as a user's `npm install --global --prefix <dir> --ignore-scripts` would,
//     from this checkout's already-built files (it builds nothing). After exit 0:
//       <dir>/lib/node_modules/deepbuild/   the package's runtime folder, "the installed tree": real copies, no file
//                                           in it a link into the checkout;
//       <dir>/bin/deep                      the deep command (npm's link to the package's `bin`).
//     `--plant checkout-fallback` lays out the planted twin instead: the same tree, except that a bundled data file
//     missing from it is read from the checkout's copy. Without --plant there is no fallback of any kind.
//   - The still export: `node <dir>/bin/deep export --document <film.json> --still <frame | marker> --out <file.png>`
//     renders one still of the document headlessly (design, Export: "a single still at a frame or a marker", PNG) in
//     its own process tree. It needs neither `deep setup` nor a running hub. Success: exit 0 and a PNG at --out.
//     Failure: a non-zero exit, with the reason on stdout or stderr.
//   - Run "from installed files only" (issue, Scope): the test's own Node runs <dir>/bin/deep with a fresh HOME as
//     the working folder, PATH set to an empty folder and no other environment variable, so nothing points our
//     tools at a host copy. The document is the fixture film (fixtures/film.json, a copy of #417's), copied into
//     that fresh HOME; the still is frame 30.
//   - "A bundled data file" is any regular file of the installed tree that is not code: not a .js/.mjs/.cjs/.ts/
//     .map/.node/.wasm file, not a package.json, not executable, not a Mach-O or ELF binary, and not inside a
//     third-party dependency's node_modules folder (DeepBuild's own `deepbuild` and `@deepbuild/*` packages count).
//     The issue doesn't say which file, so the test finds one the still export reads: with every bundled data file
//     removed the export must fail, and halving that set finds one file whose removal alone makes it fail. That
//     run's output must name the file's installed path (<dir>/lib/node_modules/deepbuild/<file>) and never the
//     checkout.
// Wrong programs: the base (no install-prefix.mjs, no `deep export`); an install that reads its data from the checkout
// (the planted twin: its export passes); an export that fails without naming the missing file's installed path.

import { spawnSync } from 'node:child_process';
import { closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const AC = 'AC20 #41.3f0c28ab';
const REPO = realpathSync(fileURLToPath(new URL('../../../../', import.meta.url))).replace(/\/+$/, '');
const INSTALL = join(REPO, 'scripts', 'install-prefix.mjs');
const FILM = fileURLToPath(new URL('./fixtures/film.json', import.meta.url));
const STILL = '30';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CODE = /\.(?:[cm]?js|[cm]?ts|map|node|wasm)$/;
const BINARY = new Set(['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', '7f454c46']);
const LONG = 30 * 60_000;

const made: string[] = [];
afterAll(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });
/** Short real paths outside the checkout: a Unix socket an export might open must fit in 104 bytes on macOS. */
function temp(prefix: string): string {
  const dir = realpathSync(mkdtempSync(`/tmp/${prefix}`));
  made.push(dir);
  return dir;
}
const tail = (text: string, n = 40) => text.trim().split('\n').slice(-n).join('\n');

/** Every entry under a folder, links included, never followed. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    out.push(p);
    if (e.isDirectory()) out.push(...walk(p));
  }
  return out;
}

interface Installed { prefix: string; tree: string; deep: string }
function install(plant?: string): Installed {
  const prefix = temp('db41p-');
  const r = spawnSync(process.execPath, [INSTALL, '--prefix', prefix, ...(plant ? ['--plant', plant] : [])], { cwd: REPO, encoding: 'utf8', timeout: LONG, maxBuffer: 1 << 26 });
  const said = `${r.stdout ?? ''}\n${r.stderr ?? ''}${r.error ? `\n${r.error.message}` : ''}`;
  expect(r.status, `scripts/install-prefix.mjs --prefix <temp>${plant ? ` --plant ${plant}` : ''} lays out the installed tree (exit 0); got exit ${r.status}:\n${tail(said)}`).toBe(0);
  const tree = join(prefix, 'lib', 'node_modules', 'deepbuild');
  const deep = join(prefix, 'bin', 'deep');
  expect(existsSync(join(tree, 'package.json')), `the installed tree is <prefix>/lib/node_modules/deepbuild, holding the package's package.json`).toBe(true);
  expect(existsSync(deep), 'the deep command is <prefix>/bin/deep').toBe(true);
  const intoCheckout = walk(tree).filter((p) => {
    try { return realpathSync(p).startsWith(`${REPO}${sep}`); } catch { return false; }
  });
  expect(intoCheckout.map((p) => relative(tree, p)), 'every file of the installed tree is its own copy, none a link into the checkout').toEqual([]);
  return { prefix, tree, deep };
}

function binary(path: string): boolean {
  const fd = openSync(path, 'r');
  try {
    const head = Buffer.alloc(4);
    return readSync(fd, head, 0, 4, 0) === 4 && BINARY.has(head.toString('hex'));
  } finally {
    closeSync(fd);
  }
}

/** The installed tree's bundled data files, as paths relative to it, in a fixed order. */
function dataFiles(tree: string): string[] {
  return walk(tree).filter((p) => {
    const parts = relative(tree, p).split(sep);
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] !== 'node_modules') continue;
      const name = parts[i + 1]?.startsWith('@') ? `${parts[i + 1]}/${parts[i + 2]}` : parts[i + 1];
      if (!(name === 'deepbuild' || name?.startsWith('@deepbuild/'))) return false;
    }
    const st = lstatSync(p);
    if (!st.isFile() || st.mode & 0o111) return false;
    if (CODE.test(p) || basename(p) === 'package.json') return false;
    return !binary(p);
  }).map((p) => relative(tree, p)).sort();
}

interface Run { status: number | null; text: string; wrote: boolean }
const passed = (r: Run) => r.status === 0 && r.wrote;

/** The fixture film's still export, run from the installed tree only. */
function exportStill(deep: string): Run {
  const home = temp('db41h-');
  const empty = join(home, 'empty-path');
  mkdirSync(empty);
  const doc = join(home, 'film.json');
  copyFileSync(FILM, doc);
  const png = join(home, 'still.png');
  const r = spawnSync(process.execPath, [deep, 'export', '--document', doc, '--still', STILL, '--out', png], {
    cwd: home, env: { HOME: home, PATH: empty }, encoding: 'utf8', timeout: LONG, maxBuffer: 1 << 26, killSignal: 'SIGKILL',
  });
  const wrote = existsSync(png) && readFileSync(png).subarray(0, 8).equals(PNG);
  return { status: r.status, text: `${r.stdout ?? ''}\n${r.stderr ?? ''}${r.error ? `\n${r.error.message}` : ''}`, wrote };
}

/** Moves the files out of the tree for one call, then puts them back. */
function withRemoved<T>(tree: string, rels: string[], fn: () => T): T {
  const stash = temp('db41s-');
  const moved: string[] = [];
  try {
    for (const rel of rels) {
      mkdirSync(dirname(join(stash, rel)), { recursive: true });
      renameSync(join(tree, rel), join(stash, rel));
      moved.push(rel);
    }
    return fn();
  } finally {
    for (const rel of moved) renameSync(join(stash, rel), join(tree, rel));
  }
}

/** What this criterion requires of an export run with one bundled data file removed; empty when it holds. */
function judge(run: Run, installed: string, rel: string): string[] {
  const problems: string[] = [];
  if (run.status === 0 || run.wrote) problems.push(`the still export passed (exit ${run.status}${run.wrote ? ', a PNG written' : ''}) with ${rel} removed from the installed tree, so it read that file from somewhere else`);
  if (!run.text.includes(installed)) problems.push(`its output does not name the removed file's installed path ${installed}`);
  if (run.text.includes(REPO)) problems.push(`its output names the checkout (${REPO}), so it looked there`);
  return problems;
}

let found: string | undefined;

describe(`${AC} the still export from an installed tree missing one bundled data file`, () => {
  it(`${AC} with one bundled data file removed from the installed tree, the still export fails, naming that file's installed path and not the checkout's`, () => {
    const { tree, deep } = install();
    const intact = exportStill(deep);
    expect(passed(intact), `the fixture film's still export runs from the intact installed tree (exit 0 and a PNG at --out); got exit ${intact.status}:\n${tail(intact.text)}`).toBe(true);

    const data = dataFiles(tree);
    expect(data.length, 'the installed tree bundles data files beside its code').toBeGreaterThan(0);
    const none = withRemoved(tree, data, () => exportStill(deep));
    expect(passed(none), `with all ${data.length} bundled data files removed from the installed tree the still export still passed, so it read none of them from there`).toBe(false);

    let set = data;
    const trail: string[] = [];
    while (set.length > 1) {
      const half = set.slice(0, Math.ceil(set.length / 2));
      const r = withRemoved(tree, half, () => exportStill(deep));
      trail.push(`${half.length} of ${set.length} removed: ${passed(r) ? 'passed' : 'failed'}`);
      set = passed(r) ? set.slice(half.length) : half;
    }
    const rel = set[0]!;
    found = rel;
    const installed = join(tree, rel);
    const one = withRemoved(tree, [rel], () => exportStill(deep));
    console.log(`${AC}: removed ${rel} (found by halving ${data.length} data files: ${trail.join('; ')}); export exit ${one.status}`);
    expect(judge(one, installed, rel), `the still export with only ${rel} removed; its output:\n${tail(one.text)}`).toEqual([]);
    expect(existsSync(installed), `${rel} is back in the installed tree after the run`).toBe(true);
  }, 4 * LONG);

  it(`${AC} planted: an install that falls back to the checkout's copy passes the export with that file removed, and this test's judge fails it`, () => {
    expect(found, 'the test above found a bundled data file the still export reads').toBeDefined();
    const rel = found!;
    const { tree, deep } = install('checkout-fallback');
    expect(existsSync(join(tree, rel)), `the planted install bundles ${rel} too`).toBe(true);
    const run = withRemoved(tree, [rel], () => exportStill(deep));
    expect(passed(run), `the planted install passes the still export with ${rel} removed, reading the checkout's copy; got exit ${run.status}:\n${tail(run.text)}`).toBe(true);
    const problems = judge(run, join(tree, rel), rel);
    expect(problems.length, 'the judge the real install meets fails the plant').toBeGreaterThan(0);
    expect(problems[0], 'first of all because its export passed').toMatch(/the still export passed/);
  }, 2 * LONG);
});

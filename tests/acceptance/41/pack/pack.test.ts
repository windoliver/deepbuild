// AC7 #41 The release pack check: `deepbuild` and each per-platform deep-hook package are packed from a clean
// checkout of the commit the preflight report passed on, each archive is read back from its own bytes, and its
// `bin`, `main` and every `exports` entry (wildcards included) must resolve to a file in the archive. A planted
// `./schemas/*` whose files `files` leaves out fails, naming the entry and the package, and writes no manifest.
// The manifest records each archive's sha256 and the commit; a changed tree or another commit is refused, named.
//
// Surface assumed (issue and design name no command line, so this is the one the tests pin):
//   node scripts/release-pack.mjs --repo <dir> --commit <sha> --out <dir>
//   - packs every non-private package of the repo at <dir> (the root and each workspace package) with real
//     `npm pack`, from a clean checkout of <sha>; never publishes anything;
//   - success: exit 0, <out>/manifest.json = { commit, archives: [{ name, file, sha256 }] }, each `file` a
//     tarball in <out> (name = package name, sha256 = hex of that file's bytes);
//   - any refusal: non-zero exit, a message on stdout or stderr, and no manifest.json in <out>.
// The tests build tiny throwaway git repos; they never pack this repository.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'scripts', 'release-pack.mjs');
const made: string[] = [];
afterAll(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

const ENV = {
  PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '',
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  npm_config_registry: 'http://127.0.0.1:9', // a publish could not succeed anywhere
};
const run = (cmd: string, args: string[], cwd: string) => spawnSync(cmd, args, { cwd, env: ENV, encoding: 'utf8' });
const git = (cwd: string, ...a: string[]) => {
  const r = run('git', a, cwd);
  if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const sha256 = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

type Files = Record<string, string>;
const put = (root: string, files: Files) => {
  for (const [p, body] of Object.entries(files)) { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), body); }
};
const pkg = (o: object) => JSON.stringify({ version: '1.0.0', ...o }, null, 2);

const ROOT = 'deepbuild';
const DARWIN = '@deepbuild/deep-hook-darwin-arm64';
const LINUX = '@deepbuild/deep-hook-linux-x64';

function goodFiles(): Files {
  return {
    'package.json': pkg({ name: ROOT, bin: { deep: 'bin/deep.js' }, main: 'lib/index.js', workspaces: ['packages/*'],
      exports: { '.': './lib/index.js', './schemas/*': './schemas/*.json', './util': './lib/util.js' }, files: ['bin', 'lib', 'schemas'] }),
    'bin/deep.js': '#!/usr/bin/env node\nconsole.log("deep")\n',
    'lib/index.js': 'module.exports = {}\n', 'lib/util.js': 'module.exports = {}\n',
    'schemas/event.json': '{}\n', 'schemas/verdict.json': '{}\n',
    'packages/darwin/package.json': pkg({ name: DARWIN, os: ['darwin'], cpu: ['arm64'], bin: { 'deep-hook': 'bin/deep-hook' }, files: ['bin'] }),
    'packages/darwin/bin/deep-hook': 'binary-darwin\n',
    'packages/linux/package.json': pkg({ name: LINUX, os: ['linux'], cpu: ['x64'], bin: { 'deep-hook': 'bin/deep-hook' }, files: ['bin'] }),
    'packages/linux/bin/deep-hook': 'binary-linux\n',
  };
}

function makeRepo(files: Files) {
  const dir = mkdtempSync(join(tmpdir(), 'dh41p-'));
  made.push(dir);
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  git(repo, 'init', '-q');
  put(repo, files);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'one');
  return { dir, repo, sha: git(repo, 'rev-parse', 'HEAD'), out: join(dir, 'out') };
}

function pack(repo: string, commit: string, out: string) {
  const r = run(process.execPath, [SCRIPT, '--repo', repo, '--commit', commit, '--out', out], tmpdir());
  return { status: r.status, text: `${r.stdout}\n${r.stderr}`, manifest: join(out, 'manifest.json') };
}
const noManifest = (out: string) => existsSync(join(out, 'manifest.json'));
const tarEntries = (tgz: string) => run('tar', ['-tzf', tgz], tmpdir()).stdout.split('\n').filter(Boolean);

describe('AC7 #41.377b5cb2 The release packs deepbuild and each per-platform deep-hook package and records the archives in a manifest', { timeout: 120000 }, () => {
  it('AC7 #41.377b5cb2 a clean tree at its HEAD packs all three packages and the manifest holds each tarball\'s own sha256 and the commit', () => {
    const { repo, sha, out } = makeRepo(goodFiles());
    const r = pack(repo, sha, out);
    expect(r.status, r.text).toBe(0);
    const m = JSON.parse(readFileSync(r.manifest, 'utf8'));
    expect(m.commit).toBe(sha);
    expect(m.archives.map((a: { name: string }) => a.name).sort()).toEqual([DARWIN, LINUX, ROOT].sort());
    for (const a of m.archives) {
      expect(readdirSync(out)).toContain(a.file);
      expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(a.sha256, `sha256 of ${a.file} must be that of the archive's bytes`).toBe(sha256(join(out, a.file)));
    }
    const root = m.archives.find((a: { name: string }) => a.name === ROOT);
    const names = tarEntries(join(out, root.file));
    expect(names).toContain('package/schemas/event.json');
    expect(names).toContain('package/bin/deep.js');
    const darwin = m.archives.find((a: { name: string }) => a.name === DARWIN);
    expect(tarEntries(join(out, darwin.file))).toContain('package/bin/deep-hook');
  });

  it('AC7 #41.377b5cb2 the archives come from a clean checkout of the commit: a gitignored file the main entry needs, present only in the working tree, fails the check', () => {
    const files = goodFiles();
    delete files['lib/index.js'];
    files['.gitignore'] = 'lib/index.js\n';
    const { repo, sha, out } = makeRepo(files);
    put(repo, { 'lib/index.js': 'module.exports = {}\n' }); // on disk, never in the commit
    const r = pack(repo, sha, out);
    expect(r.status, r.text).not.toBe(0);
    expect(r.text).toContain('lib/index.js');
    expect(r.text).toContain(ROOT);
    expect(noManifest(out)).toBe(false);
  });

  it('AC7 #41.377b5cb2 a planted exports entry ./schemas/* whose files the files list leaves out fails, naming the entry and the package, and writes no manifest', () => {
    const files = goodFiles();
    files['package.json'] = pkg({ name: ROOT, bin: { deep: 'bin/deep.js' }, main: 'lib/index.js', workspaces: ['packages/*'],
      exports: { '.': './lib/index.js', './schemas/*': './schemas/*.json' }, files: ['bin', 'lib'] });
    const { repo, sha, out } = makeRepo(files);
    const r = pack(repo, sha, out);
    expect(r.status, r.text).not.toBe(0);
    expect(r.text).toContain('./schemas/*');
    expect(r.text).toContain(ROOT);
    expect(noManifest(out)).toBe(false);
  });

  it('AC7 #41.377b5cb2 a wildcard whose directory is packed but holds no file the pattern matches fails the same way', () => {
    const files = goodFiles();
    delete files['schemas/event.json']; delete files['schemas/verdict.json'];
    files['schemas/notes.txt'] = 'x\n';
    const { repo, sha, out } = makeRepo(files);
    const r = pack(repo, sha, out);
    expect(r.status, r.text).not.toBe(0);
    expect(r.text).toContain('./schemas/*');
    expect(r.text).toContain(ROOT);
    expect(noManifest(out)).toBe(false);
  });

  it('AC7 #41.377b5cb2 a bin pointing at a file the commit does not hold fails, naming the package that has it (a per-platform one here) and the path', () => {
    const files = goodFiles();
    delete files['packages/linux/bin/deep-hook'];
    const { repo, sha, out } = makeRepo(files);
    const r = pack(repo, sha, out);
    expect(r.status, r.text).not.toBe(0);
    expect(r.text).toContain(LINUX);
    expect(r.text).toContain('bin/deep-hook');
    expect(noManifest(out)).toBe(false);
  });

  it('AC7 #41.377b5cb2 a main pointing at a file the archive does not hold fails, naming the package and the path', () => {
    const files = goodFiles();
    files['package.json'] = pkg({ name: ROOT, bin: { deep: 'bin/deep.js' }, main: 'lib/missing.js', workspaces: ['packages/*'],
      exports: { '.': './lib/index.js' }, files: ['bin', 'lib'] });
    const { repo, sha, out } = makeRepo(files);
    const r = pack(repo, sha, out);
    expect(r.status, r.text).not.toBe(0);
    expect(r.text).toContain(ROOT);
    expect(r.text).toContain('lib/missing.js');
    expect(noManifest(out)).toBe(false);
  });

  it('AC7 #41.377b5cb2 an exports entry with a conditions object resolves each target, and a missing one fails naming the entry', () => {
    const files = goodFiles();
    files['package.json'] = pkg({ name: ROOT, bin: { deep: 'bin/deep.js' }, main: 'lib/index.js', workspaces: ['packages/*'],
      exports: { '.': './lib/index.js', './extra': { import: './lib/extra.mjs', default: './lib/extra.js' } }, files: ['bin', 'lib'] });
    const { repo, sha, out } = makeRepo(files);
    const r = pack(repo, sha, out);
    expect(r.status, r.text).not.toBe(0);
    expect(r.text).toContain('./extra');
    expect(r.text).toContain(ROOT);
    expect(noManifest(out)).toBe(false);
  });
});

describe('AC7 #41.377b5cb2 A release run on a tree with one changed file, or at another commit, is refused, naming it', { timeout: 120000 }, () => {
  it('AC7 #41.377b5cb2 one modified tracked file refuses the run, naming the file, and writes no manifest', () => {
    const { repo, sha, out } = makeRepo(goodFiles());
    writeFileSync(join(repo, 'lib', 'util.js'), 'module.exports = { changed: true }\n');
    const r = pack(repo, sha, out);
    expect(r.status, r.text).not.toBe(0);
    expect(r.text).toContain('lib/util.js');
    expect(noManifest(out)).toBe(false);
    expect(existsSync(out) ? readdirSync(out).filter((f) => f.endsWith('.tgz')) : []).toEqual([]);
  });

  it('AC7 #41.377b5cb2 one new untracked file refuses the run, naming the file', () => {
    const { repo, sha, out } = makeRepo(goodFiles());
    writeFileSync(join(repo, 'stray-file.txt'), 'x\n');
    const r = pack(repo, sha, out);
    expect(r.status, r.text).not.toBe(0);
    expect(r.text).toContain('stray-file.txt');
    expect(noManifest(out)).toBe(false);
  });

  it('AC7 #41.377b5cb2 a commit other than the checkout\'s HEAD refuses the run, naming both commits', () => {
    const { repo, sha: first, out } = makeRepo(goodFiles());
    writeFileSync(join(repo, 'lib', 'util.js'), 'module.exports = { second: 1 }\n');
    git(repo, 'commit', '-q', '-am', 'two');
    const head = git(repo, 'rev-parse', 'HEAD');
    expect(head).not.toBe(first);
    const r = pack(repo, first, out);
    expect(r.status, r.text).not.toBe(0);
    expect(r.text).toContain(first);
    expect(r.text).toContain(head);
    expect(noManifest(out)).toBe(false);
  });

  it('AC7 #41.377b5cb2 the same tree at its own HEAD is accepted, so the refusals above come from the changed file or commit and not from the setup', () => {
    const { repo, out } = makeRepo(goodFiles());
    writeFileSync(join(repo, 'lib', 'util.js'), 'module.exports = { second: 1 }\n');
    git(repo, 'commit', '-q', '-am', 'two');
    const head = git(repo, 'rev-parse', 'HEAD');
    const r = pack(repo, head, out);
    expect(r.status, r.text).toBe(0);
    expect(JSON.parse(readFileSync(r.manifest, 'utf8')).commit).toBe(head);
  });
});

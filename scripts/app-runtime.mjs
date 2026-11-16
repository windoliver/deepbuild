#!/usr/bin/env node
// The app's runtime folder (#1349): one version folder holding everything a workspace needs, so a Mac with no Node,
// git or developer tools runs DeepBuild from the download alone.
//   node scripts/app-runtime.mjs [--archives <dir>] [--out <dir>] [--plant system-git]
// --archives is a scripts/release-pack.mjs out folder: the `deepbuild` archive and this host's deep-hook archive, each
// checked against its manifest.json. Without it, scripts/release-stage.mjs --here stages this checkout as it is built.
// The folder (default target/app-runtime) holds the package tree with its deep-hook package beside it as npm installs
// it; bin/deep, a /bin/sh launcher that puts the folder's own git/bin first on PATH and runs runtime/node on
// bin/deep.mjs; bin/deep-hook; runtime/node, Node's official build; and git/, built from source with no developer tool
// at run time and finding its own files from where it sits. Node and git's source come pinned from
// scripts/fetch-lock.json; git's build is cached under target/app-git/<sha256 of its source>.
// It runs bin/deep --version once with an empty PATH and a fresh HOME, which makes the launcher's links, and refuses
// a program in the folder that links a library outside the system's, naming the program.
// --plant system-git lays out the same folder with no git/: the build that needs a system git.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, constants, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { cpus, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const fail = (message) => {
  console.error(`app-runtime: ${message}`);
  process.exit(1);
};
const flag = (name) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? undefined : process.argv[at + 1];
};
const REPO = fileURLToPath(new URL('..', import.meta.url));
const [archives, plant] = [flag('archives'), flag('plant')];
const out = resolve(flag('out') ?? join(REPO, 'target', 'app-runtime'));
if (plant !== undefined && plant !== 'system-git') fail(`--plant ${plant} names no planted runtime; the one is system-git`);
const run = (cmd, args, options = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...options });
  if (r.status !== 0) fail(`${cmd} ${args.join(' ')} failed: ${(r.stderr || r.stdout || String(r.error)).slice(-4000)}`);
  return r.stdout;
};
const platform = `${process.platform}-${process.arch}`;
const hookPackage = `@deepbuild/deep-hook-${platform}`;
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

// The pinned files, fetched into the one cache by the lock's own fetcher.
const lock = JSON.parse(readFileSync(join(REPO, 'scripts', 'fetch-lock.json'), 'utf8')).files;
const pinned = (prefix) => {
  const row = lock.find((r) => r.path.startsWith(prefix)) ?? fail(`scripts/fetch-lock.json has no row for ${prefix}`);
  run(process.execPath, [join(REPO, 'scripts', 'fetch-lock.mjs'), 'fetch', row.url], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
  return { row, file: join(homedir(), '.deepbuild', 'fetched', row.path) };
};

// Beside the out folder, so every move is a rename on one volume.
mkdirSync(join(out, '..'), { recursive: true });
const work = mkdtempSync(join(out, '..', '.app-runtime-'));
try {
  const staged = join(work, 'tree');
  // The two packages: from the release's archives, or staged from this checkout.
  if (archives) {
    const dir = resolve(archives);
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    for (const [name, to] of [['deepbuild', staged], [hookPackage, join(staged, 'node_modules', hookPackage)]]) {
      const a = manifest.archives.find((x) => x.name === name) ?? fail(`${join(dir, 'manifest.json')} lists no ${name} archive`);
      if (sha256(join(dir, a.file)) !== a.sha256) fail(`${a.file} doesn't hash to its manifest's ${a.sha256}`);
      const into = join(work, a.file);
      mkdirSync(into);
      run('tar', ['-xzf', join(dir, a.file), '-C', into]);
      mkdirSync(join(to, '..'), { recursive: true });
      renameSync(join(into, 'package'), to);
    }
  } else {
    const stage = join(work, 'stage');
    run(process.execPath, [join(REPO, 'scripts', 'release-stage.mjs'), '--out', stage, '--here'], { cwd: REPO });
    renameSync(join(stage, 'deepbuild'), staged);
    mkdirSync(join(staged, 'node_modules', '@deepbuild'), { recursive: true });
    renameSync(join(stage, `deep-hook-${platform}`), join(staged, 'node_modules', hookPackage));
  }

  // Node's own build: its program and its licence.
  const node = pinned('app/node-');
  const unpacked = join(work, 'node');
  mkdirSync(unpacked);
  run('tar', ['-xzf', node.file, '-C', unpacked, '--strip-components', '1']);
  mkdirSync(join(staged, 'runtime'));
  for (const f of ['bin/node', 'LICENSE']) cpSync(join(unpacked, f), join(staged, 'runtime', f.replace('bin/', '')));

  // git, built once per source and kept: its built-in commands, the https helper on the system's libcurl, templates.
  if (plant !== 'system-git') {
    const source = pinned('app/git-');
    const built = join(REPO, 'target', 'app-git', source.row.sha256);
    if (!existsSync(join(built, 'bin', 'git'))) {
      const src = join(work, 'git-src');
      mkdirSync(src);
      run('tar', ['-xzf', source.file, '-C', src, '--strip-components', '1']);
      // The version from the lock's path, so the build never asks a system git to describe itself.
      writeFileSync(join(src, 'version'), `${/git-([\d.]+)\.tar/.exec(source.row.path)[1]}\n`);
      const partial = `${built}.${process.pid}`;
      run('make', [`-j${cpus().length}`, 'prefix=/', `DESTDIR=${partial}`, 'RUNTIME_PREFIX=YesPlease', 'NO_RUST=YesPlease', 'NO_HOMEBREW=YesPlease',
        'NO_FINK=YesPlease', 'NO_DARWIN_PORTS=YesPlease', 'NO_GETTEXT=YesPlease', 'NO_PERL=YesPlease', 'NO_PYTHON=YesPlease', 'NO_TCLTK=YesPlease',
        'NO_EXPAT=YesPlease', 'INSTALL_SYMLINKS=YesPlease', 'SKIP_DASHED_BUILT_INS=YesPlease', 'install'], { cwd: src });
      cpSync(join(src, 'COPYING'), join(partial, 'COPYING'));
      rmSync(built, { recursive: true, force: true });
      renameSync(partial, built);
    }
    cpSync(built, join(staged, 'git'), { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE });
  }

  // The launcher: shell built-ins only, so it runs with an empty PATH; its folder is found from its own path.
  writeFileSync(join(staged, 'bin', 'deep'), '#!/bin/sh\nhere=$(cd "${0%/*}/.." && pwd)\nPATH="$here/git/bin${PATH:+:$PATH}" exec "$here/runtime/node" "$here/bin/deep.mjs" "$@"\n', { mode: 0o755 });
  symlinkSync(`../node_modules/${hookPackage}/bin/deep-hook`, join(staged, 'bin', 'deep-hook'));

  // Once alone, as a clean Mac would run it: that makes the launcher's links, which a signed app can't make later.
  const empty = join(work, 'empty');
  mkdirSync(join(empty, 'bin'), { recursive: true });
  const ran = spawnSync(join(staged, 'bin', 'deep'), ['--version'], { encoding: 'utf8', env: { HOME: empty, PATH: join(empty, 'bin') } });
  const version = JSON.parse(readFileSync(join(staged, 'package.json'), 'utf8')).version;
  if (ran.status !== 0 || !ran.stdout.includes(version)) fail(`bin/deep --version with an empty PATH exited ${ran.status}: ${(ran.stderr || ran.stdout).slice(-2000)}`);

  // Every program links only the system's libraries.
  const machO = (file) => {
    const fd = openSync(file, 'r');
    const head = Buffer.alloc(4);
    try { readSync(fd, head, 0, 4, 0); } finally { closeSync(fd); }
    return ['cffaedfe', 'cefaedfe', 'cafebabe', 'feedfacf'].includes(head.toString('hex'));
  };
  const outside = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const st = lstatSync(path);
      if (st.isDirectory()) walk(path);
      else if (st.isFile() && st.size >= 4 && machO(path)) {
        for (const line of run('otool', ['-L', path]).split('\n').slice(1)) {
          const lib = line.trim().split(' (')[0];
          if (lib && !/^(\/usr\/lib\/|\/System\/|@rpath\/|@loader_path\/|@executable_path\/)/.test(lib)) outside.push(`${path.slice(staged.length + 1)} links ${lib}`);
        }
      }
    }
  };
  walk(staged);
  if (outside.length) fail(`programs in the runtime link libraries outside the system's:\n  ${outside.join('\n  ')}`);

  rmSync(out, { recursive: true, force: true });
  renameSync(staged, out);
  console.log(`app-runtime: ${version} laid out in ${out}${plant ? ` (planted: ${plant})` : ''}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

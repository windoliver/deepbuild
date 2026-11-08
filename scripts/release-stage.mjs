#!/usr/bin/env node
// The npm packages' layout (#41), run by scripts/release-pack.mjs inside its clean checkout of the release commit:
//   node scripts/release-stage.mjs --out <dir>
// It installs this checkout's locked dependencies, builds every workspace and deep-hook (release profile), then lays
// out under <dir>, ready for `npm pack`:
//   deepbuild/  the `deep` command: the workspaces the CLI loads at the checkout's relative paths (package.json and
//               runtime files, built dist/ without tests, maps or declarations), the root folders their code reads
//               (adapters/, skills/deepbuild/, deep-hook's default rules, the banner's mark), and the third-party
//               packages they load, bundled with what they don't need at run time left out. bin/deep.mjs is
//               scripts/npm-launcher.mjs. This platform's deep-hook package is its optional dependency.
//   deep-hook-<platform>-<arch>/  `@deepbuild/deep-hook-<platform>-<arch>`, for this host's platform and linux-x64 and
//               linux-arm64: bin/deep-hook and SQLite's native module; built-<platform>-<arch>/ holds the same files as
//               built, for release-verify.
// <dir>/stage.json lists the package folders, each with its built tree when it has one.
import { spawnSync } from 'node:child_process';
import { chmodSync, constants, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';

const fail = (message) => {
  console.error(`release-stage: ${message}`);
  process.exit(1);
};
const at = process.argv.indexOf('--out');
if (at < 0 || !process.argv[at + 1]) fail('usage: release-stage.mjs --out <dir>');
const out = resolve(process.argv[at + 1]);
const REPO = realpathSync(process.cwd());
const run = (cmd, args, env = process.env) => {
  const r = spawnSync(cmd, args, { cwd: REPO, env, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) fail(`${cmd} ${args.join(' ')} failed: ${(r.stderr || r.stdout || String(r.error)).slice(-4000)}`);
  return r.stdout;
};
const readJson = (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
const copy = (from, to, filter) => {
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true, dereference: true, mode: constants.COPYFILE_FICLONE, ...(filter ? { filter } : {}) });
};

// The build, from this checkout's lockfiles alone.
run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
run('npm', ['run', 'build', '--workspaces', '--if-present']);
const home = userInfo().homedir;
const cargoHome = process.env.CARGO_HOME ?? join(home, '.cargo');
const cargo = existsSync(join(cargoHome, 'bin', 'cargo')) ? join(cargoHome, 'bin', 'cargo') : 'cargo';
// No compiler wrapper (a build cache your cargo config may name): the release compiles with rustc itself.
const cargoEnv = { ...process.env, CARGO_HOME: cargoHome, RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(home, '.rustup'), RUSTC_WRAPPER: '' };
run(cargo, ['build', '--release', '--locked', '-q', '-p', 'deep-hook'], cargoEnv);
// The release's platforms: this host's, and Linux on both architectures, whose deep-hook is a static musl build
// linked by zig from any host. Each needs its rustup target (`rustup target add <triple>`) and zig.
const builds = new Map([[`${process.platform}-${process.arch}`, join(REPO, 'target', 'release', 'deep-hook')]]);
const LINUX = { x64: ['x86_64-unknown-linux-musl', 'x86_64-linux-musl'], arm64: ['aarch64-unknown-linux-musl', 'aarch64-linux-musl'] };
const zig = [...(process.env.PATH ?? '').split(':'), '/opt/homebrew/bin', '/usr/local/bin'].map((d) => join(d, 'zig')).find((p) => existsSync(p));
for (const [arch, [triple, zigTarget]] of Object.entries(LINUX)) {
  if (builds.has(`linux-${arch}`)) continue;
  if (!zig) fail(`no zig on PATH, /opt/homebrew/bin or /usr/local/bin to link deep-hook for linux-${arch}`);
  // rustc's own musl start files are left out, since zig links its own; zig refuses one aarch64 linker flag it doesn't need.
  const linker = join(out, `.cc-${triple}`);
  mkdirSync(out, { recursive: true });
  writeFileSync(linker, `#!/bin/sh\nfor a in "$@"; do shift; a=$(printf '%s' "$a" | sed 's/,--fix-cortex-a53-843419//; s/^--fix-cortex-a53-843419$//'); case "$a" in ''|-Wl) ;; *) set -- "$@" "$a";; esac; done\nexec '${zig}' cc -target ${zigTarget} "$@"\n`, { mode: 0o755 });
  const key = triple.toUpperCase().replaceAll('-', '_');
  run(cargo, ['build', '--release', '--locked', '-q', '-p', 'deep-hook', '--target', triple], { ...cargoEnv, [`CARGO_TARGET_${key}_LINKER`]: linker, [`CARGO_TARGET_${key}_RUSTFLAGS`]: '-C link-self-contained=no' });
  builds.set(`linux-${arch}`, join(REPO, 'target', triple, 'release', 'deep-hook'));
}

const root = readJson(REPO);
const version = root.version;
const hookName = (platform) => `@deepbuild/deep-hook-${platform}`;
const pkg = join(out, 'deepbuild');

// The packages the CLI loads, by Node's lookup from each package's folder up to the checkout.
const cli = join(REPO, 'packages', 'cli');
const workspaces = new Set([cli]);
const thirdParty = new Map();
const locate = (from, name) => {
  for (let dir = from; ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'node_modules', name, 'package.json'))) return join(dir, 'node_modules', name);
    if (dir === REPO || dirname(dir) === dir) return undefined;
  }
};
const queue = [cli];
for (const dir of queue) {
  const meta = readJson(dir);
  for (const [deps, optional] of [[meta.dependencies, false], [meta.optionalDependencies, true]]) {
    for (const name of Object.keys(deps ?? {})) {
      const found = locate(dir, name);
      if (!found) {
        if (optional) continue;
        fail(`${meta.name} depends on ${name}, which no node_modules from ${relative(REPO, dir) || '.'} holds`);
      }
      const real = realpathSync(found);
      if (real.startsWith(`${REPO}${sep}packages${sep}`)) {
        if (!workspaces.has(real)) { workspaces.add(real); queue.push(real); }
      } else if (!thirdParty.has(name)) {
        if (dirname(found) !== join(REPO, 'node_modules') && dirname(dirname(found)) !== join(REPO, 'node_modules')) fail(`${name} is installed at ${relative(REPO, found)}, not the checkout's node_modules, so it can't be bundled`);
        thirdParty.set(name, found);
        queue.push(real);
      }
    }
  }
}

// The workspaces: what npm packs of each, and its dist/, without what only builds or tests use.
const listed = JSON.parse(run('npm', ['pack', '--dry-run', '--json', '--ignore-scripts', ...[...workspaces].flatMap((w) => ['--workspace', relative(REPO, w)])]));
const files = new Map(listed.map((p) => [p.name, p.files.map((f) => f.path)]));
const runtime = (path) => !/(^|\/)(test|tests|__tests__)\//.test(path) && !/\.(test|spec)\.[cm]?js$/.test(path) && !/\.(map|tsbuildinfo)$/.test(path) && !/\.[cm]?ts$/.test(path) && !/(^|\/)tsconfig[^/]*\.json$/.test(path);
for (const dir of workspaces) {
  const meta = readJson(dir);
  const rel = relative(REPO, dir);
  const paths = new Set(files.get(meta.name) ?? fail(`npm pack listed nothing for ${meta.name}`));
  if (existsSync(join(dir, 'dist'))) for (const f of spawnSync('find', ['dist', '-type', 'f'], { cwd: dir, encoding: 'utf8' }).stdout.split('\n').filter(Boolean)) paths.add(f);
  for (const path of paths) if (path !== 'package.json' && runtime(path)) copy(join(dir, path), join(pkg, rel, path));
  // Each workspace's own manifest without its `files`, which would otherwise filter what npm packs of the folder.
  const { files: _files, scripts: _scripts, devDependencies: _dev, ...kept } = meta;
  writeFileSync(join(pkg, rel, 'package.json'), `${JSON.stringify(dir === cli ? { ...kept, version } : kept, null, 2)}\n`);
}

// The root folders the workspaces read by relative path.
for (const file of ['README.md', 'LICENSE', 'adapters', 'skills/deepbuild', 'crates/deep-hook/default-rules.json', 'brand/png/favicon-32.png']) copy(join(REPO, file), join(pkg, file));

// Third-party packages, bundled: what they don't load at run time is left out. SQLite's native module is in the
// platform package, which the launcher links in.
const trims = {
  'better-sqlite3': (p) => !/^(deps|src|prebuilds|build|binding\.gyp)(\/|$)/.test(p),
  typescript: (p) => ['package.json', 'LICENSE.txt', 'lib', 'lib/typescript.js'].includes(p),
  yaml: (p) => !/^browser(\/|$)/.test(p) && !/\.d\.ts$/.test(p),
};
const dependencies = {};
for (const [name, at] of thirdParty) {
  dependencies[name] = readJson(at).version;
  const keep = trims[name];
  copy(at, join(pkg, 'node_modules', name), keep ? (src) => { const p = relative(at, src); return p === '' || keep(p); } : undefined);
}

mkdirSync(join(pkg, 'bin'), { recursive: true });
copyFileSync(join(REPO, 'scripts', 'npm-launcher.mjs'), join(pkg, 'bin', 'deep.mjs'));
chmodSync(join(pkg, 'bin', 'deep.mjs'), 0o755);
const names = Object.keys(dependencies).sort();
writeFileSync(join(pkg, 'package.json'), `${JSON.stringify({
  name: 'deepbuild', version, description: 'DeepBuild: the deep command', type: 'module', license: root.license, engines: root.engines,
  bin: { deep: 'bin/deep.mjs' },
  files: ['bin', 'packages', 'adapters', 'skills', 'crates', 'brand', 'README.md', 'LICENSE'],
  dependencies: Object.fromEntries(names.map((n) => [n, dependencies[n]])), bundleDependencies: names,
  optionalDependencies: Object.fromEntries([...builds.keys()].sort().map((p) => [hookName(p), version])),
}, null, 2)}\n`);

// Each platform's deep-hook package (its deep-hook and SQLite's native module), and the built tree it must match.
const staged = [{ dir: 'deepbuild' }];
for (const [platform, hook] of builds) {
  const [os, cpu] = platform.split('-');
  const hookPkg = join(out, `deep-hook-${platform}`);
  const built = join(out, `built-${platform}`);
  const sources = { 'deep-hook': hook, 'better_sqlite3.node': join(REPO, 'node_modules', 'better-sqlite3', 'prebuilds', `${platform}.node`) };
  for (const [name, from] of Object.entries(sources)) {
    if (!existsSync(from)) fail(`${from} is not built for ${platform}`);
    for (const dir of [join(hookPkg, 'bin'), built]) {
      mkdirSync(dir, { recursive: true });
      copyFileSync(from, join(dir, name));
      chmodSync(join(dir, name), 0o755);
    }
  }
  writeFileSync(join(hookPkg, 'package.json'), `${JSON.stringify({ name: hookName(platform), version, description: `DeepBuild's deep-hook for ${platform}`, license: root.license, os: [os], cpu: [cpu], files: ['bin'] }, null, 2)}\n`);
  staged.push({ dir: `deep-hook-${platform}`, built: `built-${platform}` });
}
writeFileSync(join(out, 'stage.json'), `${JSON.stringify({ packages: staged }, null, 2)}\n`);
console.log(`release-stage: deepbuild ${version} and deep-hook for ${[...builds.keys()].join(', ')} laid out in ${out}`);

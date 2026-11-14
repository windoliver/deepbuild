#!/usr/bin/env node
// The installed tree (#41): lays out the `deepbuild` package under a prefix as `npm install --global --prefix <dir>
// --ignore-scripts` would, from this checkout's already-built files; it builds nothing.
//   node scripts/install-prefix.mjs --prefix <dir> [--plant checkout-fallback]
// <dir>/lib/node_modules/deepbuild/ holds real copies, at the checkout's relative paths, of the root's package.json,
// README and licence and the folders the CLI reads beside it (adapters/, the first-party packs/, the banner's mark); of every workspace package
// the root's `bin` loads, as `npm pack` lists it plus its built dist/ (no package lists dist in a `files` list yet),
// each linked at node_modules/<name> as npm links a workspace; of the third-party packages those depend on; and of the
// canvas core, the newer of target/release and target/debug deep-show, shipped in the hub's dist/ beside its
// native helper. <dir>/bin/deep is npm's link to the root's bin.
// `--plant checkout-fallback` lays out the wrong program #41's AC20 catches: the same tree, with a <dir>/bin/deep
// that reads any file missing from that tree from the checkout's copy instead.
import { spawnSync } from 'node:child_process';
import { chmodSync, constants, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const fail = (message) => {
  console.error(`install-prefix: ${message}`);
  process.exit(1);
};
const flag = (name) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? undefined : process.argv[at + 1];
};
const [prefixArg, plant] = [flag('prefix'), flag('plant')];
if (!prefixArg) fail('usage: install-prefix.mjs --prefix <dir> [--plant checkout-fallback]');
if (plant !== undefined && plant !== 'checkout-fallback') fail(`--plant ${plant} names no planted install; the one is checkout-fallback`);

const REPO = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
mkdirSync(resolve(prefixArg), { recursive: true });
// Its real path, as the modules loaded from it see theirs.
const prefix = realpathSync(resolve(prefixArg));
const tree = join(prefix, 'lib', 'node_modules', 'deepbuild');
const readJson = (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
// Copy-on-write clones where the volume has them: each still a file of its own, never a link.
const copy = (from, to) => {
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true, dereference: true, mode: constants.COPYFILE_FICLONE });
};

const root = readJson(REPO);
const binRel = root.bin?.deep;
if (!binRel || !existsSync(join(REPO, binRel))) fail(`the root's bin ${binRel} is not built; run npm run build first`);
rmSync(tree, { recursive: true, force: true });
for (const file of ['package.json', 'README.md', 'LICENSE', 'adapters', 'packs', 'brand/png/favicon-32.png']) copy(join(REPO, file), join(tree, file));

// The packages the bin loads, by Node's lookup from each package's folder up to the checkout: a workspace by its
// real folder under packages/, a third-party package where node_modules holds it.
let binPackage = dirname(join(REPO, binRel));
while (!existsSync(join(binPackage, 'package.json'))) binPackage = dirname(binPackage);
const workspaces = new Set([binPackage]);
const links = new Map();
const thirdParty = new Set();
const locate = (from, name) => {
  for (let dir = from; ; dir = dirname(dir)) {
    const at = join(dir, 'node_modules', name);
    if (existsSync(join(at, 'package.json'))) return at;
    if (dir === REPO || dirname(dir) === dir) return undefined;
  }
};
const queue = [binPackage];
for (const dir of queue) {
  const meta = readJson(dir);
  for (const [deps, optional] of [[meta.dependencies, false], [meta.optionalDependencies, true]]) {
    for (const name of Object.keys(deps ?? {})) {
      const at = locate(dir, name);
      if (!at) {
        if (optional) continue;
        fail(`${meta.name} depends on ${name}, which no node_modules from ${relative(REPO, dir) || '.'} holds; run npm install first`);
      }
      const real = realpathSync(at);
      if (real.startsWith(`${REPO}${sep}packages${sep}`)) {
        links.set(relative(REPO, at), relative(dirname(at), real));
        if (!workspaces.has(real)) {
          workspaces.add(real);
          queue.push(real);
        }
      } else if (![...thirdParty].some((t) => at === t || at.startsWith(`${t}${sep}`))) {
        thirdParty.add(at);
        queue.push(real);
      }
    }
  }
}

// Each workspace as npm packs it, from one `npm pack --dry-run`, and its built dist/.
const args = ['pack', '--dry-run', '--json', '--ignore-scripts', ...[...workspaces].flatMap((w) => ['--workspace', relative(REPO, w)])];
const packed = spawnSync('npm', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 28 });
if (packed.status !== 0) fail(`npm ${args.join(' ')} failed: ${packed.stderr || packed.error}`);
const listings = new Map(JSON.parse(packed.stdout).map((p) => [p.name, p.files.map((f) => f.path)]));
for (const dir of workspaces) {
  const { name } = readJson(dir);
  const files = listings.get(name);
  if (!files) fail(`npm pack listed nothing for ${name}`);
  const rel = relative(REPO, dir);
  for (const file of files) copy(join(dir, file), join(tree, rel, file));
  if (existsSync(join(dir, 'dist'))) copy(join(dir, 'dist'), join(tree, rel, 'dist'));
}
for (const [at, target] of links) {
  mkdirSync(dirname(join(tree, at)), { recursive: true });
  symlinkSync(target, join(tree, at));
}
for (const at of thirdParty) copy(at, join(tree, relative(REPO, at)));

// The canvas core, beside the hub's code, where its canvas side looks first.
const hub = [...workspaces].find((w) => readJson(w).name === '@deepbuild/hub');
const core = ['release', 'debug'].map((p) => join(REPO, 'target', p, 'deep-show')).filter((p) => existsSync(p))
  .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
if (!hub || !core) fail(`no canvas core is built under ${join(REPO, 'target')}; run cargo build -p deep-show --bin deep-show first`);
copyFileSync(core, join(tree, relative(REPO, hub), 'dist', 'deep-show'), constants.COPYFILE_FICLONE);

chmodSync(join(tree, binRel), 0o755);
const deep = join(prefix, 'bin', 'deep');
mkdirSync(dirname(deep), { recursive: true });
rmSync(deep, { force: true });
if (!plant) symlinkSync(relative(dirname(deep), join(tree, binRel)), deep);
else {
  writeFileSync(deep, `#!/usr/bin/env node
// The planted wrong program of #41's AC20 (scripts/install-prefix.mjs --plant checkout-fallback): a file missing from
// the installed tree is read from the checkout's copy, so the still export passes where the real install fails.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
const TREE = ${JSON.stringify(tree)};
const CHECKOUT = ${JSON.stringify(REPO)};
const exists = fs.existsSync;
const away = (p) => {
  const path = p instanceof URL || String(p).startsWith('file:') ? fileURLToPath(p) : String(p);
  return path.startsWith(TREE + '/') && !exists(path) ? CHECKOUT + path.slice(TREE.length) : p;
};
for (const name of ['readFileSync', 'readdirSync', 'statSync', 'existsSync', 'openSync']) {
  const real = fs[name];
  fs[name] = (p, ...rest) => real(away(p), ...rest);
}
syncBuiltinESMExports();
await import(${JSON.stringify(pathToFileURL(join(tree, binRel)).href)});
`, { mode: 0o755 });
}
console.log(`install-prefix: deepbuild laid out in ${tree}${plant ? ` (planted: ${plant})` : ''}, deep at ${deep}`);

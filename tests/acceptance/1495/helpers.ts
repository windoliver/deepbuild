// Test-side tools for #1495's acceptance tests (README): fixture releases (tiny throwaway git repos holding the version
// sources the real repo has, in its layout), their release folders (artifacts and the signed manifest, as #41's
// release-pack writes them), the release preflight's report, and runs of `scripts/release.mjs`, the one surface under
// test. Nothing here stands in for the release: every judge reads what the script printed and what it left in the
// fixture's repo, its output folder and its publish folder.
//
// Safety: every folder is a temp folder under /tmp, removed by `cleanup`; HOME is the world's own; git reads no user or
// system config and runs no hook; npm's registry is a closed loopback port, so nothing could be published anywhere.
// Processes are started with spawnSync, whose timeout stops the one child it started, by its PID.
import { spawnSync } from 'node:child_process';
import { createHash, createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';
import { chmodSync, copyFileSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

export const REPO = realpathSync(fileURLToPath(new URL('../../../', import.meta.url))).replace(/\/+$/, '');
export const SCRIPT = join(REPO, 'scripts', 'release.mjs');
/** The fixture film, a copy of #41's (itself #417's look film); its still is frame 30. */
export const FILM = fileURLToPath(new URL('./fixtures/film.json', import.meta.url));
/** Where a release commit holds the fixture film its app-download check exports (README, The contract, 9). */
const FILM_IN_REPO = 'tests/fixtures/films/release-still/film.json';
export const STILL = '30';
export const MIN = 60_000;
export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The criteria: `#1495.<first 8 hex of SHA-256(text, trimmed, white space collapsed)>` (scripts/proof-change.mjs). */
const ID = {
  1: '#1495.2599b24d', 2: '#1495.33e806c7', 3: '#1495.4e3f9f7e', 4: '#1495.7d91f999', 5: '#1495.c2b38fd8', 6: '#1495.1a706da4',
  7: '#1495.7644dc0b', 8: '#1495.1fbd7770', 9: '#1495.a1f2c768', 10: '#1495.f010e08b', 11: '#1495.84b5e71f', 12: '#1495.e029821e',
} as const;
export const named = (n: keyof typeof ID): string => `AC${n} ${ID[n]}`;

const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
export const sha256File = (path: string): string => sha256(readFileSync(path));
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---- Temp folders, short real paths under /tmp, removed by cleanup().

const made: string[] = [];
export function tempDir(prefix = 'dr1495-'): string {
  const dir = realpathSync(mkdtempSync(join('/tmp', prefix)));
  made.push(dir);
  return dir;
}
export function cleanup(): void {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

type Files = Record<string, string>;
export function put(root: string, files: Files): void {
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
}

// ---- Processes.

export interface Ran { code: number | null; signal: string | null; stdout: string; stderr: string; text: string }
function runSync(command: string, args: readonly string[], o: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs?: number }): Ran {
  const r = spawnSync(command, args, { cwd: o.cwd, env: o.env, encoding: 'utf8', timeout: o.timeoutMs ?? 10 * MIN, killSignal: 'SIGKILL', maxBuffer: 1 << 28 });
  const stdout = r.stdout ?? '';
  const stderr = `${r.stderr ?? ''}${r.error ? `\n[${r.error.message}]` : ''}`;
  return { code: r.status, signal: r.signal, stdout, stderr, text: `${stdout}\n${stderr}` };
}
export const shown = (r: Ran, n = 3000): string =>
  `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}\n--- stdout\n${r.stdout.slice(-n)}\n--- stderr\n${r.stderr.slice(-n)}`;

/** This process's environment without anything that points git, npm or DeepBuild at a real home, registry or hub. */
function scrubbed(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(DEEP_|GIT_|npm_|NPM_|NODE_|XDG_|CLAUDE|CODEX|VITEST|TEST$)/i.test(k)) env[k] = v;
  env.PATH = `${dirname(process.execPath)}:${process.env.PATH ?? '/usr/bin:/bin'}`;
  return env;
}

// ---- A world: one fixture release's folders, key, known-limits file and environment.

export interface World {
  dir: string;
  /** The fixture release's git checkout. */
  repo: string;
  /** The release's output folder (`--out`). */
  out: string;
  /** Where the release publishes (`--publish`). */
  publish: string;
  /** The Ed25519 private key the manifest is signed with (`--key`), PKCS8 PEM, outside the repo. */
  key: string;
  env: NodeJS.ProcessEnv;
}
export function world(): World {
  const dir = tempDir();
  const [repo, home, publish] = ['repo', 'home', 'publish'].map((name) => join(dir, name)) as [string, string, string];
  for (const d of [repo, home, publish]) mkdirSync(d, { recursive: true });
  const { privateKey } = generateKeyPairSync('ed25519');
  const key = join(dir, 'release-key.pem');
  writeFileSync(key, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  // Open known-limit items (README, The contract, 10): none, so the release never asks GitHub.
  const limits = join(dir, 'known-limits.json');
  writeFileSync(limits, '[]\n');
  const gitconfig = join(dir, 'gitconfig');
  writeFileSync(gitconfig, '');
  const env: NodeJS.ProcessEnv = {
    ...scrubbed(), HOME: home, DEEP_KNOWN_LIMITS: limits,
    GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: '/dev/null',
    GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    npm_config_registry: 'http://127.0.0.1:9',
  };
  return { dir, repo, out: join(dir, 'out'), publish, key, env };
}

export function git(w: World, ...args: string[]): string {
  const r = runSync('git', args, { cwd: w.repo, env: w.env, timeoutMs: MIN });
  if (r.code !== 0) throw Error(`git ${args.join(' ')} failed: ${shown(r)}`);
  return r.stdout.trim();
}
/** Commits everything in the fixture's tree; returns the new commit. */
export function commitAll(w: World, message: string): string {
  git(w, 'add', '-A');
  git(w, 'commit', '-q', '-m', message);
  return git(w, 'rev-parse', 'HEAD');
}
/** The commit a tag names in the fixture, or null when there's no such tag. */
export function tagged(w: World, version: string): string | null {
  const r = runSync('git', ['rev-parse', '-q', '--verify', `refs/tags/release/${version}^{commit}`], { cwd: w.repo, env: w.env, timeoutMs: MIN });
  return r.code === 0 ? r.stdout.trim() : null;
}

// ---- The version sources, in the real repo's layout (README, The contract, 2).

/** A third-party pin at the old release's version: it is not the release's, so no bump moves it. */
export const THIRD_PARTY = '1.2.0';
const PACKAGES = ['cli', 'contracts', 'hub'] as const;
const CRATES = ['deep-contracts', 'deep-hook', 'deep-show'] as const;
const PACKS = ['foley-1.0.0', 'verbs-1.0.0'] as const;
/** Every file a bump moves: the version sources the fixture has. */
export const VERSION_FILES = [
  'package.json', 'package-lock.json', ...PACKAGES.map((p) => `packages/${p}/package.json`),
  ...CRATES.map((c) => `crates/${c}/Cargo.toml`), 'Cargo.lock', 'scripts/app-bundle', ...PACKS.map((p) => `packs/${p}/pack.json`),
].sort();

const deps: Record<(typeof PACKAGES)[number], (v: string) => Record<string, string>> = {
  cli: (v) => ({ '@deepbuild/hub': v, yaml: THIRD_PARTY }),
  contracts: () => ({}),
  hub: (v) => ({ '@deepbuild/contracts': v }),
};
const crateDeps: Record<(typeof CRATES)[number], string[]> = { 'deep-contracts': ['itoa'], 'deep-hook': ['deep-contracts'], 'deep-show': ['deep-contracts'] };

/** The version sources at `version`, every one of them (the files VERSION_FILES lists, plus the workspace Cargo.toml). */
function versionSources(version: string): Files {
  const files: Files = {
    'package.json': json({ name: 'deepbuild', version, private: true, type: 'module', license: 'Apache-2.0', workspaces: ['packages/*'], devDependencies: { typescript: THIRD_PARTY } }),
    'Cargo.toml': `[workspace]\nmembers = [${CRATES.map((c) => `"crates/${c}"`).join(', ')}]\nresolver = "2"\n`,
    'scripts/app-bundle': [
      '#!/bin/sh',
      "# The app bundle's Info.plist, as scripts/app-bundle writes it (a fixture copy of its version line, #1495).",
      'set -eu',
      'app="$(cd "$(dirname "$0")/.." && pwd)/target/DeepBuild.app"',
      'mkdir -p "$app/Contents"',
      "cat >\"$app/Contents/Info.plist\" <<'PLIST'",
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<plist version="1.0">',
      '<dict>',
      '  <key>CFBundleIdentifier</key><string>dev.deepbuild.DeepBuild</string>',
      '  <key>CFBundleName</key><string>DeepBuild</string>',
      `  <key>CFBundleShortVersionString</key><string>${version}</string>`,
      '</dict>',
      '</plist>',
      'PLIST',
      'echo "$app"',
      '',
    ].join('\n'),
  };
  const lock: Record<string, unknown> = {
    '': { name: 'deepbuild', version, license: 'Apache-2.0', workspaces: ['packages/*'], devDependencies: { typescript: THIRD_PARTY } },
  };
  for (const p of PACKAGES) lock[`node_modules/@deepbuild/${p}`] = { resolved: `packages/${p}`, link: true };
  lock['node_modules/typescript'] = { version: THIRD_PARTY, resolved: `https://registry.npmjs.org/typescript/-/typescript-${THIRD_PARTY}.tgz`, integrity: 'sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==', dev: true, license: 'Apache-2.0' };
  lock['node_modules/yaml'] = { version: THIRD_PARTY, resolved: `https://registry.npmjs.org/yaml/-/yaml-${THIRD_PARTY}.tgz`, integrity: 'sha512-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB==', license: 'ISC' };
  for (const p of PACKAGES) {
    const d = deps[p](version);
    const meta = { name: `@deepbuild/${p}`, version, private: true, type: 'module', license: 'Apache-2.0', ...(Object.keys(d).length ? { dependencies: d } : {}) };
    files[`packages/${p}/package.json`] = json(meta);
    lock[`packages/${p}`] = { name: `@deepbuild/${p}`, version, license: 'Apache-2.0', ...(Object.keys(d).length ? { dependencies: d } : {}) };
  }
  files['package-lock.json'] = json({ name: 'deepbuild', version, lockfileVersion: 3, requires: true, packages: lock });
  for (const c of CRATES) {
    const own = c === 'deep-contracts' ? `itoa = "${THIRD_PARTY}"` : 'deep-contracts = { path = "../deep-contracts" }';
    files[`crates/${c}/Cargo.toml`] = `[package]\nname = "${c}"\nversion = "${version}"\nedition = "2021"\nlicense = "Apache-2.0"\npublish = false\n\n[dependencies]\n${own}\n`;
  }
  const blocks = CRATES.map((c) => `[[package]]\nname = "${c}"\nversion = "${version}"\ndependencies = [\n${crateDeps[c].map((d) => ` "${d}",`).join('\n')}\n]\n`);
  blocks.push(`[[package]]\nname = "itoa"\nversion = "${THIRD_PARTY}"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "${'c'.repeat(64)}"\n`);
  files['Cargo.lock'] = `# This file is automatically @generated by Cargo.\n# It is not intended for manual editing.\nversion = 4\n\n${blocks.join('\n')}`;
  for (const p of PACKS) {
    const [pack] = p.split('-');
    files[`packs/${p}/pack.json`] = json({ name: pack, version: '1.0.0', license: 'Apache-2.0', requires: { core: `>=${version}`, modules: { media: '>=1.0.0' } } });
  }
  return files;
}

/** The fixture release's whole first tree at `version`: its version sources, each crate's one source file, a README and the fixture film. */
function firstTree(version: string): Files {
  return {
    ...versionSources(version),
    'crates/deep-contracts/src/lib.rs': '//! A fixture crate: it holds a version and builds nothing.\n',
    'crates/deep-hook/src/main.rs': 'fn main() {}\n',
    'crates/deep-show/src/main.rs': 'fn main() {}\n',
    'README.md': '# Fixture release\n\nA release #1495\'s acceptance tests cut. It ships nothing.\n',
    [FILM_IN_REPO]: readFileSync(FILM, 'utf8'),
  };
}

/** A fixture repo at `version`: its first commit. */
export function initRepo(w: World, version: string, extra: Files = {}): string {
  git(w, 'init', '-q', '-b', 'main');
  put(w.repo, { ...firstTree(version), ...extra });
  return commitAll(w, `Fixture release at ${version}`);
}

interface Found { file: string; field: string; version: string }
/** Every version the fixture's sources hold for the release, read from the checkout (third-party pins left out). */
export function versionsIn(repo: string): Found[] {
  const read = (p: string): string => readFileSync(join(repo, p), 'utf8');
  const found: Found[] = [];
  const root = JSON.parse(read('package.json')) as { version: string };
  found.push({ file: 'package.json', field: 'version', version: root.version });
  for (const p of PACKAGES) {
    const file = `packages/${p}/package.json`;
    const meta = JSON.parse(read(file)) as { version: string; dependencies?: Record<string, string> };
    found.push({ file, field: 'version', version: meta.version });
    for (const [name, v] of Object.entries(meta.dependencies ?? {})) if (name.startsWith('@deepbuild/')) found.push({ file, field: `dependencies.${name}`, version: v });
  }
  const lock = JSON.parse(read('package-lock.json')) as { version: string; packages: Record<string, { version?: string; dependencies?: Record<string, string> }> };
  found.push({ file: 'package-lock.json', field: 'version', version: lock.version });
  found.push({ file: 'package-lock.json', field: 'packages[""].version', version: lock.packages['']?.version ?? '(none)' });
  for (const p of PACKAGES) {
    const entry = lock.packages[`packages/${p}`];
    found.push({ file: 'package-lock.json', field: `packages["packages/${p}"].version`, version: entry?.version ?? '(none)' });
    for (const [name, v] of Object.entries(entry?.dependencies ?? {})) if (name.startsWith('@deepbuild/')) found.push({ file: 'package-lock.json', field: `packages["packages/${p}"].dependencies.${name}`, version: v });
  }
  for (const c of CRATES) {
    const file = `crates/${c}/Cargo.toml`;
    found.push({ file, field: 'package.version', version: /\[package\][^[]*?\nversion\s*=\s*"([^"]+)"/.exec(read(file))?.[1] ?? '(none)' });
  }
  const cargoLock = read('Cargo.lock');
  for (const c of CRATES) found.push({ file: 'Cargo.lock', field: `package ${c}`, version: new RegExp(`\\[\\[package\\]\\]\\nname = "${escape(c)}"\\nversion = "([^"]+)"`).exec(cargoLock)?.[1] ?? '(none)' });
  found.push({ file: 'scripts/app-bundle', field: 'CFBundleShortVersionString', version: /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(read('scripts/app-bundle'))?.[1] ?? '(none)' });
  for (const p of PACKS) {
    const file = `packs/${p}/pack.json`;
    const core = (JSON.parse(read(file)) as { requires?: { core?: string } }).requires?.core ?? '(none)';
    found.push({ file, field: 'requires.core', version: core.replace(/^>=/, '') });
  }
  return found;
}

/** The pins that aren't the release's: they keep the third-party version, and each pack its own. */
export function othersIn(repo: string): Found[] {
  const read = (p: string): string => readFileSync(join(repo, p), 'utf8');
  const root = JSON.parse(read('package.json')) as { devDependencies: Record<string, string> };
  const cli = JSON.parse(read('packages/cli/package.json')) as { dependencies: Record<string, string> };
  const lock = JSON.parse(read('package-lock.json')) as { packages: Record<string, { version?: string; devDependencies?: Record<string, string>; dependencies?: Record<string, string> }> };
  const found: Found[] = [
    { file: 'package.json', field: 'devDependencies.typescript', version: root.devDependencies.typescript ?? '(none)' },
    { file: 'packages/cli/package.json', field: 'dependencies.yaml', version: cli.dependencies.yaml ?? '(none)' },
    { file: 'package-lock.json', field: 'packages["node_modules/typescript"].version', version: lock.packages['node_modules/typescript']?.version ?? '(none)' },
    { file: 'package-lock.json', field: 'packages["node_modules/yaml"].version', version: lock.packages['node_modules/yaml']?.version ?? '(none)' },
    { file: 'package-lock.json', field: 'packages[""].devDependencies.typescript', version: lock.packages['']?.devDependencies?.typescript ?? '(none)' },
    { file: 'crates/deep-contracts/Cargo.toml', field: 'dependencies.itoa', version: /\nitoa = "([^"]+)"/.exec(read('crates/deep-contracts/Cargo.toml'))?.[1] ?? '(none)' },
    { file: 'Cargo.lock', field: 'package itoa', version: /\[\[package\]\]\nname = "itoa"\nversion = "([^"]+)"/.exec(read('Cargo.lock'))?.[1] ?? '(none)' },
  ];
  for (const p of PACKS) found.push({ file: `packs/${p}/pack.json`, field: 'version', version: (JSON.parse(read(`packs/${p}/pack.json`)) as { version: string }).version });
  return found;
}

// ---- Artifacts, the signed manifest and the preflight report (README, The contract, 4 and 5).

export interface Held { path: string; sha256: string }
export interface Artifact { name: string; file: string; path: string; sha256: string; holds: Held[] }

/** Every regular file under `root`, by its path relative to `under` (links are not followed or listed). */
function filesUnder(root: string, under: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out.push(p.slice(under.length + 1));
    }
  };
  walk(root);
  return out.sort();
}
let built = 0;

/** An npm-shaped archive, as `npm pack` lays one out: `package/package.json` and the given files under `package/`. */
export function npmArchive(w: World, name: string, version: string, files: Files = {}): Artifact {
  const root = join(w.dir, 'build', `npm-${(built += 1)}`);
  put(join(root, 'package'), { 'package.json': json({ name, version, license: 'Apache-2.0' }), ...files });
  const file = `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`;
  const path = join(root, file);
  const r = runSync('tar', ['-czf', path, '-C', root, 'package'], { cwd: root, env: w.env, timeoutMs: MIN });
  if (r.code !== 0) throw Error(`tar failed: ${shown(r)}`);
  const holds = filesUnder(join(root, 'package'), root).map((p) => ({ path: p, sha256: sha256File(join(root, p)) }));
  return { name, file, path, sha256: sha256File(path), holds };
}

/** A small PNG, `width` by `height`, of a gradient: what a stand-in export writes. */
function png(width: number, height: number): Buffer {
  const row = width * 3 + 1;
  const raw = Buffer.alloc(row * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw.set([(x * 255) / width, (y * 255) / height, 128], y * row + 1 + x * 3);
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** The runtime folder inside an app download (design: Starting from nothing). */
export const RUNTIME = 'DeepBuild.app/Contents/Resources/runtime';
export const APP = 'DeepBuild.app';
export const appFile = (version: string): string => `DeepBuild-${version}.zip`;

/** An app download's Info.plist, as scripts/app-bundle writes it, at `version`. */
export function infoPlist(version: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n  <key>CFBundleIdentifier</key><string>dev.deepbuild.DeepBuild</string>\n  <key>CFBundleName</key><string>DeepBuild</string>\n  <key>CFBundleShortVersionString</key><string>${version}</string>\n</dict>\n</plist>\n`;
}

/** Zips an app folder as the release's app download is zipped (README, The contract, 4). */
export function zipApp(app: string, zip: string, env: NodeJS.ProcessEnv): void {
  const r = runSync('/usr/bin/ditto', ['-c', '-k', '--norsrc', '--keepParent', app, zip], { cwd: dirname(app), env, timeoutMs: 30 * MIN });
  if (r.code !== 0) throw Error(`ditto failed: ${shown(r)}`);
}

/**
 * A small app download (README, Fixtures): DeepBuild.app with its Info.plist and a runtime folder holding the
 * first-party packs and a stand-in `bin/deep` that passes the app check (it prints `version` for --version, and for
 * `export ... --out <file>` copies a PNG it carries to that file; /bin/sh and /bin/cp only, so it runs under the
 * sandbox). Its manifest entry lists every pack's files and both programs. `drop` leaves one pack's folder out of the
 * zip while the entry still lists it: the app download built wrong, its version strings unchanged.
 */
export function appDownload(w: World, version: string, o: { drop?: string } = {}): Artifact {
  const root = join(w.dir, 'build', `app-${(built += 1)}`);
  const runtime = join(root, RUNTIME);
  const deep = [
    '#!/bin/sh',
    '# A stand-in for the runtime\'s deep (#1495\'s fixtures): its version, and a still it carries for any export.',
    'here=$(cd "${0%/*}/.." && pwd)',
    'case "$1" in',
    `  --version) echo "${version}" ;;`,
    '  export)',
    '    out=""',
    '    while [ $# -gt 0 ]; do',
    '      if [ "$1" = "--out" ]; then out="$2"; fi',
    '      shift',
    '    done',
    '    [ -n "$out" ] || { echo "deep export: no --out" >&2; exit 2; }',
    '    /bin/cp "$here/still.png" "$out" ;;',
    '  *) echo "deep (stand-in): no command $1" >&2; exit 2 ;;',
    'esac',
    '',
  ].join('\n');
  put(root, { [`${APP}/Contents/Info.plist`]: infoPlist(version) });
  put(runtime, {
    'package.json': json({ name: 'deepbuild', version }),
    'bin/deep': deep,
    'bin/deep-hook': `#!/bin/sh\necho "${version}"\n`,
  });
  writeFileSync(join(runtime, 'still.png'), png(480, 270));
  for (const p of PACKS) {
    const [pack] = p.split('-');
    put(join(runtime, 'packs', p), {
      'pack.json': json({ name: pack, version: '1.0.0', license: 'Apache-2.0', requires: { core: `>=${version}` } }),
      'kinds/readme.md': `The ${pack} pack's kinds, as a fixture.\n`,
    });
  }
  chmodSync(join(runtime, 'bin', 'deep'), 0o755);
  chmodSync(join(runtime, 'bin', 'deep-hook'), 0o755);
  const holds = [
    ...['bin/deep', 'bin/deep-hook'].map((p) => `${RUNTIME}/${p}`),
    ...filesUnder(join(runtime, 'packs'), root),
  ].sort().map((p) => ({ path: p, sha256: sha256File(join(root, p)) }));
  if (o.drop) rmSync(join(runtime, 'packs', o.drop), { recursive: true });
  const path = join(root, appFile(version));
  zipApp(join(root, APP), path, w.env);
  return { name: APP, file: appFile(version), path, sha256: sha256File(path), holds };
}

/** The release folder as release-pack leaves it for `commit`: the artifacts, manifest.json and its Ed25519 signature. */
export function writeOut(w: World, commit: string, artifacts: readonly Artifact[], out = w.out): Buffer {
  mkdirSync(out, { recursive: true });
  for (const a of artifacts) copyFileSync(a.path, join(out, a.file));
  const manifest = Buffer.from(json({ commit, archives: artifacts.map((a) => ({ name: a.name, file: a.file, sha256: a.sha256, holds: a.holds })) }));
  writeFileSync(join(out, 'manifest.json'), manifest);
  writeFileSync(join(out, 'manifest.json.sig'), sign(null, manifest, createPrivateKey(readFileSync(w.key))));
  return manifest;
}

interface Lane { name: string; state: string; reason?: string }
/** Lanes that passed: a release report with nothing BLOCKED or INCONCLUSIVE. */
export const PASSING: Lane[] = [{ name: 'checks', state: 'PASS' }, { name: 'parity suite release', state: 'PASS' }];
let reports = 0;
/** The release preflight's report (README, The contract, 6), outside the repo. */
export function preflight(w: World, commit: string, lanes: readonly Lane[] = PASSING, verdict = 'PASS'): string {
  const path = join(w.dir, `preflight-${(reports += 1)}.json`);
  writeFileSync(path, json({ commit, verdict, lanes }));
  return path;
}

// ---- The release (README, The contract, 1).

/** One run of `node scripts/release.mjs <step> ...`, with DEEP_RELEASE_PLANT naming a planted program when given. */
export function release(w: World, step: 'bump' | 'notes' | 'tag', args: readonly string[], plant?: string, timeoutMs = 10 * MIN): Ran {
  const env = plant ? { ...w.env, DEEP_RELEASE_PLANT: plant } : w.env;
  return runSync(process.execPath, [SCRIPT, step, ...args], { cwd: w.dir, env, timeoutMs });
}
export const bump = (w: World, version: string): Ran => release(w, 'bump', ['--repo', w.repo, '--version', version]);
export const notes = (w: World, commit: string, report: string, o: { out?: string; plant?: string } = {}): Ran =>
  release(w, 'notes', ['--repo', w.repo, '--commit', commit, '--out', o.out ?? w.out, '--preflight', report], o.plant);
export const tag = (w: World, commit: string, report: string, o: { out?: string; plant?: string; timeoutMs?: number } = {}): Ran =>
  release(w, 'tag', ['--repo', w.repo, '--commit', commit, '--out', o.out ?? w.out, '--key', w.key, '--preflight', report, '--publish', w.publish], o.plant, o.timeoutMs);

/** The artifact files in the publish folder (regular files only), by name. */
export function published(w: World): string[] {
  return readdirSync(w.publish).filter((f) => lstatSync(join(w.publish, f)).isFile()).sort();
}
/** How many report lines start `<word> <file>` (README, The contract, 8). */
export function reported(text: string, word: 'verified' | 'published' | 'skipped', file: string): number {
  return text.split('\n').filter((line) => new RegExp(`^${word} ${escape(file)}(?:$|[\\s:])`).test(line.trim())).length;
}

/**
 * What a refused tag leaves, as one list of failures (empty when it was refused as the criterion says): a non-zero
 * exit, every name in the run's output, no `release/<version>` tag and nothing published.
 */
export function refusal(w: World, r: Ran, version: string, names: readonly string[]): string[] {
  const failures: string[] = [];
  if (r.code === 0) failures.push('the tag step exited 0; it was to refuse the release');
  for (const name of names) if (!r.text.includes(name)) failures.push(`the refusal doesn't name ${name}`);
  const at = tagged(w, version);
  if (at) failures.push(`release/${version} was tagged at ${at}`);
  const out = published(w);
  if (out.length) failures.push(`it published ${out.join(', ')}`);
  return failures;
}

// ---- Blessing decisions in a fixture release's history (README, The contract, 11).

export interface Decision { id: string; kind: 'golden' | 'corpus'; name: string; cause: string; share: number; largest: number }
/** The blessing of a golden 3.2% of whose pixels moved, by at most 9 code values (AC9). */
export const GOLDEN: Decision = { id: 'dec-0001-5a1f0c2e9b47', kind: 'golden', name: 'parity/marks/ring.figure', cause: 'stroke joins now mitre up to a 4:1 limit', share: 0.032, largest: 9 };
/** The acceptance of a corpus document the previous release saved. */
export const CORPUS: Decision = { id: 'dec-0002-c03e7d1a8f62', kind: 'corpus', name: 'saved-chart', cause: 'axis labels now sit on the baseline grid', share: 0.011, largest: 4 };
/** The golden's first blessing, made before the previous tag: never a row of this release. */
export const EARLIER = 'dec-0000-91b2e4f6a0c3';
const D0 = sha256('ring as first blessed');
const D1 = sha256('ring with mitred joins');
const S0 = sha256('saved-chart as the previous release drew it');
const S1 = sha256('saved-chart with the labels on the grid');

const STORE = 'parity/goldens/store.json';
const CORPUS_FILE = `crates/deep-show/kit-corpus/${CORPUS.name}.json`;
function store(blessed: boolean): string {
  const you = { kind: 'you', id: 'you' };
  const first = { digest: D0, state: blessed ? 'untriaged' : 'positive', backend: 'cpu', fingerprint: 'cpu', environment: sha256('cpu environment'), recorded_by: you, decision: EARLIER };
  const second = { digest: D1, state: 'positive', backend: 'cpu', fingerprint: 'cpu', environment: sha256('cpu environment'), recorded_by: you, decision: GOLDEN.id };
  const decisions: unknown[] = [{ decision: EARLIER, by: you, what: { bless: { fixture: GOLDEN.name, digest: D0, backend: 'cpu' } } }];
  if (blessed) {
    decisions.push({
      decision: GOLDEN.id, by: you,
      what: { bless: { fixture: GOLDEN.name, digest: D1, backend: 'cpu', cause: GOLDEN.cause } },
      comparison: { fixture: GOLDEN.name, backend: 'cpu', golden: D0, candidate: D1, share_past_tolerance: GOLDEN.share, largest_change: GOLDEN.largest },
    });
  }
  return json({ fixtures: { [GOLDEN.name]: { first_oracle: `${GOLDEN.name}#check0:analytic`, digests: blessed ? [first, second] : [first] } }, decisions });
}
function corpusDocument(accepted: boolean): string {
  const document = {
    format: 1, id: CORPUS.name, profile: 'figure', title: 'Saved chart', size: [320, 180],
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    items: { bar: { id: 'bar', kind: 'rect@1', layer: 'main', name: 'Bar', order: 'a0', params: { box: [40, 60, 120, 80], paint: { fill: { role: 'accent' } } } } },
  };
  const values = { 0: { bar: { box: [40, 60, 120, 80] } } };
  return json({
    name: CORPUS.name, document, modules: ['marks2d'], times: [0], values, snapshots: { 0: S0 },
    accepted: accepted ? [{
      cause: CORPUS.cause, decision: CORPUS.id, set_digest: sha256('module set'), values, snapshots: { 0: S1 },
      comparison: { document: CORPUS.name, time: 0, recorded: S0, candidate: S1, share_past_tolerance: CORPUS.share, largest_change: CORPUS.largest },
    }] : [],
  });
}

/**
 * A fixture release whose previous tag, release/1.2.0, holds the golden's first blessing and the corpus document the
 * release saved; since then, with `blessings`, one commit blesses the golden (GOLDEN) and one accepts the corpus
 * document's new result (CORPUS), else one commit changes only the README; last, every version source moves to 1.3.0.
 */
export function historyRelease(w: World, o: { blessings: boolean }): { commit: string; decisions: Decision[] } {
  initRepo(w, '1.2.0', { [STORE]: store(false), [CORPUS_FILE]: corpusDocument(false) });
  git(w, 'tag', 'release/1.2.0');
  if (o.blessings) {
    put(w.repo, { [STORE]: store(true) });
    commitAll(w, `Bless ${GOLDEN.name}: ${GOLDEN.cause}`);
    put(w.repo, { [CORPUS_FILE]: corpusDocument(true) });
    commitAll(w, `Accept ${CORPUS.name}'s new result: ${CORPUS.cause}`);
  } else {
    put(w.repo, { 'README.md': '# Fixture release\n\nA release #1495\'s acceptance tests cut, with no look that moved.\n' });
    commitAll(w, 'Say what the fixture release is');
  }
  put(w.repo, versionSources('1.3.0'));
  return { commit: commitAll(w, 'Version 1.3.0'), decisions: o.blessings ? [GOLDEN, CORPUS] : [] };
}

// ---- Reading the notes and the README the release wrote (README, The contract, 7).

interface LookRow { line: string; name: string; kind: string; cause: string; share: string; largest: string }
/** NOTES.md's `Looks that moved`: its heading line (or null), whether it says none, and its table's rows. */
export function looks(text: string): { heading: string | null; none: boolean; rows: LookRow[] } {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => /^#{0,6}\s*Looks that moved\b/i.test(l.trim()));
  if (at < 0) return { heading: null, none: false, rows: [] };
  const heading = lines[at]!.trim();
  const none = /^#{0,6}\s*Looks that moved:\s*none\.?$/i.test(heading) || /^none\.?$/i.test((lines.slice(at + 1).find((l) => l.trim()) ?? '').trim());
  const table: string[] = [];
  for (const line of lines.slice(at + 1)) {
    if (/^#{1,6}\s/.test(line.trim())) break;
    if (line.trim().startsWith('|')) table.push(line.trim());
    else if (table.length && line.trim()) break;
  }
  const cells = (line: string): string[] => line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  const header = table[0] ? cells(table[0]).map((c) => c.toLowerCase()) : [];
  const column = (start: string): number => header.findIndex((h) => h.startsWith(start));
  const [name, kind, cause, share, largest] = ['fixture or document', 'kind', 'cause', 'pixels past tolerance', 'largest change'].map(column) as [number, number, number, number, number];
  const rows = table.slice(1).filter((l) => !/^\|?\s*:?-{3,}/.test(l)).map((line) => {
    const c = cells(line);
    const cell = (i: number): string => (i >= 0 ? c[i] ?? '' : '');
    return { line, name: cell(name), kind: cell(kind), cause: cell(cause), share: cell(share), largest: cell(largest) };
  });
  return { heading, none, rows };
}
/** A row's share as a percentage, or NaN when the cell isn't one ("3.2%"). */
export const percent = (cell: string): number => {
  const m = /^(\d+(?:\.\d+)?)\s*%$/.exec(cell);
  return m ? Number(m[1]) : Number.NaN;
};
export const shownShare = (share: number): string => `${(share * 100).toFixed(1)}%`;

/** The bullets of the README's `Known limits` section, or null when it has none. */
export function knownLimits(text: string): string[] | null {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => /^#{1,6}\s*Known limits\b/i.test(l.trim()));
  if (at < 0) return null;
  const items: string[] = [];
  for (const line of lines.slice(at + 1)) {
    if (/^#{1,6}\s/.test(line.trim())) break;
    const m = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (m) items.push(m[1]!.trim());
  }
  return items;
}

/** Removes, by hand, every line of `file` holding `words`; returns the text it had. */
export function removeLines(file: string, words: string): string {
  const before = readFileSync(file, 'utf8');
  const after = before.split('\n').filter((l) => !l.includes(words)).join('\n');
  if (after === before) throw Error(`${file} has no line holding ${words}`);
  writeFileSync(file, after);
  return before;
}

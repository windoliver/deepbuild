// Where a release's version lives (#1495; technical design: How it installs, Cutting a release). The root
// package.json's `version` is the one source; every other place holds a copy that moves with it:
//   - each workspace package's package.json `version`, and each pin one workspace package's dependencies hold on
//     another (npm links a workspace only when the pin matches), with the same entries in package-lock.json and the
//     pins scripts/repo-rules.json allows;
//   - each Cargo workspace member's `[package] version`, with its entry in Cargo.lock, and the canvas crate's
//     CORE_VERSION and the schedule snapshots that name `core@<version>`, which its tests hold equal to it;
//   - the app bundle's CFBundleShortVersionString in scripts/app-bundle;
//   - each first-party pack's `requires.core` (`>=<version>`).
// The hook binary's version is its crate's (`deep-hook --version`). Each place is edited where it stands, so a
// bump's diff is its version strings and nothing else. A tree is read from the working folder (`onDisk`), which a
// bump writes, or from a commit (`atCommit`), which the tag step judges.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** The working folder as a tree: a file's text (undefined when absent) and a folder's entries. */
export const onDisk = (repo) => ({
  read: (path) => (existsSync(join(repo, path)) && statSync(join(repo, path)).isFile() ? readFileSync(join(repo, path), 'utf8') : undefined),
  list: (dir) => (existsSync(join(repo, dir)) && statSync(join(repo, dir)).isDirectory() ? readdirSync(join(repo, dir)).sort() : []),
});

/** A commit's tree, read through git. */
export function atCommit(repo, commit) {
  const git = (args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28 });
  const listed = git(['ls-tree', '-r', '-z', '--name-only', commit]);
  if (listed.status !== 0) throw Error(`git can't list ${commit}: ${listed.stderr.trim()}`);
  const paths = new Set(listed.stdout.split('\0').filter(Boolean));
  return {
    read: (path) => (paths.has(path) ? git(['show', `${commit}:${path}`]).stdout : undefined),
    list: (dir) => [...new Set([...paths].filter((p) => p.startsWith(`${dir}/`)).map((p) => p.slice(dir.length + 1).split('/')[0]))].sort(),
  };
}

/** The span of each string value in a JSON text, by its key path, so an edit keeps the file's layout. */
function jsonStrings(text) {
  const spans = new Map();
  let i = 0;
  const space = () => { while (/\s/.test(text[i] ?? '')) i++; };
  const string = () => {
    const start = i++;
    while (text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    i++;
    return { start, end: i, value: JSON.parse(text.slice(start, i)) };
  };
  const value = (path) => {
    space();
    if (text[i] === '"') return void spans.set(JSON.stringify(path), string());
    const close = text[i] === '{' ? '}' : text[i] === '[' ? ']' : null;
    if (!close) {
      while (i < text.length && !/[\s,\]}]/.test(text[i])) i++;
      return undefined;
    }
    i++;
    for (let n = 0; ; n++) {
      space();
      if (text[i] === close) return void i++;
      let key = n;
      if (close === '}') {
        key = string().value;
        space();
        i++;
      }
      value([...path, key]);
      space();
      if (text[i] === ',') i++;
    }
  };
  value([]);
  return spans;
}

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const DEPENDENCIES = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

/** The workspace packages' folders, as the root's `workspaces` globs list them. */
function workspaceDirs(tree, root) {
  const dirs = [];
  for (const glob of Array.isArray(root.workspaces) ? root.workspaces : (root.workspaces?.packages ?? [])) {
    if (!glob.endsWith('/*')) {
      if (tree.read(`${glob}/package.json`) !== undefined) dirs.push(glob);
      continue;
    }
    const parent = glob.slice(0, -2);
    for (const d of tree.list(parent)) if (tree.read(`${parent}/${d}/package.json`) !== undefined) dirs.push(`${parent}/${d}`);
  }
  return dirs;
}

/** A Cargo.toml's `[package]` name and version, with the span of the version inside its quotes. */
function cargoPackage(text) {
  let table = '', at = 0, name, version;
  for (const line of text.split('\n')) {
    // A table, or an array of tables such as [[bin]], whose `name` is a target's and not the package's.
    const header = /^\s*(\[\[?)([^\]]+)\]\]?\s*(?:#.*)?$/.exec(line);
    if (header) table = `${header[1]}${header[2].trim()}`.replace(/^\[/, '');
    else if (table === 'package') {
      const field = /^(\s*(name|version)\s*=\s*)"([^"]*)"/.exec(line);
      if (field?.[2] === 'name') name = field[3];
      if (field?.[2] === 'version') version = { value: field[3], start: at + field[1].length + 1, end: at + field[0].length - 1 };
    }
    at += line.length + 1;
  }
  return { name, version };
}

/**
 * Every place the version lives in `tree`: `{file, where, version}`, with what moving it takes, `json` (the string's
 * span and its new text) or `span` (the version's own characters).
 */
function versionPlaces(tree) {
  const places = [];
  const texts = new Map();
  const text = (file) => (texts.has(file) ? texts.get(file) : texts.set(file, tree.read(file)).get(file));
  const inJson = (file, path, where, of = (v) => v, to = (n) => n) => {
    const span = jsonStrings(text(file)).get(JSON.stringify(path));
    const version = span && of(span.value);
    if (version && SEMVER.test(version)) places.push({ file, where, version, json: { span, to } });
  };
  const pattern = (file, re, where) => {
    if (text(file) === undefined) return;
    for (const m of text(file).matchAll(re)) {
      const start = m.index + m[0].indexOf(m[1]);
      places.push({ file, where, version: m[1], span: { start, end: start + m[1].length } });
    }
  };

  const root = JSON.parse(text('package.json'));
  inJson('package.json', ['version'], 'version');
  const dirs = workspaceDirs(tree, root);
  const metas = new Map(dirs.map((d) => [d, JSON.parse(text(`${d}/package.json`))]));
  const names = new Set([root.name, ...[...metas.values()].map((m) => m.name)]);
  for (const [dir, meta] of metas) {
    inJson(`${dir}/package.json`, ['version'], 'version');
    for (const section of DEPENDENCIES) for (const name of Object.keys(meta[section] ?? {})) if (names.has(name)) inJson(`${dir}/package.json`, [section, name], `${section} ${name}`);
  }
  if (text('package-lock.json') !== undefined) {
    const lock = JSON.parse(text('package-lock.json'));
    inJson('package-lock.json', ['version'], 'version');
    inJson('package-lock.json', ['packages', '', 'version'], 'packages[""] version');
    for (const dir of dirs) {
      const entry = lock.packages?.[dir];
      if (!entry) continue;
      inJson('package-lock.json', ['packages', dir, 'version'], `packages["${dir}"] version`);
      for (const section of DEPENDENCIES) for (const name of Object.keys(entry[section] ?? {})) if (names.has(name)) inJson('package-lock.json', ['packages', dir, section, name], `packages["${dir}"] ${section} ${name}`);
    }
  }
  if (text('scripts/repo-rules.json') !== undefined) {
    for (const [manifest, sections] of Object.entries(JSON.parse(text('scripts/repo-rules.json')).deps ?? {})) {
      if (!manifest.endsWith('package.json')) continue;
      for (const [section, deps] of Object.entries(sections)) for (const name of Object.keys(deps)) if (names.has(name)) inJson('scripts/repo-rules.json', ['deps', manifest, section, name, 'spec'], `deps ${manifest} ${section} ${name}`);
    }
  }

  const members = text('Cargo.toml') === undefined ? '' : /^\[workspace\][^]*?^members\s*=\s*\[([^\]]*)\]/m.exec(text('Cargo.toml'))?.[1] ?? '';
  const crates = [...members.matchAll(/"([^"]+)"/g)].map((m) => `${m[1]}/Cargo.toml`).filter((file) => text(file) !== undefined)
    .map((file) => ({ file, ...cargoPackage(text(file)) }));
  // A member whose version can't be read holds none, which no release version equals.
  for (const c of crates) places.push({ file: c.file, where: `[package] version of ${c.name}`, version: c.version?.value ?? 'no version', ...(c.version && { span: c.version }) });
  // A workspace member's entry in Cargo.lock has no source line.
  for (const c of crates) pattern('Cargo.lock', new RegExp(`^\\[\\[package\\]\\]\\nname = "${c.name}"\\nversion = "([^"]*)"\\n(?!source = )`, 'gm'), `${c.name} version`);
  // The canvas core's version is its crate's, and the published plans name it.
  pattern('crates/deep-canvas/src/registry/mod.rs', /pub const CORE_VERSION: &str = "([^"]+)"/g, 'CORE_VERSION');
  for (const f of tree.list('crates/deep-show/schedule')) if (f.endsWith('.json')) pattern(`crates/deep-show/schedule/${f}`, /core@(\d+\.\d+\.\d+[^"\s]*)/g, 'core@');
  pattern('scripts/app-bundle', /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/g, 'CFBundleShortVersionString');
  for (const d of tree.list('packs')) {
    if (text(`packs/${d}/pack.json`) !== undefined) inJson(`packs/${d}/pack.json`, ['requires', 'core'], 'requires.core', (v) => /^>=\s*(\S+)$/.exec(v)?.[1], (n) => `>=${n}`);
  }
  for (const p of places) p.text = text(p.file);
  return places;
}

/** The version every place must hold: the root package.json's. */
export const sourceVersion = (tree) => JSON.parse(tree.read('package.json')).version;

/** Each place that holds another version than the root's, as a line naming the file and both versions. */
export function strayVersions(tree) {
  const version = sourceVersion(tree);
  return versionPlaces(tree).filter((p) => p.version !== version)
    .map((p) => `${p.file} holds ${p.version} (${p.where}), not ${version}, the version in package.json`);
}

/** The text of each file whose places don't hold `version`, with them moved to it. */
export function moveVersions(tree, version) {
  if (!SEMVER.test(version ?? '')) throw Error(`${version} is no version: give major.minor.patch`);
  const byFile = new Map();
  for (const p of versionPlaces(tree)) if (p.version !== version) (byFile.get(p.file) ?? byFile.set(p.file, []).get(p.file)).push(p);
  const moved = new Map();
  for (const [file, places] of byFile) {
    // Every place's span is in the file's text as read, so the edits go in from the end.
    const edits = places.flatMap((p) => (p.json ? [[p.json.span, JSON.stringify(p.json.to(version))]] : p.span ? [[p.span, version]] : []));
    let out = places[0].text;
    for (const [span, next] of edits.sort((a, b) => b[0].start - a[0].start)) out = `${out.slice(0, span.start)}${next}${out.slice(span.end)}`;
    if (out !== places[0].text) moved.set(file, out);
  }
  return moved;
}

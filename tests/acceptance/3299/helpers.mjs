// Shared by #3299's acceptance tests (README.md beside this file). They reach the work only through the surfaces the
// issue names: `cargo build -p deep-show`, cargo's fingerprint reasons for it (CARGO_LOG), the source digest its build
// script hands the binary (`cargo:rustc-env=DEEP_SOURCE_DIGEST=…`, in the build script's `output` beside the `out_dir`
// cargo reports), and the files of the checkout: gpui-shell's gitignored files in `crates/deep-app/panels/*/`, one
// committed file of `crates/deep-app` and one canvas module's `src/lib.rs`. Nothing here imports the code under test.
// Every file a test writes or changes is put back byte for byte, in a finally and on SIGINT, SIGTERM or SIGHUP.
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The checkout these tests are in: the change, a twin laid over it, or the base with these tests. */
export const ROOT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));

/** The folder gpui-shell loads panels from, and the files it (and DeepBuild) write into each panel's folder. */
export const PANELS = 'crates/deep-app/panels';
const WRITTEN = {
  'gpui-kit.d.ts': '// gpui-kit typings, as gpui-shell writes them each time it loads this panel.\nexport {};\n',
  'jsconfig.json': '{ "compilerOptions": { "checkJs": true, "types": ["./gpui-kit.d.ts"] } }\n',
  '@deepbuild/panel.js': '// Written by DeepBuild each time it loads this panel (#1425): @deepbuild/panel, the one module a panel imports.\nexport {};\n',
};
/** A committed file of crates/deep-app (a panel's own script, beside where the gitignored files go). */
export const APP_FILE = 'crates/deep-app/panels/claude-code/main.js';
/** One canvas module's src/lib.rs: deep-canvas-loop, a path dependency of deep-show. */
export const MODULE_FILE = 'crates/deep-canvas-loop/src/lib.rs';
export const BUILD_SCRIPT = 'crates/deep-show/build.rs';

// cargo's fingerprint log: the module is `cargo::compiler::fingerprint` in the cargo of the base's toolchain, and was
// `cargo::core::compiler::fingerprint` before; both are asked for.
const LOG = 'cargo::compiler::fingerprint=info,cargo::core::compiler::fingerprint=info';

// ---------------------------------------------------------------------------------------------------------------
// Putting files back.

const restores = [];
function onSignal(signal) {
  restoreAll();
  process.exit(128 + ({ SIGINT: 2, SIGTERM: 15, SIGHUP: 1 }[signal] ?? 1));
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, onSignal);
function restoreAll() {
  while (restores.length) restores.pop()();
}

/** Saves `path` (relative to ROOT) as it is, or that it is missing; the returned function puts it back. */
function keep(path) {
  const full = join(ROOT, path);
  let saved = null, kind = 'missing';
  try {
    const stat = lstatSync(full);
    kind = stat.isDirectory() ? 'dir' : 'file';
    if (kind === 'file') saved = readFileSync(full);
  } catch {}
  const back = () => {
    if (kind === 'file') {
      mkdirSync(dirname(full), { recursive: true });
      if (!existsSync(full) || !readFileSync(full).equals(saved)) writeFileSync(full, saved);
    } else if (kind === 'missing') rmSync(full, { recursive: true, force: true });
  };
  restores.push(back);
  return () => {
    const at = restores.indexOf(back);
    if (at >= 0) restores.splice(at, 1);
    back();
  };
}

/** Runs `body` with every file it names kept, and puts them back after, whatever happens. */
export function keeping(paths, body) {
  const backs = paths.map(keep);
  try {
    return body();
  } finally {
    for (const back of backs.reverse()) back();
  }
}

/** The panel folders of crates/deep-app. */
export function panelFolders() {
  return readdirSync(join(ROOT, PANELS), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => `${PANELS}/${entry.name}`);
}

/** Every path the panel files can take, and each panel's `@deepbuild` folder, for keeping. */
export function panelPaths() {
  return panelFolders().flatMap((folder) => [`${folder}/@deepbuild`, ...Object.keys(WRITTEN).map((name) => `${folder}/${name}`)]);
}

/** Writes gpui-shell's and DeepBuild's files into every panel folder, as loading each panel does. */
export function writePanelFiles() {
  for (const folder of panelFolders()) for (const [name, text] of Object.entries(WRITTEN)) {
    mkdirSync(dirname(join(ROOT, folder, name)), { recursive: true });
    writeFileSync(join(ROOT, folder, name), text);
  }
}

/** Deletes them (and each `@deepbuild` folder) from every panel folder. */
export function deletePanelFiles() {
  for (const folder of panelFolders()) {
    for (const name of Object.keys(WRITTEN)) rmSync(join(ROOT, folder, name), { force: true });
    rmSync(join(ROOT, folder, '@deepbuild'), { recursive: true, force: true });
  }
}
export const PANEL_FILES = Object.keys(WRITTEN).join(', ');

/** Moves a committed file's modification time to now, its bytes unchanged. */
export function touch(path) {
  const now = new Date();
  utimesSync(join(ROOT, path), now, now);
}

/** Appends a line to a committed file (kept by the caller): a change to its committed source. */
export function change(path, line) {
  writeFileSync(join(ROOT, path), Buffer.concat([readFileSync(join(ROOT, path)), Buffer.from(line)]));
}

// ---------------------------------------------------------------------------------------------------------------
// Building deep-show.

/** This process's environment for cargo: ~/.cargo/bin on PATH, no colour. */
function childEnv(extra = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) if (key !== 'NODE_TEST_CONTEXT') env[key] = value;
  return Object.assign(env, { PATH: [join(homedir(), '.cargo/bin'), process.env.PATH ?? '/usr/bin:/bin'].join(delimiter), CARGO_TERM_COLOR: 'never' }, extra);
}

/**
 * The build the run makes first in each checkout (scripts/proof-binaries.mjs, #2820), so the tests' first reading
 * starts from a built deep-show. A build that fails is no reading: it throws before any assertion.
 */
export function warm() {
  const made = spawnSync('cargo', ['build', '--locked', '-p', 'deep-show'], { cwd: ROOT, env: childEnv(), encoding: 'utf8', maxBuffer: 1 << 28 });
  if (made.status !== 0) throw new Error(`cargo build --locked -p deep-show fails: ${made.error?.message ?? ''}\n${(made.stderr ?? '').slice(-4000)}`);
}

const short = (text) => text.split(ROOT).join('.');

/**
 * One build of deep-show, read: the units cargo compiled (`fresh: false`), whether deep-show's build script ran (cargo's
 * fingerprint says its RunCustomBuild unit is dirty, or its `output` was written again), cargo's reasons for every
 * dirty unit, and the source digest the build script's output hands the binary.
 */
export function build() {
  const made = spawnSync('cargo', ['build', '--locked', '-p', 'deep-show', '--message-format=json-render-diagnostics'],
    { cwd: ROOT, env: childEnv({ CARGO_LOG: LOG }), encoding: 'utf8', maxBuffer: 1 << 29 });
  if (made.status !== 0) throw new Error(`cargo build -p deep-show fails: ${made.error?.message ?? ''}\n${short(made.stderr ?? '').split('\n').filter((line) => !/ (?:INFO|DEBUG|TRACE) /.test(line)).join('\n').slice(-4000)}`);
  const messages = made.stdout.split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line));
  const compiled = messages.filter((message) => message.reason === 'compiler-artifact' && message.fresh === false)
    .map((message) => `${message.package_id.replace(/^.*[#/]/, '')} ${message.target.kind.join(',')} ${message.target.name}`);
  const script = messages.find((message) => message.reason === 'build-script-executed' && /[#/]deep-show[@#]|^deep-show /.test(message.package_id));
  if (!script) throw new Error('cargo reports no build-script-executed for deep-show');
  const output = join(dirname(script.out_dir), 'output');
  const text = readFileSync(output, 'utf8');
  const digest = text.match(/^cargo::?rustc-env=DEEP_SOURCE_DIGEST=(\S*)$/m)?.[1] ?? null;
  // Each fingerprint line: the unit it is about (its span's package and target) and what cargo says.
  const reasons = [];
  let scriptDirty = false;
  for (const line of made.stderr.split('\n')) {
    const said = line.match(/cargo::(?:core::)?compiler::fingerprint: (.*)$/)?.[1];
    if (!said) continue;
    const spans = [...line.matchAll(/prepare_target\{[^}]*?package_id=(\S+) v[^}]*?target="([^"]+)"\}/g)].at(-1);
    const unit = spans ? `${spans[1]} ${spans[2]}` : '?';
    if (/^fingerprint dirty for deep-show v.*\/RunCustomBuild\//.test(said)) scriptDirty = true;
    if (/^stale: |^\s*dirty: /.test(said)) reasons.push(`${unit}: ${short(said.trim()).slice(0, 400)}`);
  }
  return { compiled, digest, output: short(output), mtime: statSync(output).mtimeMs, scriptDirty, reasons };
}

/** Whether deep-show's build script ran in `after`, the build after `before`. */
export const scriptRan = (before, after) => after.scriptDirty || after.mtime !== before.mtime || after.output !== before.output;

/** What a build that should have been fresh did, in words; empty when it ran no build script of deep-show and compiled nothing. */
export function unfresh(what, before, after) {
  const did = [];
  if (scriptRan(before, after)) did.push('ran deep-show\'s build script');
  if (after.compiled.length) did.push(`compiled ${after.compiled.length} unit(s): ${after.compiled.join('; ')}`);
  if (!did.length) return [];
  return [`after ${what}, the next build of deep-show ${did.join(' and ')}; cargo's reasons: ${after.reasons.join(' | ') || 'none logged'}`];
}

/**
 * The first criterion's readings, as failures in words by part (writing, digest, deleting; each empty when it holds). From a checkout with none of the panel
 * files: a build after a touch of APP_FILE (so the build script runs and the digest is read without them); the files
 * written, and a build (fresh?); a touch and a build again (the digest with them); the files deleted, and a build
 * (fresh?). Every panel path and APP_FILE is put back as found.
 */
export function firstCriterion() {
  return keeping([...panelPaths(), APP_FILE], () => {
    deletePanelFiles();
    warm();
    touch(APP_FILE);
    const without = build();
    const failures = { writing: [], digest: [], deleting: [] };
    if (!without.digest) failures.digest.push(`deep-show's build script hands the binary no DEEP_SOURCE_DIGEST (${without.output})`);
    writePanelFiles();
    const written = build();
    failures.writing.push(...unfresh(`writing ${PANEL_FILES} into every folder of ${PANELS}`, without, written));
    touch(APP_FILE);
    const withFiles = build();
    if (!scriptRan(written, withFiles)) failures.digest.push(`after a touch of ${APP_FILE}, deep-show's build script did not run again, so no digest was read with the panel files there`);
    else if (withFiles.digest !== without.digest) failures.digest.push(`the source digest differs with the panel files there: ${withFiles.digest} with them, ${without.digest} without`);
    deletePanelFiles();
    const deleted = build();
    failures.deleting.push(...unfresh(`deleting ${PANEL_FILES} from every folder of ${PANELS}`, withFiles, deleted));
    return { failures, readings: { without, written, withFiles, deleted } };
  });
}

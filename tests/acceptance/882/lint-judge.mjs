// #882 AC2: what the color-literal guard must do, as judges that lint.test.mjs runs on scripts/color-literal-guard.mjs
// and scripts/lanes.mjs, and wrong.test.mjs runs on the wrong guards and lane tables under wrong/.
//
// The guard is run as `node <guard> --root <dir>` on a copy of the app, <dir>/crates/deep-app (with the look's
// folder, crates/deep-canvas-marks/looks, beside it): once as it is, once per planted literal and once per planted
// exception. A literal must fail it: exit 1, and a line starting `FAIL ` that names `<path>:<line>`, the path under
// the root; for the AC's own plant, rgb(0x2563eb) in views.rs, that line also names a role of the look to use
// instead. The copy as it is passes: exit 0 and no line starting `FAIL`. Nothing here writes to the repo's files.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BASE, CHROME_ROLES, remove, repoRoot, tempRoot } from './common.mjs';

export const GUARD = 'scripts/color-literal-guard.mjs';
const APP = 'crates/deep-app';
const SRC = `${APP}/src`;
const LOOKS = 'crates/deep-canvas-marks/looks';
/** The roles a FAIL line may name as the one to use: the chrome roles and the look's data roles. */
export const ROLE_WORDS = [...CHROME_ROLES, 'ink', 'muted'];
/**
 * The base's color literal lines. The issue counts 21: the lines with `rgb(0x`. Its suggested grep, which adds
 * `hsla(`, finds 23 (show.rs:201 and :202 hold `hsla(` literals too); the guard must name all 23.
 */
export const BASE_RGB = /rgb\(0x/;
export const BASE_PATTERN = /rgb\(0x|hsla\(/;
export const BASE_LINES = 21;
/** The exception the README pins: a trailing comment on the literal's own line. */
const EXCEPTION = '// color-literal-exception: planted to test an exception; review 2099-12-31';

const lineCount = (text) => (text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length);

/** Appends `lines` to `file` (after a newline if it lacks one); answers the 1-based line number of `lines[at]`. */
function append(file, lines, at) {
  let text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (text && !text.endsWith('\n')) text += '\n';
  writeFileSync(file, `${text}${lines.join('\n')}\n`);
  return lineCount(text) + at + 1;
}

/** Writes a new file of `lines`, declares its module in lib.rs, answers the line number of `lines[at]`. */
function newModule(root, path, decl, lines, at) {
  const file = join(root, SRC, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${lines.join('\n')}\n`);
  append(join(root, SRC, 'lib.rs'), ['// Planted by #882\'s acceptance tests.', decl], 0);
  return at + 1;
}

const viewsFn = (body) => ['', '// Planted by #882\'s acceptance tests.', 'pub fn planted_882_color() -> gpui_kit::Rgba {', `    ${body}`, '}'];

/** Each planted literal: what it is, and how to write it into a copy, answering its path and line. */
export const PLANTED = [
  { case: 'rgb(0x2563eb) in views.rs', role: true, plant: (root) => ({ path: `${SRC}/views.rs`, line: append(join(root, SRC, 'views.rs'), viewsFn('gpui_kit::rgb(0x2563eb)'), 3) }) },
  { case: 'an hsla color in a nested module', plant: (root) => ({
    path: `${SRC}/planted_882/chip.rs`,
    line: newModule(root, 'planted_882/chip.rs', 'pub mod planted_882 {\n    pub mod chip;\n}', ['//! Planted by #882\'s acceptance tests: a chip in its own color.', 'pub fn chip_color() -> gpui_kit::Hsla {', '    gpui_kit::hsla(0.6, 0.8, 0.5, 1.)', '}'], 2),
  }) },
  { case: 'rgba(0x2563ebff) in lib.rs', plant: (root) => ({ path: `${SRC}/lib.rs`, line: append(join(root, SRC, 'lib.rs'), ['', '// Planted by #882\'s acceptance tests.', 'pub fn planted_882_fill() -> gpui_kit::Rgba {', '    gpui_kit::rgba(0x2563ebff)', '}'], 3) }) },
  { case: 'a color held in a constant first', plant: (root) => ({
    path: `${SRC}/planted_882_const.rs`,
    line: newModule(root, 'planted_882_const.rs', 'pub mod planted_882_const;', ['//! Planted by #882\'s acceptance tests: a color held in a constant first.', 'const PLANTED_BLUE: u32 = 0x2563eb;', '', 'pub fn planted_blue() -> gpui_kit::Rgba {', '    gpui_kit::rgb(PLANTED_BLUE)', '}'], 1),
  }) },
  { case: 'a #rrggbb string in views.rs', plant: (root) => ({ path: `${SRC}/views.rs`, line: append(join(root, SRC, 'views.rs'), viewsFn('gpui_kit::Rgba::try_from("#2563eb").unwrap_or_default()'), 3) }) },
  { case: 'rgb(0x2563eb) with an exception that has no review date', plant: (root) => ({ path: `${SRC}/views.rs`, line: append(join(root, SRC, 'views.rs'), viewsFn('gpui_kit::rgb(0x2563eb) // color-literal-exception: planted to test an exception'), 3) }) },
  { case: 'rgb(0x2563eb) with a full exception on another line', plant: (root) => {
    const file = join(root, SRC, 'views.rs');
    const line = append(file, viewsFn('gpui_kit::rgb(0x2563eb)'), 3);
    append(file, ['', EXCEPTION], 1);
    return { path: `${SRC}/views.rs`, line };
  } },
];

/** A literal whose exception names its exact place, a reason and a review date: it passes. */
const EXCEPTED = (root) => append(join(root, SRC, 'views.rs'), viewsFn(`gpui_kit::rgb(0x2563eb) ${EXCEPTION}`), 3);

export function runGuard(guard, root, cwd = root) {
  const r = spawnSync(process.execPath, [guard, '--root', root], { cwd, encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, output: `${r.stdout ?? ''}${r.stderr ?? ''}`, error: r.error };
}

const failLines = (output) => output.split('\n').filter((l) => l.startsWith('FAIL'));
/** The FAIL lines naming `path:line` exactly (not `path:line0`). */
export const naming = (output, path, line) => failLines(output).filter((l) => new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:${line}(?!\\d)`).test(l));
const namesRole = (l) => ROLE_WORDS.some((role) => new RegExp(`(^|[^\\w])${role}($|[^\\w])`).test(l));

/** A copy of the app at `source` (its crates/deep-app) under a new root, with the branch's look beside it. */
export function appCopy(source, what) {
  const root = tempRoot(what);
  cpSync(join(source, APP), join(root, APP), { recursive: true });
  cpSync(join(repoRoot, LOOKS), join(root, LOOKS), { recursive: true });
  return root;
}

/** The ways `guard` falls short on the app at `source`, one line each; empty when it does all of the above. */
export function judgeLint(guard, { source = repoRoot } = {}) {
  if (!existsSync(guard)) return [`no guard at ${guard}`];
  const failures = [];
  const clean = appCopy(source, 'lint');
  try {
    const { status, output, error } = runGuard(guard, clean);
    if (error) return [`the guard couldn't run: ${error.message}`];
    if (status !== 0 || failLines(output).length) failures.push(`the app as it stands fails the guard (exit ${status}): ${output.trim().slice(0, 1500)}`);
  } finally {
    remove(clean);
  }
  for (const planted of PLANTED) {
    const root = appCopy(source, 'lint');
    try {
      const { path, line } = planted.plant(root);
      const { status, output } = runGuard(guard, root);
      const named = naming(output, path, line);
      if (status === 0) failures.push(`${planted.case} (${path}:${line}) passes the guard`);
      else if (status !== 1) failures.push(`${planted.case} ends the guard with exit ${status}, not 1: ${output.trim().slice(0, 600)}`);
      else if (!named.length) failures.push(`${planted.case} fails the guard without a FAIL line naming ${path}:${line}: ${output.trim().slice(0, 600)}`);
      else if (planted.role && !named.some(namesRole)) failures.push(`${planted.case}: the FAIL line names no role to use (one of ${ROLE_WORDS.join(', ')}): ${named[0]}`);
    } finally {
      remove(root);
    }
  }
  const root = appCopy(source, 'lint');
  try {
    const line = EXCEPTED(root);
    const { status, output } = runGuard(guard, root);
    if (status !== 0 || naming(output, `${SRC}/views.rs`, line).length) failures.push(`a literal with an exception at its place, a reason and a review date fails the guard (exit ${status}): ${output.trim().slice(0, 600)}`);
  } finally {
    remove(root);
  }
  return failures;
}

/** Every line of the files under `dir` matching `pattern`, as `path:line` under `root`. */
function literalLines(root, dir, pattern) {
  const files = (d) => readdirSync(d).flatMap((name) => {
    const p = join(d, name);
    return statSync(p).isDirectory() ? files(p) : name.endsWith('.rs') ? [p] : [];
  });
  return files(join(root, dir)).flatMap((file) => readFileSync(file, 'utf8').split('\n')
    .flatMap((text, i) => (pattern.test(text) ? [`${relative(root, file).replaceAll('\\', '/')}:${i + 1}`] : [])));
}

/**
 * AC2's last clause: the merge base's app has the issue's 21 `rgb(0x` lines, and fails the guard naming each of them
 * and the two `hsla(` lines beside them.
 */
export function judgeBase(guard) {
  if (!existsSync(guard)) return [`no guard at ${guard}`];
  const root = tempRoot('base');
  try {
    const archive = spawnSync('git', ['archive', BASE, APP, LOOKS], { cwd: repoRoot, maxBuffer: 256 * 1024 * 1024 });
    if (archive.status !== 0) return [`git archive ${BASE} failed: ${archive.stderr}`];
    const tar = spawnSync('tar', ['-x', '-C', root], { input: archive.stdout });
    if (tar.status !== 0) return [`tar failed: ${tar.stderr}`];
    const rgb = literalLines(root, SRC, BASE_RGB);
    if (rgb.length !== BASE_LINES) return [`the base has ${rgb.length} rgb(0x lines, not the issue's ${BASE_LINES}: ${rgb.join(', ')}`];
    const lines = literalLines(root, SRC, BASE_PATTERN);
    const { status, output } = runGuard(guard, root);
    const failures = [];
    if (status !== 1) failures.push(`the base's app ends the guard with exit ${status}, not 1`);
    const unnamed = lines.filter((at) => {
      const [path, line] = at.split(':');
      return !naming(output, path, Number(line)).length;
    });
    if (unnamed.length) failures.push(`the guard names ${lines.length - unnamed.length} of the base's ${lines.length} literal lines; not ${unnamed.join(', ')}: ${output.trim().slice(0, 800)}`);
    return failures;
  } finally {
    remove(root);
  }
}

/**
 * AC2's own scan: the app's source at `root` holds no line the issue's pattern finds, nor rgba(0x, a hex literal
 * inside an rgb(...) call (card.rs:185 at the base) or a "#rrggbb" string. An exception doesn't count here: the
 * criterion says the source holds none.
 */
export function literalsIn(root) {
  const extra = /rgba\(0x|\brgba?\([^;]*\b0x[0-9a-fA-F]{6}|"#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?"/;
  const files = (d) => readdirSync(d).flatMap((name) => {
    const p = join(d, name);
    return statSync(p).isDirectory() ? files(p) : name.endsWith('.rs') ? [p] : [];
  });
  return files(join(root, SRC)).flatMap((file) => readFileSync(file, 'utf8').split('\n')
    .flatMap((text, i) => (BASE_PATTERN.test(text) || extra.test(text) ? [`${relative(root, file)}:${i + 1}: ${text.trim()}`] : [])));
}

/**
 * The ways the lane table at `lanes` (a module exporting `checks`, as scripts/lanes.mjs does) falls short: its lane
 * named `lint` runs `guard` on every change to the app, without pointing --root elsewhere, and that command, run
 * through scripts/lanes.mjs's runLanes on a copy of the app at `source` with views.rs's plant, fails the lane naming
 * views.rs and the line; on the copy as it is, the lane passes.
 */
export async function judgeWiring(lanes, { guard = GUARD, source = repoRoot } = {}) {
  const { checks } = await import(pathToFileURL(lanes).href);
  const lint = (checks ?? []).find((lane) => lane.name === 'lint');
  if (!lint) return [`${lanes} has no lint lane in checks`];
  const command = (lint.commands ?? []).find((argv) => argv.some((arg) => String(arg).replaceAll('\\', '/').endsWith(guard)));
  if (!command) return [`the lint lane doesn't run ${guard}`];
  if (lint.paths && !(Array.isArray(lint.paths) && lint.paths.some((p) => p.endsWith('/**') && `${SRC}/views.rs`.startsWith(p.slice(0, -2))))) {
    return [`the lint lane's paths skip a change to ${SRC}: ${JSON.stringify(lint.paths)}`];
  }
  if (command.includes('--root')) return [`the lint lane points the guard at ${command[command.indexOf('--root') + 1]}, not the checkout`];
  const lane = (root) => {
    const run = `const { runLanes } = await import(${JSON.stringify(pathToFileURL(join(repoRoot, 'scripts/lanes.mjs')).href)});
      process.exitCode = runLanes([JSON.parse(process.env.DA882_LANE)], { cwd: ${JSON.stringify(repoRoot)} });`;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', run], {
      cwd: repoRoot, encoding: 'utf8', timeout: 180_000, maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, DA882_LANE: JSON.stringify({ name: 'lint', commands: [[...command, '--root', root]], fix: 'Use the role named.' }) },
    });
    return { status: r.status, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  };
  const failures = [];
  const clean = appCopy(source, 'lane');
  try {
    const { status, output } = lane(clean);
    if (status !== 0) failures.push(`the lint lane's guard fails the app as it stands (exit ${status}): ${output.trim().slice(0, 800)}`);
  } finally {
    remove(clean);
  }
  const root = appCopy(source, 'lane');
  try {
    const { path, line } = PLANTED[0].plant(root);
    const { status, output } = lane(root);
    const lifted = output.split('\n').filter((l) => l.startsWith('FAIL lint:') && new RegExp(`views\\.rs:${line}(?!\\d)`).test(l));
    if (status !== 1 || !lifted.length) failures.push(`the lint lane with ${path}:${line} planted doesn't fail as 'FAIL lint: ...views.rs:${line}...' (exit ${status}): ${output.trim().slice(0, 800)}`);
  } finally {
    remove(root);
  }
  return failures;
}

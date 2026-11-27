// Shared by #2044's acceptance tests (README.md beside this file). The tests reach the four readers of outside bytes
// only through what each crate already makes public at the base: the decode worker's reply to a probe
// (`deep_codecs::run`), the mesh import (`deep_canvas_scene3d::gltf::import`), the terminal
// (`deep_canvas_cells::emulator::Terminal`) and the SVG import (`deep_canvas_vector::svg::import`). reader.rs calls
// one of them on one fixture in a process of its own and prints what it answered; a judge here decides the criterion
// from that answer. Nothing here imports the code under test.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The checkout these tests are in: the change, a twin laid over it, or the base with these tests. */
export const ROOT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const SUITE = 'tests/acceptance/2044';
const MINUTE = 60_000;
/** A test's own bound: a first build of the four crates' libraries on a loaded machine, then its readers. */
export const TEST_MS = 90 * MINUTE;
/** The longest a reader may run, in seconds (see `run`). */
export const DEADLINE_S = 300;

/** Nothing was judged, for a reason in the suite or the build: never a pass, and no failure of the criterion. */
function blocked(why) {
  throw new Error(`BLOCKED ${why}`);
}

/** Nothing was judged, for a reason of the machine: never a pass, and no failure of the criterion. */
function inconclusive(why) {
  throw new Error(`INCONCLUSIVE ${why}`);
}

const brief = (value, most = 700) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? 'undefined';
  return text.length > most ? `${text.slice(0, most)}…` : text;
};
const tail = (text, most = 4000) => String(text ?? '').trim().slice(-most);

// ---------------------------------------------------------------------------------------------------------------
// The reader: cargo builds the four crates' libraries, rustc builds reader.rs against them (README: Run them).

/** The crates the reader links, each by the name the reader calls it and its folder. */
const LIBRARIES = {
  deep_codecs: 'crates/deep-codecs',
  deep_canvas_scene3d: 'crates/deep-canvas-scene3d',
  deep_canvas_cells: 'crates/deep-canvas-cells',
  deep_canvas_vector: 'crates/deep-canvas-vector',
};

/** This process's environment for cargo and rustc: builds stay light, as the acceptance helpers build (the caller's settings win). */
function toolEnv() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return {
    ...env,
    PATH: [process.env.PATH ?? '/usr/bin:/bin', join(homedir(), '.cargo/bin')].join(delimiter),
    CARGO_INCREMENTAL: process.env.CARGO_INCREMENTAL ?? '0',
    CARGO_PROFILE_DEV_DEBUG: process.env.CARGO_PROFILE_DEV_DEBUG ?? '0',
    CARGO_TERM_COLOR: 'never',
  };
}

function tool(command, args, minutes) {
  // deadline: bounds a build that hangs; a build that ends, however slowly, is never judged by its time.
  const ran = spawnSync(command, args, { cwd: ROOT, env: toolEnv(), encoding: 'utf8', maxBuffer: 1 << 28, timeout: minutes * MINUTE, killSignal: 'SIGKILL' });
  if (ran.error?.code === 'ETIMEDOUT') inconclusive(`${command} ${args[0]} was stopped after ${minutes} minutes`);
  if (ran.error) inconclusive(`${command} did not run: ${ran.error.message}`);
  if (ran.signal) inconclusive(`${command} ${args[0]} was stopped by ${ran.signal}`);
  return ran;
}

const folders = [];
let built;

/** The reader's executable, built once a test file. A build that fails is BLOCKED, naming it: no reader ran. */
function reader() {
  if (built) return built;
  const source = join(ROOT, SUITE, 'reader.rs');
  if (!existsSync(source)) blocked(`${SUITE}/reader.rs is not there`);
  const cargo = tool('cargo', ['build', '--locked', '-p', 'deep-codecs', '-p', 'deep-canvas-scene3d', '-p', 'deep-canvas-cells', '-p', 'deep-canvas-vector', '--message-format=json'], 60);
  if (cargo.status !== 0) blocked(`cargo build of deep-codecs, deep-canvas-scene3d, deep-canvas-cells and deep-canvas-vector failed, so no reader was built:\n${tail(cargo.stderr)}`);
  const libraries = {};
  for (const line of cargo.stdout.split('\n')) {
    if (!line.startsWith('{')) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (message.reason !== 'compiler-artifact' || !message.target?.kind?.some((kind) => kind === 'lib' || kind === 'rlib')) continue;
    const manifest = String(message.manifest_path).split('\\').join('/');
    const name = Object.keys(LIBRARIES).find((library) => manifest.endsWith(`/${LIBRARIES[library]}/Cargo.toml`));
    // The library as cargo itself hands it to rustc: the file beside its metadata, where cargo keeps what it built.
    const beside = message.filenames?.find((path) => path.endsWith('.rmeta'))?.replace(/\.rmeta$/, '.rlib');
    const file = beside && existsSync(beside) ? beside : message.filenames?.find((path) => path.endsWith('.rlib'));
    if (name && file) libraries[name] = file;
  }
  const unnamed = Object.keys(LIBRARIES).filter((library) => !libraries[library]);
  if (unnamed.length) blocked(`cargo build named no library file for ${unnamed.join(', ')}, so no reader was built`);
  const folder = mkdtempSync(join(tmpdir(), 'deep-2044-'));
  folders.push(folder);
  const executable = join(folder, 'reader');
  // What the four libraries link in turn is found where cargo keeps it, beside them.
  const kept = [...new Set(Object.values(libraries).map((file) => (basename(dirname(file)) === 'deps' ? dirname(file) : join(dirname(file), 'deps'))))];
  const rustc = tool(process.env.RUSTC ?? 'rustc', [
    '--edition', '2021', '--crate-name', 'acceptance_2044_reader', '-C', 'debuginfo=0', '-o', executable,
    ...kept.flatMap((path) => ['-L', `dependency=${path}`]),
    ...Object.entries(libraries).flatMap(([name, file]) => ['--extern', `${name}=${file}`]),
    source,
  ], 20);
  if (rustc.status !== 0 || !existsSync(executable)) blocked(`${SUITE}/reader.rs doesn't build against the four crates' libraries (README: The surface under test), so no reader ran:\n${tail(rustc.stderr)}`);
  built = executable;
  return built;
}

/** Removes what this file's build left; each test file calls it once its tests are done. */
export function tidy() {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  built = undefined;
}

/**
 * One run of the reader, in a process of its own: `args` are `mp4 <file>`, `gltf <file>`, `svg <file>` or
 * `terminal <cols>x<rows> <step>...`. It returns how the process ended and what it wrote; `answer` reads it.
 */
export function run(args) {
  const executable = reader();
  // deadline: on a program that bounds what it reads a reader ends in well under a second; the bound turns a reader
  // that loops over a count the file states, or walks a tree it has no memory of, into a failure. The process is
  // stopped by its own PID. No criterion states a time, so nothing is judged by how long a reader that ended took.
  const ran = spawnSync(executable, args, { cwd: ROOT, env: { ...process.env, RUST_BACKTRACE: '0' }, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'pipe'], timeout: DEADLINE_S * 1000, killSignal: 'SIGKILL' });
  const late = ran.error?.code === 'ETIMEDOUT';
  return { late, error: late ? null : ran.error?.message ?? null, status: ran.status, signal: ran.signal, out: ran.stdout ?? '', said: ran.stderr ?? '' };
}

/**
 * What a reader that ended answered, as JSON. A reader that outlived its deadline, or died (a panic in the code under
 * test, or a heap past the reader's 4 GiB cap), fails the test here, naming which and what it said; `who` names the
 * reader and its fixture. A reader that never ran, or was given arguments it can't read, is BLOCKED.
 */
export function answer(ran, who) {
  const said = ran.said.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('note:')).slice(0, 6).join(' | ');
  assert.ok(!ran.late, `${who} was still running after ${DEADLINE_S} s and was stopped: it gave no answer${said ? ` (it said: ${said})` : ''}`);
  if (ran.error) blocked(`the reader did not run: ${ran.error}`);
  if (ran.status === 64) blocked(`the reader can't read its own arguments: ${said}`);
  assert.ok(ran.signal === null, `${who} died of ${ran.signal} and gave no answer${said ? `: ${said}` : ''}`);
  assert.ok(ran.status === 0, `${who} ${/panicked at/.test(said) ? 'panicked' : `died (exit ${ran.status})`} and gave no answer: ${said}`);
  try {
    return JSON.parse(ran.out);
  } catch {
    return blocked(`the reader's answer is no JSON: ${brief(ran.out)}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The fixtures (README: The fixtures). Each is read and held to what its criterion says of it by its own test.

/** A fixture of the suite: its path, its name in messages and its bytes. One that isn't there is BLOCKED. */
export function fixture(name) {
  const shown = `${SUITE}/fixtures/${name}`;
  const file = join(ROOT, shown);
  if (!existsSync(file)) blocked(`the fixture ${shown} is not there`);
  return { file, shown, bytes: readFileSync(file) };
}

/** A fixture says what its criterion says of it, or nothing is judged. */
export function holds(said, what) {
  if (!said) blocked(`a fixture doesn't say what its criterion says of it: ${what}`);
}

/** The body of the first `kind` box in an MP4's bytes, looked for inside the boxes that hold the sample tables. */
export function mp4Box(bytes, kind) {
  const holders = ['moov', 'trak', 'mdia', 'minf', 'stbl'];
  const find = (from, to) => {
    for (let at = from; at + 8 <= to;) {
      const size = bytes.readUInt32BE(at);
      const name = bytes.toString('latin1', at + 4, at + 8);
      if (size < 8 || at + size > to) return null;
      if (name === kind) return bytes.subarray(at + 8, at + size);
      const inner = holders.includes(name) ? find(at + 8, at + size) : null;
      if (inner) return inner;
      at += size;
    }
    return null;
  };
  const body = find(0, bytes.length);
  if (!body) blocked(`a fixture MP4 has no ${kind} box`);
  return body;
}

// ---------------------------------------------------------------------------------------------------------------
// The judges (README: Readings). Each decides one criterion from a reader's answer and fails naming what it read.

/**
 * Whether a refusal's text names element `index` of `word` (`accessor`, `node`): the word, or a name that starts
 * with it, then the index, with at most three characters that are neither letters nor digits between them and, at
 * most, the words `at`, `index`, `number`, `no.` or `#`. So `accessor 0`, `accessors/0`, `accessors[0]`,
 * `accessor #0`, `accessor at index 0`, `node: 1` and `node_two_parents: 1` name it, and `an accessor past its
 * buffer`, `node 10` and `node 0` (for index 1) don't.
 */
export function names(text, word, index) {
  return new RegExp(`${word}[a-z_]*[^0-9a-z]{0,3}(?:(?:at|index|number|no\\.?|#)[^0-9a-z]{0,2}){0,2}${index}(?!\\d|\\.\\d)`, 'i').test(String(text));
}

/** Whether a refusal's text names the count `count`: its digits, written together or in groups of three. */
export function namesCount(text, count) {
  const together = String(text).replace(/(?<=\d)[,_ \u00a0\u2009\u202f](?=\d{3}(?!\d))/g, '');
  return new RegExp(`(?<![\\d.])${count}(?!\\d|\\.\\d)`).test(together);
}

/**
 * Criteria 1 and 2: the decode worker's reply to a probe is a refusal, `{"refused": {"code": <string>, ...}}`, the
 * shape every refusal of the worker has at the base, and the refusal, read as its JSON text, names the box by its
 * four letters and, where `count` is given, the count.
 */
export function refusedNamingBox(reply, { box, count, who, states }) {
  const refused = reply?.refused;
  assert.ok(refused !== null && typeof refused === 'object' && typeof refused.code === 'string',
    `${who} is not refused: the probe's reply has no refusal, though ${states}. The reply: ${brief(reply)}`);
  const text = JSON.stringify(refused);
  assert.ok(new RegExp(`(?<![0-9a-z])${box}(?![0-9a-z])`).test(text), `${who} is refused without naming \`${box}\`, though ${states}. The refusal: ${brief(text)}`);
  if (count !== undefined) assert.ok(namesCount(text, count), `${who} is refused naming \`${box}\` but not the count ${count}. The refusal: ${brief(text)}`);
}

/** Criteria 3 and 4: the import is refused, and its refusal names element `index` of `word` (see `names`). */
export function refusedNaming(got, { word, index, who, states }) {
  assert.ok(typeof got?.refused === 'string', `${who} is not refused, though ${states}. The import returned ${brief(got?.imported)}`);
  assert.ok(names(got.refused, word, index), `${who} is refused without naming ${word} ${index}, though ${states}. The refusal: ${brief(got.refused)}`);
}

/** Where two JSON values first differ, as a sentence, or null when they are the same; 0 and -0 are one number. */
function difference(got, want, at) {
  if (Array.isArray(want)) {
    if (!Array.isArray(got)) return `${at} is ${brief(got, 120)}, not a list`;
    if (got.length !== want.length) return `${at} holds ${got.length}, not ${want.length}: ${brief(got, 240)}`;
    return want.map((item, i) => difference(got[i], item, `${at}[${i}]`)).find(Boolean) ?? null;
  }
  if (want !== null && typeof want === 'object') {
    if (got === null || typeof got !== 'object' || Array.isArray(got)) return `${at} is ${brief(got, 120)}, not an object`;
    const keys = [...new Set([...Object.keys(want), ...Object.keys(got)])];
    return keys.map((key) => (key in want && key in got ? difference(got[key], want[key], `${at}.${key}`) : `${at}.${key} is ${key in got ? 'there' : 'missing'}`)).find(Boolean) ?? null;
  }
  return got === want ? null : `${at} is ${brief(got, 120)}, not ${brief(want, 120)}`;
}

/**
 * What criterion 5's fixture imports to, worked out from the file's own numbers: each scene node in order, by its
 * index, named by its index since it has no name, at its translation; its mesh's one primitive with each accessor's
 * rows as the buffer view holds them at its stride, in the file's order with no indices, and no material; nothing
 * else in the file to import.
 */
export function importOf(bytes) {
  const doc = JSON.parse(bytes.toString('utf8'));
  const buffer = Buffer.from(doc.buffers[0].uri.split(';base64,')[1], 'base64');
  const rows = (index) => {
    const accessor = doc.accessors[index], view = doc.bufferViews[accessor.bufferView];
    const from = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    return Array.from({ length: accessor.count }, (_, row) => [0, 1, 2].map((part) => buffer.readFloatLE(from + row * view.byteStride + 4 * part)));
  };
  const nodes = doc.scenes[doc.scene].nodes.map((index) => {
    const node = doc.nodes[index], [x, y, z] = node.translation;
    const { POSITION, NORMAL } = doc.meshes[node.mesh].primitives[0].attributes;
    const positions = rows(POSITION);
    return {
      index,
      name: String(index),
      world: [[1, 0, 0, x], [0, 1, 0, y], [0, 0, 1, z]],
      primitives: [{ material: null, vertices: positions.length, positions, normals: rows(NORMAL), indices: positions.map((_, i) => i), uv0: 0, uv1: 0, tangents: 0 }],
    };
  });
  return { nodes, lights: 0, materials: 0, images: 0, dropped: 0 };
}

/** Criterion 5: the import is not refused, and what it returned is `want`, value for value. */
export function importsAs(got, want, who) {
  assert.ok(got?.refused === undefined, `${who} is refused: ${brief(got?.refused)}`);
  const differs = difference(got?.imported, want, 'the import');
  assert.ok(differs === null, `${who} doesn't import to the merge base's result: ${differs}`);
}

/** Criterion 6: the grid is `cols` by `rows`, and its one cell that isn't blank is the `x`, at `row` and `column`, both counted from 1. */
export function xAt(got, { cols, rows, row, column }, who) {
  assert.ok(got?.cols === cols && got?.rows === rows, `${who}: the grid is ${got?.cols} by ${got?.rows}, not ${cols} by ${rows}`);
  const differs = difference(got.cells, [{ row, column, text: 'x' }], 'the cells that are not blank');
  assert.ok(differs === null, `${who}: the x is not at row ${row}, column ${column}, alone on the grid: ${differs}. The cells that aren't blank: ${brief(got.cells)}`);
}

/** Criterion 7: the SVG is imported, not refused; what it read comes back as one text. */
export function imported(got, who) {
  assert.ok(typeof got?.imported === 'string', `${who} is not imported: it is refused as ${brief(got?.refused)}`);
  return got.imported;
}

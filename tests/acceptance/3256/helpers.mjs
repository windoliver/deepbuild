// Shared by #3256's acceptance tests (README.md beside this file). They reach the work only through the surface the
// issue names: the three crates' unit lanes, run by `cargo test`, and what those lanes print. Nothing here imports the
// code under test. The judges below decide a criterion from one run's output and from this suite's own reading of the
// crates' source (the #[repr(C)] structs and the shader structs bound as var<uniform>), never from each other.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, delimiter, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cargoResults, crates } from '../../../scripts/lanes.mjs';

/** The checkout these tests are in: the change, a twin laid over it, or the base with these tests. */
export const ROOT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const MINUTE = 60_000;
/** The three crates that hold both sides (the issue's Scope), in the order every cargo call here names them. */
export const CRATES = ['deep-scene3d-render', 'deep-gpu-layer', 'deep-groups-render'];
/** Yours: every test of the lane has this in its name, so one filter runs the lane and nothing else. */
export const FILTER = 'shader_layout';
/** Yours: the build feature of deep-groups-render behind which the comparison sums host sizes (criterion 4). */
export const PLANT = 'plant-3256-host-sizes';
/** Yours: this suite's Rust target in deep-scene3d-render (twin_shaders.rs), and the one test it holds. */
export const TWIN_TARGET = 'acceptance_3256_twin_shaders';
export const TWIN_TEST = 'the_frame_twin_validates_at_the_size_frame_uniform_is';

const PACKAGES = CRATES.flatMap((crate) => ['-p', crate]);
/** The lane as these tests run it: the three crates' unit and integration test targets, the lane's tests alone. */
export const LANE_ARGS = ['test', '--locked', ...PACKAGES, '--lib', '--bins', '--tests', '--no-fail-fast', '--', FILTER, '--show-output'];
/** The same lane with criterion 4's planted comparison, in deep-groups-render's library tests. */
export const PLANTED_ARGS = ['test', '--locked', ...PACKAGES, '--features', `deep-groups-render/${PLANT}`, '--lib', '--no-fail-fast', '--', FILTER, '--show-output'];
/** This suite's own Rust target. */
export const TWIN_ARGS = ['test', '--locked', ...PACKAGES, '--test', TWIN_TARGET, '--no-fail-fast', '--', '--show-output'];

/** A reason of the machine or the run, not the work: never PASS, and never a failure of the work. */
export function blocked(why) {
  throw new Error(`BLOCKED ${why}`);
}
export function inconclusive(why) {
  throw new Error(`INCONCLUSIVE ${why}`);
}

/** This process's environment for cargo: the caller's cargo first, no colour, no git variables, the lanes' profile. */
function childEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) if (key !== 'NODE_TEST_CONTEXT' && !key.startsWith('GIT_')) env[key] = value;
  return Object.assign(env, {
    PATH: [process.env.PATH ?? '/usr/bin:/bin', join(homedir(), '.cargo/bin')].join(delimiter),
    CARGO_TERM_COLOR: 'never',
    NO_COLOR: '1',
    // A failure's message is read for the numbers it names: no backtrace, whose frames are numbered.
    RUST_BACKTRACE: '0',
    CARGO_INCREMENTAL: process.env.CARGO_INCREMENTAL ?? '0',
    CARGO_PROFILE_DEV_DEBUG: process.env.CARGO_PROFILE_DEV_DEBUG ?? '0',
  });
}

/** One cargo call in the checkout, its two streams in one file in the order they were written, as the lanes read them. */
function cargo(args) {
  const folder = mkdtempSync(join(tmpdir(), 'deep-3256-'));
  try {
    const log = join(folder, 'output');
    const descriptor = openSync(log, 'w', 0o600);
    let ran;
    try {
      // deadline: a cargo that hangs is stopped by its PID and the run reads BLOCKED; nothing is judged by this time
      ran = spawnSync('cargo', args, { cwd: ROOT, env: childEnv(), stdio: ['ignore', descriptor, descriptor], timeout: 40 * MINUTE });
    } finally {
      closeSync(descriptor);
    }
    if (ran.error) blocked(`cargo ${args.join(' ')} did not run: ${ran.error.message}`);
    if (ran.signal) blocked(`cargo ${args.join(' ')} was stopped by ${ran.signal}`);
    return { status: ran.status, out: readFileSync(log, 'utf8') };
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

let workspace;
/** The workspace's targets, which name each test by the arguments that rerun it (scripts/lanes.mjs, `crates`). */
function targets() {
  try {
    workspace ??= crates(ROOT);
  } catch (error) {
    blocked(`cargo metadata did not read the workspace: ${error.message}`);
  }
  return workspace;
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading a run

const HOST = String.raw`(\S+\.rs):(\w+)`;
const SHADER = String.raw`(\S+)#(\w+)`;
/** Yours: the lines the lane prints, one per line of a lane test's output (README: The lines the lane prints). */
const LINES = {
  pair: new RegExp(`^layout pair ${HOST} = ${SHADER}: (\\w+@\\d+(?: \\w+@\\d+)*); (\\d+) bytes$`),
  record: new RegExp(`^layout record ${HOST} = (\\w+)(?:\\W.*)?$`),
  differs: new RegExp(`^layout differs ${HOST} = ${SHADER}: (\\S.*)$`),
  'host-only': new RegExp(`^layout host-only ${HOST}:(.*)$`),
  'gpu-only': new RegExp(`^layout gpu-only ${SHADER}:(.*)$`),
};
const slashes = (path) => path.split(sep).join('/');

/** One line of the listing, or null for a line that isn't one; `malformed` for one of a kind it doesn't read as. */
function listed(line) {
  const kind = line.match(/^layout (pair|record|differs|host-only|gpu-only) /)?.[1];
  if (!kind) return null;
  const read = line.match(LINES[kind]);
  if (!read) return { kind: 'malformed', text: line };
  const [, a, b, c, d, e, f] = read;
  if (kind === 'gpu-only') return { kind, text: line, shaderFile: basename(a), shader: b, reason: c.trim() };
  const host = { kind, text: line, file: a, name: b, host: `${a}:${b}` };
  if (kind === 'host-only') return { ...host, reason: c.trim() };
  if (kind === 'record') return { ...host, list: c };
  if (kind === 'differs') return { ...host, shaderFile: basename(c), shader: d, message: e };
  return { ...host, shaderFile: basename(c), shader: d, fields: e.split(' ').map((field) => ({ name: field.split('@')[0], offset: Number(field.split('@')[1]) })), bytes: Number(f) };
}

/**
 * What one cargo run says. `passed` and `failures` are the lanes' own reading (scripts/lanes.mjs, `cargoResults`). That
 * reading keeps one line of a failure and none of what a test printed, so two more are taken from the same output:
 * each test's own block as libtest prints it under `---- <test> stdout ----` (`failed`: the tests that failed, each
 * with its message), and each target's `finished in <s>s`.
 */
export function read(out, status, known) {
  const { failures, passed } = cargoResults(out, status, known);
  const blocks = [];
  let section = null, block = null;
  for (const line of out.split('\n')) {
    const header = line.match(/^---- (.+?) stdout ----$/);
    if (header) blocks.push(block = { test: header[1], failed: section === 'failures', lines: [] });
    else if (line === 'successes:' || line === 'failures:') [section, block] = [line.slice(0, -1), null];
    else if (/^running \d+ tests?$/.test(line)) [section, block] = [null, null];
    else if (line.startsWith('test result: ')) block = null;
    else if (block) block.lines.push(line);
  }
  // A failed test's message: what it printed and its panic's, less the lines of the listing, the line that says where
  // it panicked (a file, a line and a column, which are no offsets) and libtest's note.
  const aside = (line) => !line.trim() || listed(line) || /^thread '.*' (?:\(\d+\) )?panicked at /.test(line) || line.startsWith('note: run with `RUST_BACKTRACE');
  const failed = blocks.filter((one) => one.failed).map(({ test, lines }) => ({ test, message: lines.filter((line) => !aside(line)).join('\n') }));
  const lines = [...new Map(out.split('\n').map((line) => [line, listed(line)]).filter(([, line]) => line)).values()];
  const of = (kind) => lines.filter((line) => line.kind === kind);
  return {
    out, status, failures, passed, failed,
    /** How many tests of the lane ran, whatever they read. */
    tests: (out.match(/^test .+ \.\.\. (?:ok|FAILED|BLOCKED|INVALID|INCONCLUSIVE)$/gm) ?? []).length,
    /** What libtest reports its tests took, summed over the run's targets, in ms. */
    ms: 1000 * [...out.matchAll(/^test result: .*; finished in ([\d.]+)s$/gm)].reduce((sum, [, seconds]) => sum + Number(seconds), 0),
    error: out.split('\n').find((line) => /^error/.test(line)) ?? null,
    pairs: of('pair'), records: of('record'), differs: of('differs'), hostOnly: of('host-only'), gpuOnly: of('gpu-only'), malformed: of('malformed'),
  };
}

/** A run's results and listing for a failure message: its result lines, its listing's size and its failures' messages. */
export const shown = (run) => [
  `${run.tests} ${FILTER} tests ran, ${run.passed.length} passed; ${run.pairs.length} pair, ${run.records.length} record, ${run.differs.length} differs, ${run.hostOnly.length} host-only and ${run.gpuOnly.length} gpu-only lines`,
  ...run.failed.map(({ test, message }) => `FAILED ${test}: ${message}`),
  ...run.failures.filter(({ id }) => !id.includes(' › ')).map(({ id, state, message }) => `${state} ${id}: ${message}`),
].join('\n').slice(0, 6000);

/** A run of the lane that can be judged: cargo built and started the targets, and none failed outside its tests. */
function judged(args) {
  const { status, out } = cargo(args);
  const run = read(out, status, targets());
  if (status !== 0 && run.tests === 0) blocked(`cargo ${args.join(' ')} ran no test and exited ${status}: ${run.error ?? out.trim().split('\n').at(-1)}`);
  const outside = run.failures.filter(({ id }) => !id.includes(' › '));
  if (outside.length) blocked(`cargo ${args.join(' ')}: ${outside.map(({ id, message }) => `${id}: ${message}`).join('; ')}`);
  // A lane test that says it can't judge is no failure of a pair, and no pass.
  const unjudged = run.failures.find(({ state }) => state !== 'FAIL');
  if (unjudged) throw new Error(`${unjudged.state} ${unjudged.id}: ${unjudged.message}`);
  return run;
}

let plain;
/** The three crates' unit lanes, the lane's tests alone, once a process: every test of a file judges the same run. */
export function lane() {
  if (!plain) {
    try {
      plain = { run: judged(LANE_ARGS) };
    } catch (error) {
      plain = { error };
    }
  }
  if (plain.error) throw plain.error;
  return plain.run;
}
/** The lane again, uncached: one more run of the same command, for a time. */
export const laneAgain = () => judged(LANE_ARGS);

/** The lane with the planted comparison. A build that isn't there, or doesn't build, is read by the test, not here. */
export function plantedLane() {
  const { status, out } = cargo(PLANTED_ARGS);
  return read(out, status, targets());
}

/** This suite's Rust target: whether its one test ran and passed, and what it printed. */
export function twinShaders() {
  const { status, out } = cargo(TWIN_ARGS);
  const run = read(out, status, targets());
  const own = (id) => id.endsWith(` › ${TWIN_TEST}`);
  return { passed: run.passed.some(own), said: out.split('\n').filter((line) => /^#3256\.[0-9a-f]{8} twin /.test(line)).join('\n'), why: run.failed.map(({ message }) => message).join('\n') || run.error || `no target ${TWIN_TARGET} ran ${TWIN_TEST}` };
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading the crates' source, as this suite reads it

const walk = (folder) => readdirSync(folder).sort().flatMap((name) => {
  const path = join(folder, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});
/** The files under a crate's `src/`, by their path from the checkout's root. */
const sources = (root, crate, kinds) => walk(join(root, 'crates', crate, 'src')).filter((path) => kinds.test(path)).map((path) => slashes(relative(root, path)));
const count = (text, mark) => text.split(mark).length - 1;
/** A file's text with each `//` comment to its line's end removed. */
const code = (text) => text.split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n');

/**
 * Every `#[repr(C)]` struct in the three crates' `src/` (`#[repr(C, …)]` too), test code included: `{ crate, file, name,
 * host }`, `host` as the listing names one. The attributes, comments and blank lines between the attribute and the
 * item are passed over; an enum or a union is no struct.
 */
export function hostStructs(root = ROOT) {
  const found = [];
  for (const crate of CRATES) {
    for (const file of sources(root, crate, /\.rs$/)) {
      const lines = readFileSync(join(root, file), 'utf8').split('\n');
      for (let at = 0; at < lines.length; at += 1) {
        const repr = lines[at].match(/^\s*#\[repr\(C\s*[,)][^\]]*\]\s*(.*)$/);
        if (!repr) continue;
        let item = repr[1], depth = 0;
        for (let next = at + 1; !item && next < lines.length; next += 1) {
          const text = lines[next].trim();
          if (depth > 0 || text.startsWith('#[')) depth += count(text, '[') - count(text, ']');
          else if (text && !text.startsWith('//')) item = text;
        }
        const name = item.match(/^(?:pub(?:\([^)]*\))?\s+)?struct\s+(\w+)/)?.[1];
        if (name) found.push({ crate, file, name, host: `${file}:${name}` });
      }
    }
  }
  return found;
}

/**
 * Every shader struct the three crates bind as `var<uniform>`: `{ crate, name, files, shown }`, `files` the names of the
 * files that may hold its declaration (the binding's own file when it declares the struct, else every file of the
 * crate that does). Shader text in a Rust string counts as the `.rs` file's. A bound type the crate declares in no
 * file (one the core's emitter writes) is not this suite's to place, and is left out.
 */
export function uniformStructs(root = ROOT) {
  const found = new Map();
  for (const crate of CRATES) {
    const texts = sources(root, crate, /\.(?:wgsl|rs)$/).map((file) => [file, code(readFileSync(join(root, file), 'utf8'))]);
    const declared = new Map();
    for (const [file, text] of texts) for (const [, name] of text.matchAll(/\bstruct\s+(\w+)\s*\{/g)) declared.set(name, [...(declared.get(name) ?? []), file]);
    for (const [file, text] of texts) {
      for (const [, type] of text.matchAll(/\bvar\s*<\s*uniform\s*>\s*\w+\s*:\s*([^;]+);/g)) {
        const name = type.trim().match(/^(?:array\s*<\s*)?(\w+)\s*(?:,\s*\w+\s*)?>?$/)?.[1];
        const where = declared.get(name) ?? [];
        const files = (where.includes(file) ? [file] : where).map((path) => basename(path));
        if (files.length) found.set(`${crate} ${name} ${files.join(' ')}`, { crate, name, files, shown: `${files.join(' or ')}#${name}` });
      }
    }
  }
  return [...found.values()];
}

/** Each declaration `struct <name> { … }` in a crate's `src/`, Rust or shader: its fields as `name:type`, spaces out. */
export function declarations(crate, name, root = ROOT) {
  return sources(root, crate, /\.(?:wgsl|rs)$/).flatMap((file) => [...code(readFileSync(join(root, file), 'utf8')).matchAll(new RegExp(`\\bstruct\\s+${name}\\s*\\{([^{}]*)\\}`, 'g'))]
    .map(([, body]) => body.split(/,|\n/).map((field) => field.replace(/#\[[^\]]*\]/g, '').replace(/^\s*pub(?:\([^)]*\))?\s+/, '').replace(/\s+/g, '')).filter(Boolean).join(' ')));
}

// ---------------------------------------------------------------------------------------------------------------------
// The judges: each decides one criterion from a run (and this suite's reading of the source), and throws an assertion
// that names what it found.

/** The words of `words` that `text` doesn't hold as words of their own (`Frame` is not in `FrameUniform`). */
export const unnamed = (text, words) => words.filter((word) => !new RegExp(`(?<![\\w])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w])`).test(text));
/** The failures of a run's tests whose messages name every one of `words`. */
const naming = (run, words) => run.failed.filter(({ message }) => unnamed(message, words).length === 0);
const said = (failures) => failures.map(({ test, message }) => `${test}: ${message}`).join('\n');

/** The lane is there: at least one test of the three crates has the filter in its name. Fails at the base. */
export function ran(run) {
  assert.ok(run.tests > 0, `no test in the unit lanes of ${CRATES.join(', ')} has ${FILTER} in its name: the lane isn't there (cargo test ${LANE_ARGS.slice(1).join(' ')} ran 0 tests)`);
}

/** Whether a listing line names the struct `host` of the source. */
const names = (host) => (line) => line.host === host.host;
/** The #[repr(C)] structs of the source that the listing neither compares nor holds on the host-only list. */
const unlisted = (run, hosts) => hosts.filter((host) => ![...run.pairs, ...run.records, ...run.differs, ...run.hostOnly].some(names(host)));
/** The var<uniform> structs of the source that no host struct of the listing names and the gpu-only list doesn't hold. */
const unheld = (run, uniforms) => uniforms.filter(({ name, files }) => ![...run.pairs, ...run.differs, ...run.gpuOnly].some((line) => line.shader === name && files.includes(line.shaderFile)));

/**
 * AC1: every pair passes, every #[repr(C)] struct of the three crates is a pair or on the host-only list, and the lane
 * prints the pairs it compared. Returns the counts it found, for the test to state.
 */
export function judgeListing(run, hosts) {
  ran(run);
  assert.equal(run.failed.length + run.failures.length, 0, `every pair on main passes, but the lane fails:\n${shown(run)}`);
  assert.deepEqual(run.malformed.map(({ text }) => text), [], 'each line the lane prints of a pair, a record or a list reads as README.md gives it');
  assert.ok(run.pairs.length > 0, `the lane prints no pair it compared (no "layout pair" line):\n${shown(run)}`);
  assert.deepEqual(unlisted(run, hosts).map(({ host }) => host), [], `every #[repr(C)] struct of the three crates is a pair or on the host-only list (${hosts.length} in their src/)`);
  assert.deepEqual(run.hostOnly.filter(({ reason }) => !reason).map(({ host }) => host), [], 'each struct on the host-only list is there with its reason');
  const paired = new Set([...run.pairs, ...run.records, ...run.differs].map(({ host }) => host));
  return { structs: hosts.length, pairs: run.pairs.length, records: run.records.length, compared: hosts.filter(({ host }) => paired.has(host)).length, hostOnly: hosts.filter((host) => run.hostOnly.some(names(host)) && !paired.has(host.host)).length };
}

const FRAME = 'crates/deep-scene3d-render/src/lib.rs:FrameUniform';
/**
 * AC2: `FrameUniform` and `scene3d.wgsl`'s `Frame` are a pair the lane compares field by field, at the shader's own
 * offsets. Where the lane fails that pair (the twin frame-fields-swapped), the failure names the pair, both fields and
 * their offsets. By hand, from the shader language's layout rules (mat4x4<f32>: align 16, size 64; vec4: align 16, size
 * 16; array<vec4<f32>, 4>: stride 16, size 64) and the Rust struct at the base (every field an array of f32 or u32, so
 * no padding): clip 0, right 64, up 80, viewport 96, light 112, px 128, sky_top 144, sky_low 160, inverse_clip 176,
 * eye 240, cut 256, cut_info 320, cap 336, and 352 bytes, on both sides. The twin has sky_low at 144 and sky_top at 160.
 */
export function judgeFrame(run, twin) {
  ran(run);
  const validated = twin.passed ? `naga validates the checkout's scene module with the swap laid and its Frame is 352 bytes, as FrameUniform is (${twin.said || TWIN_TEST})` : `${TWIN_TARGET} doesn't show the swapped shader validating at FrameUniform's size: ${twin.why}`;
  const failures = naming(run, ['FrameUniform']);
  if (failures.length) {
    const words = ['FrameUniform', 'Frame', 'sky_top', 'sky_low', '144', '160'];
    assert.ok(naming(run, words).length > 0, `the lane fails FrameUniform without naming the pair, both fields and their offsets (${words.join(', ')}):\n${said(failures)}`);
    assert.fail(`the lane fails the pair FrameUniform = scene3d.wgsl#Frame, naming sky_top and sky_low and their offsets 144 and 160:\n${said(naming(run, words))}\n${validated}`);
  }
  const pairs = run.pairs.filter((pair) => pair.host === FRAME && pair.shader === 'Frame' && pair.shaderFile === 'scene3d.wgsl');
  assert.ok(pairs.length > 0, `the lane compares ${FRAME} with scene3d.wgsl#Frame (a "layout pair" line):\n${shown(run)}`);
  for (const { fields, bytes, text } of pairs) {
    assert.equal(fields.length, 13, `FrameUniform and Frame hold 13 fields each: ${text}`);
    assert.deepEqual(fields.filter(({ name }) => ['sky_top', 'sky_low'].includes(name)), [{ name: 'sky_top', offset: 144 }, { name: 'sky_low', offset: 160 }], `sky_top is at 144 and sky_low at 160 on both sides: ${text}`);
    assert.equal(bytes, 352, `FrameUniform and Frame are 352 bytes: ${text}`);
  }
  assert.ok(twin.passed, validated);
}

const AO = 'crates/deep-scene3d-render/src/ao.rs:AoUniform';
/**
 * AC3: `AoUniform` and the shader's `Ao` are a pair. Where the lane fails it, the failure names the field `opts` and
 * both types (the twin ao-opts-retyped: `[f32; 4]` against `vec4<u32>`, read as the scalar types f32 and u32), or both
 * sizes (the twin ao-field-added). By hand: clip 0, inv 64, size 128, opts 144, scale 160, contact 176, steps 192 and
 * 208 bytes on both sides; one more `[f32; 4]` at the host's end makes it 224.
 */
export function judgeAo(run) {
  ran(run);
  const failures = naming(run, ['AoUniform']);
  if (failures.length) {
    const retyped = naming(run, ['AoUniform', 'opts', 'f32', 'u32']), longer = naming(run, ['AoUniform', '208', '224']);
    assert.ok(retyped.length + longer.length > 0, `the lane fails AoUniform without naming the field and both types (opts, f32, u32) or both sizes (208, 224):\n${said(failures)}`);
    assert.fail(retyped.length ? `the lane fails AoUniform, naming the field opts and both types, f32 and u32:\n${said(retyped)}` : `the lane fails AoUniform, naming both sizes, 208 and 224:\n${said(longer)}`);
  }
  const pairs = run.pairs.filter((pair) => pair.host === AO && pair.shader === 'Ao' && ['ao.wgsl', 'ao_shade.wgsl'].includes(pair.shaderFile));
  assert.ok(pairs.length > 0, `the lane compares ${AO} with the shader's Ao (a "layout pair" line naming ao.wgsl#Ao or ao_shade.wgsl#Ao):\n${shown(run)}`);
  for (const { fields, bytes, text } of pairs) {
    assert.deepEqual(fields.filter(({ name }) => name === 'opts'), [{ name: 'opts', offset: 144 }], `opts is at 144 on both sides: ${text}`);
    assert.equal(bytes, 208, `AoUniform and Ao are 208 bytes: ${text}`);
  }
}

const tidy = (fields) => fields.replace(/\s+/g, '').replace(/,/g, ' ');
/** Criterion 4's two small pairs, as the criterion gives them: each side's fields, in order. */
export const SMALL = [
  { name: 'OffsetsAgree3256', host: 'a: [f32; 3], b: f32', shader: 'a: vec3<f32>, b: f32' },
  { name: 'OffsetsDiffer3256', host: 'a: [f32; 3], b: [f32; 3]', shader: 'a: vec3<f32>, b: vec3<f32>' },
];
/**
 * AC4: the offsets compared are the shader's own. `declared` gives a small pair's declarations in deep-groups-render's
 * source (`declarations`). By hand: a host `[f32; 3]` then `f32` sits at 0 and 12 in 16 bytes, and `vec3<f32>` (align
 * 16, size 12) then `f32` (align 4) at 0 and 12 in 16; a host `[f32; 3]` then `[f32; 3]` sits at 0 and 12, and two
 * `vec3<f32>` at 0 and 16. A comparison that sums host sizes for the shader's offsets finds 12 against 12 and passes it.
 */
export function judgeOffsets(run, declared) {
  ran(run);
  for (const { name, host, shader } of SMALL) {
    const found = declared(name);
    assert.ok(found.includes(tidy(host)), `deep-groups-render's source holds the host struct ${name} { ${host} } (found: ${found.join(' | ') || 'no struct of that name'})`);
    assert.ok(found.includes(tidy(shader)), `deep-groups-render's source holds the shader struct ${name} { ${shader} } (found: ${found.join(' | ') || 'no struct of that name'})`);
  }
  const [agree, differ] = SMALL.map(({ name }) => name);
  const pairs = run.pairs.filter((pair) => pair.name === agree && pair.shader === agree);
  assert.ok(pairs.length > 0, `the lane compares ${agree} with its shader struct and finds them to agree (a "layout pair" line):\n${shown(run)}`);
  for (const { fields, bytes, text } of pairs) {
    assert.deepEqual(fields, [{ name: 'a', offset: 0 }, { name: 'b', offset: 12 }], `[f32; 3] then f32 against vec3<f32> then f32 passes at offsets 0 and 12: ${text}`);
    assert.equal(bytes, 16, `${agree} is 16 bytes on both sides: ${text}`);
  }
  assert.deepEqual(run.pairs.filter((pair) => pair.name === differ).map(({ text }) => text), [], `[f32; 3] then [f32; 3] against two vec3<f32> is no pair that agrees: the shader's second field is at 16, the host's at 12`);
  const differs = run.differs.filter((line) => line.name === differ && line.shader === differ);
  assert.ok(differs.length > 0, `the lane compares ${differ} with its shader struct and states how they differ (a "layout differs" line):\n${shown(run)}`);
  for (const { message, text } of differs) assert.deepEqual(unnamed(message, ['b', '12', '16']), [], `[f32; 3] then [f32; 3] against two vec3<f32> fails at the second field, b, 12 against 16: ${text}`);
}

/**
 * AC4's last sentence: a run of the lane built with the planted comparison (`plantedLane`). The build is there and runs
 * the lane; `[f32; 3]` then `f32` still passes at 0 and 12, since there the host's sizes sum to the shader's offsets;
 * the lane's test of the second pair fails, naming it, since the planted comparison passes it; and `judgeOffsets`, the
 * judge the shipped lane passes, fails on this run.
 */
export function judgePlanted(planted, declared) {
  const [agree, differ] = SMALL.map(({ name }) => name);
  assert.ok(planted.tests > 0, `the lane with the planted comparison ran no test (cargo ${PLANTED_ARGS.join(' ')}): ${planted.error ?? `exit ${planted.status}`}`);
  const still = planted.pairs.filter(({ name }) => name === agree);
  assert.ok(still.length > 0 && still.every(({ fields }) => fields.map(({ name, offset }) => `${name}@${offset}`).join(' ') === 'a@0 b@12'), `with ${PLANT}, [f32; 3] then f32 still passes at 0 and 12, where the host's sizes sum to the shader's offsets:\n${shown(planted)}`);
  assert.ok(naming(planted, [differ]).length > 0, `with ${PLANT}, the comparison passes [f32; 3] then [f32; 3] against two vec3<f32>, so the lane's test of ${differ} fails, naming it:\n${shown(planted)}`);
  assert.throws(() => judgeOffsets(planted, declared), assert.AssertionError, `a comparison that sums host sizes for the shader's offsets (${PLANT}) passes this test's judge`);
}

const SOLID = 'crates/deep-scene3d-render/src/lib.rs:SolidRecord';
/**
 * AC5: `SolidRecord` is held three ways, with its attribute list `SOLID`. Where the lane fails it (the twin
 * solid-fields-swapped), the failure names locations 10 and 11 and both names, base and surface. By hand, from the
 * base: SOLID's Float32x4 at locations 10 and 11 start at bytes 80 and 96, where the record holds base and surface,
 * and the shader's inputs at 10 and 11 are base and surface.
 */
export function judgeSolid(run) {
  ran(run);
  const failures = naming(run, ['SolidRecord']);
  if (failures.length) {
    const words = ['SolidRecord', '10', '11', 'base', 'surface'];
    assert.ok(naming(run, words).length > 0, `the lane fails SolidRecord without naming locations 10 and 11 and both names, base and surface:\n${said(failures)}`);
    assert.fail(`the lane fails SolidRecord, naming locations 10 and 11 and the names base and surface:\n${said(naming(run, words))}`);
  }
  const records = run.records.filter((record) => record.host === SOLID && record.list === 'SOLID');
  assert.ok(records.length > 0, `the lane holds ${SOLID} against its attribute list SOLID and the shader's inputs (a "layout record" line):\n${shown(run)}`);
}

/** The names of AC6's two planted structs (twins host-struct-unlisted and uniform-struct-unnamed). */
export const NEW = ['Unlisted3256', 'Unnamed3256'];
/**
 * AC6: coverage is closed. Where the lane fails naming a new struct (the twins), that is the failure. Else every
 * #[repr(C)] struct of the source is compared or on the host-only list with its reason, and every shader struct bound
 * as var<uniform> is named by a host struct or on the gpu-only list with its reason: one this suite finds in the
 * source and the lane doesn't hold is a struct the lane should have failed on.
 */
export function judgeCoverage(run, hosts, uniforms) {
  ran(run);
  for (const name of NEW) {
    const failures = naming(run, [name]);
    if (failures.length) assert.fail(`the lane fails, naming the new struct ${name}, which has neither a pair nor a reason:\n${said(failures)}`);
  }
  const passes = run.failed.length ? `the lane fails, without naming it:\n${said(run.failed)}` : 'the lane passes';
  // A struct a failure of the lane names is one the lane holds: a pair that differs prints no pair line.
  const quiet = ({ name }) => naming(run, [name]).length === 0;
  assert.deepEqual(run.malformed.map(({ text }) => text), [], 'each line the lane prints of a pair, a record or a list reads as README.md gives it');
  assert.deepEqual(unlisted(run, hosts).filter(quiet).map(({ host }) => host), [], `a #[repr(C)] struct with neither a pair nor a reason fails the lane, naming it; ${passes}`);
  assert.deepEqual(run.hostOnly.filter(({ reason }) => !reason).map(({ host }) => host), [], 'each struct on the host-only list is there with its reason');
  assert.deepEqual(unheld(run, uniforms).filter(quiet).map(({ shown: struct }) => struct), [], `a var<uniform> struct no host struct names fails the lane, naming it; ${passes}`);
  assert.deepEqual(run.gpuOnly.filter(({ reason }) => !reason).map(({ text }) => text), [], 'each struct on the gpu-only list is there with its reason');
  return { structs: hosts.length, uniforms: uniforms.length, gpuOnly: run.gpuOnly.length };
}

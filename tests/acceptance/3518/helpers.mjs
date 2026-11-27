// Helpers for #3518's acceptance tests: the checkout's own budget manifest and size record, planted trees (a folder
// holding a copy of this checkout's benchmarks/ and scripts/, a planted benchmarks/budgets.json, a planted size record
// and the six small files it names, and no built binary), one run of the web-export task's command in such a tree, and
// the judges that read a run. A count's ceiling is judged by scripts/benchmark.mjs's own `judgeCount`, and a change to
// a ceiling by its `validateBudgets`, as perf and a budget window call them (README: The surface).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants } from 'node:zlib';
import { judgeCount, validateBudgets } from '../../../scripts/benchmark.mjs';

const at = (path) => fileURLToPath(new URL(path, import.meta.url));
const ROOT = at('../../../');
// The folders a planted tree copies whole, and the files of the checkout the tests read. Each file is spelled as its
// own path, since scripts/affected.mjs selects a suite by the paths its literals name: the bench the issue names, the
// manifest and the size record.
const BENCHMARKS = at('../../../benchmarks/');
const SCRIPTS = at('../../../scripts/');
const BENCH_FILE = at('../../../benchmarks/web.mjs');
const MANIFEST_FILE = at('../../../benchmarks/budgets.json');
const RECORD_FILE = at('../../../crates/deep-player/web/dist/sets.json');
const MANIFEST = 'benchmarks/budgets.json';
export const RECORD = 'crates/deep-player/web/dist/sets.json';

/** Each criterion's tag: `#3518.<first 8 hex digits of the SHA-256 of its text>`, as scripts/proof-change.mjs's criterionId gives it. */
export const AC = {
  1: 'AC1 #3518.df764765',
  2: 'AC2 #3518.d99171b8',
  3: 'AC3 #3518.9de0d983',
  4: 'AC4 #3518.fd5b7a48',
  5: 'AC5 #3518.3c8c36bf',
};
const TASK = 'web-export';
const SETS = ['figure', 'game2d', 'full'];
/** The issue's plant: a set 100,000 B larger. */
export const OVER = 100_000;
/** #172's limit on the player, 12 MB, as tests/acceptance/172/budgets.test.ts reads it. */
const PLAYER_LIMIT = 12_000_000;
/**
 * Each set's compressed size on the pinned base, main at b134dd38f7a628c15a0764e299b77809fd5be230, as its committed
 * size record gives it (README: Readings): `git show b134dd38f:crates/deep-player/web/dist/sets.json`, each set's
 * `compressed`.
 */
const PINNED = { figure: 2_556_890, game2d: 4_977_487, full: 7_973_566 };

// The names this suite gives the report's fields and the task's ceilings (README: The surface).
const bytesField = (set) => `${set}_brotli_bytes`;
const ceilingField = (set) => `${set}_ceiling_bytes`;
const shareField = (set) => `${set}_share`;
const limitKey = (set) => `report.${bytesField(set)}`;
/** The numbers the base's report holds, which a tree with no built binary can't give. */
const EXPORT_FIELDS = ['player_brotli_bytes', 'player_bytes', 'bundle_bytes'];

const show = (value) => (value === undefined ? 'no such field' : JSON.stringify(value));
/** A message without this machine's folders: the checkout, a home and a test's temporary folder are written as names. */
const scrub = (text, temp = null) => [...(temp ? [[temp, '<tmp>']] : []), [ROOT, '<checkout>/'], [homedir(), '~']]
  .reduce((said, [from, to]) => said.split(from).join(to), String(text));

/** No failures; the message lists them. */
export function none(failures, what) {
  assert.ok(failures.length === 0, `${what}: ${failures.slice(0, 30).join('\n  and ')}`);
}

/** This checkout's budget manifest, its web-export task with its limits, and its committed size record; `problems` names what isn't there or can't be read. */
export function checkout() {
  const problems = [];
  const read = (file, name) => {
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      problems.push(`${name} can't be read: ${scrub(error.message)}`);
      return null;
    }
  };
  const manifest = read(MANIFEST_FILE, MANIFEST), record = read(RECORD_FILE, RECORD);
  const task = Array.isArray(manifest?.tasks) ? manifest.tasks.find(({ id }) => id === TASK) ?? null : null;
  if (manifest && !task) problems.push(`${MANIFEST} holds no task ${TASK}`);
  else if (task && !(Array.isArray(task.command) && task.command.length && task.limits && typeof task.limits === 'object')) problems.push(`${MANIFEST}'s ${TASK} has no command or no limits: ${JSON.stringify(task).slice(0, 300)}`);
  if (!existsSync(BENCH_FILE)) problems.push(`benchmarks/web.mjs, the bench the issue names for ${TASK}, isn't in the checkout`);
  if (record && !(record.sets && typeof record.sets === 'object')) problems.push(`${RECORD} holds no sets: ${JSON.stringify(record).slice(0, 300)}`);
  return { manifest, record, task, limits: task?.limits ?? {}, problems };
}

/**
 * AC1, its first sentence: each set's ceiling in this checkout's manifest is the set's compressed size on the pinned
 * base. A ceiling only moves down, and a change that makes a set smaller may lower its ceiling (the issue's Scope), so
 * a lower value stands while the committed record's size for the set is within it. Anything else fails, naming the set.
 */
export function pinnedFailures(here) {
  return SETS.flatMap((set) => {
    const key = limitKey(set), limit = here.limits[key], pinned = PINNED[set], now = here.record?.sets?.[set]?.compressed;
    if (limit === undefined) return [`${MANIFEST}: ${TASK} holds no ceiling ${key} (its limits: ${JSON.stringify(here.limits)}): the task has no limit for ${set}, which is ${pinned} B on the pinned base`];
    if (limit === pinned) return [];
    if (!(limit < pinned)) return [`${MANIFEST}: ${TASK}'s ${key} is ${show(limit)}, not ${set}'s compressed size on the pinned base, ${pinned} B: a ceiling starts there and only moves down`];
    if (!(Number.isFinite(now) && now <= limit)) return [`${MANIFEST}: ${TASK}'s ${key} is ${limit}, under the ${pinned} B of the pinned base, while the committed ${RECORD} gives ${set} ${show(now)} B: a ceiling is lowered only with its set, never under the set's size`];
    return [];
  });
}

/** Brotli at quality 11, as scripts/player-wasm.mjs measures a set's file for the size record. */
const brotli11 = (bytes) => brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length } }).length;
/** A set's compressed size, as the record gives one: Brotli 11 of its WebAssembly and of its page glue, summed. */
const sizeOf = ({ wasm, glue }) => brotli11(wasm) + brotli11(glue);
/** `length` bytes from a seed (mulberry32): the same bytes every run, and nothing Brotli can shrink. */
function noise(seed, length) {
  const bytes = Buffer.alloc(length);
  let state = seed >>> 0;
  for (let index = 0; index < length; index++) {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    bytes[index] = (mixed ^ (mixed >>> 14)) & 0xff;
  }
  return bytes;
}

let made;
/**
 * The planted sets' files, made once: for each set a small WebAssembly file and a page glue file of seeded bytes,
 * `sizes`, each set's Brotli 11 size measured here, and `grown`, game2d's two files with its WebAssembly lengthened
 * until the set measures exactly 100,000 B more.
 */
export function plants() {
  if (made) return made;
  const lengths = { figure: [3_000, 500], game2d: [5_000, 600], full: [8_000, 700] };
  const files = Object.fromEntries(SETS.map((set, index) => [set, { wasm: noise(2 * index + 1, lengths[set][0]), glue: noise(2 * index + 2, lengths[set][1]) }]));
  const sizes = Object.fromEntries(SETS.map((set) => [set, sizeOf(files[set])]));
  let extra = OVER;
  for (let tries = 0; tries < 8 && extra > 0; tries++) {
    const grown = { wasm: Buffer.concat([files.game2d.wasm, noise(7, extra)]), glue: files.game2d.glue };
    const by = sizeOf(grown) - sizes.game2d;
    if (by === OVER) return (made = { files, sizes, grown });
    extra += OVER - by;
  }
  throw Error(`BLOCKED: no length of seeded bytes made game2d's planted files exactly ${OVER} B larger at Brotli 11 on Node ${process.version}`);
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const placeOf = (set, file) => `crates/deep-player/web/dist/${set}/${file}`;
/** Where a planted record names a set's two files, from the tree's root, as the committed record does. */
export const pathsOf = (set) => ({ wasm: placeOf(set, 'player_bg.wasm'), glue: placeOf(set, 'player.js') });

/**
 * A planted tree, removed when the test ends: this checkout's benchmarks/ (but for its windows/) and scripts/,
 * copied; over them the checkout's manifest with web-export's three ceilings set to `ceilings`; the committed size
 * record with each set's two files named at their usual paths with their real SHA-256, and `recorded` as each set's
 * `compressed`; and the files themselves, but for those in `without`. It holds no target/, so no built binary. `sets`
 * gives each set's `{wasm, glue}` bytes.
 */
export function plant(t, here, { sets, recorded, ceilings, without = [] }) {
  const temp = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3518-')));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const root = join(temp, 'tree');
  // Not the budget windows' records, which grow with every window and are no code.
  const records = join(BENCHMARKS, 'windows');
  cpSync(BENCHMARKS, join(root, 'benchmarks'), { recursive: true, filter: (source) => source !== records });
  cpSync(SCRIPTS, join(root, 'scripts'), { recursive: true });
  const manifest = structuredClone(here.manifest);
  const task = manifest.tasks.find(({ id }) => id === TASK);
  task.limits = { ...task.limits, ...Object.fromEntries(SETS.map((set) => [limitKey(set), ceilings[set]])) };
  writeFileSync(join(root, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  const record = structuredClone(here.record);
  for (const set of SETS) {
    const paths = pathsOf(set);
    record.sets[set] = { ...record.sets[set], wasm: { path: paths.wasm, sha256: sha256(sets[set].wasm) }, glue: { path: paths.glue, sha256: sha256(sets[set].glue) }, compressed: recorded[set] };
    for (const kind of ['wasm', 'glue']) {
      if (without.includes(paths[kind])) continue;
      mkdirSync(dirname(join(root, paths[kind])), { recursive: true });
      writeFileSync(join(root, paths[kind]), sets[set][kind]);
    }
  }
  mkdirSync(dirname(join(root, RECORD)), { recursive: true });
  writeFileSync(join(root, RECORD), `${JSON.stringify(record, null, 2)}\n`);
  for (const folder of ['home', 'cache', 'tmp']) mkdirSync(join(temp, folder));
  return { temp, root, command: task.command, recorded, ceilings };
}

/**
 * One run of the task's command, as the tree's manifest gives it, in the tree's root, with a home, a cache folder and
 * a temporary folder of the test's own, this Node first on PATH, and no folder of binaries built elsewhere named to
 * it. Nothing is thrown: a run that can't start or is stopped has no exit status 0, and is read as a failed run.
 */
export function run(planted) {
  const env = { ...process.env, HOME: join(planted.temp, 'home'), XDG_CACHE_HOME: join(planted.temp, 'cache'), TMPDIR: join(planted.temp, 'tmp'), PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}` };
  for (const name of ['NODE_TEST_CONTEXT', 'DEEP_BIN_DIR', 'CARGO_TARGET_DIR']) delete env[name];
  const [command, ...args] = planted.command;
  // deadline: the command reads a size record and six small files; one still running after two minutes is stopped and read as a failed run
  const ran = spawnSync(command, args, { cwd: planted.root, env, encoding: 'utf8', timeout: 120_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024 });
  return { status: ran.status, ended: ran.status === null ? `was stopped (${ran.signal ?? ran.error?.code ?? 'no exit status'})` : `exited ${ran.status}`, stdout: ran.stdout ?? '', stderr: ran.stderr ?? '', temp: planted.temp };
}

/** A run's report: its last stdout line that is a JSON object, as `judgeTask` reads one; null when there is none. */
export function reportOf(ran) {
  const last = ran.stdout.trim().split('\n').filter((line) => line.trim().startsWith('{')).at(-1);
  try {
    const value = JSON.parse(last);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
const linesOf = (ran) => [...ran.stderr.split('\n'), ...ran.stdout.split('\n')];
/** What a run said, for a message: the last line of its stderr that isn't a stack frame, and the last line of its stdout. */
function said(ran) {
  const last = (text) => text.split('\n').filter((line) => line.trim() && !/^\s/.test(line) && !/^Node\.js v/.test(line)).at(-1);
  const [err, out] = [last(ran.stderr), last(ran.stdout)];
  return scrub(`its stderr ends ${err === undefined ? 'empty' : JSON.stringify(err.slice(0, 400))}, its stdout ${out === undefined ? 'empty' : JSON.stringify(out.slice(0, 400))}`, ran.temp);
}

/**
 * Each set's ceiling on a run, for the ceilings this checkout's task holds (`here.limits`), against the tree's own
 * values, as perf and a window read one: a run that exits non-zero has no verdict but BLOCKED, since `judgeTask`
 * throws on it; otherwise `judgeCount` on the number the report gives under the ceiling's name, null when it gives
 * none. One run stands for the five a lane takes: the command's count is the same every run.
 */
function verdicts(ran, planted, here) {
  const report = reportOf(ran);
  return Object.fromEntries(SETS.filter((set) => limitKey(set) in here.limits).map((set) => {
    const reading = report?.[bytesField(set)];
    return [set, ran.status !== 0 ? { status: 'BLOCKED', reason: `the command ${ran.ended}` } : judgeCount({ limit: planted.ceilings[set], runs: [Number.isFinite(reading) ? reading : null] })];
  }));
}

// A number as a message may write it: its digits, with or without separators between thousands, and no digit or
// decimal point beside it. A set is named where its name stands with no letter or digit beside it, as in a field's name.
const plain = (line) => line.replace(/(?<=\d)[,_\u00a0\u2009\u202f](?=\d{3}(?!\d))/g, '');
const holds = (line, number) => RegExp(`(?<![\\d.])${number}(?!\\d|\\.\\d)`).test(plain(line));
const namesSet = (line, set) => RegExp(`(?<![A-Za-z0-9])${set}(?![A-Za-z0-9])`).test(line);
/** Whether one line names a set and every one of `numbers`. */
const names = (line, set, numbers) => namesSet(line, set) && numbers.every((number) => holds(line, number));

/** A run that didn't end with a report: why, or null when it did. */
function unreported(ran, what) {
  if (ran.status !== 0) return `${what}: the task's command ${ran.ended}, so the lanes read no count of it; ${said(ran)}`;
  if (!reportOf(ran)) return `${what}: the task's command printed no report, a last stdout line that is a JSON object; ${said(ran)}`;
  return null;
}

/**
 * A tree whose record is true and whose sets are within their ceilings: the command exits 0 with no built binary, its
 * report gives each set's bytes as the tree's record has them, and each ceiling this checkout's task holds reads PASS.
 */
export function standsFailures(ran, planted, here, what) {
  const stopped = unreported(ran, what);
  if (stopped) return [stopped];
  const report = reportOf(ran), judged = verdicts(ran, planted, here), failures = [];
  for (const set of SETS) {
    const bytes = report[bytesField(set)];
    if (bytes !== planted.recorded[set]) failures.push(`${what}: the report's ${bytesField(set)} is ${show(bytes)}, not the ${planted.recorded[set]} B the tree's ${RECORD} records for ${set}`);
    if (judged[set] && judged[set].status !== 'PASS') failures.push(`${what}: ${set}'s ceiling of ${planted.ceilings[set]} B reads ${judged[set].status}, not PASS, on ${show(bytes)}: ${judged[set].reason}`);
  }
  return failures;
}

/**
 * AC1's plant: a tree whose `set` is truly `OVER` B over its ceiling, and whose record says so. The command exits 0,
 * the report gives the set's size, its ceiling reads FAIL and the other sets' PASS, and one line names the set, both
 * sizes and the difference: the ceiling's verdict as the lanes print it, `<task>: <limit's key>: <reason>`, or a line
 * of the run's stderr or stdout. A checkout whose task holds no ceiling for the set passes the plant, and that is the
 * first failure named.
 */
export function overFailures(ran, planted, here, set) {
  const what = `a planted ${RECORD} whose ${set} is ${OVER} B larger than its ceiling`, key = limitKey(set), failures = [];
  if (!(key in here.limits)) failures.push(`${what} passes: ${TASK} holds no ceiling ${key} (its limits: ${JSON.stringify(here.limits)}), so nothing fails the plant`);
  const stopped = unreported(ran, what);
  if (stopped) return [...failures, stopped];
  const report = reportOf(ran), judged = verdicts(ran, planted, here), size = planted.recorded[set], ceiling = planted.ceilings[set];
  if (report[bytesField(set)] !== size) failures.push(`${what}: the report's ${bytesField(set)} is ${show(report[bytesField(set)])}, not the ${size} B the planted record gives`);
  for (const [other, verdict] of Object.entries(judged)) {
    const expected = other === set ? 'FAIL' : 'PASS';
    if (verdict.status !== expected) failures.push(`${what}: ${other}'s ceiling of ${planted.ceilings[other]} B reads ${verdict.status}, not ${expected}, on ${show(report[bytesField(other)])}${verdict.reason ? `: ${verdict.reason}` : ''}`);
  }
  const verdict = judged[set] ? `${TASK}: ${key}: ${judged[set].reason ?? judged[set].status}` : null;
  if (![...(verdict ? [verdict] : []), ...linesOf(ran)].some((line) => names(line, set, [size, ceiling, OVER]))) {
    failures.push(`${what}: no line names ${set}, both sizes (${size} and ${ceiling}) and the difference (${OVER}): the ceiling's verdict reads ${verdict === null ? 'nothing, with no ceiling' : JSON.stringify(verdict)}, and the run: ${said(ran)}`);
  }
  return failures;
}

/**
 * AC2's plant: a tree whose record gives `set` the size `recorded` while its two files measure `measured` at Brotli
 * 11. The run fails, exiting non-zero, which the lanes read as the task BLOCKED with the run's output, never as a
 * count; and one line it prints names the set and both numbers.
 */
export function recordFailures(ran, set, recorded, measured, what) {
  const failures = [];
  if (ran.status === 0) {
    const report = reportOf(ran);
    failures.push(`${what}: the task's command exited 0${report ? `, its report giving ${bytesField(set)} ${show(report[bytesField(set)])}` : ''}: a record whose size for ${set} (${recorded}) differs from the Brotli 11 size of its two files (${measured}) fails the run, or a ceiling is met by editing the record`);
  }
  if (!linesOf(ran).some((line) => names(line, set, [recorded, measured]))) failures.push(`${what}: no line the run printed names ${set} and both numbers, the record's ${recorded} and the files' ${measured}; ${said(ran)}`);
  return failures;
}

/**
 * AC4's plant: a tree whose record is true but where a file of each set in `gone` (`{set: path}`) is missing. The
 * command still exits 0 and prints its report; each such set's bytes and share are missing from it, absent or null,
 * never 0 and never a number, and its ceiling reads INCONCLUSIVE; every other set is read as before. The numbers of
 * the export itself, which a tree with no built binary can't give, are never 0 either.
 */
export function unreadFailures(ran, planted, here, gone) {
  const what = `a tree where ${Object.entries(gone).map(([set, path]) => `${set}'s ${path}`).join(' and ')} ${Object.keys(gone).length > 1 ? 'are' : 'is'} missing`;
  if (ran.status !== 0) return [`${what}: the task's command ${ran.ended}, so its ceilings read BLOCKED, not INCONCLUSIVE, and no set's count is read; ${said(ran)}`];
  const stopped = unreported(ran, what);
  if (stopped) return [stopped];
  const report = reportOf(ran), judged = verdicts(ran, planted, here), failures = [];
  const missing = (value) => value === undefined || value === null;
  for (const set of SETS) {
    const bytes = report[bytesField(set)], share = report[shareField(set)];
    if (!(set in gone)) {
      if (bytes !== planted.recorded[set]) failures.push(`${what}: the report's ${bytesField(set)} is ${show(bytes)}, not the ${planted.recorded[set]} B recorded for ${set}, whose two files are there`);
      if (judged[set] && judged[set].status !== 'PASS') failures.push(`${what}: ${set}'s ceiling reads ${judged[set].status}, not PASS, though its two files are there: ${judged[set].reason}`);
      continue;
    }
    if (bytes === 0) failures.push(`${what}: the report's ${bytesField(set)} is 0: a count that can't be read is missing, never 0`);
    else if (!missing(bytes)) failures.push(`${what}: the report's ${bytesField(set)} is ${show(bytes)}: ${set}'s count can't be read with a file of it missing, so it is missing from the report, absent or null`);
    if (!missing(share)) failures.push(`${what}: the report's ${shareField(set)} is ${show(share)}: the share of a count that can't be read is missing too, never 0`);
    if (!judged[set]) failures.push(`${what}: ${TASK} holds no ceiling ${limitKey(set)} (its limits: ${JSON.stringify(here.limits)}), so nothing reads INCONCLUSIVE for ${set}`);
    else if (judged[set].status !== 'INCONCLUSIVE') failures.push(`${what}: ${set}'s ceiling reads ${judged[set].status}, not INCONCLUSIVE, on ${show(bytes)}${judged[set].reason ? `: ${judged[set].reason}` : ''}`);
  }
  for (const field of EXPORT_FIELDS) if (report[field] === 0) failures.push(`${what}: the report's ${field} is 0 in a tree with no built binary: a count that can't be read is missing, never 0`);
  return failures;
}

/**
 * AC5, on a tree whose record is true and whose sets are each under their ceiling by their own amount: the run stands
 * (`standsFailures`, which holds each set's bytes), and the report also lists each set's ceiling, as the tree's
 * manifest has it, and its share of the 12 MB limit, its bytes over 12,000,000 to within half a byte.
 */
export function listFailures(ran, planted, here) {
  const what = 'a tree whose three sets are under their ceilings';
  const stood = standsFailures(ran, planted, here, what);
  if (unreported(ran, what)) return stood;
  const report = reportOf(ran);
  return [...stood, ...SETS.flatMap((set) => {
    const ceiling = report[ceilingField(set)], share = report[shareField(set)], size = planted.recorded[set];
    return [
      ...ceiling === planted.ceilings[set] ? [] : [`${what}: the report's ${ceilingField(set)} is ${show(ceiling)}, not ${set}'s ceiling, the ${planted.ceilings[set]} of ${limitKey(set)} in the tree's ${MANIFEST}`],
      ...typeof share === 'number' && Math.abs(share * PLAYER_LIMIT - size) <= 0.5 ? [] : [`${what}: the report's ${shareField(set)} is ${show(share)}, not ${set}'s share of the 12 MB limit, ${size} / ${PLAYER_LIMIT} = ${size / PLAYER_LIMIT}`],
    ];
  })];
}

/**
 * AC3: against this checkout's manifest as the merge base, a change that raises a set's ceiling by 1 B is refused by
 * `validateBudgets` with no approval, in a message that names the task and the field; the same change with #2665's
 * approved proposal for it isn't, so the refusal is for the missing approval; and a change that lowers the ceiling by
 * 1 B isn't refused. A checkout whose task holds no such ceiling refuses nothing, and that is the failure named.
 */
export function raiseFailures(here) {
  const refusal = (change, approved = []) => {
    try {
      validateBudgets(change, here.manifest, approved);
      return null;
    } catch (error) {
      return error.message;
    }
  };
  const failures = [];
  const unchanged = refusal(structuredClone(here.manifest));
  if (unchanged !== null) failures.push(`${MANIFEST} with nothing changed is refused against itself: ${unchanged}`);
  for (const set of SETS) {
    const key = limitKey(set), before = here.limits[key];
    const moved = (value) => {
      const change = structuredClone(here.manifest);
      change.tasks.find(({ id }) => id === TASK).limits[key] = value;
      return change;
    };
    if (before === undefined) {
      const answer = refusal(moved(PINNED[set] + 1));
      failures.push(`${TASK} holds no ceiling ${key} to raise (its limits: ${JSON.stringify(here.limits)}): a change that sets it 1 B over ${set}'s size on the pinned base, at ${PINNED[set] + 1}, ${answer === null ? "isn't refused" : `is answered ${JSON.stringify(answer)}`}`);
      continue;
    }
    const raised = before + 1, answer = refusal(moved(raised));
    const named = answer !== null && RegExp(`(?<![\\w-])${TASK}(?![\\w-])`).test(answer) && RegExp(`(?<![\\w.])${key.replace('.', '\\.')}(?!\\w)`).test(answer);
    if (answer === null) failures.push(`a change that raises ${TASK}'s ${key} from ${before} to ${raised} with no approval isn't refused`);
    else if (!named) failures.push(`the refusal of ${key} raised from ${before} to ${raised} doesn't name the task ${TASK} and the field ${key}: ${JSON.stringify(answer)}`);
    const item = `${MANIFEST} › ${TASK} › ${key} ${before} → ${raised}`;
    const approved = refusal(moved(raised), [item]);
    if (approved !== null) failures.push(`the same raise is refused with its approved proposal, "${item}", so the refusal isn't for the missing approval: ${JSON.stringify(approved)}`);
    const lowered = refusal(moved(before - 1));
    if (lowered !== null) failures.push(`a change that lowers ${TASK}'s ${key} from ${before} to ${before - 1} is refused: ${JSON.stringify(lowered)}`);
  }
  return failures;
}

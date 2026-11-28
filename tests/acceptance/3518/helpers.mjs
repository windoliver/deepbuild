import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants } from 'node:zlib';
import { judgeCount, validateBudgets } from '../../../scripts/benchmark.mjs';

const fromThisFile = (path) => fileURLToPath(new URL(path, import.meta.url));
const ROOT = fromThisFile('../../../');
const BENCHMARKS_FOLDER = fromThisFile('../../../benchmarks/');
const SCRIPTS_FOLDER = fromThisFile('../../../scripts/');
const BENCH_FILE = fromThisFile('../../../benchmarks/web.mjs');
const MANIFEST_FILE = fromThisFile('../../../benchmarks/budgets.json');
const RECORD_FILE = fromThisFile('../../../crates/deep-player/web/dist/sets.json');
const MANIFEST = 'benchmarks/budgets.json';
export const RECORD = 'crates/deep-player/web/dist/sets.json';

export const CRITERION_TAG = {
  1: 'AC1 #3518.df764765',
  2: 'AC2 #3518.d99171b8',
  3: 'AC3 #3518.9de0d983',
  4: 'AC4 #3518.fd5b7a48',
  5: 'AC5 #3518.3c8c36bf',
};
const TASK = 'web-export';
const SETS = ['figure', 'game2d', 'full'];
export const PLANTED_GROWTH_BYTES = 100_000;
const PLAYER_LIMIT_BYTES = 12_000_000;
const BYTES_ON_PINNED_BASE = { figure: 2_556_890, game2d: 4_977_487, full: 7_973_566 };

const bytesField = (set) => `${set}_brotli_bytes`;
const ceilingField = (set) => `${set}_ceiling_bytes`;
const shareField = (set) => `${set}_share`;
const limitKey = (set) => `report.${bytesField(set)}`;
const FIELDS_ONLY_A_BUILT_BINARY_GIVES = ['player_brotli_bytes', 'player_bytes', 'bundle_bytes'];

const show = (value) => (value === undefined ? 'no such field' : JSON.stringify(value));
const withoutMachineFolders = (text, temp = null) => [...(temp ? [[temp, '<tmp>']] : []), [ROOT, '<checkout>/'], [homedir(), '~']]
  .reduce((said, [from, to]) => said.split(from).join(to), String(text));

export function assertNoFailures(failures, what) {
  assert.ok(failures.length === 0, `${what}: ${failures.slice(0, 30).join('\n  and ')}`);
}

export function readCheckout() {
  const problems = [];
  const read = (file, name) => {
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      problems.push(`${name} can't be read: ${withoutMachineFolders(error.message)}`);
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

export function pinnedCeilingFailures(here) {
  return SETS.flatMap((set) => {
    const key = limitKey(set), limit = here.limits[key], pinned = BYTES_ON_PINNED_BASE[set], now = here.record?.sets?.[set]?.compressed;
    if (limit === undefined) return [`${MANIFEST}: ${TASK} holds no ceiling ${key} (its limits: ${JSON.stringify(here.limits)}): the task has no limit for ${set}, which is ${pinned} B on the pinned base`];
    if (limit === pinned) return [];
    if (!(limit < pinned)) return [`${MANIFEST}: ${TASK}'s ${key} is ${show(limit)}, not ${set}'s compressed size on the pinned base, ${pinned} B: a ceiling starts there and only moves down`];
    if (!(Number.isFinite(now) && now <= limit)) return [`${MANIFEST}: ${TASK}'s ${key} is ${limit}, under the ${pinned} B of the pinned base, while the committed ${RECORD} gives ${set} ${show(now)} B: a ceiling is lowered only with its set, never under the set's size`];
    return [];
  });
}

const brotli11 = (bytes) => brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length } }).length;
const brotli11OfBothFiles = ({ wasm, glue }) => brotli11(wasm) + brotli11(glue);
function seededBytes(seed, length) {
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

let plantedFilesOnce;
export function plantedFiles() {
  if (plantedFilesOnce) return plantedFilesOnce;
  const lengths = { figure: [3_000, 500], game2d: [5_000, 600], full: [8_000, 700] };
  const files = Object.fromEntries(SETS.map((set, index) => [set, { wasm: seededBytes(2 * index + 1, lengths[set][0]), glue: seededBytes(2 * index + 2, lengths[set][1]) }]));
  const sizes = Object.fromEntries(SETS.map((set) => [set, brotli11OfBothFiles(files[set])]));
  let extra = PLANTED_GROWTH_BYTES;
  for (let tries = 0; tries < 8 && extra > 0; tries++) {
    const largerGame2d = { wasm: Buffer.concat([files.game2d.wasm, seededBytes(7, extra)]), glue: files.game2d.glue };
    const by = brotli11OfBothFiles(largerGame2d) - sizes.game2d;
    if (by === PLANTED_GROWTH_BYTES) return (plantedFilesOnce = { files, sizes, largerGame2d });
    extra += PLANTED_GROWTH_BYTES - by;
  }
  throw Error(`BLOCKED: no length of seeded bytes made game2d's planted files exactly ${PLANTED_GROWTH_BYTES} B larger at Brotli 11 on Node ${process.version}`);
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const pathInTree = (set, file) => `crates/deep-player/web/dist/${set}/${file}`;
export const recordedPathsOf = (set) => ({ wasm: pathInTree(set, 'player_bg.wasm'), glue: pathInTree(set, 'player.js') });

export function plantTree(t, here, { sets, recorded, ceilings, without = [] }) {
  const temp = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3518-')));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const root = join(temp, 'tree');
  const budgetWindowRecords = join(BENCHMARKS_FOLDER, 'windows');
  cpSync(BENCHMARKS_FOLDER, join(root, 'benchmarks'), { recursive: true, filter: (source) => source !== budgetWindowRecords });
  cpSync(SCRIPTS_FOLDER, join(root, 'scripts'), { recursive: true });
  const manifest = structuredClone(here.manifest);
  const task = manifest.tasks.find(({ id }) => id === TASK);
  task.limits = { ...task.limits, ...Object.fromEntries(SETS.map((set) => [limitKey(set), ceilings[set]])) };
  writeFileSync(join(root, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  const record = structuredClone(here.record);
  for (const set of SETS) {
    const paths = recordedPathsOf(set);
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

export function runTaskCommand(planted) {
  const env = { ...process.env, HOME: join(planted.temp, 'home'), XDG_CACHE_HOME: join(planted.temp, 'cache'), TMPDIR: join(planted.temp, 'tmp'), PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}` };
  for (const name of ['NODE_TEST_CONTEXT', 'DEEP_BIN_DIR', 'CARGO_TARGET_DIR']) delete env[name];
  const [command, ...args] = planted.command;
  // deadline: the command reads a size record and six small files; one still running after two minutes is stopped and read as a failed run
  const ran = spawnSync(command, args, { cwd: planted.root, env, encoding: 'utf8', timeout: 120_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024 });
  return { status: ran.status, ended: ran.status === null ? `was stopped (${ran.signal ?? ran.error?.code ?? 'no exit status'})` : `exited ${ran.status}`, stdout: ran.stdout ?? '', stderr: ran.stderr ?? '', temp: planted.temp };
}

export function reportOf(ran) {
  const last = ran.stdout.trim().split('\n').filter((line) => line.trim().startsWith('{')).at(-1);
  try {
    const value = JSON.parse(last);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
const printedLines = (ran) => [...ran.stderr.split('\n'), ...ran.stdout.split('\n')];
function lastStderrAndStdoutLine(ran) {
  const last = (text) => text.split('\n').filter((line) => line.trim() && !/^\s/.test(line) && !/^Node\.js v/.test(line)).at(-1);
  const [err, out] = [last(ran.stderr), last(ran.stdout)];
  return withoutMachineFolders(`its stderr ends ${err === undefined ? 'empty' : JSON.stringify(err.slice(0, 400))}, its stdout ${out === undefined ? 'empty' : JSON.stringify(out.slice(0, 400))}`, ran.temp);
}

function ceilingVerdicts(ran, planted, here) {
  const report = reportOf(ran);
  return Object.fromEntries(SETS.filter((set) => limitKey(set) in here.limits).map((set) => {
    const reading = report?.[bytesField(set)];
    return [set, ran.status !== 0 ? { status: 'BLOCKED', reason: `the command ${ran.ended}` } : judgeCount({ limit: planted.ceilings[set], runs: [Number.isFinite(reading) ? reading : null] })];
  }));
}

const withoutThousandsSeparators = (line) => line.replace(/(?<=\d)[,_\u00a0\u2009\u202f](?=\d{3}(?!\d))/g, '');
const holdsWholeNumber = (line, number) => RegExp(`(?<![\\d.])${number}(?!\\d|\\.\\d)`).test(withoutThousandsSeparators(line));
const namesSet = (line, set) => RegExp(`(?<![A-Za-z0-9])${set}(?![A-Za-z0-9])`).test(line);
const namesSetAndNumbers = (line, set, numbers) => namesSet(line, set) && numbers.every((number) => holdsWholeNumber(line, number));

function whyNoReport(ran, what) {
  if (ran.status !== 0) return `${what}: the task's command ${ran.ended}, so the lanes read no count of it; ${lastStderrAndStdoutLine(ran)}`;
  if (!reportOf(ran)) return `${what}: the task's command printed no report, a last stdout line that is a JSON object; ${lastStderrAndStdoutLine(ran)}`;
  return null;
}

export function passingTreeFailures(ran, planted, here, what) {
  const stopped = whyNoReport(ran, what);
  if (stopped) return [stopped];
  const report = reportOf(ran), judged = ceilingVerdicts(ran, planted, here), failures = [];
  for (const set of SETS) {
    const bytes = report[bytesField(set)];
    if (bytes !== planted.recorded[set]) failures.push(`${what}: the report's ${bytesField(set)} is ${show(bytes)}, not the ${planted.recorded[set]} B the tree's ${RECORD} records for ${set}`);
    if (judged[set] && judged[set].status !== 'PASS') failures.push(`${what}: ${set}'s ceiling of ${planted.ceilings[set]} B reads ${judged[set].status}, not PASS, on ${show(bytes)}: ${judged[set].reason}`);
  }
  return failures;
}

export function setOverCeilingFailures(ran, planted, here, set) {
  const what = `a planted ${RECORD} whose ${set} is ${PLANTED_GROWTH_BYTES} B larger than its ceiling`, key = limitKey(set), failures = [];
  if (!(key in here.limits)) failures.push(`${what} passes: ${TASK} holds no ceiling ${key} (its limits: ${JSON.stringify(here.limits)}), so nothing fails the plant`);
  const stopped = whyNoReport(ran, what);
  if (stopped) return [...failures, stopped];
  const report = reportOf(ran), judged = ceilingVerdicts(ran, planted, here), size = planted.recorded[set], ceiling = planted.ceilings[set];
  if (report[bytesField(set)] !== size) failures.push(`${what}: the report's ${bytesField(set)} is ${show(report[bytesField(set)])}, not the ${size} B the planted record gives`);
  for (const [other, verdict] of Object.entries(judged)) {
    const expected = other === set ? 'FAIL' : 'PASS';
    if (verdict.status !== expected) failures.push(`${what}: ${other}'s ceiling of ${planted.ceilings[other]} B reads ${verdict.status}, not ${expected}, on ${show(report[bytesField(other)])}${verdict.reason ? `: ${verdict.reason}` : ''}`);
  }
  const verdict = judged[set] ? `${TASK}: ${key}: ${judged[set].reason ?? judged[set].status}` : null;
  if (![...(verdict ? [verdict] : []), ...printedLines(ran)].some((line) => namesSetAndNumbers(line, set, [size, ceiling, PLANTED_GROWTH_BYTES]))) {
    failures.push(`${what}: no line names ${set}, both sizes (${size} and ${ceiling}) and the difference (${PLANTED_GROWTH_BYTES}): the ceiling's verdict reads ${verdict === null ? 'nothing, with no ceiling' : JSON.stringify(verdict)}, and the run: ${lastStderrAndStdoutLine(ran)}`);
  }
  return failures;
}

export function differingRecordFailures(ran, set, recorded, measured, what) {
  const failures = [];
  if (ran.status === 0) {
    const report = reportOf(ran);
    failures.push(`${what}: the task's command exited 0${report ? `, its report giving ${bytesField(set)} ${show(report[bytesField(set)])}` : ''}: a record whose size for ${set} (${recorded}) differs from the Brotli 11 size of its two files (${measured}) fails the run, or a ceiling is met by editing the record`);
  }
  if (!printedLines(ran).some((line) => namesSetAndNumbers(line, set, [recorded, measured]))) failures.push(`${what}: no line the run printed names ${set} and both numbers, the record's ${recorded} and the files' ${measured}; ${lastStderrAndStdoutLine(ran)}`);
  return failures;
}

export function missingFileFailures(ran, planted, here, gone) {
  const what = `a tree where ${Object.entries(gone).map(([set, path]) => `${set}'s ${path}`).join(' and ')} ${Object.keys(gone).length > 1 ? 'are' : 'is'} missing`;
  if (ran.status !== 0) return [`${what}: the task's command ${ran.ended}, so its ceilings read BLOCKED, not INCONCLUSIVE, and no set's count is read; ${lastStderrAndStdoutLine(ran)}`];
  const stopped = whyNoReport(ran, what);
  if (stopped) return [stopped];
  const report = reportOf(ran), judged = ceilingVerdicts(ran, planted, here), failures = [];
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
  for (const field of FIELDS_ONLY_A_BUILT_BINARY_GIVES) if (report[field] === 0) failures.push(`${what}: the report's ${field} is 0 in a tree with no built binary: a count that can't be read is missing, never 0`);
  return failures;
}

export function reportListFailures(ran, planted, here) {
  const what = 'a tree whose three sets are under their ceilings';
  const stood = passingTreeFailures(ran, planted, here, what);
  if (whyNoReport(ran, what)) return stood;
  const report = reportOf(ran);
  return [...stood, ...SETS.flatMap((set) => {
    const ceiling = report[ceilingField(set)], share = report[shareField(set)], size = planted.recorded[set];
    return [
      ...ceiling === planted.ceilings[set] ? [] : [`${what}: the report's ${ceilingField(set)} is ${show(ceiling)}, not ${set}'s ceiling, the ${planted.ceilings[set]} of ${limitKey(set)} in the tree's ${MANIFEST}`],
      ...typeof share === 'number' && Math.abs(share * PLAYER_LIMIT_BYTES - size) <= 0.5 ? [] : [`${what}: the report's ${shareField(set)} is ${show(share)}, not ${set}'s share of the 12 MB limit, ${size} / ${PLAYER_LIMIT_BYTES} = ${size / PLAYER_LIMIT_BYTES}`],
    ];
  })];
}

export function raisedCeilingFailures(here) {
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
      const answer = refusal(moved(BYTES_ON_PINNED_BASE[set] + 1));
      failures.push(`${TASK} holds no ceiling ${key} to raise (its limits: ${JSON.stringify(here.limits)}): a change that sets it 1 B over ${set}'s size on the pinned base, at ${BYTES_ON_PINNED_BASE[set] + 1}, ${answer === null ? "isn't refused" : `is answered ${JSON.stringify(answer)}`}`);
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

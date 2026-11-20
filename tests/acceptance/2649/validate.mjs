// Shared by the #2649 acceptance tests: reads the spike's public record and the counter output it cites,
// and recomputes from them everything a test can recompute instead of taking the spike's word.
// Each check returns a list of problems; an empty list means it holds. Missing or unreadable input is a problem.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const SPIKE = 'docs/spikes/2649';
export const SUBJECTS = ['command-check', 'idle-hour'];
export const VERDICTS = ['needed', 'repeated', 'replaceable'];
export const TASKS = ['sandbox-setup', 'runner-job', 'command-check-count'];
export const ROUNDS = 15;
export const HOUR_SECONDS = 3600;
export const ROOT_CALLER = '<root>';

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;
const list = (value) => (Array.isArray(value) ? value : []);
const count = (value) => Number.isInteger(value) && value >= 0;
const positive = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;
const isCommit = (value) => /^[0-9a-f]{40}$/.test(value ?? '');

// ------------------------------------------------------------------ loading

export function loadRecord(dir = root) {
  const path = join(dir, SPIKE, 'record.json');
  if (!existsSync(path)) return { problems: [`no spike record at ${SPIKE}/record.json: the spike hasn't been recorded`] };
  try { return { record: JSON.parse(readFileSync(path, 'utf8')), problems: [] }; }
  catch (error) { return { problems: [`${SPIKE}/record.json is not JSON: ${error.message}`] }; }
}

const readText = (dir, file) => {
  if (!nonEmpty(file) || file.startsWith('/') || file.split('/').includes('..')) return null;
  const path = join(dir, SPIKE, file);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
};

// ------------------------------------------------------------------ the counter's log (scripts/count-children.c)
//   start <parent> <child> <path>
//   reap <parent> <child> <instructions> <elapsed> <children's elapsed> <7 QoS times>
//   unread <parent> <child> <child time>
//   exit <process> <instructions> <children's elapsed> <7 QoS times>
export function parseCounterLog(text) {
  const starts = [], reaps = new Map(), exits = new Map(), unread = new Set();
  for (const line of text.split('\n')) {
    const [kind, ...f] = line.trim().split(/\s+/);
    if (kind === 'start' && f.length >= 3) starts.push({ parent: f[0], child: f[1], path: f.slice(2).join(' ') });
    else if (kind === 'reap' && f.length >= 3) reaps.set(f[1], Number(f[2]));
    else if (kind === 'exit' && f.length >= 2) exits.set(f[0], Number(f[1]));
    else if (kind === 'unread' && f.length >= 2) unread.add(f[1]);
  }
  const pathOf = new Map(starts.map(({ child, path }) => [child, path]));
  return starts.map(({ parent, child, path }) => ({
    caller: pathOf.has(parent) ? basename(pathOf.get(parent)) : ROOT_CALLER,
    program: basename(path),
    instructions: reaps.has(child) ? reaps.get(child) : exits.has(child) ? exits.get(child) : null,
    unread: !reaps.has(child) && !exits.has(child),
  }));
}

// Group a log's starts the way the table's rows do: one group per caller and program.
export function groupStarts(starts) {
  const groups = new Map();
  for (const { caller, program, instructions, unread } of starts) {
    const key = `${caller}\u0000${program}`;
    const group = groups.get(key) ?? { caller, program, count: 0, instructions: 0, unread: 0 };
    group.count++;
    if (unread || !Number.isFinite(instructions)) group.unread++; else group.instructions += instructions;
    groups.set(key, group);
  }
  return groups;
}

// ------------------------------------------------------------------ criteria 1 and 2: the table

export function tableProblems(record, dir = root) {
  const problems = [];
  if (!record || typeof record !== 'object') return ['the record is not an object'];
  if (!isCommit(record.main)) problems.push('main is not the full hash of the main commit the counter ran on');
  if (!nonEmpty(record.counter?.command)) problems.push('counter.command (the command that ran the perf lane\'s child counter) is missing');
  const rows = list(record.rows);
  if (!rows.length) problems.push('the table has no rows');
  const subjects = record.subjects ?? {};
  const logs = {};
  for (const name of SUBJECTS) {
    const subject = subjects[name];
    if (!subject) { problems.push(`subject ${name}: missing`); continue; }
    const text = readText(dir, subject.log);
    if (text === null) { problems.push(`subject ${name}: counter output ${subject.log} is not kept with the spike`); continue; }
    if (subject.sha256 !== sha256(text)) problems.push(`subject ${name}: sha256 of ${subject.log} is not what the record says`);
    logs[name] = parseCounterLog(text);
    if (!logs[name].length) problems.push(`subject ${name}: ${subject.log} holds no process start`);
    if (name === 'idle-hour' && !(Number.isFinite(subject.durationSeconds) && subject.durationSeconds >= HOUR_SECONDS)) problems.push(`subject idle-hour: durationSeconds ${subject.durationSeconds} is not an hour or more`);
  }
  const seen = new Set();
  const rowTotals = Object.fromEntries(SUBJECTS.map((name) => [name, 0]));
  rows.forEach((row, index) => {
    const at = `row ${index} (${row?.subject}/${row?.caller}/${row?.program})`;
    if (!SUBJECTS.includes(row?.subject)) { problems.push(`${at}: subject is not one of ${SUBJECTS.join(', ')}`); return; }
    if (!nonEmpty(row.caller) || !nonEmpty(row.program)) { problems.push(`${at}: caller and program are required`); return; }
    const key = `${row.subject}\u0000${row.caller}\u0000${row.program}`;
    if (seen.has(key)) problems.push(`${at}: listed twice`);
    seen.add(key);
    if (!count(row.count) || row.count < 1) problems.push(`${at}: count is not a whole number of starts, at least 1`);
    if (!count(row.instructions)) problems.push(`${at}: instructions retired is not a whole number`);
    if (!count(row.unread)) problems.push(`${at}: unread (starts the counter has no instructions for) is not a whole number`);
    if (!nonEmpty(row.use)) problems.push(`${at}: use (what the answer is for) is empty`);
    if (!VERDICTS.includes(row.verdict)) problems.push(`${at}: verdict ${JSON.stringify(row.verdict)} is not needed, repeated or replaceable`);
    if (row.verdict === 'repeated' && !nonEmpty(row.heldBy)) problems.push(`${at}: repeated, but heldBy doesn't name the earlier answer that holds it`);
    if (row.verdict === 'replaceable') {
      if (!nonEmpty(row.replacement)) problems.push(`${at}: replaceable, but replacement is empty`);
      if (!nonEmpty(row.change)) problems.push(`${at}: replaceable, but change (what a person or a test would see change) is empty`);
    }
    if (count(row.count)) rowTotals[row.subject] += row.count;
    const group = logs[row.subject] && groupStarts(logs[row.subject]).get(`${row.caller}\u0000${row.program}`);
    if (logs[row.subject]) {
      if (!group) problems.push(`${at}: the counter output has no such starts`);
      else {
        if (row.count !== group.count) problems.push(`${at}: count ${row.count}, the counter output has ${group.count}`);
        if (row.instructions !== group.instructions) problems.push(`${at}: instructions ${row.instructions}, the counter output sums to ${group.instructions}`);
        if (row.unread !== group.unread) problems.push(`${at}: unread ${row.unread}, the counter output has ${group.unread}`);
      }
    }
  });
  for (const name of SUBJECTS) {
    if (logs[name] && rowTotals[name] !== logs[name].length) problems.push(`subject ${name}: rows list ${rowTotals[name]} starts, the counter output has ${logs[name].length}`);
    const total = subjects[name]?.totalStarts;
    if (logs[name] && total !== logs[name].length) problems.push(`subject ${name}: totalStarts ${total}, the counter output has ${logs[name].length}`);
  }
  const readme = readText(dir, 'README.md');
  if (readme === null) problems.push(`${SPIKE}/README.md (the table to read) is missing`);
  else for (const row of rows) {
    if (nonEmpty(row?.program) && !readme.includes(row.program)) problems.push(`README.md doesn't name program ${row.program}`);
    if (nonEmpty(row?.caller) && row.caller !== ROOT_CALLER && !readme.includes(row.caller)) problems.push(`README.md doesn't name caller ${row.caller}`);
  }
  return problems;
}

// ------------------------------------------------------------------ criterion 3: each cut tried

export function cutProblems(record) {
  const problems = [];
  const cuts = record?.cuts;
  if (!Array.isArray(cuts)) return ['cuts is not a list (an empty list says no cut was tried)'];
  const ids = new Set();
  cuts.forEach((cut, index) => {
    const at = `cut ${cut?.id ?? index}`;
    if (!nonEmpty(cut?.id) || ids.has(cut.id)) problems.push(`${at}: id is missing or repeated`);
    ids.add(cut?.id);
    if (!nonEmpty(cut?.description)) problems.push(`${at}: description is empty`);
    if (!isCommit(cut?.mergeBase)) problems.push(`${at}: mergeBase is not a full commit hash`);
    if (!isCommit(cut?.change)) problems.push(`${at}: change is not a full commit hash`);
    for (const task of TASKS) {
      const m = cut?.measurements?.[task];
      const here = `${at}, ${task}`;
      if (!m) { problems.push(`${here}: not measured`); continue; }
      if (!nonEmpty(m.command)) problems.push(`${here}: the command that measures it is missing`);
      const rounds = list(m.rounds);
      if (rounds.length !== ROUNDS) problems.push(`${here}: ${rounds.length} rounds, not ${ROUNDS} a side`);
      rounds.forEach((round, i) => {
        if (!positive(round?.base) || !positive(round?.change)) problems.push(`${here}, round ${i + 1}: base and change instructions must both be read (positive numbers)`);
        if (!['base', 'change'].includes(round?.first)) problems.push(`${here}, round ${i + 1}: first is not base or change`);
        else if (i > 0 && rounds[i - 1]?.first === round.first) problems.push(`${here}, round ${i + 1}: runs ${round.first} first again, so the sides weren't alternated`);
      });
    }
  });
  return problems;
}

// ------------------------------------------------------------------ criterion 4: fork to process.tracked

// Nearest rank: the smallest sample with at least p of the samples at or below it.
export const percentile = (sorted, p) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];

export function latencyProblems(record, dir = root) {
  const problems = [];
  const latency = record?.latency;
  if (!latency) return ['latency is missing'];
  if (!isCommit(latency.main)) problems.push('latency.main is not the full hash of the main commit it was read on');
  if (!nonEmpty(latency.command)) problems.push('latency.command (the command that measures it) is missing');
  if (latency.unit !== 'ms') problems.push('latency.unit is not "ms"');
  const text = readText(dir, latency.samplesFile);
  if (text === null) return [...problems, `the raw fork and process.tracked times ${latency.samplesFile} are not kept with the spike`];
  if (latency.samplesSha256 !== sha256(text)) problems.push('latency.samplesSha256 is not the sha256 of the samples file');
  // One JSON object a line: { "pid": n, "forkedAtMs": t, "trackedAtMs": t }
  const deltas = [];
  text.split('\n').filter((line) => line.trim()).forEach((line, i) => {
    let s;
    try { s = JSON.parse(line); } catch { problems.push(`samples line ${i + 1} is not JSON`); return; }
    if (!Number.isFinite(s?.forkedAtMs) || !Number.isFinite(s?.trackedAtMs)) problems.push(`samples line ${i + 1}: forkedAtMs and trackedAtMs are required numbers`);
    else if (s.trackedAtMs < s.forkedAtMs) problems.push(`samples line ${i + 1}: tracked before the fork`);
    else deltas.push(s.trackedAtMs - s.forkedAtMs);
  });
  if (!deltas.length) return [...problems, 'the samples file holds no fork that was tracked'];
  if (latency.samples !== deltas.length) problems.push(`latency.samples ${latency.samples}, the file holds ${deltas.length}`);
  const sorted = [...deltas].sort((a, b) => a - b);
  for (const [name, p] of [['p50', 0.5], ['p95', 0.95]]) {
    const want = percentile(sorted, p);
    if (!Number.isFinite(latency[name]) || Math.abs(latency[name] - want) > 1e-6) problems.push(`latency.${name} is ${latency[name]}, the samples give ${want}`);
  }
  return problems;
}

// ------------------------------------------------------------------ criterion 5: the recommendation

export function recommendationProblems(record) {
  const rec = record?.recommendation;
  if (!rec || typeof rec !== 'object') return ['recommendation is missing'];
  const hasCuts = Array.isArray(rec.cuts) && rec.cuts.length > 0;
  const none = rec.none === true;
  if (hasCuts === none) return ['recommendation must be either a non-empty cuts list or none: true with a reason, not both and not neither'];
  if (none) return nonEmpty(rec.reason) ? [] : ['recommendation says none but gives no reason'];
  return rec.cuts.flatMap((cut, i) => [
    ...(nonEmpty(cut?.cut) ? [] : [`recommended cut ${i}: cut (its name) is empty`]),
    ...(nonEmpty(cut?.criterion) ? [] : [`recommended cut ${i}: it has no drafted criterion`]),
  ]);
}

// AC1 redraft for #2649: recompute the table from the perf lane's child counter log (scripts/count-children.c)
// the way scripts/benchmark.mjs reads it, instead of keying everything by pid. Each check returns problems; empty = holds.
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { loadRecord, ROOT_CALLER, root, sha256, SPIKE, SUBJECTS } from '../validate.mjs';

export { loadRecord, root, SPIKE };
export const HOUR_NS = 3600n * 1_000_000_000n;
// mach_timebase_info of the hosts that run the lane: Intel 1/1, Apple silicon 125/3.
export const TIMEBASES = [[1, 1], [125, 3]];
// scripts/benchmark.mjs `observers`: starts it never reports as uncounted.
export const OBSERVERS = new Set(['/bin/ps', '/usr/sbin/lsof', '/usr/bin/log']);

const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
const whole = (v) => Number.isSafeInteger(v) && v >= 0;
const isInt = (s) => /^\d+$/.test(s ?? '');
// Fields after the kind, as count-children.c writes them: start parent child path...; reap parent child instructions
// elapsed children's-elapsed and 7 QoS times; unread parent child time; exit process instructions children's-elapsed and 7 QoS.
const wellFormed = (kind, f) => {
  if (kind === 'start') return f.length >= 3 && isInt(f[0]) && isInt(f[1]);
  const want = { reap: 12, unread: 3, exit: 10 }[kind];
  return f.length === want && f.every(isInt);
};

// Parse the log in order. A pid is reused over an hour (pids wrap), so an end line belongs to the latest start of
// its pid that has no end yet, never to a map entry keyed by pid alone. A child with no start line (the measured
// command, reaped by the runner) is a root. Returns { starts, roots, uncounted, problems }.
export function parseCounter(text) {
  const problems = [], recs = [], rootReaps = [], accruals = [];
  const current = new Map();
  text.split('\n').forEach((raw, i) => {
    if (!raw.trim()) return;
    const [kind, ...f] = raw.trim().split(/\s+/);
    if (!['start', 'reap', 'unread', 'exit'].includes(kind) || !wellFormed(kind, f)) {
      problems.push(`counter log line ${i + 1} is not a line the counter writes: ${raw.slice(0, 60)}`);
      return;
    }
    if (kind === 'start') {
      const rec = { parentPid: f[0], pid: f[1], path: f.slice(2).join(' '), parentRec: current.get(f[0]) ?? null };
      recs.push(rec);
      current.set(f[1], rec);
    } else if (kind === 'exit') {
      const rec = current.get(f[0]);
      if (rec && !rec.exit && !rec.reap && !rec.unread) rec.exit = { instructions: Number(f[1]), childElapsed: BigInt(f[2]) };
    } else {
      const [parent, child] = f;
      const end = kind === 'reap'
        ? { instructions: Number(f[2]), elapsed: BigInt(f[3]), childElapsed: BigInt(f[4]) }
        : { time: BigInt(f[2]) };
      const rec = current.get(child);
      if (rec && !rec.reap && !rec.unread) rec[kind] = end;
      else if (kind === 'reap') rootReaps.push({ pid: child, path: ROOT_CALLER, isRoot: true, reap: end });
      accruals.push({ parent, parentRec: current.get(parent) ?? null, time: kind === 'reap' ? end.elapsed + end.childElapsed : end.time });
    }
  });
  const roots = new Map(rootReaps.map((r) => [r.pid, r]));
  for (const rec of recs) {
    const parentRec = rec.parentRec ?? roots.get(rec.parentPid) ?? null;
    if (!parentRec) problems.push(`start of ${rec.path} (${rec.pid}) has parent ${rec.parentPid}, which is neither a start in the log nor the measured command the runner reaped`);
    rec.parentRec = parentRec;
    rec.caller = parentRec ? (parentRec.isRoot ? ROOT_CALLER : basename(parentRec.path)) : `<unknown ${rec.parentPid}>`;
    rec.program = basename(rec.path);
    const instructions = rec.reap ? rec.reap.instructions : rec.unread ? null : rec.exit ? rec.exit.instructions : null;
    rec.instructions = Number.isFinite(instructions) ? instructions : null;
  }
  // benchmark.mjs countChildren: a process's child time is the sum of what it reaped, to the tick; a parent whose
  // child time differs from what the log accounts for started children the counter could not log (a platform binary
  // it can't enter, a child leaving by _exit). Those are gaps: one per parent program and caller, observers exempt.
  // An unread or still-running start is logged; it is a start with no count (a row's unread), not a gap.
  const accounted = new Map();
  for (const { parent, parentRec, time } of accruals) {
    const owner = parentRec ?? roots.get(parent);
    if (owner) accounted.set(owner, (accounted.get(owner) ?? 0n) + time);
  }
  const gaps = new Map();
  for (const r of [...roots.values(), ...recs.filter((s) => s.reap || (s.exit && !s.unread))]) {
    const own = r.reap ? r.reap.childElapsed : r.exit.childElapsed;
    if ((accounted.get(r) ?? 0n) === own || (!r.isRoot && OBSERVERS.has(r.path))) continue;
    const gap = r.isRoot ? { parent: ROOT_CALLER, caller: null } : { parent: r.program, caller: r.caller };
    gaps.set(gapKey(gap), gap);
  }
  return { starts: recs, roots: [...roots.values()], gaps: [...gaps.values()], problems };
}

const gapKey = ({ parent, caller }) => `${parent}\u0000${caller ?? ''}`;

// One group per caller and program: the table's rows for one subject.
export function groupStarts(starts) {
  const groups = new Map();
  for (const { caller, program, instructions } of starts) {
    const key = `${caller}\u0000${program}`;
    const g = groups.get(key) ?? { caller, program, count: 0, instructions: 0, unread: 0 };
    g.count++;
    if (instructions === null) g.unread++; else g.instructions += instructions;
    groups.set(key, g);
  }
  return groups;
}

const SEPARATORS = /[,_'   ]/g;
const cells = (line) => line.split('|').slice(1, -1).map((c) => {
  const t = c.trim().replace(/[`\\]/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  return /^\d[\d,_'   ]*$/.test(t) ? t.replace(SEPARATORS, '') : t;
});

// The user's ruling (2026-11-20, "Logged starts, gaps named"): where the accounting shows a parent started children
// the counter could not log, subjects[name].unlogged names it as { parent, caller }: the parent's program and its
// caller as the table gives them, or { parent: '<root>', caller: null } for the measured command. Every gap must be
// named, once, every name must be a gap, and README.md must name it on a line that says "unlogged".
function unloggedProblems(name, unlogged, gaps, readme) {
  if (!Array.isArray(unlogged)) return [`subject ${name}: unlogged (the parents whose starts the counter could not log, [] if none) is not a list`];
  const problems = [], named = new Set(), found = new Set(gaps.map(gapKey));
  const show = (g) => `${g.parent}${g.caller ? ` (caller ${g.caller})` : ''}`;
  for (const entry of unlogged) {
    if (!nonEmpty(entry?.parent) || !(entry.caller === null || nonEmpty(entry.caller)) || (entry.parent === ROOT_CALLER) !== (entry.caller === null)) {
      problems.push(`subject ${name}: unlogged entry ${JSON.stringify(entry)} is not { parent, caller } (caller null only for parent <root>)`);
      continue;
    }
    const key = gapKey(entry);
    if (named.has(key)) problems.push(`subject ${name}: unlogged names ${show(entry)} twice`);
    named.add(key);
    if (!found.has(key)) problems.push(`subject ${name}: unlogged names ${show(entry)}, but the counter's accounting shows no start it could not log under it`);
    else if (readme !== null && !readme.split('\n').some((l) => /unlogged/i.test(l) && cellText(l).includes(entry.parent) && (entry.caller === null || cellText(l).includes(entry.caller)))) {
      problems.push(`subject ${name}: README.md has no line saying unlogged that names ${show(entry)}`);
    }
  }
  for (const g of gaps) if (!named.has(gapKey(g))) problems.push(`subject ${name}: the counter's own accounting shows ${show(g)} started children it could not log, and unlogged does not name it`);
  return problems;
}
const cellText = (line) => line.replace(/[`\\]/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

export function tableProblems(record, dir = root) {
  const problems = [];
  if (!record || typeof record !== 'object') return ['the record is not an object'];
  if (!/^[0-9a-f]{40}$/.test(record.main ?? '')) problems.push('main is not the full hash of the main commit the counter ran on');
  if (!nonEmpty(record.counter?.command)) problems.push("counter.command (the command that ran the perf lane's child counter) is missing");
  const tb = record.counter?.timebase;
  const rows = Array.isArray(record.rows) ? record.rows : [];
  if (!rows.length) problems.push('the table has no rows');
  const logs = {};
  const readmePath = join(dir, SPIKE, 'README.md');
  const readme = existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : null;
  for (const name of SUBJECTS) {
    const subject = record.subjects?.[name];
    if (!subject) { problems.push(`subject ${name}: missing`); continue; }
    const file = subject.log;
    const path = nonEmpty(file) && !file.startsWith('/') && !file.split('/').includes('..') ? join(dir, SPIKE, file) : null;
    if (!path || !existsSync(path)) { problems.push(`subject ${name}: counter output ${file} is not kept with the spike`); continue; }
    const text = readFileSync(path, 'utf8');
    if (subject.sha256 !== sha256(text)) problems.push(`subject ${name}: sha256 of ${file} is not what the record says`);
    const log = logs[name] = parseCounter(text);
    problems.push(...log.problems.map((p) => `subject ${name}: ${p}`));
    if (!log.starts.length) problems.push(`subject ${name}: ${file} holds no process start`);
    problems.push(...unloggedProblems(name, subject.unlogged, log.gaps, readme));
    if (name === 'idle-hour') {
      if (!TIMEBASES.some(([n, d]) => tb?.numer === n && tb?.denom === d)) problems.push('counter.timebase must be the mach timebase of the host: {numer, denom} 1/1 or 125/3');
      else if (!log.roots.some((r) => (r.reap.elapsed * BigInt(tb.numer)) / BigInt(tb.denom) >= HOUR_NS)) problems.push('subject idle-hour: no measured command in the counter output ran for an hour (its reap elapsed, read at the timebase)');
    }
  }
  const seen = new Set(), totals = Object.fromEntries(SUBJECTS.map((n) => [n, 0]));
  if (readme === null) problems.push(`${SPIKE}/README.md (the table to read) is missing`);
  const tableRows = (readme ?? '').split('\n').filter((l) => l.trim().startsWith('|')).map(cells);
  rows.forEach((row, index) => {
    const at = `row ${index} (${row?.subject}/${row?.caller}/${row?.program})`;
    if (!SUBJECTS.includes(row?.subject)) { problems.push(`${at}: subject is not one of ${SUBJECTS.join(', ')}`); return; }
    if (!nonEmpty(row.caller) || !nonEmpty(row.program)) { problems.push(`${at}: caller and program are required`); return; }
    const key = `${row.subject}\u0000${row.caller}\u0000${row.program}`;
    if (seen.has(key)) problems.push(`${at}: listed twice`);
    seen.add(key);
    if (!whole(row.count) || row.count < 1) problems.push(`${at}: count is not a whole number of starts, at least 1`);
    if (!whole(row.instructions)) problems.push(`${at}: instructions retired is not a whole number`);
    if (!whole(row.unread)) problems.push(`${at}: unread (starts the counter has no instructions for) is not a whole number`);
    if (whole(row.count)) totals[row.subject] += row.count;
    if (logs[row.subject]) {
      const g = groupStarts(logs[row.subject].starts).get(`${row.caller}\u0000${row.program}`);
      if (!g) problems.push(`${at}: the counter output has no such starts`);
      else {
        if (row.count !== g.count) problems.push(`${at}: count ${row.count}, the counter output has ${g.count}`);
        if (row.instructions !== g.instructions) problems.push(`${at}: instructions ${row.instructions}, the counter output sums to ${g.instructions}`);
        if (row.unread !== g.unread) problems.push(`${at}: unread ${row.unread}, the counter output has ${g.unread}`);
      }
    }
    if (readme !== null && !tableRows.some((c) => [row.program, row.caller, String(row.count), String(row.instructions)].every((v) => c.includes(v)))) {
      problems.push(`${at}: no row of a table in README.md holds its program, caller, count ${row.count} and instructions ${row.instructions}`);
    }
  });
  for (const name of SUBJECTS) {
    if (!logs[name]) continue;
    const n = logs[name].starts.length;
    if (totals[name] !== n) problems.push(`subject ${name}: rows list ${totals[name]} starts, the counter output has ${n}`);
    if (record.subjects[name].totalStarts !== n) problems.push(`subject ${name}: totalStarts ${record.subjects[name].totalStarts}, the counter output has ${n}`);
  }
  return problems;
}

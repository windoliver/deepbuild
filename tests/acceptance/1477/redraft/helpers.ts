// The redraft's one change to the first draft's helpers: how a record decides (#1477.e66d9bdb, amended 2026-11-09).
// A table arm that can't show its 100,000 rows reads `missed` with the reason and counts as a miss. Everything else
// (the bench, its calls, the lane's rule, the arm readers, the net arithmetic) is the first draft's, imported.

import {
  ARMS, COLUMNS, TABLE_ARMS, TABLE_ROWS, UPDATE_MS, armShapeProblems, decisionOf, isObject, laneProblem, netOf,
  obj, readingOf, type ArmName, type JsonObject, type Net, type Word,
} from '../helpers.ts';

/** The arms that may read `missed`: the tables, kit's and the panel's, and ours when it exists. */
export const MISSABLE: readonly ArmName[] = [...TABLE_ARMS, 'ours'];

/**
 * A `missed` arm: a table arm that ran and can't show its rows. It names the reason, carries the machine's fingerprint
 * and the rows and columns it was asked to show, and has no `raw` or `net` reading, since it took none.
 */
export function missedProblems(name: ArmName, a: JsonObject, what: string): string[] {
  const out: string[] = [];
  if (!MISSABLE.includes(name)) out.push(`${what}: ${name} reads missed, but only a table arm (${MISSABLE.join(', ')}) can miss by not showing its rows`);
  if (typeof a['reason'] !== 'string' || a['reason'].trim() === '') out.push(`${what}: ${name} reads missed without a reason`);
  if (!isObject(a['fingerprint'])) out.push(`${what}: ${name} reads missed with no fingerprint`);
  if (a['rows'] !== TABLE_ROWS || a['columns'] !== COLUMNS) out.push(`${what}: ${name} reads missed at ${JSON.stringify(a['rows'])} rows × ${JSON.stringify(a['columns'])} columns, not the ${TABLE_ROWS} × ${COLUMNS} it couldn't show`);
  if ('raw' in a || 'net' in a) out.push(`${what}: ${name} reads missed but carries a reading (${JSON.stringify({ raw: a['raw'], net: a['net'] }).slice(0, 300)}); a missed arm took none`);
  return out;
}

/**
 * The amended rule. INCONCLUSIVE while blank, kit or panel is unrun. Otherwise build when kit or panel reads missed, or
 * misses 4 ms at p99 net of the blank arm; stop when both were measured within it.
 */
export function decide(state: Record<'blank' | 'kit' | 'panel', 'measured' | 'missed' | 'unrun'>, nets: Partial<Record<'kit' | 'panel', Net>>): Word {
  if (state.blank !== 'measured' || TABLE_ARMS.some((t) => state[t] === 'unrun')) return 'INCONCLUSIVE';
  return TABLE_ARMS.some((t) => state[t] === 'missed' || nets[t]!.p99_ms > UPDATE_MS) ? 'build' : 'stop';
}

export interface Judgement { word: Word; line: string; unrun: string[]; missed: string[]; off: string[]; problems: string[]; nets: Partial<Record<ArmName, Net>>; arms: Partial<Record<ArmName, JsonObject>> }

/**
 * Reads a record as the first draft's judgeRecord does, with `missed` added: every arm present, each measured with its
 * fingerprint and load, missed (a table arm, with the reason), or INCONCLUSIVE with a reason; a measured arm's `net`
 * equal to its raw readings less the blank arm's; the decision its last line, and the one the amended rule gives on the
 * record's own arms; `ours` present under build. `missed` names the missed arms with their reasons; a missed arm isn't
 * timed, so the lane's rule reads only measured arms (`off`).
 */
export async function judgeRecord(rec: JsonObject, what: string): Promise<Judgement> {
  const { word, line } = decisionOf(rec, what);
  const all = obj(rec['arms'], `${what}: arms`);
  const names: ArmName[] = [...ARMS, ...(word === 'build' || 'ours' in all ? ['ours' as const] : [])];
  const j: Judgement = { word, line, unrun: [], missed: [], off: [], problems: [], nets: {}, arms: {} };
  const state: Record<'blank' | 'kit' | 'panel', 'measured' | 'missed' | 'unrun'> = { blank: 'unrun', kit: 'unrun', panel: 'unrun' };
  const extra = Object.keys(all).filter((k) => !(names as string[]).includes(k));
  if (extra.length) j.problems.push(`${what} has arms the issue doesn't name: ${extra.join(', ')}`);
  for (const name of names) {
    const a = all[name];
    if (!isObject(a)) { j.problems.push(`${what} has no ${name} arm (an unrun arm is still listed, reading INCONCLUSIVE)`); continue; }
    if (a['status'] === 'INCONCLUSIVE') {
      if (typeof a['reason'] !== 'string' || a['reason'] === '') j.problems.push(`${what}: ${name} reads INCONCLUSIVE without a reason`);
      j.unrun.push(`${name}: ${String(a['reason'])}`);
      continue;
    }
    if (a['status'] === 'missed') {
      j.problems.push(...missedProblems(name, a, what));
      j.missed.push(`${name}: ${String(a['reason'])}`);
      if (name === 'kit' || name === 'panel') state[name] = 'missed';
      continue;
    }
    if (a['status'] !== 'measured') { j.problems.push(`${what}: ${name} reads ${JSON.stringify(a['status'])}, neither measured, missed nor INCONCLUSIVE`); continue; }
    j.arms[name] = a;
    if (name === 'blank' || name === 'kit' || name === 'panel') state[name] = 'measured';
    j.problems.push(...armShapeProblems(name, a).map((p) => `${what}: ${p}`));
    const load = isObject(a['load']) ? { start: Number(a['load']['start']), end: Number(a['load']['end']) } : { start: NaN, end: NaN };
    const off = await laneProblem(a['fingerprint'], load);
    if (off) j.off.push(`${name}: ${off}`);
  }
  const blank = j.arms.blank ? readingOf(j.arms.blank, `${what}: blank`) : null;
  for (const name of names.filter((n) => n !== 'blank')) {
    const a = j.arms[name];
    if (!a || !blank) continue;
    const net = netOf(readingOf(a, `${what}: ${name}`), blank);
    j.nets[name] = net;
    const said = obj(a['net'], `${what}: ${name}.net`);
    for (const [k, v] of Object.entries(net)) {
      const s = said[k];
      if (typeof s !== 'number' || Math.abs(s - v) > 1e-6 * Math.max(1, Math.abs(v))) j.problems.push(`${what}: ${name}.net.${k} is ${JSON.stringify(s)}, but its raw reading less the blank arm's is ${v}`);
    }
  }
  if (j.arms.kit && readingOf(j.arms.kit, `${what}: kit`).allocations_per_frame <= 0) j.problems.push(`${what}: kit reads no allocations per frame, though the kit's table builds an element per cell`);
  const rule = decide(state, { ...(j.nets.kit ? { kit: j.nets.kit } : {}), ...(j.nets.panel ? { panel: j.nets.panel } : {}) });
  const tables = TABLE_ARMS.map((t) => (state[t] === 'missed' ? `${t} missed` : j.nets[t] ? `${t} p99 ${j.nets[t].p99_ms.toFixed(3)} ms` : `${t} ${state[t]}`)).join(', ');
  if (word !== 'INCONCLUSIVE' && word !== rule) j.problems.push(`${what} decides ${word}, but its own arms give ${rule}: blank ${state.blank}, ${tables} net of the blank arm, against ${UPDATE_MS} ms, a missed table arm counting as a miss`);
  if (word === 'INCONCLUSIVE' && j.unrun.length === 0) j.problems.push(`${what} reads INCONCLUSIVE though no arm is unrun (${tables}): it ends in ${rule}`);
  return j;
}

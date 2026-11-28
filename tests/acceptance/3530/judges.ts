import { STEPS, seededInALine, type Seeded } from './programs.ts';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };
export const isObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const brief = (v: unknown, n = 600): string => (JSON.stringify(v) ?? String(v)).slice(0, n);

export interface Row { step: number; hash: string | null; fuel: number | null; failed: boolean; pages: number[] | null }
export function rowsByStep(reply: JsonObject, item: string): Map<number, Row> {
  const out = new Map<number, Row>();
  for (const record of Array.isArray(reply['steps']) ? reply['steps'] : []) {
    if (!isObject(record) || !Number.isSafeInteger(record['step']) || !isObject(record['items'])) continue;
    const row = record['items'][item];
    if (!isObject(row)) continue;
    const pages = row['pages'];
    out.set(record['step'] as number, {
      step: record['step'] as number,
      hash: typeof row['hash'] === 'string' ? row['hash'] : null,
      fuel: Number.isSafeInteger(row['fuel']) ? (row['fuel'] as number) : null,
      failed: row['failed'] === true,
      pages: Array.isArray(pages) && pages.every((p) => Number.isSafeInteger(p)) ? (pages as number[]) : null,
    });
  }
  return out;
}
export function trapsOf(reply: JsonObject, item: string): { step: number | null; kind: string }[] {
  return (Array.isArray(reply['traps']) ? reply['traps'] : []).filter(isObject).filter((t) => t['item'] === item)
    .map((t) => ({ step: Number.isSafeInteger(t['step']) ? (t['step'] as number) : null, kind: String(t['kind']) }));
}

export const PIECE_ITEM = 'p';
export interface Finding {
  program: number;
  step: number;
  page: number | null;
  what: 'unmarked' | 'unchanged' | 'unread';
  text: string;
}
export function judgePages(p: Seeded, changed: readonly (readonly number[])[], reply: JsonObject, where: string): Finding[] {
  const who = `${where}: seeded program ${p.index}`;
  const unread = (step: number, why: string): Finding => ({ program: p.index, step, page: null, what: 'unread', text: `${who}, step ${step}: ${why} (${seededInALine(p)})` });
  if (reply['ok'] !== true) return [unread(0, `the piece wasn't baked: ${brief(reply)}`)];
  const traps = trapsOf(reply, PIECE_ITEM);
  if (traps.length) return [unread(traps[0]!.step ?? 0, `the program trapped ${traps[0]!.kind}`)];
  const rows = rowsByStep(reply, PIECE_ITEM);
  const out: Finding[] = [];
  for (let k = 0; k < STEPS; k++) {
    const row = rows.get(k);
    if (!row || row.failed || row.pages === null) {
      out.push(unread(k, !row ? 'the bake holds no record of the step' : row.failed ? 'the step failed' : 'the step reports no pages'));
      continue;
    }
    const want = changed[k] ?? [];
    const held = `the bitmap holds ${JSON.stringify(row.pages)}, the bytes changed in ${JSON.stringify(want)}`;
    for (const page of want) if (!row.pages.includes(page)) out.push({ program: p.index, step: k, page, what: 'unmarked', text: `${who}, step ${k}: page ${page}'s bytes changed and the bitmap doesn't hold it: ${held} (${seededInALine(p)})` });
    for (const page of row.pages) if (!want.includes(page)) out.push({ program: p.index, step: k, page, what: 'unchanged', text: `${who}, step ${k}: the bitmap holds page ${page}, and none of its bytes changed: ${held} (${seededInALine(p)})` });
  }
  return out;
}

export function judgePlanted(programs: readonly Seeded[], findings: readonly Finding[]): string[] {
  const out: string[] = [];
  const by = new Map<number, Finding[]>();
  for (const f of findings) by.set(f.program, [...(by.get(f.program) ?? []), f]);
  for (const f of findings) {
    const p = programs[f.program]!;
    if (f.what !== 'unmarked') out.push(`the planted rewrite only skips a store's mark, and here ${f.what === 'unchanged' ? 'the bitmap holds a page nothing changed' : "a step's pages can't be read"}: ${f.text}`);
    else if (f.page === 0 || !p.storedPages.includes(f.page!)) out.push(`the planted rewrite loses only a page a store wrote, never the read region's or one only a fill or a copy wrote, and here it lost page ${f.page}: ${f.text}`);
  }
  for (const p of programs.filter((q) => q.family === 'one page' && q.pages <= 64)) {
    const got = (by.get(p.index) ?? []).filter((f) => f.what === 'unmarked').map((f) => `step ${f.step}: page ${f.page}`).sort();
    const want = Array.from({ length: STEPS - 1 }, (_, k) => `step ${k + 1}: page ${p.onlyStoredPage}`);
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      out.push(`seeded program ${p.index} stores only in page ${p.onlyStoredPage}, which its last store of each step marked last: the planted rewrite must lose ${want.join(', ')}, and the judge found ${got.length ? got.join(', ') : 'nothing'} (${seededInALine(p)})`);
    }
  }
  return out;
}

export interface Recorded { steps: [string | null, number | null][]; checkpoints: [number, string][]; trap: { step: number | null; kind: string } | null }
export interface Recording { commit: string; made_by: string; piece: JsonObject; track: Json[]; steps: number; items: Record<string, Recorded> }

export function recordedOf(reply: JsonObject, steps: number): Record<string, Recorded> {
  const items = isObject(reply['items']) ? Object.keys(reply['items']) : [];
  const checkpoints = isObject(reply['checkpoints']) ? reply['checkpoints'] : {};
  return Object.fromEntries(items.map((id) => {
    const rows = rowsByStep(reply, id);
    const list = Array.isArray(checkpoints[id]) ? (checkpoints[id] as Json[]) : [];
    return [id, {
      steps: Array.from({ length: steps }, (_, k): [string | null, number | null] => [rows.get(k)?.hash ?? null, rows.get(k)?.fuel ?? null]),
      checkpoints: list.filter(isObject).map((c): [number, string] => [Number(c['step']), String(c['deep_hash'])]),
      trap: trapsOf(reply, id)[0] ?? null,
    }];
  }));
}

export function judgeFixtures(base: Recording, reply: JsonObject): string[] {
  if (reply['ok'] !== true) return [`the piece of #531's fixtures wasn't baked: ${brief(reply)}`];
  const now = recordedOf(reply, base.steps);
  const out: string[] = [];
  for (const [id, was] of Object.entries(base.items)) {
    const is = now[id];
    if (!is) { out.push(`fixture ${id}: the bake holds no such item`); continue; }
    const hash = was.steps.findIndex((s, k) => s[0] !== is.steps[k]?.[0]);
    if (hash >= 0) out.push(`fixture ${id}, step ${hash}: its step hash was ${was.steps[hash]![0]} on the merge base and is ${is.steps[hash]?.[0] ?? null}`);
    const fuel = was.steps.findIndex((s, k) => s[1] !== is.steps[k]?.[1]);
    if (fuel >= 0) out.push(`fixture ${id}, step ${fuel}: it was charged ${was.steps[fuel]![1]} fuel on the merge base and is charged ${is.steps[fuel]?.[1] ?? null}`);
    const steps = [...new Set([...was.checkpoints, ...is.checkpoints].map(([step]) => step))].sort((a, b) => a - b);
    const deep = steps.find((step) => was.checkpoints.find(([s]) => s === step)?.[1] !== is.checkpoints.find(([s]) => s === step)?.[1]);
    if (deep !== undefined) out.push(`fixture ${id}, step ${deep}: its full-state hash was ${was.checkpoints.find(([s]) => s === deep)?.[1] ?? 'none (no checkpoint)'} on the merge base and is ${is.checkpoints.find(([s]) => s === deep)?.[1] ?? 'none (no checkpoint)'}`);
    if (JSON.stringify(was.trap) !== JSON.stringify(is.trap)) {
      const at = (t: Recorded['trap']): string => (t ? `trapped ${t.kind} at step ${t.step ?? 'none (before step 0)'}` : 'trapped nowhere');
      out.push(`fixture ${id}, step ${is.trap?.step ?? was.trap?.step ?? 'none (before step 0)'}: it ${at(was.trap)} on the merge base and ${at(is.trap)} now`);
    }
  }
  return out;
}

export interface Load { start: number; end: number }
export interface Verdict { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'BLOCKED'; reason?: string; limit?: number; runs?: number[]; margin?: number }
export type Machine = Record<string, unknown>;
export type JudgeLimit = (input: { limit: number; runs: number[]; fingerprint: Machine; loads: Load[] }) => Verdict;

export const RECORD_APP_NS_PER_FUEL = 0.25;
export const WRITES_LIMIT = 2 * RECORD_APP_NS_PER_FUEL;

export const judgeWrites = (judgeLimit: JudgeLimit, runs: number[], machine: Machine, loads: Load[]): Verdict =>
  judgeLimit({ limit: WRITES_LIMIT, runs, fingerprint: machine, loads });

export const nsPerFuel = (benchNs: readonly number[], twinNs: readonly number[], fuel: readonly [number, number]): number =>
  (Math.min(...benchNs) - Math.min(...twinNs)) / (fuel[0] - fuel[1]);

export interface MeteringRecord { model: string | null; app: number; web: number }
export function judgeMetering(judgeLimit: JudgeLimit, host: 'app' | 'web', runs: number[], record: MeteringRecord, margin: number, machine: Machine, loads: Load[]): Verdict {
  const base = record[host];
  if (!(Number.isFinite(base) && base > 0)) return { status: 'BLOCKED', reason: `the merge base's record holds no ns per fuel unit for ${host}: ${brief(base)}` };
  const times = runs.map((r) => r / base);
  const verdict = judgeLimit({ limit: 1 + margin, runs: times, fingerprint: machine, loads });
  if ((verdict.status === 'PASS' || verdict.status === 'FAIL') && machine['model'] !== record.model) {
    return { ...verdict, status: 'INCONCLUSIVE', reason: `a reading, not a budget result: the merge base's record was read on ${record.model ?? 'no named Mac'} and this is ${String(machine['model'])}, so there is no merge-base reading of this Mac to compare with` };
  }
  return verdict;
}

export interface BenchmarkTask { id: string; command: string[]; margin: number; targets: Record<string, number>; criterion: string; file: string }
export function benchmarkTaskProblems(budgets: unknown, want: BenchmarkTask, refusal: string, timed: readonly string[], runs: string): string[] {
  const out: string[] = [];
  const tasks = isObject(budgets) && Array.isArray(budgets['tasks']) ? budgets['tasks'].filter(isObject) : [];
  const task = tasks.find((t) => t['id'] === want.id);
  const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
  if (!task) out.push(`benchmarks/budgets.json holds no task ${want.id}, so no budget window measures ${want.criterion} (it holds ${tasks.length} tasks; ${tasks.filter((t) => Array.isArray(t['criteria']) && t['criteria'].includes(want.criterion)).length} name the criterion)`);
  else {
    if (!same(task['command'], want.command)) out.push(`${want.id}.command is ${brief(task['command'])}, not ${brief(want.command)}: the task runs this test, which takes the reading and judges it`);
    if (task['margin'] !== want.margin) out.push(`${want.id}.margin is ${brief(task['margin'])}, not ${want.margin}`);
    const targets = isObject(task['targets']) ? task['targets'] : {};
    if (!same(Object.entries(targets).sort(), Object.entries(want.targets).sort())) out.push(`${want.id}.targets is ${brief(task['targets'])}, not ${brief(want.targets)}`);
    if (!(Array.isArray(task['criteria']) && task['criteria'].includes(want.criterion))) out.push(`${want.id}.criteria is ${brief(task['criteria'])}: it doesn't name ${want.criterion}`);
    if (!(typeof task['initialReason'] === 'string' && task['initialReason'].includes('#3530'))) out.push(`${want.id}.initialReason doesn't name #3530`);
  }
  if (refusal) out.push(`the lanes' validator refuses benchmarks/budgets.json: ${refusal}`);
  if (!timed.includes(want.file)) out.push(`scripts/lanes.mjs doesn't list ${want.file} in timed, so it would run without a timed grant`);
  if (!runs.includes(want.file)) out.push(`benchmarks/canvas-world.mjs doesn't run ${want.file}: it runs ${runs.trim() || 'nothing it names'}`);
  return out;
}

export const judgedReadingInALine = (what: string, runs: readonly number[], unit: string, bound: string, loads: readonly Load[], machine: Machine, verdict: Verdict): string =>
  `${what}: ${runs.map((r) => r.toFixed(4)).join(', ')} ${unit} against ${bound}, one-minute load at each run's start and end ${loads.map((l) => `${l.start.toFixed(1)}/${l.end.toFixed(1)}`).join(', ')}, on ${String(machine['model'])}: ${verdict.status}${verdict.reason ? ` (${verdict.reason})` : ''}`;

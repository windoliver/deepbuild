import { createHash } from 'node:crypto';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export const KIND = 'scene.relations';
export const MISSED = 'scene.relation_missed';
export const COUNT = 'scene.relation_count';
export const TOL_M = 0.001;
export const TOL_DEG = 1;

export interface Expected { a: string; rel: string; b: string; d?: number; count?: number | [number, number] }
export const nameOf = (e: { a: string; rel: string; b: string }): string => `${e.a} ${e.rel} ${e.b}`;

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const brief = (v: JsonValue | undefined, n = 1200): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
export function canon(v: JsonValue | undefined): string {
  if (v === undefined) return 'undefined';
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (isObject(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
const finite = (v: JsonValue | undefined): v is number => typeof v === 'number' && Number.isFinite(v);
const strings = (v: JsonValue | undefined): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const list = (o: JsonObject, k: string): JsonObject[] => (Array.isArray(o[k]) ? (o[k] as JsonValue[]).filter(isObject) : []);

export function bitsOf(x: number): string {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  return view.getBigUint64(0).toString(16).padStart(16, '0');
}
export function lastPlaces(x: number, y: number): bigint {
  const d = BigInt(`0x${bitsOf(x)}`) - BigInt(`0x${bitsOf(y)}`);
  return d < 0n ? -d : d;
}

export interface Reading {
  a: string; b: string; rel: string;
  m: number | null; deg: number | null; held: boolean | null;
  unknown: boolean;
  count: number | null;
  raw: JsonObject;
}
export interface Issue {
  code: string; severity: string; ids: string[]; rel: string | null; b: string | null;
  m: number | null; deg: number | null; expected: JsonValue | undefined; actual: JsonValue | undefined;
  raw: JsonObject;
}
export interface Row { result: string; readings: Reading[]; issues: Issue[]; raw: JsonObject }

const missOf = (v: JsonValue | undefined): { m: number | null; deg: number | null } =>
  (isObject(v) ? { m: finite(v['m']) ? v['m'] : null, deg: finite(v['deg']) ? v['deg'] : null } : { m: null, deg: null });
const text = (v: JsonValue | undefined): string | null => (typeof v === 'string' ? v : null);

export function rowOf(verdict: JsonObject, req: string): Row | null {
  const raw = list(verdict, 'requirements').find((r) => r['id'] === req);
  if (!raw) return null;
  return {
    result: String(raw['result']), raw,
    readings: list(raw, 'results').map((r) => ({
      a: String(r['a']), b: String(r['b']), rel: String(r['rel']), ...missOf(r['miss']),
      held: typeof r['held'] === 'boolean' ? r['held'] : null,
      unknown: r['miss'] === 'unknown' || r['held'] === 'unknown',
      count: finite(r['count']) ? r['count'] : null, raw: r,
    })),
    issues: list(raw, 'issues').map((i) => ({
      code: String(i['code']), severity: String(i['severity']), ids: strings(i['ids']), rel: text(i['rel']), b: text(i['b']),
      ...missOf(i['miss']), expected: i['expected'], actual: i['actual'], raw: i,
    })),
  };
}
const NO_ROW = 'the verdict has no row for its requirement';
const readingsFor = (row: Row, e: { a: string; rel: string; b: string }): Reading[] =>
  row.readings.filter((r) => r.a === e.a && r.rel === e.rel && r.b === e.b);
const shown = (r: Reading): string => `miss ${brief(r.raw['miss'])}, held ${brief(r.raw['held'])}`;

function oneFor(row: Row, e: { a: string; rel: string; b: string }): Reading | string {
  const found = readingsFor(row, e);
  return found.length === 1 ? found[0]! : `${nameOf(e)}: the row has ${found.length} results for it, not one: ${brief(row.raw['results'] ?? null)}`;
}

export function timingOf(row: Row | null, key: string): number | null {
  const t = row?.raw['timing'];
  const v = isObject(t) ? t[key] : undefined;
  return finite(v) && v >= 0 ? v : null;
}

export function heldFailures(row: Row | null, expected: readonly Expected[], what: string): string[] {
  if (!row) return [`${what}: ${NO_ROW}`];
  const failures: string[] = [];
  if (row.result !== 'PASS') failures.push(`${what} is ${row.result}, not PASS: ${brief(row.raw)}`);
  for (const e of expected) {
    const r = oneFor(row, e);
    if (typeof r === 'string') { failures.push(`${what}: ${r}`); continue; }
    if (r.unknown || r.m === null || r.deg === null) failures.push(`${what}: ${nameOf(e)} reads no miss in m and degrees: ${shown(r)}`);
    else if (!(r.m >= 0 && r.m <= TOL_M && r.deg >= 0 && r.deg <= TOL_DEG)) failures.push(`${what}: ${nameOf(e)} misses by ${r.m} m and ${r.deg}°, past 1 mm and 1°`);
    if (r.held !== true) failures.push(`${what}: ${nameOf(e)} doesn't read held: ${shown(r)}`);
  }
  return failures;
}

export function resultsOf(row: Row | null, expected: readonly Expected[]): JsonObject[] | string {
  if (!row) return NO_ROW;
  const out: JsonObject[] = [];
  for (const e of expected) {
    const r = oneFor(row, e);
    if (typeof r === 'string') return r;
    const miss = r.raw['miss'];
    out.push({ a: r.a, b: r.b, rel: r.rel, miss: isObject(miss) ? { m: miss['m'] ?? null, deg: miss['deg'] ?? null } : miss ?? null, held: r.raw['held'] ?? null });
  }
  return out;
}
export function resultsHash(row: Row | null, expected: readonly Expected[]): { hash: string } | string {
  const results = resultsOf(row, expected);
  return typeof results === 'string' ? results : { hash: sha256(canon(results)) };
}
export function sameResultsFailures(first: Row | null, second: Row | null, expected: readonly Expected[], whatFirst: string, whatSecond: string): string[] {
  const [h1, h2] = [resultsHash(first, expected), resultsHash(second, expected)];
  if (typeof h1 === 'string') return [`${whatFirst} gives no results to hash: ${h1}`];
  if (typeof h2 === 'string') return [`${whatSecond} gives no results to hash: ${h2}`];
  if (h1.hash === h2.hash) return [];
  const [r1, r2] = [resultsOf(first, expected) as JsonObject[], resultsOf(second, expected) as JsonObject[]];
  const differ = expected.flatMap((e, k) => (canon(r1[k]) === canon(r2[k]) ? [] : [`${nameOf(e)}: ${canon(r1[k])} against ${canon(r2[k])}`]));
  return [`${whatSecond} gives other results than ${whatFirst}: hash ${h2.hash.slice(0, 12)} against ${h1.hash.slice(0, 12)}; ${differ.slice(0, 5).join('; ')}`];
}

export type Bound = { least: number } | { near: number; within: number };
const bounded = (v: number | null, b: Bound): boolean =>
  v !== null && ('least' in b ? v >= b.least : Math.abs(v - b.near) <= b.within);
const boundText = (b: Bound, unit: string): string => ('least' in b ? `at least ${b.least} ${unit}` : `${b.near} ${unit} within ${b.within} ${unit}`);

export interface Missed { m?: Bound; deg?: Bound; names?: readonly string[] }

export function missedFailures(row: Row | null, e: Expected, want: Missed, what: string): string[] {
  if (!row) return [`${what}: ${NO_ROW}`];
  const failures: string[] = [];
  if (row.result !== 'FAIL') failures.push(`${what}: ${nameOf(e)}: the requirement is ${row.result}, not FAIL: ${brief(row.raw)}`);
  const missFailures = (m: number | null, deg: number | null, where: string): void => {
    if (want.m && !bounded(m, want.m)) failures.push(`${what}: ${nameOf(e)}: ${where} reads a miss of ${String(m)} m, not ${boundText(want.m, 'm')}`);
    if (want.deg && !bounded(deg, want.deg)) failures.push(`${what}: ${nameOf(e)}: ${where} reads a miss of ${String(deg)}°, not ${boundText(want.deg, '°')}`);
  };
  const r = oneFor(row, e);
  if (typeof r === 'string') failures.push(`${what}: ${r}`);
  else {
    if (r.held !== false) failures.push(`${what}: ${nameOf(e)} doesn't read as not held: ${shown(r)}`);
    missFailures(r.m, r.deg, 'its result');
  }
  const names = [...new Set([e.a, ...(want.names ?? [])])];
  const issue = row.issues.find((i) => i.code === MISSED && i.rel === e.rel && names.every((id) => i.ids.includes(id)));
  if (!issue) failures.push(`${what}: ${nameOf(e)}: no ${MISSED} issue names ${names.join(' and ')} and the relation ${e.rel}: ${brief(row.raw['issues'] ?? null)}`);
  else missFailures(issue.m, issue.deg, `its ${MISSED} issue`);
  return failures;
}

export const holdsFailures = (row: Row | null, e: Expected, what: string): string[] => heldFailures(row, [e], what);

export function auditPassFailures(row: Row | null, what: string): string[] {
  if (!row) return [`${what}: ${NO_ROW}`];
  const failures: string[] = [];
  if (row.result !== 'PASS') failures.push(`${what} is ${row.result}, not PASS: ${brief(row.raw)}`);
  for (const i of row.issues) if (i.severity === 'error' || i.severity === 'warning') failures.push(`${what} raises ${i.code} on ${i.ids.join(', ')}: ${brief(i.raw, 400)}`);
  return failures;
}

export interface Counted { result: 'PASS' | 'FAIL'; members: readonly string[]; holding: readonly string[]; count: number }

export function countFailures(row: Row | null, e: Expected, want: Counted, what: string): string[] {
  if (!row) return [`${what}: ${NO_ROW}`];
  const failures: string[] = [];
  if (row.result !== want.result) failures.push(`${what} is ${row.result}, not ${want.result}: ${brief(row.raw)}`);
  for (const member of want.members) {
    const r = oneFor(row, { a: member, rel: e.rel, b: e.b });
    if (typeof r === 'string') { failures.push(`${what}: ${r}`); continue; }
    const holds = want.holding.includes(member);
    if (r.held !== holds) failures.push(`${what}: ${member} ${e.rel} ${e.b} reads ${shown(r)}, where it ${holds ? 'holds' : "doesn't hold"}`);
  }
  const counts = row.readings.filter((r) => r.rel === e.rel && r.b === e.b && (r.a === e.a || want.members.includes(r.a)) && r.count !== null).map((r) => r.count!);
  if (!counts.length) failures.push(`${what}: no result of ${nameOf(e)} gives its count: ${brief(row.raw['results'] ?? null)}`);
  else if (counts.some((c) => c !== want.count)) failures.push(`${what}: ${nameOf(e)} reads count ${[...new Set(counts)].join(' and ')}, not ${want.count}`);
  const raised = row.issues.filter((i) => i.code === COUNT && i.rel === e.rel && i.b === e.b);
  if (want.result === 'PASS') {
    if (raised.length) failures.push(`${what}: a count inside its range raises ${COUNT}: ${brief(raised[0]!.raw, 400)}`);
  } else {
    const issue = raised.find((i) => i.actual === want.count && canon(i.expected) === canon(e.count as JsonValue | undefined));
    if (!issue) failures.push(`${what}: no ${COUNT} issue names ${e.rel} ${e.b}, the expected ${canon(e.count as JsonValue | undefined)} and the actual ${want.count}: ${brief(row.raw['issues'] ?? null)}`);
  }
  return failures;
}

export const readsUnknown = (r: Reading): boolean => r.unknown && r.m === null && r.deg === null && r.held === null;

export function unknownFailures(row: Row | null, e: Expected, what: string): string[] {
  if (!row) return [`${what}: ${nameOf(e)}: ${NO_ROW}`];
  const failures: string[] = [];
  if (row.result !== 'INCONCLUSIVE') failures.push(`${what}: ${nameOf(e)}: the requirement that needs it is ${row.result}, not INCONCLUSIVE: ${brief(row.raw)}`);
  const r = oneFor(row, e);
  if (typeof r === 'string') failures.push(`${what}: ${r}`);
  else if (!readsUnknown(r)) failures.push(`${what}: ${nameOf(e)} reads ${shown(r)}, not unknown`);
  return failures;
}

export interface SolveMiss { a: string; rel: string; b: string; by: number; deg: number }

export function solveMisses(reply: JsonObject): { misses: SolveMiss[]; problems: string[] } {
  const audit = reply['audit'];
  if (!isObject(audit) || !Array.isArray(audit['failures'])) return { misses: [], problems: [`the reply holds no audit.failures: ${brief(audit)}`] };
  const misses: SolveMiss[] = [];
  const problems: string[] = [];
  for (const f of audit['failures'].filter(isObject).filter((x) => x['check'] === 'relation')) {
    const [a, rel, b, by, deg] = [f['a'], f['rel'], f['b'], f['by'], f['deg']];
    if (typeof a === 'string' && typeof rel === 'string' && typeof b === 'string' && finite(by) && finite(deg)) misses.push({ a, rel, b, by, deg });
    else problems.push(`a relation failure without a, rel, b, by and deg: ${brief(f, 300)}`);
  }
  return { misses, problems };
}

export interface Mismatch { pose: number; relation: string; why: string; read?: number; solve?: number }
export interface Compared { mismatches: Mismatch[]; bitwise: number; heldOnly: number }

export function measureMismatches(
  rows: readonly (Row | null)[], groups: readonly (readonly Expected[])[], solve: readonly SolveMiss[], poseOf: (e: Expected) => number,
): Compared {
  const out: Compared = { mismatches: [], bitwise: 0, heldOnly: 0 };
  const key = (e: { a: string; rel: string; b: string }): string => `${e.a}\n${e.rel}\n${e.b}`;
  const bySolve = new Map(solve.map((s) => [key(s), s]));
  groups.forEach((expected, k) => {
    const row = rows[k] ?? null;
    for (const e of expected) {
      const miss = (why: string, read?: number, measured?: number): void => {
        out.mismatches.push({ pose: poseOf(e), relation: nameOf(e), why, ...(read === undefined ? {} : { read }), ...(measured === undefined ? {} : { solve: measured }) });
      };
      if (!row) { miss(NO_ROW); continue; }
      const r = oneFor(row, e);
      if (typeof r === 'string') { miss(`the row is ${row.result}; ${r.slice(0, 300)}`); continue; }
      if (r.m === null || r.deg === null || r.held === null) { miss(`it reads ${shown(r)}, no miss in m and degrees with a flag`); continue; }
      const s = bySolve.get(key(e));
      if (!s) {
        out.heldOnly += 1;
        if (r.held !== true || !(r.m >= 0 && r.m <= TOL_M && r.deg >= 0 && r.deg <= TOL_DEG)) miss(`the solve's measure holds it, and the check reads ${shown(r)}`);
        continue;
      }
      out.bitwise += 1;
      if (r.held !== false) miss(`the solve's measure misses it by ${s.by} m and ${s.deg}°, and the check reads it held`);
      if (bitsOf(r.m) !== bitsOf(s.by)) miss(`miss.m is ${r.m} (bits ${bitsOf(r.m)}), the solve's measure ${s.by} (bits ${bitsOf(s.by)})`, r.m, s.by);
      if (bitsOf(r.deg) !== bitsOf(s.deg)) miss(`miss.deg is ${r.deg} (bits ${bitsOf(r.deg)}), the solve's measure ${s.deg} (bits ${bitsOf(s.deg)})`, r.deg, s.deg);
    }
  });
  return out;
}

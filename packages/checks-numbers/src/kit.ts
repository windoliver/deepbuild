// check.kind@1's kit for the numbers kind (#87), run by the conformance package's one runner. A case is a SQLite file
// the judge builds in a temporary checkout, a numbers spec over it, and the run outcome it must come to. The fixed
// part holds numbers that hold, a planted wrong number, a planted term that changes nothing, a crashed query and a
// query past its deadline; the seeded part draws the totals. Each rule has one planted runner that breaks it alone.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fail, Finding } from '@deepbuild/conformance/slot-types';
import type { CheckContext, CheckResult, Fixture, PlantedFill, Random, RunOutcome, SlotCase, SlotKitImpl, SlotRule } from '@deepbuild/conformance';
import type { AddedTerm, NumbersFill, NumbersSpec, StatedNumber } from './types.js';

const SLOT = 'check.kind@1';
const LONG = 60_000;
/** The deadline case: a query that takes far longer than DEADLINE ms. */
const DEADLINE = 300;
const OUTCOMES: readonly RunOutcome[] = ['passed', 'failed', 'ran_nothing', 'missing', 'overran', 'stopped', 'uncounted'];

const RULES = {
  work: { id: 'outcome-from-numbers', rule: 'A stated number that its query or recount doesn\'t return, or an added term that changes nothing on its sample, fails at the check\'s assertion showing both values; numbers that hold pass.', message: 'reported a run other than what the numbers show', code: 'numbers_outcome' },
  deadline: { id: 'deadline-holds', rule: 'A run still going at its deadline is overran; a result that arrives after the deadline is never passed or failed.', message: 'reported a result after the deadline instead of overran', code: 'reported_after_deadline' },
  crash: { id: 'crash-output-kept', rule: 'A query that errors is a crash: failed, its error kept as a failure that isn\'t the check\'s assertion.', message: 'dropped a crashed run\'s output', code: 'crash_output_dropped' },
} as const;
type Rule = keyof typeof RULES;
const rules: SlotRule[] = Object.values(RULES).map(({ id, rule }) => ({ id, rule }));

interface Work { sql: string; numbers: StatedNumber[]; added: AddedTerm[]; deadline: number }
interface Expected { outcome: RunOutcome; assertion?: string; crash?: string }

const DB = 'shop.db';
const ORDERS = "CREATE TABLE orders (id INTEGER PRIMARY KEY, status TEXT NOT NULL, amount INTEGER NOT NULL); INSERT INTO orders VALUES (1, 'paid', 1000), (2, 'paid', 250), (3, 'refunded', 250);";
const REVENUE = 'SELECT SUM(amount) FROM orders';
const stated = (value: string, sql = REVENUE): StatedNumber => ({ where: 'dashboard: revenue', stated: value, query: { database: DB, sql } });
const filter = (term: string): AddedTerm => ({ kind: 'filter', term, with: `${REVENUE} WHERE ${term}`, without: REVENUE, sample: DB });
const work = (id: string, w: Partial<Work>, expected: Expected): Fixture =>
  ({ id, input: { sql: ORDERS, numbers: [], added: [], deadline: LONG, ...w } as unknown as Fixture['input'], expected: expected as unknown as Fixture['expected'] });

const FIXED: Fixture[] = [
  work('numbers-hold', { numbers: [stated('1,500')], added: [filter("status <> 'refunded'")] }, { outcome: 'passed' }),
  work('planted-three-times-too-high', { numbers: [stated('4,500')] }, { outcome: 'failed', assertion: 'states 4,500, and its query returns 1,500' }),
  work('planted-idle-filter', { added: [filter("status <> 'test'")] }, { outcome: 'failed', assertion: "status <> 'test' changes no result" }),
  work('nothing-stated', {}, { outcome: 'ran_nothing' }),
  work('crashed-no-table', { numbers: [stated('1', 'SELECT SUM(amount) FROM refunds')] }, { outcome: 'failed', crash: 'no such table' }),
  work('past-deadline', { numbers: [stated('10,000,000', 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 10000000) SELECT count(*) FROM c')], deadline: DEADLINE }, { outcome: 'overran' }),
];

function generate(random: Random): SlotCase[] {
  const amounts = Array.from({ length: random.int(1, 8) }, () => random.int(0, 100_000));
  const sql = `CREATE TABLE orders (id INTEGER PRIMARY KEY, status TEXT NOT NULL, amount INTEGER NOT NULL); INSERT INTO orders VALUES ${amounts.map((a, i) => `(${i + 1}, 'paid', ${a})`).join(', ')};`;
  const total = amounts.reduce((s, a) => s + a, 0);
  const off = total + random.int(1, 9);
  const seeded = (i: number, numbers: StatedNumber[], expected: Expected): SlotCase =>
    ({ id: `seeded-${i}`, part: 'seeded', input: { sql, numbers, added: [], deadline: LONG } as unknown as SlotCase['input'], expected: expected as unknown as SlotCase['expected'] });
  return [
    seeded(1, [stated(total.toLocaleString('en-US'))], { outcome: 'passed' }),
    seeded(2, [stated(off.toLocaleString('en-US'))], { outcome: 'failed', assertion: `states ${off.toLocaleString('en-US')}, and its query returns ${total.toLocaleString('en-US')}` }),
  ];
}

// ---- The judge.

const grace = (deadline: number): number => Math.max(100, deadline);
const broke = (rule: Rule, detail: string): Finding => fail(RULES[rule].message, [RULES[rule].code], detail);

function hold(answer: unknown, ex: Expected, deadline: number, elapsed: number): void {
  if (typeof answer !== 'object' || answer === null) throw new Finding('FAIL', 'the result is not an object', ['type']);
  const r = answer as Record<string, unknown>;
  if ('verdict' in r) throw new Finding('FAIL', 'the result carries a verdict; a runner reports a run outcome and the core matches it to a verdict', ['unlisted_field']);
  if (!OUTCOMES.includes(r.outcome as RunOutcome)) throw new Finding('FAIL', `outcome ${JSON.stringify(r.outcome)} is not one of the run outcomes`, ['enum']);
  if (!Number.isInteger(r.testsRun) || !Array.isArray(r.failures) || !Array.isArray(r.read)) throw new Finding('FAIL', 'the result lacks its testsRun, failures or read', ['type']);
  const failures = r.failures as CheckResult['failures'];
  const outcome = r.outcome as RunOutcome;
  const shown = failures.map((f) => `${f.assertion ? '(assertion) ' : ''}${f.message}`).join(' | ') || 'no failures';
  if (elapsed > deadline + grace(deadline) && outcome !== 'overran') throw broke('deadline', `reported ${outcome} ${elapsed} ms in, past the ${deadline} ms deadline`);
  if (outcome !== ex.outcome) throw broke('work', `reported ${outcome}; the numbers' run is ${ex.outcome} (${shown})`);
  if (ex.assertion && !failures.some((f) => f.assertion && f.message.includes(ex.assertion!))) throw broke('work', `no failure at the check's assertion says "${ex.assertion}" (${shown})`);
  if (ex.crash && !failures.some((f) => !f.assertion && f.message.includes(ex.crash!))) throw broke('crash', `the run stopped on "${ex.crash}", and no failure keeps it (${shown})`);
}

function* judge(fill: NumbersFill, c: SlotCase): Generator<() => unknown, void, unknown> {
  const w = c.input as unknown as Work;
  const checkout = mkdtempSync(join(tmpdir(), 'deep-numbers-'));
  try {
    const db = new DatabaseSync(join(checkout, DB));
    db.exec(w.sql);
    db.close();
    const spec: NumbersSpec = { kind: 'numbers', runner: 'sqlite', inputs: [DB], depth: 'unit', oracle: 'code', contract: null, numbers: w.numbers, added: w.added };
    const ctx: CheckContext = { checkout, deadline: w.deadline, now: () => Date.now() };
    const started = Date.now();
    const answer = yield () => fill.run(spec, ctx);
    hold(answer, c.expected as unknown as Expected, w.deadline, Date.now() - started);
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
}

function planted(reference: NumbersFill): PlantedFill<NumbersFill>[] {
  const plant = (name: string, breaks: Rule, run: NumbersFill['run']): PlantedFill<NumbersFill> =>
    ({ name, message: RULES[breaks].message, codes: [RULES[breaks].code], breaks: RULES[breaks].id, fill: { ...reference, run } });
  return [
    plant('misses-the-fault', 'work', async (spec, ctx) => {
      const r = await reference.run(spec, ctx);
      return r.outcome === 'failed' && r.failures.every((f) => f.assertion) ? { ...r, outcome: 'passed', failures: [] } : r;
    }),
    plant('past-deadline', 'deadline', (spec, ctx) => reference.run(spec, { ...ctx, deadline: LONG })),
    plant('dropped-output', 'crash', async (spec, ctx) => {
      const r = await reference.run(spec, ctx);
      return { ...r, failures: r.failures.filter((f) => f.assertion), evidence: [] };
    }),
  ];
}

export function numbersKit(reference: () => NumbersFill): SlotKitImpl<NumbersFill> {
  return { slot: SLOT, fills: 'one', revision: 1, rules, fixtures: FIXED, planted: planted(reference()), clean: () => [reference()], generate, judge };
}

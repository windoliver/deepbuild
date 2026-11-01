// #854.3f8dbc12: deep_query's summary returns in 20 ms and under 2,000 tokens, and a 1,000-row page in 50 ms; a
// planted query that returns every row unpaged fails, naming its size.
//
// The perf-lane task `canvas-scene-read` (`node benchmarks/canvas.mjs scene-read`) shows the patch task's
// 10,000-item board and, on a release build, asks deep_query for the board's summary and for one paged read of
// 1,000 rows, timing each and measuring each reply in tokens by the tokenizer an agent adapter's facts pin
// (README: The surface under test). Tokens and rows are counts, judged on any machine; the two times are judged
// by the design's rule on a reference Mac only. The planted query is `--planted unpaged`. The wrong programs: the
// base (no deep_query, no task, no pinned tokenizer); a query that returns every row unpaged; a count by another
// tokenizer than the facts pin, or none; a judge that never fails, or fails without naming the reply's size.
import { describe, expect, it } from 'vitest';
import {
  AGENT_ADAPTERS, ITEMS, PAGE_ROWS, REPO, TASKS, commonRuns, int, judgeWithin, judged, laneVerdict, mentions, num, obj, readJson, record,
  referenceMacProblem, requireMac, str, synthetic, targetOf, type JsonObject, type Recorded,
} from './helpers.ts';
import { join } from 'node:path';

const ID = '#854.3f8dbc12';
const RELEASE = '#854.926cdce7';
const TASK = TASKS.read;

interface Read { ms: number; tokens: number; bytes: number; rows: number; next?: string | null }
interface Run { summary: Read; page: Read }

function readOf(v: JsonObject, what: string): Read {
  const out: Read = { ms: num(v['ms'], `${what}.ms`), tokens: int(v['tokens'], `${what}.tokens`), bytes: int(v['bytes'], `${what}.bytes`), rows: int(v['rows'], `${what}.rows`) };
  expect(out.ms > 0 && out.tokens > 0 && out.bytes > 0, `${what}: a timed reply with tokens and bytes: ${JSON.stringify(v)}`).toBe(true);
  // A tokenizer's count of a reply lies between one token per byte and one per 16 bytes; a count outside is no count of it.
  expect(out.tokens <= out.bytes && out.tokens >= out.bytes / 16, `${what}: ${out.tokens} tokens is a tokenizer's count of ${out.bytes} bytes`).toBe(true);
  return out;
}
function runsOf(report: JsonObject, what: string): Run[] {
  const runs = commonRuns(report, what);
  expect(report['items'], `${what}: the board holds 10,000 items`).toBe(ITEMS);
  return runs.map((run, r) => {
    const page = obj(run['page'], `${what}: run ${r + 1}: page`);
    const next = page['next'];
    expect(next === null || (typeof next === 'string' && next !== ''), `${what}: run ${r + 1}: page.next is a cursor or null, got ${JSON.stringify(next)}`).toBe(true);
    return { summary: readOf(obj(run['summary'], `${what}: run ${r + 1}: summary`), `${what}: run ${r + 1}: summary`), page: { ...readOf(page, `${what}: run ${r + 1}: page`), next: next as string | null } };
  });
}

let shipped: Recorded | undefined;
let planted: Recorded | undefined;
const shippedRuns = (): Run[] => runsOf((shipped ??= record('read')).report, TASK.id);
const plantedRuns = (): Run[] => runsOf((planted ??= record('read', true)).report, `${TASK.id} --planted ${TASK.planted}`);

describe(`${ID} deep_query's summary returns in 20 ms and under 2,000 tokens, and a 1,000-row page in 50 ms; a planted query that returns every row unpaged fails, naming its size`, () => {
  it(`${ID} ${RELEASE} on a release build, the task reads the 10,000-item board's summary and one 1,000-row page with a cursor to the next, each reply counted by the tokenizer an agent adapter's facts pin, and the summary is under 2,000 tokens in every run`, (ctx) => {
    requireMac(ctx);
    const { report } = (shipped ??= record('read'));
    const runs = shippedRuns();
    const tokenizer = obj(report['tokenizer'], 'the report names the tokenizer it counted with');
    const adapter = str(tokenizer['adapter'], 'tokenizer.adapter');
    expect(AGENT_ADAPTERS as readonly string[], `the tokenizer is an agent adapter's: ${adapter}`).toContain(adapter);
    const facts = obj(obj(readJson(join(REPO, 'adapters', `${adapter}.facts.json`)), `adapters/${adapter}.facts.json`)['tokenizer'], `adapters/${adapter}.facts.json names a tokenizer`);
    const name = str(facts['name'], 'the facts\' tokenizer.name');
    const version = str(facts['version'], 'the facts\' tokenizer.version');
    expect(version, 'the facts pin one exact version, no range').toMatch(/^\d+(\.\d+)*([-+][0-9A-Za-z.-]+)?$/);
    expect({ name: tokenizer['name'], version: tokenizer['version'] }, 'the replies are counted by the tokenizer the facts pin').toEqual({ name, version });
    runs.forEach(({ summary, page }, r) => {
      expect(page.rows, `run ${r + 1}: one paged read of 1,000 rows`).toBe(PAGE_ROWS);
      expect(page.next, `run ${r + 1}: the page of 1,000 of 10,000 rows hands back a cursor to the next`).toEqual(expect.any(String));
      expect(summary.tokens, `run ${r + 1}: the summary is under 2,000 tokens`).toBeLessThan(TASK.targets.summary_tokens);
    });
    console.log(`${ID} summary ${runs.map((r) => `${r.summary.tokens} tokens / ${r.summary.ms.toFixed(2)} ms`).join(', ')}; page ${runs.map((r) => `${r.page.tokens} tokens / ${r.page.ms.toFixed(2)} ms`).join(', ')}`);
  }, 3_600_000);

  it(`${ID} on the reference Mac the summary returns within 20 ms and the 1,000-row page within 50 ms in all five runs, and the lane's judge passes the task on those same runs`, (ctx) => {
    const problem = referenceMacProblem();
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const runs = shippedRuns();
    judgeWithin(ctx, `${TASK.id} summary ms`, runs.map((r) => r.summary.ms), TASK.targets.summary_ms);
    judgeWithin(ctx, `${TASK.id} page ms`, runs.map((r) => r.page.ms), TASK.targets.page_ms);
    const verdict = judged(shipped!.report);
    for (const [name, pick] of [['summary_ms', (r: Run) => r.summary.ms], ['summary_tokens', (r: Run) => r.summary.tokens], ['page_ms', (r: Run) => r.page.ms], ['page_rows', (r: Run) => r.page.rows]] as const) {
      const target = targetOf(verdict, name);
      expect(target.limit, `the judge holds ${name} to the issue's number`).toBe(TASK.targets[name]);
      target.runs.forEach((v, i) => expect(v, `the judge judges run ${i + 1}'s ${name}`).toBeCloseTo(pick(runs[i]!), 3));
    }
    laneVerdict(ctx, verdict, 'PASS');
  }, 3_600_000);

  it(`${ID} a planted query that returns every row unpaged answers the 1,000-row read with all 10,000 rows and no cursor, and the lane fails it on any machine, naming its size in rows and tokens`, (ctx) => {
    requireMac(ctx);
    const runs = plantedRuns();
    runs.forEach(({ page }, r) => {
      expect(page.rows, `run ${r + 1}: the planted query returns every row of the board`).toBe(ITEMS);
      expect(page.next, `run ${r + 1}: unpaged, so no cursor`).toBeNull();
    });
    const verdict = judged(planted!.report);
    expect(verdict['status'], `the lane fails the planted query: ${JSON.stringify(verdict).slice(0, 2000)}`).toBe('FAIL');
    expect(targetOf(verdict, 'page_rows').status, 'on the page\'s size').toBe('FAIL');
    const reason = str(verdict['reason'], 'verdict.reason');
    const { page } = runs[0]!;
    expect(/page/.test(reason) && mentions(reason, page.rows) && mentions(reason, page.tokens), `the failure names the reply's size, ${page.rows} rows and ${page.tokens} tokens: ${reason.slice(0, 1500)}`).toBe(true);
  }, 3_600_000);

  it(`${ID} the lane's judge fails a reading whose summary is 2,000 tokens or more, naming the summary's size, and passes its twin under 2,000`, () => {
    const within = judged(synthetic('read'));
    expect(within['status'], `a reading within every target on a reference Mac passes: ${JSON.stringify(within).slice(0, 1500)}`).toBe('PASS');
    const report = synthetic('read');
    report['runs'] = Array.from({ length: 5 }, () => ({ summary: { ms: 5, tokens: 2_437, bytes: 9_811, rows: 37 }, page: { ms: 20, tokens: 30_000, bytes: 120_000, rows: PAGE_ROWS, next: 'c1000' } }));
    const verdict = judged(report);
    expect(verdict['status'], `a 2,437-token summary fails: ${JSON.stringify(verdict).slice(0, 1500)}`).toBe('FAIL');
    expect(targetOf(verdict, 'summary_tokens').status, 'on the summary\'s tokens').toBe('FAIL');
    const reason = str(verdict['reason'], 'verdict.reason');
    expect(/summary/.test(reason) && mentions(reason, 2_437), `the failure names the summary's size, 2,437 tokens: ${reason.slice(0, 1500)}`).toBe(true);
  }, 600_000);
});

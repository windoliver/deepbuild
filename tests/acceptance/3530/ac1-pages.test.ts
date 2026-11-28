import { describe, expect, it } from 'vitest';
import { titlePrefix, CRITERIA, answerForEachCall, bakeCall, bakeInHeadlessChrome, inconclusive, debugLogicAnswers, logicDebug, expectNoProblems, oneItemPiece, prebuild, run, webPlanCall } from './helpers.ts';
import { brief, isObject, judgePages, judgePlanted, type Finding, type JsonObject } from './judges.ts';
import { SEEDS, STEPS, changedPagesInNode, seededInALine, seeded, withReadRegion, type Seeded } from './programs.ts';

const ID = titlePrefix(1);
prebuild(logicDebug);
const PLANTED_REWRITE = 'store_skips_page_marked_last';
const RUN_MS = 12 * 60_000;
const TEST_MS = 15 * 60_000;

const programs: Seeded[] = Array.from({ length: SEEDS }, (_, i) => seeded(i));
const pieceFor = (p: Seeded): JsonObject => oneItemPiece(p.program, 3530, { fuel: 10_000_000, ...(p.pages > 64 ? { memory: Math.ceil(p.pages / 16) } : {}) });
const bakes = (): JsonObject[] => programs.map((p) => bakeCall(pieceFor(p), STEPS));

let known: number[][][] | undefined;
function changedPagesOfEveryProgram(): number[][][] {
  known ??= programs.map((p) => {
    const steps = changedPagesInNode(p.program, STEPS);
    for (const [k, pages] of steps.entries()) if (JSON.stringify(pages) !== JSON.stringify(p.writtenPages)) throw Error(`INVALID: this suite's own program isn't what it says: in Node's engine step ${k} changed pages ${JSON.stringify(pages)}, and its instructions write ${JSON.stringify(p.writtenPages)} (${seededInALine(p)})`);
    return steps.map(withReadRegion);
  });
  return known;
}
const judgeAll = (replies: readonly JsonObject[], where: string): Finding[] => programs.flatMap((p, i) => judgePages(p, changedPagesOfEveryProgram()[i]!, replies[i]!, where));

describe(`${ID} the pages the bitmap holds after a step are the pages whose bytes changed`, () => {
  it(`${ID} in wasmtime, for 1,000 seeded programs of stores, fills and copies, the pages the bitmap holds after each step equal the pages whose bytes changed`, () => {
    expect([programs.length, STEPS], 'the criterion names 1,000 programs; each runs three steps').toEqual([1_000, 3]);
    const replies = debugLogicAnswers(bakes(), RUN_MS);
    const findings = judgeAll(replies, 'wasmtime');
    expectNoProblems(findings.map((f) => f.text), `${ID}: in wasmtime the bitmap doesn't hold the pages whose bytes changed (${new Set(findings.map((f) => f.program)).size} of ${SEEDS} programs)`);
  }, TEST_MS);

  it(`${ID} in headless Chrome, for the same 1,000 programs as the app rewrote them, the pages the bitmap holds after each step equal the pages whose bytes changed`, async () => {
    const calls: JsonObject[] = [{ call: 'web_runner' }, ...programs.map((p) => webPlanCall(pieceFor(p), STEPS))];
    const [runner, ...plans] = debugLogicAnswers(calls, RUN_MS);
    const source = runner!['source'];
    expect(typeof source === 'string' && /WebAssembly\.(instantiate|Module|Instance|compile)/.test(source), 'web_runner gives the logic module\'s web runner, which runs the rewritten bytes in the browser\'s own WebAssembly engine').toBe(true);
    const refused = plans.flatMap((plan, i) => (plan['ok'] === true && isObject(plan['request']) ? [] : [`seeded program ${i}: web_plan gave no request: ${brief(plan)} (${seededInALine(programs[i]!)})`]));
    expectNoProblems(refused, `${ID}: the app plans each program for the web runner`);
    const page = await bakeInHeadlessChrome(source as string, plans.map((plan) => plan['request']!), RUN_MS);
    expect(page.replies.length, 'the web runner answers each request once').toBe(SEEDS);
    const replies = page.replies.map((r): JsonObject => (isObject(r) ? r : { ok: false, code: 'bad_output', reply: brief(r) }));
    const findings = judgeAll(replies, 'headless Chrome');
    expectNoProblems(findings.map((f) => f.text), `${ID}: in headless Chrome (${page.userAgent}) the bitmap doesn't hold the pages whose bytes changed (${new Set(findings.map((f) => f.program)).size} of ${SEEDS} programs)`);
  }, TEST_MS);

  it(`${ID} a planted rewrite that skips the mark of a store whose page was marked last (${PLANTED_REWRITE}) fails, naming the page`, () => {
    const calls = bakes();
    const ran = run(logicDebug(), ['--planted', PLANTED_REWRITE], calls, RUN_MS);
    if (ran.timedOut) inconclusive(`deep-logic --planted ${PLANTED_REWRITE} didn't end in time and was stopped; it had answered ${ran.replies.length} of ${calls.length} bakes`);
    expect(ran.status === 0 && ran.replies.length === calls.length,
      `${ID}: deep-logic --planted ${PLANTED_REWRITE} runs the planted rewrite and answers each of the ${calls.length} bakes; it exited ${ran.status ?? ran.signal} after ${ran.replies.length} ${ran.replies.length === 1 ? 'answer' : 'answers'}, the last ${brief(ran.replies.at(-1) ?? null, 300)}, so this binary holds no such planted rewrite (${CRITERIA[1]})`).toBe(true);
    const findings = judgeAll(answerForEachCall(ran, calls, `deep-logic --planted ${PLANTED_REWRITE}`), `--planted ${PLANTED_REWRITE}`);
    const one = programs.filter((p) => p.family === 'one page' && p.pages <= 64);
    expect(one.length, 'this suite holds programs whose stores all lie in one page of a memory of one bitmap word').toBeGreaterThanOrEqual(100);
    expect(findings.length, `${ID}: the judge fails the planted rewrite: a store whose page the step before marked last goes unmarked once the bitmap is cleared, as in seeded program ${one[0]!.index}, page ${one[0]!.onlyStoredPage}`).toBeGreaterThan(0);
    expect(findings[0]!.text, 'each failure names the page').toMatch(/step \d+: page \d+'s bytes changed and the bitmap doesn't hold it/);
    expectNoProblems(judgePlanted(programs, findings), `${ID}: the planted rewrite loses exactly the marks it is planted to lose`);
  }, TEST_MS);
});

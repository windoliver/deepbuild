// #1514 AC1, AC2 and AC6: Codex shares one byte budget across every AGENTS.md it reads and loads none in a project it
// doesn't trust. The issue's repo (a root and a nested AGENTS.md, 20 KiB each, 40 KiB together) under a Codex facts
// budget of 32 KiB: `deep doctor` names the nested file and its first line past the budget (AC1); in a project Codex
// doesn't trust the rules page marks every rule as not reaching Codex, cause untrusted (AC2); and a rule marked over
// budget that a recorded native load event shows loaded reads as loaded, the page saying so (AC6).
//
// The world is #19's all-ok world (../19/doctor/helpers.ts, `world`), with the fixture facts in DEEP_HUB_TEST_FACTS on
// every process it starts: the shipped facts with Codex's byte cap set to 32 KiB (README: The surface under test).
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, deep, doctor, rootOf, shown, startHub, startSession, stopHub, world, type Doctored, type World } from '../19/doctor/helpers.ts';
import {
  AC1, AC2, AC6, CODEX, CODEX_BUDGET, KIB, NESTED, OVER_BUDGET, SUMS_PER_FILE, UNTRUSTED, budgetRepo, bytesOf, fixtureFacts, itemWords, itemsShownShort, isNotLoaded,
  loadedIn, lostFor, markedAs, marksFor, namesLine, onPage, pageShown, readPage, recordNativeLoad, shownLine, trustInCodex, type BudgetRepo,
} from './helpers.ts';

afterAll(cleanup, 60_000);

interface Made { w: World; missing: string[] }
let made: Promise<Made> | undefined;
/** One world for this file, its hub and every process reading the fixture facts. */
const theWorld = (): Promise<Made> => (made ??= (async () => {
  let missing: string[] = [];
  const w = await world({
    before: (_settings, h) => {
      const dir = join(h.tmp, 'facts');
      missing = fixtureFacts(dir, { codexBudget: CODEX_BUDGET });
      h.env.DEEP_HUB_TEST_FACTS = dir;
    },
  });
  return { w, missing };
})());
const factsReady = (missing: string[]): void => {
  expect.soft(missing.join('; ') || 'none', 'the fixture facts: the shipped facts with every byte cap of Codex\'s rule-load entry set to 32 KiB (README); what the shipped facts lack').toBe('none');
};

/** The issue's sizes, checked: 40 KiB together, each file under the budget alone, the nested file's first lost line a rule. */
function sizes(r: BudgetRepo): void {
  expect(bytesOf(r.rootText) + bytesOf(r.coreText), 'the root and nested AGENTS.md total 40 KiB').toBe(40 * KIB);
  expect(Math.max(bytesOf(r.rootText), bytesOf(r.coreText)), 'each file alone is under the 32 KiB budget, so a doctor that sums per file reads OK').toBeLessThan(CODEX_BUDGET);
  expect(r.firstLost, 'the nested file\'s first line past the budget, after the root file\'s 20 KiB').toBe(193);
  expect(r.rules.some((x) => x.file === NESTED && x.line === 193), 'line 193 of the nested file is a rule').toBe(true);
}

/** AC1's judgment of one doctor run in the nested folder: the nested file and its first line past the budget, exit non-zero. */
function judgeBudget(d: Doctored, r: BudgetRepo): void {
  const where = `deep doctor run in ${r.core}`;
  const nested = lostFor(d, CODEX).filter((i) => itemWords(i).includes(NESTED));
  if (!nested.length) expect.fail(`AC1 ${where} must report rules.not_loaded for Codex naming ${NESTED}; its rules items: ${itemsShownShort(d.items.filter(isNotLoaded))}; all items: ${d.items.map((i) => `${i.item}:${i.level}`).join(', ')}; exit ${String(d.ran.code)}, stderr ${JSON.stringify(d.ran.stderr.slice(0, 600))}`);
  const at = nested.filter((i) => namesLine(itemWords(i), r.firstLost!));
  if (!at.length) expect.fail(`AC1 ${where} must name line ${String(r.firstLost)} of ${NESTED}, its first line past Codex's 32 KiB budget: ${itemsShownShort(nested)}`);
  if (d.ran.code === 0) expect.fail(`AC1 ${where} must exit non-zero when ${NESTED} loses lines past the budget: exit ${String(d.ran.code)}`);
}

describe(`${AC1} a fixture repo whose root and nested AGENTS.md total 40 KiB, under a Codex facts budget of 32 KiB: deep doctor names the nested file and its first line past the budget, and exits non-zero; a doctor that sums per file reports OK and fails`, () => {
  it(`${AC1} deep doctor run in the repo names packages/core/AGENTS.md and line 193 in a rules.not_loaded item for Codex, and exits non-zero`, async () => {
    const { w, missing } = await theWorld();
    factsReady(missing);
    const r = budgetRepo(join(w.h.tmp, 'b-doctor'), 'd');
    sizes(r);
    trustInCodex(w.h.home, r.repo, 'trusted');
    judgeBudget(await doctor(w.h, ['--prompt'], { cwd: r.core }), r);
  }, 600_000);

  it(`${AC1} (wrong program) a doctor that sums per file (${SUMS_PER_FILE}) reports OK in the same repo and fails this test`, async () => {
    const { w, missing } = await theWorld();
    factsReady(missing);
    const r = budgetRepo(join(w.h.tmp, 'b-planted'), 'p');
    trustInCodex(w.h.home, r.repo, 'trusted');
    const d = await doctor(w.h, ['--prompt'], { cwd: r.core, env: { DEEP_HUB_PLANT: SUMS_PER_FILE } });
    expect(itemsShownShort(lostFor(d, CODEX)), `the planted doctor reports Codex's rules OK: no rules.not_loaded item above ok`).toBe('none');
    expect(() => judgeBudget(d, r)).toThrow(/^AC1 deep doctor run in .* must report rules\.not_loaded for Codex naming packages\/core\/AGENTS\.md/);
  }, 600_000);
});

describe(`${AC2} the same repo in a project Codex doesn't trust reports every rule as not reaching Codex, cause untrusted`, () => {
  it(`${AC2} every rule of the root and nested AGENTS.md is marked on the rules page as not reaching Codex, cause untrusted`, async () => {
    const { w, missing } = await theWorld();
    factsReady(missing);
    const r = budgetRepo(join(w.h.tmp, 'b-untrusted'), 'u');
    trustInCodex(w.h.home, r.repo, 'untrusted');
    await startSession(w.h, r.repo);
    const sync = await deep(w.h, ['rules', 'sync']);
    const page = readPage(rootOf(w.h.home));
    expect(r.rules.length, 'the repo holds 20 rules, 10 in each file').toBe(20);
    for (const rule of r.rules) {
      const p = onPage(page, rule.text);
      expect(p, `the rules page lists line ${rule.line} of ${rule.file} ("${rule.text.slice(0, 40)}"); deep rules sync: ${shown(sync)}; ${pageShown(page)}`).toBeDefined();
      expect(markedAs(p!, CODEX, UNTRUSTED), `AC2 line ${rule.line} of ${rule.file}, in a project Codex doesn't trust, is marked as not reaching Codex, cause untrusted: ${shownLine(p)}`).toBe(true);
    }
  }, 600_000);
});

describe(`${AC6} a rule marked over budget that a recorded native load event shows loaded reads as loaded, and the page says so`, () => {
  it(`${AC6} a nested rule past the budget is marked over budget for Codex; once a Codex session's record holds session.loaded naming its file, it reads as loaded, the page naming that session`, async () => {
    const { w, missing } = await theWorld();
    factsReady(missing);
    const r = budgetRepo(join(w.h.tmp, 'b-loaded'), 'l');
    trustInCodex(w.h.home, r.repo, 'trusted');
    const rule = r.rules.find((x) => x.file === NESTED && x.line === 225)!;
    await startSession(w.h, r.repo);
    const root = rootOf(w.h.home);
    await deep(w.h, ['rules', 'sync']);
    const before = onPage(readPage(root), rule.text);
    expect(before, `the rules page lists line ${rule.line} of ${NESTED}; ${pageShown(readPage(root))}`).toBeDefined();
    expect(markedAs(before!, CODEX, OVER_BUDGET), `AC6 line ${rule.line} of ${NESTED} is past the 32 KiB budget (the root file's 20 KiB and the nested file's first 192 lines spend it), so it is marked as not reaching Codex, over budget: ${shownLine(before)}`).toBe(true);

    // A Codex session in packages/core whose record says it loaded both files whole (README: the native load event).
    const session = `codex${Date.now().toString(36)}`;
    await stopHub(w.hub!);
    let refused: string | undefined;
    try {
      refused = await recordNativeLoad(root, { session, worktree: r.core, files: [join(r.repo, 'AGENTS.md'), join(r.repo, NESTED)] });
    } finally {
      w.hub = await startHub(w.h);
    }
    expect(refused, `AC6 the record holds a native load event (session.loaded) for the Codex session ${session}`).toBeUndefined();
    await deep(w.h, ['rules', 'sync']);
    const after = onPage(readPage(root), rule.text);
    expect(after, `the rules page still lists line ${rule.line} of ${NESTED}`).toBeDefined();
    expect(marksFor(after!, CODEX), `AC6 the recorded load outranks the prediction: line ${rule.line} of ${NESTED} reads as loaded, with no mark for Codex: ${shownLine(after)}`).toEqual([]);
    expect(loadedIn(after!, CODEX, session), `AC6 the page says so: line ${rule.line}'s loaded entry names Codex and the session session:${session} whose record shows the load: ${shownLine(after)}`).toBe(true);
  }, 600_000);
});

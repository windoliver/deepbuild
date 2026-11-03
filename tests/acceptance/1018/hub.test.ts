// #1018: through a real hub (`deep hub run`, deep-hook and #29's Claude Code stand-in), sessions in worktrees of one repo
// cut from one default-branch commit make claims on #31's sample repo, real Vitest runs check them, and the readings come
// from the record (README). A hub that can't start, the planted ones included, is BLOCKED (the test throws), never a pass.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { FIXED_CART } from '../31/helpers.ts';
import { cleanup } from '../29/h-d.ts';
import {
  draft, makeTrees, mustFail, open, readsCarried, removeTemp, requirement, SAMPLE, settled, shownReading, shownRun, sleep, startHub, stop, stopHub,
  verdictText, vitestCheck, writes, type ClaimRead, type Hub, type Reading, type Trees, type Worker,
} from './helpers.ts';

// Removing the worlds' cloned installs takes a while on a loaded machine.
afterEach(async () => {
  await cleanup();
  removeTemp();
}, 300_000);

const LIMIT = 1_500_000;

/** The planted wrong programs (README, Proof on a wrong program), selected with DEEP_HUB_PLANT. */
const PLANTS = {
  bySession: 'keys-runs-by-session',
  noReads: 'key-leaves-out-reads',
  perClaim: 'counts-shared-run-per-claim',
  latest: 'keeps-latest-result-per-key',
  wholeEvidence: 'carry-copies-evidence',
} as const;

/**
 * Runs a scenario on a fresh world through a hub started with `plant`: `steps` opens the sessions, makes their claims and
 * returns the reading; the hub is stopped either way.
 */
async function scenario(world: Trees, plant: string | undefined, steps: (hub: Hub, w: Trees) => Promise<Reading>): Promise<Reading> {
  const hub = await startHub(world, { plant });
  try {
    return await steps(hub, world);
  } finally {
    await stopHub(hub);
  }
}
/** The runs of `check` the claim ran as its own. */
const ownRuns = (r: Reading, c: ClaimRead, check: string) => r.runs.filter((x) => x.claim === c.claim && x.check === check);

// ---- AC1: one base run serves five sessions.
const FIX_PROMPT = 'make the cart total take the discount off';
const FIX_CHECK = '.deepbuild/checks/cart-discount.sh';
/** The fix's test: on the merge base the total is 100, so it waits 60 s and then fails at its expect, line 7. */
const SLOW_TEST = "import { expect, it } from 'vitest';\nimport { total } from '../src/cart.ts';\n\nit('total takes the discount off', async () => {\n  const got = total({ items: [100], discount: 10 });\n  if (got !== 90) await new Promise((done) => setTimeout(done, 60_000));\n  expect(got).toBe(90);\n}, 120_000);\n";
const FIX_ASSERTS = ['test/cart.test.ts:7'];
/** Session i's fix: the same test file, and its own src/cart.ts (a line naming it), so only the base runs share a key. */
const fixOf = (i: number): Record<string, string> => ({ 'src/cart.ts': `// session ${i}'s fix\n${FIXED_CART}`, 'test/cart.test.ts': SLOW_TEST });

function fiveSessions(plant?: string): Promise<Reading> {
  const world = makeTrees({ ...SAMPLE, [FIX_CHECK]: vitestCheck('test/cart.test.ts') },
    [draft(FIX_PROMPT, [requirement('R1', 'The cart total takes the discount off', FIX_CHECK, { on_base: 'fails', asserts: FIX_ASSERTS })])], 5);
  return scenario(world, plant, async (hub, w) => {
    const workers: Worker[] = [];
    for (const tree of w.trees) workers.push(await open(hub, w, tree, FIX_PROMPT));
    for (const [i, k] of workers.entries()) await writes(k, fixOf(i + 1));
    await Promise.all(workers.map(stop));
    return settled(hub, w, workers);
  });
}
const baseRunsOf = (r: Reading) => r.runs.filter((x) => x.check === FIX_CHECK && x.commit === r.base).sort((a, b) => a.started.log_pos - b.started.log_pos);
/**
 * AC1: one base run runs for the five claims; the other four read it as carried, naming that run; and every claim's
 * verdict (PASS: the base run proves the fix) lands within 70 s of the last claim.
 */
function oneBaseRun(r: Reading): void {
  const base = baseRunsOf(r);
  expect(base.length, `one base run of ${FIX_CHECK} must run for the five claims, yet ${base.length} ran${base.length > 1 ? `; the second is ${base[1]!.run}` : ''}: ${base.map((x) => shownRun(x, r.base)).join('; ')}; ${shownReading(r)}`).toBe(1);
  const source = base[0]!;
  const others = r.claims.filter((c) => c.claim !== source.claim);
  expect(others.length, `the base run ${source.run} must be one of the five claims' own: it ran for ${source.claim}; ${shownReading(r)}`).toBe(4);
  for (const c of others) readsCarried(r, c, source.run, 'AC1');
  const last = Math.max(...r.claims.map((c) => c.made!.ts));
  for (const c of r.claims) {
    const v = c.verdicts[c.verdicts.length - 1];
    expect(c.outcome, `${c.claim}'s verdict must land as PASS, its base run proving the fix: ${shownReading(r)}`).toBe('PASS');
    expect(v!.ts - last, `${c.claim}'s verdict must land within 70 s of the last claim: it landed ${v!.ts - last} ms after it; ${shownReading(r)}`).toBeLessThanOrEqual(70_000);
  }
}

describe('AC1 #1018.a7bf0857 one base run serves five sessions: five worktrees from one commit claim a fix whose base run takes 60 s, one base run runs and four read it as carried, all five verdicts within 70 s of the last claim', () => {
  it('AC1 five sessions each claim the fix: one base run runs, four claims read it as carried naming it, all PASS within 70 s of the last claim', async () => {
    oneBaseRun(await fiveSessions());
  }, LIMIT);

  it(`AC1 (wrong program ${PLANTS.bySession}) a runner that keys runs by session runs five base runs and fails, naming the second`, async () => {
    const r = await fiveSessions(PLANTS.bySession);
    const base = baseRunsOf(r);
    expect(base.length, `${PLANTS.bySession}: the planted runner must run a base run for each session: ${shownReading(r)}`).toBe(5);
    await mustFail(`${PLANTS.bySession} on AC1`, () => oneBaseRun(r), [base[1]!.run]);
  }, LIMIT);
});

// ---- AC2: carry follows read files.
const CHECKOUT_PROMPT = 'make the checkout total take the discount off';
const PRICE = '.deepbuild/checks/price.sh';
const FORMAT = '.deepbuild/checks/format.sh';
const JOURNEY = '.deepbuild/checks/journey:checkout';
const READS_FILES: Record<string, string> = {
  ...SAMPLE,
  'src/price.ts': 'export const withTax = (amount: number): number => Math.round(amount * 1.2);\n',
  'src/format.ts': 'export const money = (amount: number): string => `$${amount.toFixed(2)}`;\n',
  'test/price.test.ts': "import { expect, it } from 'vitest';\nimport { withTax } from '../src/price.ts';\n\nit('adds the tax', () => {\n  expect(withTax(100)).toBe(120);\n});\n",
  'test/format.test.ts': "import { expect, it } from 'vitest';\nimport { money } from '../src/format.ts';\n\nit('shows dollars', () => {\n  expect(money(9)).toBe('$9.00');\n});\n",
  'test/checkout.test.ts': "import { expect, it } from 'vitest';\nimport { total } from '../src/cart.ts';\n\nit('checks out with the discount taken off', () => {\n  expect(total({ items: [100], discount: 10 })).toBe(90);\n});\n",
  [PRICE]: vitestCheck('test/price.test.ts'),
  [FORMAT]: vitestCheck('test/format.test.ts'),
  [JOURNEY]: vitestCheck('test/checkout.test.ts'),
};
/** The two sessions' claims: the same files but src/cart.ts, which each fixes its own way. */
const CART_A = FIXED_CART;
const CART_B = 'export interface Cart { items: number[]; discount: number }\nexport function total(cart: Cart): number {\n  let sum = 0;\n  for (const item of cart.items) sum += item;\n  return sum - cart.discount;\n}\n';

function twoReaders(plant?: string): Promise<Reading> {
  const world = makeTrees(READS_FILES, [draft(CHECKOUT_PROMPT, [
    requirement('R1', 'Prices carry the tax', PRICE), requirement('R2', 'Amounts show as dollars', FORMAT), requirement('R3', 'Checkout takes the discount off', JOURNEY),
  ])], 2);
  return scenario(world, plant, async (hub, w) => {
    const a = await open(hub, w, w.trees[0]!, CHECKOUT_PROMPT);
    const b = await open(hub, w, w.trees[1]!, CHECKOUT_PROMPT);
    await writes(a, { 'src/cart.ts': CART_A });
    await stop(a);
    await settled(hub, w, [a]);
    await writes(b, { 'src/cart.ts': CART_B });
    await stop(b);
    return settled(hub, w, [a, b]);
  });
}
/** AC2: the second claim shares price and format (one run each, the first claim's, read as carried) and runs its own journey. */
function sharesButJourney(r: Reading): void {
  const [a, b] = r.claims as [ClaimRead, ClaimRead];
  for (const check of [PRICE, FORMAT]) {
    const ran = r.runs.filter((x) => x.check === check && (x.claim === a.claim || x.claim === b.claim));
    expect(ran.map((x) => x.claim), `${check} leaves src/cart.ts out, so the two claims share it: one run, the first claim's, and ${b.claim} runs none: ${shownReading(r)}`).toEqual([a.claim]);
    readsCarried(r, b, ran[0]!.run, `AC2 ${check}`);
  }
  for (const c of [a, b]) {
    expect(ownRuns(r, c, JOURNEY).length, `${c.claim} must run its own journey:checkout, which reads src/cart.ts, where the two claims differ: ${shownReading(r)}`).toBeGreaterThan(0);
  }
}

describe('AC2 #1018.ce3898ef carry follows read files: two claims differing only in src/cart.ts share every check whose inputs leave it out, and each runs its own journey:checkout, which reads it', () => {
  it('AC2 the second claim reads price and format as carried and runs its own journey:checkout', async () => {
    sharesButJourney(await twoReaders());
  }, LIMIT);

  it(`AC2 (wrong program ${PLANTS.noReads}) a key that leaves out read files carries the journey and fails, naming src/cart.ts`, async () => {
    const r = await twoReaders(PLANTS.noReads);
    const b = r.claims[1]!;
    expect([PRICE, FORMAT].flatMap((check) => ownRuns(r, b, check)), `${PLANTS.noReads}: the second claim must share price and format: ${shownReading(r)}`).toEqual([]);
    await mustFail(`${PLANTS.noReads} on AC2`, () => sharesButJourney(r), ['src/cart.ts']);
  }, LIMIT);
});

// ---- AC3: runs are counted once. AC4: flakes are seen across sessions.
const COUNT_PROMPT = 'make the cart total take the discount off for every session';
const STEADY = '.deepbuild/checks/steady.sh';
const STEADY_FILES: Record<string, string> = {
  ...SAMPLE,
  'test/steady.test.ts': "import { expect, it } from 'vitest';\nimport { total } from '../src/cart.ts';\n\nit('total takes the discount off', () => {\n  expect(total({ items: [100], discount: 10 })).toBe(90);\n});\n",
  [STEADY]: vitestCheck('test/steady.test.ts'),
};

/** Three sessions make the same claim, one after another, each once the record shows no run going. */
function threeCounters(plant?: string): Promise<Reading> {
  const world = makeTrees(STEADY_FILES, [draft(COUNT_PROMPT, [requirement('R1', 'The cart total takes the discount off', STEADY, { runs: 3 })])], 3);
  return scenario(world, plant, async (hub, w) => {
    const workers: Worker[] = [];
    for (const tree of w.trees) workers.push(await open(hub, w, tree, COUNT_PROMPT));
    for (const [i, k] of workers.entries()) {
      await writes(k, { 'src/cart.ts': FIXED_CART });
      await stop(k);
      await settled(hub, w, workers.slice(0, i + 1));
    }
    return settled(hub, w, workers);
  });
}
/** The distinct clean runs on the steady check's key that finished before a verdict. */
const cleanBefore = (r: Reading, at: number) => r.runs.filter((x) => x.check === STEADY && r.claims.some((c) => c.claim === x.claim) && x.outcome === 'passed' && x.finished!.log_pos < at);
/** The claims after the first, with their first PASS verdict.made. */
const laterPasses = (r: Reading) => r.claims.slice(1).map((c) => ({ c, pass: c.verdicts.find((v) => v.data.outcome === 'PASS') }));
/** AC3: each claim after the first reaches PASS, and only once 3 distinct clean runs exist on its key. */
function countedOnce(r: Reading): void {
  for (const { c, pass } of laterPasses(r)) {
    expect(pass, `${c.claim} (a later session) must reach PASS once 3 distinct runs exist on the key: ${shownReading(r)}`).toBeDefined();
    const clean = cleanBefore(r, pass!.log_pos);
    expect(clean.length, `${c.claim} read PASS with ${clean.length} distinct clean runs on its key (${clean.map((x) => x.run).join(', ') || 'none'}); the check needs 3, and a run read by several claims counts once: ${shownReading(r)}`).toBeGreaterThanOrEqual(3);
  }
}

const FLAKY_PROMPT = 'make the cart total take the discount off before the flip';
const FLAKY = '.deepbuild/checks/flaky.sh';
/** Passes until the time test/flip.json names, and fails from then on: the same inputs, a different outcome. */
const FLAKY_FILES: Record<string, string> = {
  ...SAMPLE,
  'test/flip.json': '{ "until": 0 }\n',
  'test/flaky.test.ts': "import { readFileSync } from 'node:fs';\nimport { expect, it } from 'vitest';\nimport { total } from '../src/cart.ts';\n\nconst { until } = JSON.parse(readFileSync(new URL('./flip.json', import.meta.url), 'utf8')) as { until: number };\n\nit('the discount comes off, before the flip', () => {\n  expect(total({ items: [100], discount: 10 })).toBe(90);\n  expect(Date.now()).toBeLessThan(until);\n});\n",
  [FLAKY]: vitestCheck('test/flaky.test.ts'),
};
/** How long before the flip session A claims: its run ends well before it. */
const LEAD_MS = 120_000;
/**
 * Session A claims at once, with the flip LEAD_MS ahead; its run passes. Once the flip has passed, session B makes the
 * same claim (the same bytes), and a run on the key now fails.
 */
function flakyPair(plant?: string): Promise<Reading> {
  const world = makeTrees(FLAKY_FILES, [draft(FLAKY_PROMPT, [requirement('R1', 'The cart total takes the discount off', FLAKY, { runs: 2 })])], 2);
  return scenario(world, plant, async (hub, w) => {
    const a = await open(hub, w, w.trees[0]!, FLAKY_PROMPT);
    const b = await open(hub, w, w.trees[1]!, FLAKY_PROMPT);
    const until = Date.now() + LEAD_MS;
    const files = { 'src/cart.ts': FIXED_CART, 'test/flip.json': `{ "until": ${until} }\n` };
    await writes(a, files);
    await stop(a);
    const first = await settled(hub, w, [a]);
    const ran = first.runs.filter((x) => x.check === FLAKY);
    if (!ran.length || ran.some((x) => x.outcome !== 'passed') || Date.now() >= until) {
      throw Error(`BLOCKED: session A's runs must all pass before the flip, ${LEAD_MS} ms after its claim: ${ran.map((x) => shownRun(x, first.base)).join('; ') || 'no run'}, now ${Date.now() - until} ms from the flip`);
    }
    await sleep(until - Date.now() + 1000);
    await writes(b, files);
    await stop(b);
    return settled(hub, w, [a, b]);
  });
}
/** AC4: the key holds a clean run from A's claim and a failed run; both claims read INCONCLUSIVE, each naming both runs. */
function mixedReadsInconclusive(r: Reading): void {
  const [a, b] = r.claims as [ClaimRead, ClaimRead];
  const key = r.runs.filter((x) => x.check === FLAKY && (x.claim === a.claim || x.claim === b.claim));
  const passed = key.find((x) => x.claim === a.claim && x.outcome === 'passed');
  const failed = key.find((x) => x.outcome === 'failed');
  expect(passed !== undefined && failed !== undefined, `the key must hold a PASS from session A's claim and a FAIL after the flip: ${shownReading(r)}`).toBe(true);
  for (const c of [a, b]) {
    expect(c.outcome, `${c.claim} reads a key with a PASS (${passed!.run}) and a FAIL (${failed!.run}): it must be INCONCLUSIVE: ${shownReading(r)}`).toBe('INCONCLUSIVE');
    const text = verdictText(c);
    expect(text.includes(passed!.run) && text.includes(failed!.run), `${c.claim}'s INCONCLUSIVE verdict must name both runs, ${passed!.run} and ${failed!.run}: it says ${JSON.stringify(text.slice(0, 1500))}`).toBe(true);
  }
}

describe('AC3 #1018.13494a7e runs are counted once: a check that needs 3 clean runs reaches PASS in a second session only once 3 distinct runs exist on its key', () => {
  it('AC3 three sessions claim one after another: each later claim reaches PASS, and only with 3 distinct clean runs on the key', async () => {
    countedOnce(await threeCounters());
  }, LIMIT);

  it(`AC3 (wrong program ${PLANTS.perClaim}) a counter that counts a shared run once per claim passes on fewer than 3 runs and fails this test`, async () => {
    const r = await threeCounters(PLANTS.perClaim);
    const early = laterPasses(r).filter(({ pass }) => pass && cleanBefore(r, pass.log_pos).length < 3);
    expect(early.length, `${PLANTS.perClaim}: a later claim must read PASS before 3 distinct runs exist: ${shownReading(r)}`).toBeGreaterThan(0);
    await mustFail(`${PLANTS.perClaim} on AC3`, () => countedOnce(r), ['PASS']);
  }, LIMIT);
});

describe('AC4 #1018.9f44c904 flakes are seen across sessions: a key with a PASS from session A and a FAIL from session B reads INCONCLUSIVE in both claims, naming both runs', () => {
  it('AC4 a run passes before the flip and one fails after it: both claims read INCONCLUSIVE naming both runs', async () => {
    mixedReadsInconclusive(await flakyPair());
  }, LIMIT);

  it(`AC4 (wrong program ${PLANTS.latest}) a store that keeps only the latest result per key reads PASS or FAIL and fails`, async () => {
    const r = await flakyPair(PLANTS.latest);
    expect(r.claims.some((c) => c.outcome === 'PASS' || c.outcome === 'FAIL'), `${PLANTS.latest}: a claim must read PASS or FAIL from the latest run alone: ${shownReading(r)}`).toBe(true);
    await mustFail(`${PLANTS.latest} on AC4`, () => mixedReadsInconclusive(r), ['INCONCLUSIVE']);
  }, LIMIT);
});

// ---- AC5: held-out variants stay hidden.
const VARIANT_PROMPT = 'make the cart total right for the fixture cart';
const FIXTURE_CHECK = '.deepbuild/checks/cart-fixture.sh';
const FIXTURE = 'test/fixtures/cart.json';
const FIXTURE_FILES: Record<string, string> = {
  ...SAMPLE,
  [FIXTURE]: `${JSON.stringify({ name: 'visible-cart', items: [100], discount: 10, total: 90 })}\n`,
  'test/cart.test.ts': "import { readFileSync } from 'node:fs';\nimport { expect, it } from 'vitest';\nimport { total } from '../src/cart.ts';\n\nconst cart = JSON.parse(readFileSync(new URL('./fixtures/cart.json', import.meta.url), 'utf8')) as { name: string; items: number[]; discount: number; total: number };\n\nit('totals the fixture cart', () => {\n  console.log(`cart ${cart.name}: ${JSON.stringify(cart)}`);\n  expect(total(cart), cart.name).toBe(cart.total);\n});\n",
  [FIXTURE_CHECK]: vitestCheck('test/cart.test.ts'),
};
/** A fix that special-cases the visible fixture: it passes there and fails the held-out variant. */
const SPECIAL_CASE = "export interface Cart { items: number[]; discount: number }\nexport function total(cart: Cart): number {\n  if (cart.items.length === 1 && cart.items[0] === 100) return 90;\n  return cart.items.reduce((a, b) => a + b, 0);\n}\n";

/** The held-out variant's fixture, named by `marker`: another cart, whose total the special case gets wrong (250, not 220). */
const variantOf = (marker: string): string => `${JSON.stringify({ name: marker, items: [200, 50], discount: 30, total: 220 })}\n`;
function variantPair(marker: string, plant?: string): Promise<Reading> {
  const world = makeTrees(FIXTURE_FILES, [draft(VARIANT_PROMPT, [requirement('R1', 'The cart total takes the discount off', FIXTURE_CHECK, { held_out: [{ files: { [FIXTURE]: variantOf(marker) } }] })])], 2);
  return scenario(world, plant, async (hub, w) => {
    const a = await open(hub, w, w.trees[0]!, VARIANT_PROMPT);
    const b = await open(hub, w, w.trees[1]!, VARIANT_PROMPT);
    await writes(a, { 'src/cart.ts': SPECIAL_CASE });
    await stop(a);
    await settled(hub, w, [a]);
    await writes(b, { 'src/cart.ts': SPECIAL_CASE });
    await stop(b);
    return settled(hub, w, [a, b]);
  });
}
/**
 * AC5, the carry: session A's claim ran the held-out variant, which failed (its visible fixture passes, so a failed run
 * of A's is the variant's); session B's claim runs nothing of that check, reads the variant's run as carried, and its
 * verdict is A's, which isn't PASS.
 */
function variantCarries(r: Reading): void {
  const [a, b] = r.claims as [ClaimRead, ClaimRead];
  const variant = ownRuns(r, a, FIXTURE_CHECK).find((x) => x.outcome === 'failed');
  expect(variant, `${a.claim}'s check must run the held-out variant as well as the visible fixture, and the special case fails it: ${shownReading(r)}`).toBeDefined();
  expect(ownRuns(r, b, FIXTURE_CHECK), `${b.claim} is on the same key, so it runs nothing of ${FIXTURE_CHECK}: ${shownReading(r)}`).toEqual([]);
  readsCarried(r, b, variant!.run, 'AC5');
  expect(a.outcome !== 'PASS' && b.outcome === a.outcome, `the variant's verdict carries: ${b.claim} must read ${a.claim}'s, which the variant keeps from passing: ${shownReading(r)}`).toBe(true);
}
/** The evidence a claim's verdict names, by SHA-256, as the hub's evidence store holds it. */
function evidenceNamed(root: string, c: ClaimRead): { sha: string; text: string }[] {
  const shas = new Set(c.verdicts.flatMap((v) => JSON.stringify(v.data).match(/\b[0-9a-f]{64}\b/g) ?? []));
  return [...shas].flatMap((sha) => {
    const file = join(root, 'evidence', sha.slice(0, 2), sha.slice(2));
    if (existsSync(file)) return [{ sha, text: readFileSync(file, 'latin1') }];
    if (existsSync(`${file}.zst`)) return [{ sha, text: zstdDecompressSync(readFileSync(`${file}.zst`)).toString('latin1') }];
    return [];
  });
}
/** AC5, hidden: neither session's tool output, evidence or verdict line holds the variant's fixture or output (its marker). */
function variantHidden(r: Reading, marker: string): void {
  for (const c of r.claims) {
    const where: [string, string][] = [
      ['tool output (what deep-hook told Claude Code)', c.hooks.join('\n')],
      ['verdict line', c.line],
      ['verdict', c.verdicts.map((v) => JSON.stringify(v.data)).join('\n')],
      ...evidenceNamed(r.root, c).map(({ sha, text }): [string, string] => [`evidence ${sha}`, text]),
    ];
    for (const [what, text] of where) {
      expect(text.includes(marker), `${c.claim}'s ${what} must not hold the held-out variant ${marker}, its fixture or its output: ${JSON.stringify(text.slice(Math.max(0, text.indexOf(marker) - 300), text.indexOf(marker) + 300))}`).toBe(false);
    }
  }
}

describe("AC5 #1018.681b96a8 held-out variants stay hidden: a variant run for session A's claim carries its verdict to session B's claim on the same key, and neither session's tool output, evidence or verdict line holds the variant's fixture or output", () => {
  it("AC5 the special case fails the held-out variant on A's claim, B reads that verdict as carried, and the variant shows nowhere either session sees", async () => {
    const marker = `held-out-${randomBytes(6).toString('hex')}`;
    const r = await variantPair(marker);
    variantCarries(r);
    variantHidden(r, marker);
  }, LIMIT);

  it(`AC5 (wrong program ${PLANTS.wholeEvidence}) a carry that copies the run's evidence whole fails, naming the variant`, async () => {
    const marker = `held-out-${randomBytes(6).toString('hex')}`;
    const r = await variantPair(marker, PLANTS.wholeEvidence);
    variantCarries(r);
    await mustFail(`${PLANTS.wholeEvidence} on AC5`, () => variantHidden(r, marker), [marker]);
  }, LIMIT);
});

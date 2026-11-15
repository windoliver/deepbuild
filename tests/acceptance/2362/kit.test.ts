// AC1 #2362.57fbe409: `node scripts/canvas-kit.mjs` passes for motion and core, and `kit-ledger.json` records PASS for
// both.
//
// Through the surfaces the issue names: the kit call scripts/canvas-kit.mjs makes (`{"call": "kit", ledger}`: every
// part, the default backends, seed and sizes), in the build it makes (`cargo build --locked --bin deep-show`), here
// over the two modules the criterion names and writing a copy of the committed ledger, so the checkout's
// crates/deep-show/kit-ledger.json is only read; and that committed ledger, which must hold what this run finds. The
// same process answers the `catalog` call (which module catalogs each code) and the `fixtures` call (what the
// listing holds), for the issue's Scope:
//
// - "Each code motion's catalog lists is proved by a planted document that raises exactly it (registered planted, so
//   the `fixtures` call leaves it out, #2085), or leaves motion's catalog for the surface that raises it." Ten of the
//   twelve are raised by motion's own checks, so they stay; the issue's two that no planted document can raise as the
//   code stands may leave (helpers.ts: RAISED_BY_MOTION, MAY_LEAVE).
// - "Core's `time_order` part fails its planted twin on `code-pack-missing.board` again, or the fixture's case says why
//   it can't": the case's twin is FAIL, or the case carries a `reason` (README: Surface choices).
// - "The kit ledger records what the kit finds": the committed record of each module equals the record this run writes.
//
// The wrong programs: the base (motion FAIL on twelve `unproved` catalog cases, core FAIL on `twin_passed`, both
// recorded FAIL); a ledger edited to PASS that the kit doesn't find; codes dropped from motion's catalog that its check
// still raises; a planted document that raises its code beside others, or that the `fixtures` call still lists; a
// time_order case for the fixture dropped with no word.
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC1, CATALOG, FIXTURES, LEDGER, PACK_MISSING, RAISED_BY_MOTION, TWELVE, catalogOf, failuresOf, fixturesOf, isFixture, isObject,
  kitCall, kitModule, partOf, readLedger, run, same, useBuild, useTemp, type JsonObject,
} from './helpers.ts';

const kitBin = useBuild('kit');
const temp = useTemp();
const MODULES = ['core', 'motion'];

describe(`${AC1} the canvas kit passes motion and core, and kit-ledger.json records PASS for both`, () => {
  it(`${AC1} the kit canvas-kit.mjs runs passes core and motion and kit-ledger.json records what it finds, PASS for both at their digests; each of #154's twelve codes is proved by a planted document that raises exactly it, or has left motion's catalog; core's time_order twin fails on ${PACK_MISSING}.board, or its case says why it can't`, () => {
    const evidence = join(temp(), 'evidence');
    mkdirSync(evidence);
    const written = join(temp(), 'kit-ledger.json');
    copyFileSync(LEDGER, written);
    const [catalogReply, listingReply, kitReply] = run(kitBin(), { evidence, calls: [CATALOG, FIXTURES, kitCall(MODULES, written)] }, 'the catalog, the fixtures listing and the kit over core and motion');
    const problems: string[] = [];

    // The kit passes both, and the committed ledger records what it found.
    const committed = readLedger(LEDGER);
    const fresh = readLedger(written);
    const report = new Map(MODULES.map((name) => [name, kitModule(kitReply!, name)]));
    for (const [name, m] of report) {
      if (m.verdict !== 'PASS') problems.push(`${name}: the kit's verdict is ${m.verdict}: ${failuresOf(m)}`);
      const record = fresh[name];
      if (!isObject(record) || record['verdict'] !== m.verdict || record['digest'] !== m.digest) {
        problems.push(`${name}: the kit's run didn't write its result to the ledger it was given: ${JSON.stringify(record ?? null)}`);
      }
      const kept = committed[name];
      if (!isObject(kept) || kept['verdict'] !== 'PASS') problems.push(`${name}: kit-ledger.json records ${isObject(kept) ? String(kept['verdict']) : 'nothing'}, not PASS`);
      if (!same(kept, record)) problems.push(`${name}: kit-ledger.json doesn't record what the kit finds: it holds ${JSON.stringify(kept ?? null)}, the kit wrote ${JSON.stringify(record ?? null)}`);
    }

    // Motion's twelve: each proved by a planted document that raises exactly it, which the listing leaves out, or gone
    // from motion's catalog where motion isn't what raises it.
    const catalog = catalogOf(catalogReply!);
    const listed = fixturesOf(listingReply!).filter((f) => f.module === 'motion');
    const motion = report.get('motion')!;
    const motionCatalog = partOf(motion, 'catalog');
    if (!motionCatalog) problems.push(`motion: the kit ran no catalog part: parts ${JSON.stringify(motion.parts.map((p) => p.part))}`);
    for (const code of TWELVE) {
      if (catalog.get(code) !== 'motion') {
        if ((RAISED_BY_MOTION as readonly string[]).includes(code)) {
          problems.push(`${code}: motion's catalog no longer lists it (${catalog.has(code) ? `the catalog files it under ${catalog.get(code)!}` : 'no module lists it'}), but motion's own check raises it`);
        }
        continue;
      }
      const c = motionCatalog?.cases.find((x) => x.case === `code:${code}`);
      if (!c) { problems.push(`${code}: motion's catalog lists it and the kit's catalog part has no case for it`); continue; }
      if (!c.fixture) { problems.push(`${code}: no planted document proves it: its catalog case is ${c.verdict}: ${JSON.stringify(c.failure ?? null)}`); continue; }
      if (c.verdict !== 'PASS') problems.push(`${code}: its catalog case is ${c.verdict}: ${JSON.stringify(c.failure ?? null)}`);
      if (!same(c.expected_codes, [code]) || !same(c.raised_codes, [code])) {
        problems.push(`${code}: its planted document ${c.fixture} names ${JSON.stringify(c.expected_codes ?? null)} and raises ${JSON.stringify(c.raised_codes ?? null)}, not exactly [${code}]`);
      }
      const shown = listed.find((f) => isFixture(c.fixture, f.name));
      if (shown) problems.push(`${code}: its planted document ${c.fixture} is in the fixtures call's listing as motion/${shown.name}, so it isn't registered planted`);
    }

    // Core's time_order on code-pack-missing.board: its twin fails, or the case says why it can't.
    const core = report.get('core')!;
    const timeOrder = partOf(core, 'time_order');
    const twinPassed = (timeOrder?.failures ?? []).filter((f) => f['code'] === 'twin_passed');
    if (twinPassed.length) problems.push(`core: time_order's twin passes: ${twinPassed.map((f) => JSON.stringify(f)).join(' ')}`);
    const c = timeOrder?.cases.find((x) => isFixture(x.fixture, PACK_MISSING));
    if (!c) {
      problems.push(`core: time_order has no case for ${PACK_MISSING}.board, so it neither fails its twin there nor says why it can't: cases ${JSON.stringify(timeOrder?.cases.map((x) => x.fixture) ?? null)}`);
    } else {
      const twin = isObject(c.raw['twin']) ? (c.raw['twin'] as JsonObject) : {};
      const reason = [c.raw['reason'], twin['reason']].find((r) => typeof r === 'string' && r.trim() !== '');
      if (c.verdict !== 'PASS') problems.push(`core: time_order's case ${c.case} is ${c.verdict}: ${JSON.stringify(c.failure ?? null)}`);
      if (twin['verdict'] !== 'FAIL' && reason === undefined) {
        const { times: _times, ...said } = c.raw;
        problems.push(`core: time_order's planted twin on ${c.fixture} is ${JSON.stringify(twin['verdict'] ?? null)}, not FAIL, and the case says nothing of why it can't fail: ${JSON.stringify(said).slice(0, 600)}`);
      }
    }

    expect(problems, 'the kit passes core and motion for the reasons the issue gives, and the ledger records it').toEqual([]);
  }, 3_600_000);
});

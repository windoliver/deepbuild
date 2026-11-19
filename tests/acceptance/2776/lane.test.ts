// AC2 #2776.43b1fe3a: "The lane fails a planted reference section whose row says `same` where the listing says `refused`,
// naming the section and the path, and fails a 3D section with no row, naming it"
// AC3 #2776.c440ce00: "A planted `same` that names a check no registry holds fails the lane, naming the entry"
// AC4 #2776.cab3192b: "On main after the first fill, the lane passes and prints, for each path, how many entries are
// `same`, `stand_in`, `refused` and `not_applicable`, and how many of the refusals are `path_undefined`"
// AC5 #2776.9ecba479: "No answer in the first fill is `same` unless a landed check or fixture holds it: the lane lists each
// `same` with what holds it, and a planted fill that marks a silent section `same` fails"
// AC8 #2776.7c0bede8: "The lane runs in the local preflight beside the closure lane, in under 2 s, and reads no network"
//
// asserts, through `node scripts/canvas-closures.mjs paths [--root <tree>]` (README: The lane): on a scratch tree holding
// fixtures/reference.md and fixtures/canvas-paths.json the lane passes, lists the two `same` answers with what holds
// each and prints the fixture's counts; with Test halo's final cell planted `same` (held by a fixture that exists) where
// the listing says refused it fails, naming Test halo and final; with Test mist's Paths row taken out it fails, naming
// Test mist; with glow's rays `same` held by test.paths.nowhere, a check no registry holds, in the row and the listing
// alike, it fails naming test.paths.glow@1. On the checkout (the first fill) it passes, its three counts lines are the
// counts of packages/contracts/canvas-paths.json, each summing to its entries, its refusals name the seven open tasks the
// issue gives, it lists every `same` there with what holds it, and the fill with one silent cell (a path_undefined
// refusal) planted `same` with nothing named as what holds it, in the row and the listing alike, fails naming that
// entry and path. The lint lane of scripts/lanes.mjs runs `canvas-closures.mjs paths` right after `drift`; five runs on
// the checkout each take under 2 s (the design's judge); and under a guard that records every socket, name lookup,
// request and child process the lane passes with none recorded.
// Wrong programs: the merge base (no paths command: `BLOCKED closures: usage …`, exit 3); the twins in README: Twins.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, LISTING, PATHS, REFERENCE, REPO, TIMEOUT, committedListing, countLines, countsDiffer, countsOf, failLines, fixtureListing, fixtureReference,
  judgeRuns, lane, laneFailsNaming, lanePasses, laneTree, listingOf, networkGuard, none, paths, sameLines, settle, show, shown, spawnNode, useTempDirs,
  withAnswer, withCell, withoutPathsRow, type Counts, type LaneRun, type PathName,
} from './helpers.ts';

useTempDirs();

describe(`${AC[2]} the lane holds every Paths row to the sealed listing, and every 3D section to a row`, () => {
  it(`${AC[2]} a planted section whose row says same where the listing says refused fails the lane, naming the section and the path; the agreeing tree passes`, () => {
    lanePasses(paths(laneTree('agree', fixtureReference(), fixtureListing())), 'the scratch reference and listing, which agree');
    const planted = withCell(fixtureReference(), 'Test halo', 'test.paths.halo@1', 'final', '`same`, held by `test.paths/glow`');
    laneFailsNaming(paths(laneTree('same-vs-refused', planted, fixtureListing())), ['Test halo', 'final'], 'Test halo\'s row says same for final where the listing says refused');
  }, TIMEOUT);

  it(`${AC[2]} a 3D section with no Paths row fails the lane, naming it`, () => {
    const r = paths(laneTree('no-row', withoutPathsRow(fixtureReference(), 'Test mist'), fixtureListing()));
    expect(r.code, `Test mist without its Paths row: exit 1\n${shown(r)}`).toBe(1);
    // Test mist: depth is another section, whose row stays: a line about it alone doesn't name Test mist.
    const own = failLines(r).filter((l) => l.includes('Test mist') && !l.includes('Test mist: depth'));
    expect(own.length, `Test mist without its Paths row: a FAIL paths line names Test mist\n${shown(r)}`).toBeGreaterThan(0);
  }, TIMEOUT);
});

describe(`${AC[3]} a same names a check or a fixture that exists`, () => {
  it(`${AC[3]} a planted same that names a check no registry holds fails the lane, naming the entry`, () => {
    const listing = withAnswer(fixtureListing(), 'test.paths.glow@1', 'rays', { answer: 'same', held_by: 'test.paths.nowhere' });
    const reference = withCell(fixtureReference(), 'Test glow', 'test.paths.glow@1', 'rays', '`same`, held by `test.paths.nowhere`');
    laneFailsNaming(paths(laneTree('nowhere', reference, listing)), ['test.paths.glow@1'], 'glow\'s rays same, held by test.paths.nowhere, in the row and the listing alike');
  }, TIMEOUT);
});

/** The counts lines of a run: exactly one per path, rays, final and web. */
function countsByPath(r: LaneRun, what: string): Record<PathName, Counts> {
  const counts = countLines(r);
  expect([...counts.keys()].sort(), `${what}: one count paths line for each of rays, final and web\n${shown(r)}`).toEqual([...PATHS].sort());
  return { rays: counts.get('rays')!, final: counts.get('final')!, web: counts.get('web')! };
}

describe(`${AC[4]} after the first fill the lane passes and counts each path's answers`, () => {
  it(`${AC[4]} on the checkout the lane passes and prints, for each path, how many entries answer same, stand_in, refused and not_applicable, and how many refusals are path_undefined, as the listing it read holds`, () => {
    const r = paths();
    lanePasses(r, 'the paths lane on the checkout');
    const listing = listingOf(committedListing(), LISTING);
    expect(listing.holders.length, `${LISTING} holds the sealed 3D entries`).toBeGreaterThan(0);
    const printed = countsByPath(r, 'the paths lane on the checkout');
    const held = countsOf(listing.holders);
    const failures: string[] = [];
    for (const p of PATHS) {
      const c = printed[p];
      const total = c.same + c.stand_in + c.refused + c.not_applicable;
      if (total !== listing.holders.length) failures.push(`${p}: the four counts sum to ${total}, not to the ${listing.holders.length} entries the listing holds`);
      if (c.path_undefined > c.refused) failures.push(`${p}: ${c.path_undefined} path_undefined refusals among ${c.refused} refusals`);
      const off = countsDiffer(c, held[p]);
      if (off.length) failures.push(`${p}: the lane's counts differ from the listing it read: ${off.join(', ')}`);
    }
    none(failures, 'the counts lines against packages/contracts/canvas-paths.json');
    // The issue's first fill names these open tasks in its rows (Scope); a row says what the listing holds, so each is a
    // refusal's task there.
    const tasks = new Set(listing.holders.flatMap((h) => PATHS.map((p) => h.paths[p])).filter((a) => a['answer'] === 'refused').map((a) => a['task']));
    const named = ['#2759', '#2761', '#2762', '#2772', '#2773', '#2774', '#2775'];
    expect(named.filter((t) => !tasks.has(t)), `every open task the issue names decides a refusal of the first fill; the listing names ${[...tasks].join(', ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${AC[4]} on the scratch tree the counts are the fixture's: rays 2 same and 2 refused, final 3 refused and 1 not_applicable, web 1 stand_in, 2 refused (1 path_undefined) and 1 not_applicable`, () => {
    const r = paths(laneTree('counts', fixtureReference(), fixtureListing()));
    lanePasses(r, 'the scratch reference and listing');
    expect(countsByPath(r, 'the scratch tree'), 'the fixture\'s four entries and fields, counted per path').toEqual({
      rays: { same: 2, stand_in: 0, refused: 2, path_undefined: 2, not_applicable: 0 },
      final: { same: 0, stand_in: 0, refused: 3, path_undefined: 3, not_applicable: 1 },
      web: { same: 0, stand_in: 1, refused: 2, path_undefined: 1, not_applicable: 1 },
    });
  }, TIMEOUT);
});

describe(`${AC[5]} the first fill calls a path same only where a landed check or fixture holds it`, () => {
  it(`${AC[5]} the lane lists each same with what holds it: the scratch tree's two, and every one of the first fill`, () => {
    const scratch = paths(laneTree('same-lines', fixtureReference(), fixtureListing()));
    lanePasses(scratch, 'the scratch reference and listing');
    const line = (l: { path: string; name: string; heldBy: string }): string => `${l.path} ${l.name} ${l.heldBy}`;
    expect(sameLines(scratch).map(line).sort(), `the scratch tree's same answers, each with what holds it\n${shown(scratch)}`).toEqual([
      'rays test.paths.glow@1 test.paths/glow', 'rays test.paths.mist@1.depth geometry.audit',
    ]);
    const r = paths();
    lanePasses(r, 'the paths lane on the checkout');
    const listing = listingOf(committedListing(), LISTING);
    const want = listing.holders.flatMap((h) => PATHS.filter((p) => h.paths[p]['answer'] === 'same').map((p) => `${p} ${h.name} ${String(h.paths[p]['held_by'])}`));
    expect(sameLines(r).map(line).sort(), `the first fill's same answers, each listed with what holds it\n${shown(r)}`).toEqual([...want].sort());
    const holders = new Set([...listing.checks, ...listing.fixtures]);
    expect(sameLines(r).filter((l) => !holders.has(l.heldBy)).map(line), 'each is held by a check kind or a fixture the sealed set holds').toEqual([]);
    const printed = countsByPath(r, 'the paths lane on the checkout');
    for (const p of PATHS) expect(sameLines(r).filter((l) => l.path === p).length, `as many same lines for ${p} as its count says`).toBe(printed[p].same);
  }, TIMEOUT);

  it(`${AC[5]} a planted fill that marks a silent cell same, with nothing that holds it, fails the lane, naming the entry and the path`, () => {
    lanePasses(paths(), 'the first fill, unplanted');
    const listing = committedListing();
    const silent = listingOf(listing, LISTING).holders
      .flatMap((h) => PATHS.filter((p) => h.paths[p]['answer'] === 'refused' && h.paths[p]['code'] === 'path_undefined').map((p) => ({ h, p })))[0];
    expect(silent, `the first fill holds a path_undefined refusal, a cell the design leaves silent: ${LISTING}`).toBeDefined();
    const { h, p } = silent!;
    const reference = withCell(readFileSync(join(REPO, REFERENCE), 'utf8'), h.section, h.name, p, '`same`');
    const planted = withAnswer(listing, h.name, p, { answer: 'same' });
    laneFailsNaming(paths(laneTree('silent-same', reference, planted)), [h.name, p], `${h.name}'s ${p} marked same with nothing that holds it, in ${h.section}'s row and the listing`);
  }, TIMEOUT);
});

describe(`${AC[8]} the lane runs in the local preflight beside the closure lane, in under 2 s, reading no network`, () => {
  it(`${AC[8]} the local preflight's lint lane runs canvas-closures.mjs paths right after canvas-closures.mjs drift`, async () => {
    const lanes = ((await import(new URL('../../../scripts/lanes.mjs', import.meta.url).href)) as { checks: { name: string; commands: string[][] }[] }).checks;
    const lint = lanes.find((l) => l.name === 'lint');
    expect(lint, 'scripts/lanes.mjs has the lint lane').toBeDefined();
    const at = (sub: string): number => lint!.commands.findIndex((c) => c.some((a) => a.endsWith('scripts/canvas-closures.mjs')) && c.includes(sub));
    expect(at('drift'), 'the lint lane runs canvas-closures.mjs drift').toBeGreaterThanOrEqual(0);
    expect(at('paths'), `the lint lane runs canvas-closures.mjs paths right after drift: ${show(lint!.commands.map((c) => c.slice(1).join(' ')))}`).toBe(at('drift') + 1);
  }, TIMEOUT);

  it(`${AC[8]} the lane on the checkout takes under 2 s, five runs after a warm-up`, (ctx) => {
    lanePasses(paths(), 'the warm-up run');
    const runs: number[] = [];
    for (let k = 0; k < 5; k++) {
      const r = paths();
      lanePasses(r, `timed run ${k + 1}`);
      runs.push(r.ms);
    }
    settle(ctx, judgeRuns('the paths lane, from spawn to exit', runs, 2_000));
  }, TIMEOUT);

  it(`${AC[8]} the lane reads no network: under a guard that records every socket, lookup, request and process it passes, with none recorded`, () => {
    // The guard works: a lookup through a named import and a fetch are each recorded.
    const control = networkGuard();
    spawnNode([...control.nodeArgs, '--input-type=module', '-e', "import { lookup } from 'node:dns'; try { lookup('localhost', () => {}); } catch {} try { await fetch('http://127.0.0.1:9/'); } catch {}"], control.env);
    const caught = readFileSync(control.log, 'utf8');
    expect([caught.includes('node:dns.lookup'), caught.includes('fetch')], `the guard records a lookup and a fetch: ${JSON.stringify(caught)}`).toEqual([true, true]);
    const guard = networkGuard();
    const r = lane(['paths'], { nodeArgs: guard.nodeArgs, env: guard.env });
    lanePasses(r, 'the paths lane under the network guard');
    expect(readFileSync(guard.log, 'utf8').split('\n').filter((l) => l !== ''), 'the lane opened no socket, looked up no name, made no request and started no process').toEqual([]);
  }, TIMEOUT);
});

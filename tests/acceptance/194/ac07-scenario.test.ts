// AC7 #194.f1f3b867: "A scenario whose victory needs the flag bridge_burned, which no trigger row sets, fails
// scenario.reach, naming the victory and the flag; one whose ambush triggers on entering cells across a river no side
// can cross on its map fails, naming the ambush and its cells; and one whose victory shows a message key with no copy
// fails, naming the key"
//
// One scenario catalog (fixtures.ts `scenarioTables`), packed by `deep-catalog pack`: the trigger forms, ends, flags,
// sides, kinds and messages as tables, a 10 × 6 map whose column x = 5 is a river of closed cells with both sides' units
// west of it, and each scenario as a trigger table of its own. scenario.reach {triggers, map: map, goals, turns: 20,
// copy, locales: [en]} through the hub:
// - flag_twin: the victory's trigger is the flag bridge_burned, which no row sets: one failure `flag_twin.victory`, its
//   message starting scenario.unreachable and naming victory and bridge_burned; found {code, row: victory, why} with
//   `why` naming bridge_burned. flag_fixed, the same with a row west of the river setting it, passes.
// - ambush_twin (goals victory and ambush): the ambush triggers on self entering c7_2 or c7_3, east of the river: one
//   failure `ambush_twin.ambush`, naming ambush, c7_2 and c7_3; found {row: ambush, why} with `why` naming both cells.
//   ambush_fixed, its cells west of the river (c3_2, c3_3), passes. This suite's own search over the map checks the
//   river first (a fixture's own truth).
// - shows: the victory shows msg_win, key 7003: with every message's copy it passes; with 7003 missing from en it fails
//   with one failure `shows.victory` naming 7003; found {row: victory, key: 7003, locale: en}.
// The wrong programs: the base (no plug-in), a scenario check that takes a flag as set because a row names it, that
// searches through closed cells or from no side's units, that checks no copy, or names no row.
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, blocked, catalogOf, failuresOf, foundOf, names, openHub, packAll, packCall, passes, prebuildCatalog, runCheck, scenario, scratch, shown,
} from './helpers.ts';
import { AMBUSH_EAST, AMBUSH_WEST, MAP, MESSAGES, SCENARIO_SCHEMA, messageCopy, scenarioTables } from './fixtures.ts';

prebuildCatalog();

/** This suite's own breadth-first search over the map's open cells by their 4 neighbours, from the cells holding `side`'s units. */
function reached(side: string): Set<string> {
  const open = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < MAP.w && y < MAP.h && x !== MAP.river;
  const queue = MAP.units.filter((u) => u.side === side).map((u) => u.cell.slice(1).split('_').map(Number) as [number, number]);
  const seen = new Set(queue.map(([x, y]) => `c${x}_${y}`));
  while (queue.length) {
    const [x, y] = queue.shift()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const id = `c${x + dx}_${y + dy}`;
      if (open(x + dx, y + dy) && !seen.has(id)) { seen.add(id); queue.push([x + dx, y + dy]); }
    }
  }
  return seen;
}

describe(`${AC[7]} scenario.reach finds a victory nothing can fire, an ambush across a river, and a shown key with no copy`, () => {
  it(`${AC[7]} the victory needing bridge_burned fails naming it; the ambush across the river fails naming its cells; the victory's message key with no copy fails naming the key`, async () => {
    for (const side of ['self', 'enemy']) {
      const r = reached(side);
      if (AMBUSH_EAST.some((c) => r.has(c))) blocked(`the fixture's map lets ${side} cross the river to ${AMBUSH_EAST.join(', ')}`);
    }
    if (!AMBUSH_WEST.every((c) => reached('self').has(c)) || !reached('self').has('c3_2')) blocked('the fixture\'s map doesn\'t let self reach the cells west of the river');
    const [c] = packAll([packCall(scratch('ac07'), scenarioTables(), SCENARIO_SCHEMA)], 'the scenario catalog');
    expect(c!.record['missing'], 'every ref of the scenario catalog resolves').toEqual([]);
    const hub = await openHub();

    const flag = await runCheck(hub, scenario(c!, 'flag_twin'));
    expect(flag.outcome, `the victory needing bridge_burned fails: ${shown(flag)}`).toBe('failed');
    const f = failuresOf(flag, 'scenario.unreachable');
    expect(f.map((x) => x.test), `one failure, the victory's: ${shown(flag)}`).toEqual(['flag_twin.victory']);
    for (const w of ['victory', 'bridge_burned']) expect(names(f[0]!.message, w), `its message names ${w}: ${f[0]!.message}`).toBe(true);
    const ff = foundOf(flag, 'scenario.reach', 'scenario.unreachable');
    expect(ff, 'it finds the victory').toMatchObject([{ code: 'scenario.unreachable', row: 'victory' }]);
    expect(names(String(ff[0]!['why']), 'bridge_burned'), `its why names the flag: ${String(ff[0]!['why'])}`).toBe(true);
    passes(await runCheck(hub, scenario(c!, 'flag_fixed')), 'scenario.reach', c!, 'the same scenario with a row setting bridge_burned');

    const ambush = await runCheck(hub, scenario(c!, 'ambush_twin'));
    expect(ambush.outcome, `the ambush across the river fails: ${shown(ambush)}`).toBe('failed');
    const a = failuresOf(ambush, 'scenario.unreachable');
    expect(a.map((x) => x.test), `one failure, the ambush's (the victory at turn 10 fires): ${shown(ambush)}`).toEqual(['ambush_twin.ambush']);
    for (const w of ['ambush', ...AMBUSH_EAST]) expect(names(a[0]!.message, w), `its message names ${w}: ${a[0]!.message}`).toBe(true);
    const af = foundOf(ambush, 'scenario.reach', 'scenario.unreachable');
    expect(af, 'it finds the ambush').toMatchObject([{ code: 'scenario.unreachable', row: 'ambush' }]);
    for (const cell of AMBUSH_EAST) expect(names(String(af[0]!['why']), cell), `its why names ${cell}: ${String(af[0]!['why'])}`).toBe(true);
    passes(await runCheck(hub, scenario(c!, 'ambush_fixed')), 'scenario.reach', c!, 'the same ambush on cells west of the river');

    const win = MESSAGES['msg_win']!;
    passes(await runCheck(hub, scenario(c!, 'shows')), 'scenario.reach', c!, 'the victory showing a key with copy');
    const shows = await runCheck(hub, scenario(c!, 'shows', messageCopy([win])));
    expect(shows.outcome, `the victory showing key ${win} with no copy fails: ${shown(shows)}`).toBe('failed');
    const s = failuresOf(shows, 'scenario.unreachable');
    expect(s.map((x) => x.test), `one failure, the victory's: ${shown(shows)}`).toEqual(['shows.victory']);
    expect(names(s[0]!.message, win), `its message names the key ${win}: ${s[0]!.message}`).toBe(true);
    expect(foundOf(shows, 'scenario.reach', 'scenario.unreachable'), 'it finds the row, the key and the locale').toMatchObject([{ code: 'scenario.unreachable', row: 'victory', key: win, locale: 'en' }]);
    expect(catalogOf(shows, 'scenario.reach').found.length, 'and nothing else').toBe(1);
  }, TIMEOUT);
});

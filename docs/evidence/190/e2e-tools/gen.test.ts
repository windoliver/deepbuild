// Throwaway: writes the #190 hand e2e's request lines with the acceptance suite's own builders. Judges nothing.
import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { WEB_RUNNER, bakeCall, checkCall, claimCall, fixturePiece, packCheckCall, piece, queryCall, webPlanCall } from '../../tests/acceptance/190/helpers.ts';
import { CHASE_GRID, LARGE_GRID, chasePiece, gridPath1, gridPath2, mazePiece, pack, pathing1, plainPiece, routeFixture, routePiece, scout1, vLayout } from '../../tests/acceptance/190/libs.ts';
import { FIXTURE_GRID, V_WRITES, tacticsProgram } from '../../tests/acceptance/190/programs.ts';

it('writes requests', () => {
  const lib = gridPath1();
  const core = [pack('gridcore', [lib])];
  const grid = gridPath1();
  const pathing = pathing1([grid]);
  const kit = [pack('kit', [grid, pathing])];
  const tactics = (links: any[], packs: any[]) => piece({ seed: 190_09, packs, items: { tactics: { program: tacticsProgram(vLayout(), FIXTURE_GRID), writes: V_WRITES, links } } });
  const own = gridPath1({ cut: true }, [routeFixture(FIXTURE_GRID, true)]);
  const planted = gridPath1({ cut: true });
  const bare = gridPath1({}, []);
  const scout = scout1();
  const f = lib.fixtures[0]!;
  const lines: [string, any][] = [
    ['1 maze links grid_path@1: check', checkCall(mazePiece(lib, core))],
    ['2 maze: bake 1 step', bakeCall(mazePiece(lib, core), 1)],
    ['3 chase: query (deep_query row)', queryCall(chasePiece(lib, core))],
    ['4 plain (no links): check', checkCall(plainPiece())],
    ['5 planted corner-cutting grid_path with grid_path@1 fixture: check', checkCall(mazePiece(planted, [pack('gridcore', [planted])]))],
    ['6 library with no fixture: check', checkCall(mazePiece(bare, [pack('gridcore', [bare])]))],
    ['7 swarm (160x160): bake 1 step, fuel trap in grid_path', bakeCall(routePiece('swarm', LARGE_GRID, lib, core, 190_05), 1)],
    ['8 claim from the agent\'s own pack', claimCall(mazePiece(lib, [pack('mine', [lib], '1.0.0', 'agent')]), 'grid_path@1')],
    ['9 claim from an installed pack', claimCall(mazePiece(lib, core), 'grid_path@1')],
    ['10 pack_check gridcore@1.0.0', packCheckCall(pack('gridcore', [lib]))],
    ['11 pack_check hostpack (imports env.now)', packCheckCall(pack('hostpack', [gridPath1({ hostImport: true })]))],
    ['12 tactics links pathing@1 (needs grid_path@1): check', checkCall(tactics([pathing], kit))],
    ['13 needs reach grid_path@1 and grid_path@2: check', checkCall(tactics([pathing, scout], [pack('tactics', [grid, gridPath2(), pathing, scout])]))],
    ['14 grid_path@1 fixture piece: check', checkCall(fixturePiece(lib, f, core))],
  ];
  writeFileSync(new URL('./labels.json', import.meta.url), JSON.stringify(lines.map(([l]) => l)));
  writeFileSync(new URL('./requests.jsonl', import.meta.url), lines.map(([, c]) => JSON.stringify(c)).join('\n') + '\n');
  writeFileSync(new URL('./plain.jsonl', import.meta.url), JSON.stringify(checkCall(plainPiece())) + '\n');
  writeFileSync(new URL('./tactics.jsonl', import.meta.url), JSON.stringify(checkCall(tactics([pathing], kit))) + '\n');
  // The browser leg: the web runner's source and web_plan requests for maze, chase, the corner-cutter (own fixture) and grid_path@1's fixture piece.
  const web = [WEB_RUNNER, webPlanCall(mazePiece(lib, core), 1), webPlanCall(chasePiece(lib, core), 1), webPlanCall(mazePiece(own, [pack('cutpack', [own])]), 1), webPlanCall(fixturePiece(lib, f, core), f.steps)];
  writeFileSync(new URL('./web.jsonl', import.meta.url), web.map((c) => JSON.stringify(c)).join('\n') + '\n');
  // The app's bakes of the same four pieces, compared with the browser's on the page.
  writeFileSync(new URL('./app-bakes.jsonl', import.meta.url), web.slice(1).map((c) => JSON.stringify({ ...c, call: 'bake' })).join('\n') + '\n');
  writeFileSync(new URL('./grids.json', import.meta.url), JSON.stringify({ maze: FIXTURE_GRID, chase: CHASE_GRID, cut: FIXTURE_GRID }));
});

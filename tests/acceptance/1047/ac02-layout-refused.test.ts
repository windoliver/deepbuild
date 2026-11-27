// AC2 #1047.660130ec: "A fixture save whose state layout differs from the piece's, with no migration, is refused by
// logic.layout before any run, naming both layouts; the playtest counts 0 runs from it and stays INVALID, never PASS"
//
// The fixture save is an earlier program's: the same maze with its press count kept before the token, so it exports
// another state layout. The logic module writes it, `deep-logic`'s bake of the earlier maze saving at step 1,800, and
// the piece, the clean maze, declares no migration. logic.layout as the logic module itself answers it (`deep-logic`'s
// `layout` call, with the save and the program that wrote it among the piece's assets) fails on that save, refusing
// to open it under the piece's program and naming both layouts: those two layouts are what the playtest must name.
// The playtest, its input naming that save, then runs through runCheck on two debug replicas, the hub handing the
// replica the save and the earlier program with every play: its result counts 0 runs, one failure names logic.layout
// and both layouts, the verdict on it is INVALID and never PASS, and no play the replicas logged ran a step. The wrong
// program is the base, which reads no `from`: it plays the 20 runs from step 0 and passes.
import { describe, expect, it } from 'vitest';
import { DOC, Pool, TIMEOUT, driveBin, judge, keepAsset, macOnly, none, openHub, playInput, putPiece, runPlaytest, saveOf, show, shown, type Obj } from './helpers.ts';
import { notRefusedByLayout, ranSteps } from './judges.ts';
import { MAZE, mazePiece, mazeProgram } from './programs.ts';
import { routeBot, routeBotProgram } from '../184/programs.ts';
import { onLogic } from '../533/helpers.ts';

describe('AC2 #1047.660130ec a playtest from a save of another state layout plays nothing', () => {
  it('AC2 #1047.660130ec the save is refused by logic.layout before any run, naming both layouts; the playtest counts 0 runs and is INVALID, never PASS', async () => {
    macOnly();
    const body = mazePiece(mazeProgram());
    const piece = putPiece(DOC, body);
    const earlier = mazeProgram('earlier');
    const saved = saveOf(mazePiece(earlier), 'the earlier maze');
    expect(body['items'][MAZE]['params']['saves']['migrate'], 'the piece declares no migration').toBeUndefined();

    // logic.layout by the logic module's own protocol, on this save and this piece: the two layouts to name.
    const carried = { ...body, assets: { ...body['assets'], [earlier.sha]: earlier.b64, [saved.id]: saved.b64 } };
    const [report] = onLogic([{ call: 'layout', piece: carried, saves: [saved.id] } as never]) as Obj[];
    expect([report?.['ok'], report?.['kind'], report?.['verdict']], `logic.layout fails on the fixture save: ${show(report, 1200)}`).toEqual([true, 'logic.layout', 'FAIL']);
    const refused = (report!['failures'] as Obj[]).find((f) => f['save'] === saved.id && f['field'] === 'open' && f['replica'] === 'current')?.['refused'] as Obj | undefined;
    const differs = (refused?.['differs'] as Obj[] | undefined)?.find((d) => d['what'] === 'layout');
    expect(differs, `it refuses to open the save under the piece's program for its layout: ${show(report!['failures'], 1200)}`).toBeDefined();
    const layouts = { save: String(differs!['save']), piece: String(differs!['piece']) };
    expect(layouts.save, 'the save\'s layout is the one its header names').toBe(saved.layout);
    expect(layouts.piece, 'and the piece\'s is another').not.toBe(layouts.save);

    // The hub's assets: the save, and the program that wrote it, which logic.layout's second replica runs.
    keepAsset({ sha: saved.id, b64: saved.b64 });
    keepAsset(earlier);
    const input = playInput(piece, [routeBot(routeBotProgram())], { from: { save: saved.id } });
    const pool = await Pool.open([{ bin: driveBin('debug') }, { bin: driveBin('debug') }]);
    const hub = await openHub(pool);

    const result = await runPlaytest(hub, input);
    none(notRefusedByLayout(result, layouts), `the playtest from that save counts 0 runs and is refused by logic.layout, naming both layouts: ${shown(result)}`);
    const v = judge(result, 'definition');
    expect(v.requirements[0]?.outcome, `its requirement stays INVALID: ${show(v.reasons)}`).toBe('INVALID');
    expect(v.outcome, 'never PASS').not.toBe('PASS');
    none(ranSteps(pool.log.filter((p) => p.piece === piece)), 'the save was refused before any run: no play of the piece ran a step');
  }, TIMEOUT);
});

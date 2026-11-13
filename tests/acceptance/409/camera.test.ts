// #409.063c7b10 (AC4): "A presenter film whose cut joins two medium shots 12° apart at equal framed height fails
// camera_grammar as a jump cut naming both shots while its twins 35° apart or with a 1.5 times height change pass; a
// shot whose camera crosses the brief's line through the presenter and the chart fails naming the shot; and a keyed
// shot whose camera channels bring it 20% closer counts as a push"
//
// Fixtures (helpers.ts): a 3D stage with the presenter (a 1.8 m box at the origin) and the chart 3 m to its right, on a
// perspective camera; every shot keeps the presenter in frame (`frame.keep`) from its own azimuth at elevation 0.
// `presenterCut`: medium-a from 0° and medium-b from 12° (fill 0.6 each, so equal framed height), from 35°, or from 12°
// at fill 0.9 (1.5 times the height), cut at 3 s. `lineFilm`: side-1 from −40°, side-2 from 20°, side-3 an orbit of 60°
// from 80° to 140°, across the plane z = 0 through presenter and chart (at 90°), or from −60° to 0°, in front of it
// throughout. `keyedFilm`: one keyed shot, labelled `hold`,
// whose camera's own channel takes its orbit distance from 5 m to 4 m (20% closer) or to 4.8 m (4%).
// Briefs name camera_grammar alone, with `line: {through: [presenter, chart]}` for the line films.
//
// asserts: the 12° cut FAILs with craft.camera_grammar.jump_cut naming medium-a and medium-b at 3 s; the 35° and the
// 1.5× twins PASS. The crossing side-3 FAILs with craft.camera_grammar.line naming side-3 (a frame of it, 6-9 s), and no
// line error names side-1 or side-2; the one in front PASSes. The keyed shot's move, as the row's measure reads it, is push at 20% and hold
// at 4%. Wrong programs: the base (no camera_grammar row); planted `craft_jump_cut_angle_only` (judges the cut by the
// angle alone, so the 1.5× twin fails) and planted `craft_camera_by_label` (reads the move from the shot's label).
import { describe, it } from 'vitest';
import {
  AC, FULL, JUMP_CUT, LINE, TIMEOUT, briefOf, docId, failsWith, isObject, judge, keyedFilm, lineFilm, measureOf, named, noErrorNaming, none, passes,
  presenterCut, show, useBuilds, useFolders, type Film, type Planted,
} from './helpers.ts';
import { failsNaming } from '../407/helpers.ts';

const bin = useBuilds([FULL]);
const folder = useFolders();
const GRAMMAR = briefOf(named('camera_grammar'));
const LINED = briefOf(named('camera_grammar', { line: { through: ['presenter', 'chart'] } }));

/** The jump cut at 12° fails naming both shots; the 35° and 1.5× twins pass. */
function jumpCuts(planted?: Planted): string[] {
  const films: Film[] = [
    { name: 'the cut 12° apart at equal height', doc: docId(1), document: presenterCut(docId(1), 12), brief: GRAMMAR },
    { name: 'the twin 35° apart', doc: docId(2), document: presenterCut(docId(2), 35), brief: GRAMMAR },
    { name: 'the twin 12° apart, 1.5 times taller', doc: docId(3), document: presenterCut(docId(3), 12, 0.9), brief: GRAMMAR },
  ];
  const { judged } = judge(bin(FULL), folder(), films, planted ? { planted } : {});
  return [
    ...failsWith(judged[films[0]!.name], 'camera_grammar', JUMP_CUT, { shots: ['medium-a', 'medium-b'], t: 3 }, films[0]!.name),
    ...passes(judged[films[1]!.name], 'camera_grammar', films[1]!.name),
    ...passes(judged[films[2]!.name], 'camera_grammar', `${films[2]!.name} (the 1.5× twin)`),
  ];
}

/** The keyed shot's move as camera_grammar's measure reads it: push at 20% closer, hold at 4%. */
function keyedMoves(planted?: Planted): string[] {
  const films: Film[] = [
    { name: 'the keyed shot 20% closer', doc: docId(1), document: keyedFilm(docId(1), 4), brief: GRAMMAR },
    { name: 'the keyed shot 4% closer', doc: docId(2), document: keyedFilm(docId(2), 4.8), brief: GRAMMAR },
  ];
  const { judged } = judge(bin(FULL), folder(), films, planted ? { planted } : {});
  const failures: string[] = [];
  for (const [f, want] of [[films[0]!, 'push'], [films[1]!, 'hold']] as const) {
    const moves = measureOf(judged[f.name], 'camera_grammar', f.name)['moves'];
    const got = isObject(moves) ? moves['keyed-1'] : undefined;
    if (got !== want) failures.push(`${f.name}: camera_grammar reads keyed-1's move as ${show(got)}, not ${want}: measure.moves ${show(moves)}`);
  }
  return failures;
}

describe(`${AC[4]} camera_grammar: jump cuts, the line and moves read from the camera`, () => {
  it(`${AC[4]} a cut between medium shots 12° apart at equal height fails as a jump cut naming both; 35° apart or 1.5 times taller passes`, () => {
    none(jumpCuts(), 'the jump cut and its twins');
  }, TIMEOUT);

  it(`${AC[4]} a planted check that judges the cut by its angle alone fails the 1.5× twin, and this check fails naming it`, () => {
    failsNaming(jumpCuts('craft_jump_cut_angle_only'), ['1.5 times taller'], 'a jump cut judged without the size change');
  }, TIMEOUT);

  it(`${AC[4]} a shot whose camera crosses the brief's line through the presenter and the chart fails naming that shot`, () => {
    const films: Film[] = [
      { name: 'the third shot orbiting across the line', doc: docId(1), document: lineFilm(docId(1), 110), brief: LINED },
      { name: 'the third shot orbiting in front of the line', doc: docId(2), document: lineFilm(docId(2), -30), brief: LINED },
    ];
    const { judged } = judge(bin(FULL), folder(), films);
    none([
      ...failsWith(judged[films[0]!.name], 'camera_grammar', LINE, { shots: ['side-3'], tIn: [6, 9] }, films[0]!.name),
      ...noErrorNaming(judged[films[0]!.name], LINE, 'side-1', films[0]!.name),
      ...noErrorNaming(judged[films[0]!.name], LINE, 'side-2', films[0]!.name),
      ...passes(judged[films[1]!.name], 'camera_grammar', films[1]!.name),
    ], 'the line through the presenter and the chart');
  }, TIMEOUT);

  it(`${AC[4]} a keyed shot labelled hold whose camera channels bring it 20% closer counts as a push, and 4% closer as a hold`, () => {
    none(keyedMoves(), 'the keyed shot\'s move');
  }, TIMEOUT);

  it(`${AC[4]} a planted check that reads a shot's move from its label fails this, naming the keyed shot`, () => {
    failsNaming(keyedMoves('craft_camera_by_label'), ['keyed-1'], 'a move read from the shot\'s label');
  }, TIMEOUT);
});

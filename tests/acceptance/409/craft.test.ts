// #409.1b284d72 (AC1): "Each craft@1 check has a parity fixture and a planted-fault twin that fails with its code, the
// shot and the frame; a brief that names no craft check runs none, and no agent can change a threshold"
//
// Fixtures (helpers.ts; README: Criterion 1's table): for each of the sixteen craft@1 checks the issue's Fields list,
// a parity film that passes it and a twin with one planted fault, each the agent's own work (presented by its
// deep_show) and the one deliverable of a claim whose brief names that check alone, every field at its default
// (sound_lock with the palette [pad], not_example with its fixture film). The sound films are exported to an MP4
// before their verdict, so a check that reads the export's per-bus power bakes has them.
//
// asserts, per check: the parity film's verdict holds exactly one row from that check (its `from.craft`), PASS with no
// error or warning; the twin's row FAILs with an error of the check's code naming the shot, and its frame `t`, of the
// planted fault. Then: a brief with no `craft` gets no craft row and raises no craft code on a film that breaks
// shot_length and ends, and a brief naming only ends gets one row, ends's, and no shot_length error; the agent's own
// `checks` lowering shot_length's minimum to 0.5 s change nothing: its 1 s shot still FAILs at the brief's 2 s.
// Wrong programs: the base (no craft rows), planted `craft_runs_every_check` (runs checks the brief doesn't name) and
// planted `craft_threshold_from_agent` (takes the threshold the agent wrote).
import { describe, it } from 'vitest';
import {
  AC, FULL, JUMP_CUT, PALETTE, TIMEOUT, accentsFilm, balanceFilm, briefOf, bridgesFilm, captionBandFilm, code, coverageFilm, docId, endsFilm, exampleFilm,
  failsWith, judge, livelyFilm, lockFilm, lookLockFilm, named, noErrorNaming, none, numbersFilm, passes, presenterCut, recipesFilm, shotLengthFilm,
  silencesFilm, textLedFilm, useBuilds, useFolders, withOwnThreshold, writeReel, card, shownOver, film, shotsOf, subject,
  type Check, type Expect, type Extra, type Film, type JsonObject, type Judged, type Planted,
} from './helpers.ts';
import { failsNaming } from '../407/helpers.ts';

const bin = useBuilds([FULL]);
const folder = useFolders();

interface Case {
  check: Check;
  /** The film: the parity fixture, or (`twin`) its planted-fault twin; `evidence` holds what its sound needs. */
  film: (doc: string, twin: boolean, evidence: string) => JsonObject;
  /** What the twin's issue names. */
  fault: Expect;
  /** The code, when not `craft.<check>`. */
  code?: string;
  fields?: JsonObject;
  exported?: boolean;
  /** A pack the films pin, or the fixture film not_example compares with. */
  needs?: 'pack' | 'fixture';
}
const EXAMPLE = docId(90);
const CASES: Case[] = [
  { check: 'shot_length', film: (d, t) => shotLengthFilm(d, t), fault: { shots: ['shot-2'], t: 3 } },
  { check: 'camera_grammar', film: (d, t) => presenterCut(d, t ? 12 : 35), code: JUMP_CUT, fault: { shots: ['medium-a', 'medium-b'], t: 3 } },
  { check: 'ends', film: (d, t) => endsFilm(d, t), fault: { shots: ['shot-3'], t: 6 } },
  { check: 'text_led', film: (d, t) => textLedFilm(d, t), fault: { shots: ['shot-2'], t: 3 } },
  { check: 'look_lock', film: (d, t) => lookLockFilm(d, t), fault: { shots: ['shot-3'], t: 6 } },
  { check: 'recipes', film: (d, t) => recipesFilm(d, t), fault: { shots: ['shot-3'], t: 6 }, needs: 'pack' },
  { check: 'numbers_in_script', film: (d, t) => numbersFilm(d, t), fault: { shots: ['shot-2'], t: 3 } },
  { check: 'caption_band', film: (d, t) => captionBandFilm(d, t), fault: { shots: ['shot-2'], t: 3 } },
  { check: 'motion_share', film: (d, t) => livelyFilm(d, t), fault: { shots: ['shot-b'], t: 6, within: 1 / 24 } },
  { check: 'accents', film: (d, t, e) => accentsFilm(d, e, t), fault: { shots: ['shot-2'], tIn: [3, 3.25] }, exported: true },
  {
    check: 'not_example', film: (d, t) => exampleFilm(d, { first: true, transition: true, tempo: true, moves: !t }), fields: { fixtures: [EXAMPLE] },
    fault: { anyOf: ['part-1', 'part-2', 'part-3', 'part-4'], tIn: [0, 12] }, needs: 'fixture',
  },
  { check: 'silences', film: (d, t, e) => silencesFilm(d, e, t), fault: { shots: ['shot-2'], tIn: [5, 5.8] }, exported: true },
  { check: 'sound_coverage', film: (d, t, e) => coverageFilm(d, e, t), fault: { shots: ['shot-2'], tIn: [4, 4.25] }, exported: true },
  { check: 'sound_bridges', film: (d, t, e) => bridgesFilm(d, e, t), fault: { anyOf: ['shot-1', 'shot-2'], t: 3 }, exported: true },
  { check: 'mix.balance', film: (d, t, e) => balanceFilm(d, e, t), fault: { shots: ['shot-2'], tIn: [3, 6] }, exported: true },
  { check: 'sound_lock', film: (d, t) => lockFilm(d, t), fields: { instruments: PALETTE }, fault: { shots: ['shot-2'], t: 3 } },
];

describe(`${AC[1]} each craft@1 check has a parity fixture and a planted-fault twin that fails with its code, the shot and the frame`, () => {
  for (const c of CASES) {
    it(`${AC[1]} ${c.check}: the parity fixture passes and the twin fails with ${c.code ?? code(c.check)}, the shot and the frame`, () => {
      const evidence = folder();
      const brief = briefOf(named(c.check, c.fields ?? {}));
      const films: Film[] = [false, true].map((twin, i) => ({
        name: `${c.check}'s ${twin ? 'twin' : 'parity fixture'}`, doc: docId(i + 1), document: c.film(docId(i + 1), twin, evidence), brief, exported: c.exported === true,
      }));
      const extra: Extra = { ...(c.exported ? { out: folder() } : {}) };
      if (c.needs === 'pack') extra.packs = [writeReel(folder())];
      if (c.needs === 'fixture') extra.fixtures = [{ doc: EXAMPLE, document: exampleFilm(EXAMPLE) }];
      const { judged } = judge(bin(FULL), evidence, films, extra);
      none([
        ...passes(judged[films[0]!.name], c.check, films[0]!.name),
        ...failsWith(judged[films[1]!.name], c.check, c.code ?? code(c.check), c.fault, films[1]!.name),
      ], `${c.check}'s parity fixture and twin`);
    }, TIMEOUT);
  }
});

/** A film that breaks shot_length (a 1 s second shot) and ends (its last shot led by a text card). */
const breaksTwo = (doc: string): JsonObject => film(doc, 'A 1 s shot and a text-led last shot', [subject(0), card(1)], {
  span: 7, shots: shotsOf([3, 1, 3]), channels: { card: shownOver('card', 4, 7) },
});
/** No craft row and no craft code on the brief with no craft check; one row, ends's, on the brief naming ends alone. */
function namedOnly(planted?: Planted): string[] {
  const films: Film[] = [
    { name: 'the film under a brief with no craft check', doc: docId(1), document: breaksTwo(docId(1)), brief: { goal: 'A kettle film' } },
    { name: 'the film under a brief naming ends', doc: docId(2), document: breaksTwo(docId(2)), brief: briefOf(named('ends')) },
  ];
  const { judged } = judge(bin(FULL), folder(), films, planted ? { planted } : {});
  const none_ = judged[films[0]!.name] as Judged;
  const failures: string[] = [];
  if (none_.craft.size) failures.push(`${films[0]!.name}: rows come from craft checks ${[...none_.craft.keys()].join(', ')}, though its brief names none`);
  const raised = none_.verdict.rows.flatMap((r) => r.issues).filter((i) => i.code.startsWith('craft.'));
  if (raised.length) failures.push(`${films[0]!.name}: the verdict raises ${raised.map((i) => i.code).join(', ')}, though its brief names no craft check`);
  if (none_.verdict.result === 'FAIL') failures.push(`${films[0]!.name}: the claim FAILs though its brief names no check`);
  const ends = judged[films[1]!.name] as Judged;
  const others = [...ends.craft.keys()].filter((k) => k !== 'ends');
  if (others.length) failures.push(`${films[1]!.name}: rows come from ${others.join(', ')}, which its brief doesn't name`);
  failures.push(...failsWith(ends, 'ends', code('ends'), { shots: ['shot-3'], t: 4 }, films[1]!.name));
  failures.push(...noErrorNaming(ends, code('shot_length'), 'shot-2', films[1]!.name));
  return failures;
}

describe(`${AC[1]} a brief that names no craft check runs none`, () => {
  it(`${AC[1]} a brief with no craft check gets no craft row, and one naming ends gets ends's row alone`, () => {
    none(namedOnly(), 'craft checks run only when the brief names them');
  }, TIMEOUT);
  it(`${AC[1]} a planted program that runs every craft check whatever the brief names fails this, naming shot_length`, () => {
    failsNaming(namedOnly('craft_runs_every_check'), ['shot_length'], 'craft checks run on a brief that doesn\'t name them');
  }, TIMEOUT);
});

/** The agent's film breaks shot_length (its 1 s shot) and its own checks lower the minimum to 0.5 s: the brief's 2 s holds. */
function agentThreshold(planted?: Planted): string[] {
  const doc = docId(1);
  const f: Film = { name: 'the agent\'s film that lowers shot_length\'s minimum itself', doc, document: withOwnThreshold(shotLengthFilm(doc, true)), brief: briefOf(named('shot_length')) };
  const { judged } = judge(bin(FULL), folder(), [f], planted ? { planted } : {});
  return failsWith(judged[f.name], 'shot_length', code('shot_length'), { shots: ['shot-2'], t: 3 }, f.name);
}

describe(`${AC[1]} no agent can change a threshold`, () => {
  it(`${AC[1]} the agent's own checks lowering shot_length's minimum to 0.5 s leave its 1 s shot failing at the brief's 2 s`, () => {
    none(agentThreshold(), 'a threshold the agent wrote');
  }, TIMEOUT);
  it(`${AC[1]} a planted program that takes the agent's threshold passes the 1 s shot, and this check fails naming it`, () => {
    failsNaming(agentThreshold('craft_threshold_from_agent'), ['shot-2'], 'the threshold taken from the agent');
  }, TIMEOUT);
});

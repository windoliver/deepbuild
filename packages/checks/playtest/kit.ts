// check.kind@1's kit for kind `playtest` (#184), run by the conformance package's runner: the clean maze and a planted
// twin for each code, each twin failing with its code while the clean maze passes, as every check kind ships a planted
// failure it catches (#68). The mazes are this folder's fixtures (fixtures/*.wat, built to *.wasm by deep-logic's
// play_184 test): a token moved one cell per `arrow` press (0 north, 1 east, 2 south, 3 west), `won` at the exit, and
// the route bot, a logic bot that walks the shortest route. A play goes through `replica(plant)`, the caller's replica,
// a planted one for the replay twin; the kit's pieces are named here and handed over by `pieces()`.
// playtest.not_live's subject and twin are #1046's. #555's codes plant on the same maze: a band and an expectation the
// route bot can't hold, a play interface naming an array the maze doesn't publish, and a range its presses pass.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fail, Finding } from '@deepbuild/conformance';
import type { CheckResult, CheckRunnerFill, Fixture, PlantedFill, SlotCase, SlotKitImpl, SlotRule } from '@deepbuild/conformance';
import type { PlayIface } from './iface.ts';
import { OWN, PLANTED, runReach, type Cell, type ReachInput, type Runner } from './reach.ts';
import { runPlaytest } from './run.ts';
import type { Bot, Play, PlaytestInput } from './types.ts';

const SLOT = 'check.kind@1';
const MAZES = ['maze', 'maze-stuck', 'maze-walled', 'maze-trap', 'maze-busy'] as const;
type Maze = (typeof MAZES)[number];

/** Each kit maze as the logic module's piece with its programs inline, the route bot's among them. */
export function pieces(): Record<Maze, { piece: Record<string, unknown>; assets: Record<string, string> }> {
  const bytes = (name: string): Buffer => readFileSync(new URL(`./fixtures/${name}.wasm`, import.meta.url));
  const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
  const bot = bytes('route-bot');
  return Object.fromEntries(MAZES.map((name) => {
    const program = bytes(name);
    const busy = name === 'maze-busy';
    const params = {
      program: sha(program), step_rate: busy ? 240 : 60, reads: ['arrow'], ...(busy ? { budget: { fuel: 10_000_000 } } : {}),
      writes: { pos: { type: 'i32', count: 2 }, won: { type: 'i32' }, presses: { type: 'i32' } },
    };
    const piece = { seed: 184, class: 'figure', controls: { arrow: { kind: 'slider', range: [0, 3], increment: 1, default: 0 } }, items: { maze: { kind: 'logic@1', params } } };
    return [name, { piece, assets: { [sha(program)]: program.toString('base64'), [sha(bot)]: bot.toString('base64') } }];
  })) as never;
}

const ROUTE_BOT = (): { logic: { program: string; reads: string[]; plays: Record<string, string> } } => ({
  logic: { program: createHash('sha256').update(readFileSync(new URL('./fixtures/route-bot.wasm', import.meta.url))).digest('hex'), reads: ['maze.pos'], plays: { press: 'arrow' } },
});
const POLICY = { policy: { pick: { arrow: { from: [0, 1, 2, 3], every: 0.25 } } } };
/** A kit case's input: the maze, the playtest's input on it, and the planted replica it plays on, if any. */
interface CaseInput { maze: Maze; play: PlaytestInput; plant: string | null }
const input = (maze: Maze, bots: PlaytestInput['bots'], o: Partial<PlaytestInput> = {}, plant: string | null = null): CaseInput => ({
  maze, plant,
  play: { piece: `${maze}@1`, bots, runs: 2, seed: 184, span: 30, stuck: { measure: 'maze.pos', by: 1, within: 10 }, goals: [{ name: 'won', when: 'maze.won' }], ...o },
});

const RULES = {
  stuck: { id: 'stuck-fails', rule: 'A run whose measure stops moving before every goal fails playtest.stuck, naming the step it last moved.', code: 'playtest.stuck', message: 'passed a run that got stuck' },
  goal: { id: 'goal-reached', rule: 'A goal no run reaches fails playtest.goal_missed, naming the goal.', code: 'playtest.goal_missed', message: 'passed a goal no run reached' },
  trap: { id: 'trap-fails', rule: 'A trap in the piece\'s logic fails its run with playtest.trap, naming the item, the step and the entries it read.', code: 'playtest.trap', message: 'passed a run whose logic trapped' },
  budget: { id: 'within-ceiling', rule: 'A step whose logic fuel passes its class\'s ceiling fails playtest.over_budget, naming the step, its fuel and the ceiling.', code: 'playtest.over_budget', message: 'passed a step past its ceiling' },
  replay: { id: 'replays-exactly', rule: 'A run\'s track played again without its bot reaches the same full-state hashes, or fails playtest.replay naming the first step that differs.', code: 'playtest.replay', message: 'passed a run whose track doesn\'t replay' },
  band: { id: 'share-in-band', rule: 'The share of a bot\'s runs that reach a goal lies in its band, or fails playtest.band naming the bot, the goal, the share and the band.', code: 'playtest.band', message: 'passed a share outside its band' },
  expect: { id: 'expected-miss', rule: 'A run of a bot that must miss a goal and reaches it fails playtest.expect, naming the run and the step.', code: 'playtest.expect', message: 'passed a run that reached a goal it must miss' },
  missing: { id: 'interface-published', rule: 'A name the play interface declares that the piece publishes no array of the right type for fails play.missing, naming it, before any run.', code: 'play.missing', message: 'passed a piece missing a declared name' },
  range: { id: 'within-range', rule: 'A published value outside its name\'s range fails play.out_of_range, naming the name, the row, the value and the step.', code: 'play.out_of_range', message: 'passed a value outside its range' },
} as const;
type Rule = keyof typeof RULES;
const rules: SlotRule[] = Object.values(RULES).map(({ id, rule }) => ({ id, rule }));

interface Expected { outcome: 'passed' | 'failed'; rule: Rule | null }
const fixture = (id: string, i: CaseInput, expected: Expected): Fixture => ({ id, input: i as never, expected: expected as never });
const fixtures = (): Fixture[] => [
  fixture('clean-maze', input('maze', [ROUTE_BOT(), POLICY]), { outcome: 'passed', rule: null }),
  fixture('planted-stuck', input('maze-stuck', [ROUTE_BOT()]), { outcome: 'failed', rule: 'stuck' }),
  fixture('planted-walled', input('maze-walled', [ROUTE_BOT()], { stuck: undefined as never }), { outcome: 'failed', rule: 'goal' }),
  fixture('planted-trap', input('maze-trap', [POLICY], { goals: [] }), { outcome: 'failed', rule: 'trap' }),
  fixture('planted-busy', input('maze-busy', [ROUTE_BOT()], { span: { steps: 8 }, goals: [], stuck: undefined as never }), { outcome: 'failed', rule: 'budget' }),
  fixture('planted-replay', input('maze', [ROUTE_BOT()], {}, 'drops-first-bot-entry'), { outcome: 'failed', rule: 'replay' }),
  fixture('planted-band', input('maze', [{ ...ROUTE_BOT(), share: { won: [0, 0.5] } }]), { outcome: 'failed', rule: 'band' }),
  fixture('planted-expect', input('maze', [{ ...ROUTE_BOT(), expect: { won: 'miss' } }]), { outcome: 'failed', rule: 'expect' }),
  fixture('planted-missing', input('maze', [ROUTE_BOT()], { play: { turn: 'maze.turn' } }), { outcome: 'failed', rule: 'missing' }),
  fixture('planted-range', input('maze', [ROUTE_BOT()], { play: { values: { presses: { name: 'maze.presses', range: [0, 3] } } } }), { outcome: 'failed', rule: 'range' }),
];

export interface PlaytestFill extends CheckRunnerFill { kind: 'playtest'; play: (i: CaseInput) => Promise<CheckResult> }

function* judge(fill: PlaytestFill, c: SlotCase): Generator<() => unknown, void, unknown> {
  const i = c.input as unknown as CaseInput;
  const ex = c.expected as unknown as Expected;
  const r = (yield () => fill.play(i)) as CheckResult;
  if (ex.outcome === 'passed') {
    if (r.outcome !== 'passed') throw new Finding('FAIL', `the clean maze reported ${r.outcome}: ${r.failures.map((f) => f.message).join('; ')}`, ['clean_failed']);
    return;
  }
  const rule = RULES[ex.rule!];
  if (r.outcome === 'passed' || !r.failures.some((f) => f.message.startsWith(rule.code))) throw fail(rule.message, [rule.code], `${c.id} reported ${r.outcome} without ${rule.code}`);
}

/** check.kind@1's kit for kind playtest, its plays through `replica(plant)`. */
export function playtestKit(replica: (plant: string | null) => Play): SlotKitImpl<PlaytestFill> {
  const reference = (drop: Rule | null = null): PlaytestFill => ({
    slot: SLOT, revision: 1, kind: 'playtest',
    run: () => { throw Error('the kit runs a playtest through play'); },
    play: async (i) => {
      const r = await runPlaytest(i.play, replica(i.plant));
      // A planted runner drops one rule's failures, and passes when nothing else is left.
      const failures = drop ? r.failures.filter((f) => !f.message.startsWith(RULES[drop].code)) : r.failures;
      return { ...r, failures, outcome: failures.length ? r.outcome : 'passed' };
    },
  });
  const planted = (Object.keys(RULES) as Rule[]).map((rule): PlantedFill<PlaytestFill> => ({
    name: `ignores-${rule}`, message: RULES[rule].message, codes: [RULES[rule].code], breaks: RULES[rule].id, fill: reference(rule),
  }));
  return { slot: SLOT, fills: 'one', revision: 1, rules, fixtures: fixtures(), planted, clean: () => [reference()], generate: () => [], judge };
}

// ---- #556: check.kind@1's kit for kind grid.reach.
// Its pieces are copies of the acceptance suites' own (tests/acceptance/556/README.md: Fixtures), so the kit needs no
// assembler: #555's crawler, its twin whose key lies inside its own vault and its twin that publishes no turn; #1048's
// 2-layer map and that map without the teleporter's row; a 6 × 6 pointy hex board whose one route needs the odd rows'
// shift; and a 64 × 64 flow field with its twin that steps one cell up its field from step 300. Each program is
// fixtures/<name>.wasm, and fixtures/reach.json holds each piece (its program set from the file), the play interfaces,
// the bots and the flow form.

interface ReachData { pieces: Record<string, Record<string, unknown>>; plays: Record<string, PlayIface>; bots: Record<string, Bot>; flow: NonNullable<ReachInput['flow']> }
const reachData = (): ReachData => JSON.parse(readFileSync(new URL('./fixtures/reach.json', import.meta.url), 'utf8')) as ReachData;

/** Each grid.reach kit piece as the logic module's piece with its program inline, by name (a case plays `<name>@1`). */
export function reachPieces(): Record<string, { piece: Record<string, unknown>; assets: Record<string, string> }> {
  return Object.fromEntries(Object.entries(reachData().pieces).map(([name, piece]) => {
    const program = readFileSync(new URL(`./fixtures/${name}.wasm`, import.meta.url));
    const sha = createHash('sha256').update(program).digest('hex');
    const items = Object.fromEntries(Object.entries(piece['items'] as Record<string, { params: Record<string, unknown> }>).map(([id, item]) => [id, { ...item, params: { ...item.params, program: sha } }]));
    return [name, { piece: { ...piece, items }, assets: { [sha]: program.toString('base64') } }];
  }));
}

const REACH_RULES = {
  keys: { id: 'locks-need-keys', rule: 'A locked cell opens only once the search has reached a cell holding its key, so a key inside its own vault leaves the vault unreached.', code: 'grid.unreached', message: 'opened a lock whose key it never reached' },
  links: { id: 'layers-by-links', rule: 'A cell on another layer is reached only through a link, never as the cell stacked above or below it.', code: 'grid.unreached', message: 'stepped between stacked cells on two layers' },
  hex: { id: 'hex-as-drawn', rule: 'A hex grid\'s neighbours are the six its board draws by its orient and offset.', code: 'grid.unreached', message: 'took a hex grid\'s neighbours by an offset the board doesn\'t draw' },
  flow: { id: 'flow-descends', rule: 'Past the lag after a grid change, every cell a target is reached from steps to an open neighbour of lower cost, and every spawn follows next to a target, or grid.flow names the run, step, cell and why.', code: 'grid.flow', message: 'passed a flow field that rises' },
  missing: { id: 'interface-published', rule: 'A name the play interface declares that the piece publishes no array for fails play.missing, naming it, before any run.', code: 'play.missing', message: 'passed a piece missing a declared name' },
} as const;
type ReachRule = keyof typeof REACH_RULES;

/** check.kind@1's spec of a grid.reach case: its own input in `reach`, the named playtest's input in `play`. */
interface ReachSpec { kind: 'grid.reach'; runner: string; inputs: string[]; depth: string; oracle: 'code'; contract: null; reach: ReachInput; play: PlaytestInput }
interface ReachExpected { outcome: 'passed' | 'failed'; rule: ReachRule | null; cell?: Cell }
export interface ReachFill extends CheckRunnerFill { kind: 'grid.reach' }

function reachFixtures(): Fixture[] {
  const d = reachData();
  const floors: ReachInput = { playtest: 'kit', goals: ['exit'], every: ['open'], depths: [1] };
  const flow: ReachInput = { playtest: 'kit', flow: d.flow };
  const spec = (piece: string, play: string, bot: string, steps: number, reach: ReachInput, o: Partial<PlaytestInput> = {}): ReachSpec => ({
    kind: 'grid.reach', runner: 'deep.canvas.play', inputs: [], depth: 'journey', oracle: 'code', contract: null, reach,
    play: { piece: `${piece}@1`, play: d.plays[play]!, bots: [d.bots[bot]!], runs: 1, seed: 556, span: { steps }, goals: [], ...o },
  });
  const fixture = (id: string, s: ReachSpec, expected: ReachExpected): Fixture => ({ id, input: { spec: s } as never, expected: expected as never });
  return [
    fixture('clean-crawler', spec('crawler', 'crawler', 'descender', 150, floors, { runs: 2, piece_seed: 'run' }), { outcome: 'passed', rule: null }),
    fixture('planted-vault', spec('crawler-vault', 'crawler', 'descender', 150, floors, { piece_seed: 'run' }), { outcome: 'failed', rule: 'keys' }),
    fixture('planted-noturn', spec('crawler-noturn', 'crawler', 'descender', 150, floors, { piece_seed: 'run' }), { outcome: 'failed', rule: 'missing' }),
    fixture('clean-map', spec('map', 'map', 'explorer', 60, floors), { outcome: 'passed', rule: null }),
    fixture('planted-map-gate', spec('map-gate', 'map', 'explorer', 60, floors), { outcome: 'failed', rule: 'links', cell: [14, 14] }),
    fixture('clean-hex', spec('hex', 'hex', 'idle', 2, floors), { outcome: 'passed', rule: null }),
    fixture('clean-flow', spec('flow', 'flow', 'idle', 302, flow), { outcome: 'passed', rule: null }),
    fixture('planted-flow-rising', spec('flow-rising', 'flow', 'idle', 302, flow), { outcome: 'failed', rule: 'flow', cell: [10, 40] }),
  ];
}

const CTX = { checkout: '', deadline: 3_600_000, now: Date.now };
function* reachJudge(fill: ReachFill, c: SlotCase): Generator<() => unknown, void, unknown> {
  const { spec } = c.input as unknown as { spec: ReachSpec };
  const ex = c.expected as unknown as ReachExpected;
  const r = (yield () => fill.run(spec as never, CTX)) as CheckResult;
  if (ex.outcome === 'passed') {
    const codes = [...new Set(r.failures.map((f) => f.message.split(':')[0]!))];
    if (r.outcome !== 'passed') throw new Finding('FAIL', `the ${c.id} fixture reported ${r.outcome}: ${r.failures.map((f) => f.message).join('; ')}`, codes.length ? codes : ['clean_failed']);
    return;
  }
  const rule = REACH_RULES[ex.rule!];
  const cell = ex.cell ? `cell [${ex.cell.join(', ')}]` : '';
  if (r.outcome === 'passed' || !r.failures.some((f) => f.message.startsWith(`${rule.code}:`) && f.message.includes(cell))) {
    throw fail(rule.message, [rule.code], `${c.id} reported ${r.outcome} without ${rule.code}${cell ? ` naming ${cell}` : ''}`);
  }
}

/**
 * check.kind@1's kit for kind grid.reach, its plays through `replica(null)`: the reference runs the plug-in's own
 * search; each planted runner is wrong in one way a fixture catches (#68), and `ignores-flow` drops grid.flow's failures.
 */
export function reachKit(replica: (plant: string | null) => Play): SlotKitImpl<ReachFill> {
  const fill = (runner: Runner, drop?: string): ReachFill => ({
    slot: SLOT, revision: 1, kind: 'grid.reach',
    run: async (spec) => {
      const s = spec as unknown as ReachSpec;
      const r = await runReach(s.reach, s.play, replica(null), runner);
      const failures = drop ? r.failures.filter((f) => !f.message.startsWith(drop)) : r.failures;
      return { ...r, failures, outcome: failures.length ? r.outcome : 'passed' };
    },
  });
  const runners = { 'offset-even': 'hex', 'stacked-layers': 'links', 'opens-locks': 'keys' } as const;
  const planted: PlantedFill<ReachFill>[] = [
    ...Object.entries(runners).map(([name, rule]) => ({ name, message: REACH_RULES[rule].message, codes: [REACH_RULES[rule].code], breaks: REACH_RULES[rule].id, fill: fill(PLANTED[name]!) })),
    { name: 'ignores-flow', message: REACH_RULES.flow.message, codes: [REACH_RULES.flow.code], breaks: REACH_RULES.flow.id, fill: fill(OWN, 'grid.flow') },
  ];
  const rules = Object.values(REACH_RULES).map(({ id, rule }) => ({ id, rule }));
  return { slot: SLOT, fills: 'one', revision: 1, rules, fixtures: reachFixtures(), planted, clean: () => [fill(OWN)], generate: () => [], judge: reachJudge };
}

// check.kind@1's kit for kind `playtest` (#184), run by the conformance package's runner: the clean maze and a planted
// twin for each code, each twin failing with its code while the clean maze passes, as every check kind ships a planted
// failure it catches (#68). The mazes are this folder's fixtures (fixtures/*.wat, built to *.wasm by deep-logic's
// play_184 test): a token moved one cell per `arrow` press (0 north, 1 east, 2 south, 3 west), `won` at the exit, and
// the route bot, a logic bot that walks the shortest route. A play goes through `replica(plant)`, the caller's replica,
// a planted one for the replay twin; the kit's pieces are named here and handed over by `pieces()`.
// playtest.not_live's subject and twin are #1046's.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fail, Finding } from '@deepbuild/conformance';
import type { CheckResult, CheckRunnerFill, Fixture, PlantedFill, SlotCase, SlotKitImpl, SlotRule } from '@deepbuild/conformance';
import { runPlaytest } from './run.ts';
import type { Play, PlaytestInput } from './types.ts';

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

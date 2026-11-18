// AC1 #555.c6cb5bbb: "The crawler fixture, a piece whose logic generates three 32 × 32 floors of 6 to 10 rooms, each with
// one locked vault and its key elsewhere on the floor, under a brief whose play interface names its grid, classes,
// locks, hero, hp, depth, turn, won and dead and its move, wait and descend actions, with span {steps: 4,000} and the
// goal deep = depth >= 3, passes a playtest of 20 runs each by the descender with share {deep: [0.9, 1]}, the
// explorer, the seeded legal bot, and a policy that only waits with expect {deep: miss} and share {dead: [1, 1]};
// every run that reaches no goal ends after exactly 4,000 steps, and every run replays without its bot to the same
// full-state hashes"
//
// The crawler's interface is locked (lockPlay) and its playtest run through runCheck on two debug replicas. First the
// fixture itself, from the replica's own one-step play of each run's seed: a 32 × 32 floor of one locked cell, one key
// and one exit, and 6 to 10 rooms on each of the three floors. Then the playtest's PASS is read with what the
// replicas played: each bot's 20 runs at hash(555, i) with its bot; the descender's share of runs reaching depth 3 and
// the waiting policy's (none reaching it, every one dead) from each run's own values; every run that reaches neither
// goal played exactly 4,000 steps; each run's recorded track played again without its bot to the same checkpoints
// and final hash. The ported rule (Oracle page: seeded play from listed actions only, and a state rebuilt from the
// history): each of the first-party bots' runs, replayed here from its track with the legal list asked for, puts at
// each step at most one entry set, the one a listed row of the step before makes (a press and a release of aim's
// primary button at the row's cell; an entry on wait_key; an entry on stairs), stamped at that step with the writer
// bot. The wrong programs: the base (no lockPlay, no play interface, no first-party bot), a plug-in that passes
// without playing or replaying, a span read as seconds, and bots that act outside the listed rows.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, Pool, STEP_60, TIMEOUT, canon, firstStep, lockPlay, macOnly, none, openHub, pieceOf, putPiece, rowOf, runPlaytest, runSeed,
  runsOf, scalar, shown, valuesOf, type Obj,
} from './helpers.ts';
import {
  CLASS, DESCENDER_BAND, EXPLORER, FLOORS, LEGAL, PATH, RUNS, SEED, SIZE, SPAN_STEPS, WAITING_BAND, crawlerInput, crawlerPiece, crawlerPlay,
  crawlerProgram,
} from './programs.ts';

const DEEP = (v: number): boolean => v >= 3;
const DEAD = (v: number): boolean => v >= 1;

describe(`${AC[1]} the crawler passes its playtest of 20 runs each by the descender, the explorer, the seeded legal bot and the waiting policy`, () => {
  it(`${AC[1]} the bands and the expectation hold, a run reaching no goal plays 4,000 steps, every run replays to the same hashes`, async () => {
    macOnly();
    const play = await lockPlay(crawlerPlay());
    const piece = putPiece(DOC.crawler, crawlerPiece(crawlerProgram('clean'), 'clean'));
    const input = crawlerInput(piece, play, [DESCENDER_BAND, EXPLORER, LEGAL, WAITING_BAND]);
    const pool = await Pool.open(2);

    // The fixture as the criterion describes it, from the replica's own play of each run's seed, one step, no bot.
    const shape: string[] = [];
    for (let i = 0; i < RUNS; i++) {
      const seed = runSeed(SEED, i);
      const r = await pool.play({ piece: pieceOf(piece), seed, piece_seed: 'run', span: { steps: 1 }, values: [PATH.grid, PATH.rooms, PATH.depth], frames: [] });
      if (r['ok'] !== true) { shape.push(`seed ${seed}: the replica didn't play the crawler: ${canon(r).slice(0, 400)}`); continue; }
      const grid = (valuesOf(r, PATH.grid)?.[0] ?? []) as number[];
      const count = (v: number): number => grid.filter((x) => x === v).length;
      if (grid.length !== SIZE * SIZE) shape.push(`seed ${seed}: the floor holds ${grid.length} cells, not ${SIZE * SIZE}`);
      if (count(CLASS.locked) !== 1 || count(CLASS.key) !== 1 || count(CLASS.exit) !== 1) shape.push(`seed ${seed}: floor 1 holds ${count(CLASS.locked)} locked, ${count(CLASS.key)} key and ${count(CLASS.exit)} exit cells, not one each`);
      const rooms = (valuesOf(r, PATH.rooms)?.[0] ?? []) as number[];
      if (rooms.length !== FLOORS || rooms.some((n) => n < 6 || n > 10)) shape.push(`seed ${seed}: the floors' rooms are ${canon(rooms)}, not three counts of 6 to 10`);
      if (scalar(valuesOf(r, PATH.depth)?.[0]) !== 1) shape.push(`seed ${seed}: the hero doesn't start at depth 1`);
    }
    none(shape, 'the crawler\'s floors');

    const hub = await openHub(pool);
    const result = await runPlaytest(hub, input);
    expect(result.outcome, `the crawler's playtest passes: ${shown(result)}`).toBe('passed');
    expect(result.testsRun, 'testsRun counts the 80 runs').toBe(4 * RUNS);

    const runs = runsOf(pool.log, input);
    const gaps: string[] = [];
    const reached = new Map<number, { deep: number; dead: number }>();
    let noGoal = 0;
    for (const r of runs) {
      const name = `bot ${r.b} run ${r.i}`;
      const reply = r.play.reply;
      const depth = valuesOf(reply, PATH.depth);
      const dead = valuesOf(reply, PATH.dead);
      if (!depth || !dead) { gaps.push(`${name}: its play asked no values for ${PATH.depth} and ${PATH.dead}, which the goals read`); continue; }
      const steps = Number(reply['steps']);
      if (depth.length !== steps || dead.length !== steps) gaps.push(`${name}: values of ${depth.length} and ${dead.length} steps for a play of ${steps}`);
      const deepAt = firstStep(depth, DEEP);
      const deadAt = firstStep(dead, DEAD);
      const t = reached.get(r.b) ?? { deep: 0, dead: 0 };
      reached.set(r.b, { deep: t.deep + (deepAt >= 0 ? 1 : 0), dead: t.dead + (deadAt >= 0 ? 1 : 0) });
      if (r.b === 3 && deepAt >= 0) gaps.push(`${name}: the waiting policy's run reaches depth 3 at step ${deepAt}`);
      if (r.b === 3 && deadAt < 0) gaps.push(`${name}: the waiting policy's hero never dies`);
      if (deepAt < 0 && deadAt < 0) noGoal++;
      if (deepAt < 0 && deadAt < 0 && (steps !== SPAN_STEPS || depth.length !== SPAN_STEPS)) gaps.push(`${name}: it reaches no goal and ends after ${steps} steps, not ${SPAN_STEPS}`);
      if (steps > SPAN_STEPS) gaps.push(`${name}: it plays ${steps} steps, past its span of ${SPAN_STEPS}`);
      if ((reply['entries'] as Obj[]).some((e) => e['writer'] !== 'bot')) gaps.push(`${name}: an entry of its track isn't the writer bot's`);
      if (!result.evidence.includes(String(reply['track']))) gaps.push(`${name}: its track ${String(reply['track'])} isn't in the result's evidence`);
      // The replay: its track without its bot, in a fresh replica, to the same hashes at every checkpoint and the end.
      if (!r.replays.length) gaps.push(`${name}: its track ${String(reply['track'])} was never played again without its bot`);
      for (const rp of r.replays) {
        if (rp.reply['ok'] !== true) { gaps.push(`${name}: its replay answered ${canon(rp.reply).slice(0, 300)}`); continue; }
        if (rp.reply['track'] !== reply['track']) gaps.push(`${name}: its replay records track ${String(rp.reply['track'])}, not ${String(reply['track'])}`);
        if (canon(rp.reply['checkpoints']) !== canon(reply['checkpoints'])) gaps.push(`${name}: its replay's checkpoints differ from the run's`);
        if (rp.reply['final'] !== reply['final']) gaps.push(`${name}: its replay ends at ${String(rp.reply['final'])}, the run at ${String(reply['final'])}`);
      }
    }
    const descender = reached.get(0)?.deep ?? 0;
    if (descender / RUNS < 0.9) gaps.push(`the descender reaches depth 3 in ${descender} of ${RUNS} runs, a share of ${descender / RUNS}, under 0.9`);
    if (!noGoal) gaps.push('every run reached a goal, so the 4,000-step clause read no run (the legal bot\'s hero moves every step, never dies and rarely descends twice)');
    none(gaps, 'the crawler\'s runs, as the replicas played and replayed them');

    // The ported rule: each first-party bot's entries are the listed rows' entries, one row a step at most.
    const listed: string[] = [];
    for (const r of runs.filter((x) => x.b <= 2)) {
      const name = `bot ${r.b} run ${r.i}`;
      const reply = r.play.reply;
      const again = await pool.play({ piece: pieceOf(piece), seed: r.seed, piece_seed: r.play.call['piece_seed'] ?? 'own', span: { steps: Number(reply['steps']) }, track: reply['entries'], values: [PATH.legal, PATH.nlegal, PATH.refused], frames: [] });
      if (again['ok'] !== true || again['final'] !== reply['final']) { listed.push(`${name}: its track played again here doesn't reach its final hash: ${canon(again).slice(0, 300)}`); continue; }
      const rows = valuesOf(again, PATH.legal)!;
      const counts = valuesOf(again, PATH.nlegal)!;
      const byStep = new Map<number, Obj[]>();
      for (const e of reply['entries'] as Obj[]) {
        const t = Number(e['t']);
        if (t % STEP_60 !== 0 || t < STEP_60) { listed.push(`${name}: an entry at t ${t} is stamped at no step after the first: ${canon(e)}`); continue; }
        byStep.set(t / STEP_60, [...(byStep.get(t / STEP_60) ?? []), e]);
      }
      for (const [k, es] of byStep) {
        const n = scalar(counts[k - 1]);
        const list = Array.from({ length: n }, (_, j) => [0, 1, 2].map((c) => rowOf(rows[k - 1], 3 * j + c)).join(','));
        const row = rowFor(es);
        if (!row) listed.push(`${name}: its entries at step ${k} are no one row's entry: ${canon(es)}`);
        else if (!list.includes(row)) listed.push(`${name}: its entries at step ${k} make row (${row}), which step ${k - 1} didn't list (${list.join(' | ')})`);
      }
      const refused = valuesOf(again, PATH.refused)!;
      if (scalar(refused[refused.length - 1]) !== 0) listed.push(`${name}: the crawler refused ${scalar(refused[refused.length - 1])} of its entries`);
      if (listed.length > 40) break;
    }
    none(listed, 'the first-party bots\' entries against the rows the crawler listed');
  }, TIMEOUT);
});

/** The legal row (action, a, b) a step's entries make, as `a,b,c`, or undefined when they are no one row's entry. */
function rowFor(es: Obj[]): string | undefined {
  const on = (c: string): Obj[] => es.filter((e) => e['control'] === c);
  if (on('aim').length === es.length && es.length === 2) {
    const [press, release] = [...es].sort((a, b) => Number(a['seq']) - Number(b['seq']));
    const pv = press!['value'] as Obj;
    const rv = release!['value'] as Obj;
    if (pv?.['phase'] !== 'press' || rv?.['phase'] !== 'release' || pv['button'] !== 'primary' || rv['button'] !== 'primary') return undefined;
    if (!Array.isArray(pv['cell']) || canon(pv['cell']) !== canon(rv['cell'])) return undefined;
    return `0,${pv['cell'][0]},${pv['cell'][1]}`;
  }
  if (es.length === 1 && on('wait_key').length === 1) return '1,0,0';
  if (es.length === 1 && on('stairs').length === 1) return '2,0,0';
  return undefined;
}

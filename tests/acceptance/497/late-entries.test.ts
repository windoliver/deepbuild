// Criterion 2: "A test writer that appends a second player's 40 entries up to 8 steps after their stamped steps, in a
// seeded order, over 600 steps of a piece whose driver counts each player's presses, leaves the track's hash, and the
// evaluated data at every frame once the last entry is in, equal to a run where each came on time, by seeking and by
// playing; a planted track that orders entries by arrival, and one that forks at a late entry and drops the entries
// after it, each fail, naming the first step that differs"
//
// Through `deep-motion eval` (README: The surface under test). The piece steps at 60 Hz (11,760,000 flicks, logic's and
// net's default step) and plays at 60 fps, so step k is frame k at k × 11,760,000 flicks; it runs 600 steps (0 to 599).
// Player 1 presses `fire` 40 times, each on time; player 2 presses it 40 times, each stamped at its step and arriving
// 0 to 8 steps later (one 8), so the writer appends them out of step order, ties at one arrival in a seeded order. Its
// drivers `d_p1` and `d_p2` count each player's presses into items p1 and p2. One eval line plays the 600 steps while
// the entries arrive (each `arrives`), then, once the last entry is in, reads every frame again in order (playing) and
// in a seeded order (seeking). The on-time line does the same with every entry arriving at its own step. No upstream
// test (oracle page).
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, countOf, evalAll, framesOf, none, seeded, shuffled, useMotion, type Frame, type JsonObject } from './helpers.ts';

const motion = useMotion();

const STEP = 11_760_000;
const STEPS = 600;

interface Press { step: number; player: 1 | 2; seq: number; arrives: number }

/** The presses (seed 497_02): player 1's 40 on time, player 2's 40 in ten clusters of four, each late by 0 to 8 steps. */
function presses(): Press[] {
  const rand = seeded(497_02);
  const p2: number[] = [];
  for (let c = 0; c < 10; c++) for (let j = 0; j < 4; j++) p2.push(20 + 55 * c + Math.floor(rand() * 4));
  p2.sort((a, b) => a - b);
  const p1 = Array.from({ length: 40 }, (_, i) => 10 + 14 * i + Math.floor(rand() * 6));
  p1[1] = p2[0]!; // one step where both players press
  const delays = p2.map(() => Math.floor(rand() * 9));
  delays[0] = 8; // "up to 8 steps after"
  return [
    ...p1.map((step, seq): Press => ({ step, player: 1, seq, arrives: step })),
    ...p2.map((step, seq): Press => ({ step, player: 2, seq, arrives: step + delays[seq]! })),
  ];
}
const PRESSES = presses();
/** The writer's appends: by arrival, ties at one step in a seeded order (seed 497_03). */
function appends(list: readonly Press[], seed: number): Press[] {
  const rand = seeded(seed);
  const key = new Map(list.map((p) => [p, rand()]));
  return [...list].sort((a, b) => a.arrives - b.arrives || key.get(a)! - key.get(b)!);
}
const LATE = appends(PRESSES, 497_03);
const ON_TIME = appends(PRESSES.map((p) => ({ ...p, arrives: p.step })), 497_04);
const entry = (p: Press): JsonObject => ({ t: p.step * STEP, seq: p.seq, control: 'fire', value: 1, writer: p.player === 1 ? 'you' : 'peer', player: p.player, arrives: p.arrives * STEP });

const DOC: JsonObject = {
  format: 1, id: 'presses', profile: 'film', title: '#497 presses', description: 'The #497 acceptance tests\' two-player press counter.', size: [320, 200],
  transport: { span: '10s', frame_rate: [60, 1] },
  items: {
    p1: { id: 'p1', kind: 'rect@1', name: 'Player 1', order: 'a1', params: { box: [0, 0, 20, 20], paint: { fill: { role: 'ink' } } }, at: { pos: [0, 40, 0] } },
    p2: { id: 'p2', kind: 'rect@1', name: 'Player 2', order: 'a2', params: { box: [0, 0, 20, 20], paint: { fill: { role: 'ink' } } }, at: { pos: [0, 80, 0] } },
  },
  controls: { fire: { kind: 'slider', class: 'document', label: 'Fire', range: [0, 1], default: 0 } },
  drivers: {
    d_p1: { target: 'items/p1/at/pos/0', expr: 'count(presses)', vars: { presses: { list: 'input.fire', where: 'player == 1' } }, fallback: 0 },
    d_p2: { target: 'items/p2/at/pos/0', expr: 'count(presses)', vars: { presses: { list: 'input.fire', where: 'player == 2' } }, fallback: 0 },
  },
};

const PASS = Array.from({ length: STEPS }, (_, k) => k * STEP);
const SEEK = shuffled(PASS, seeded(497_05));
/** The play while the entries arrive, then every frame again in order (playing) and in a seeded order (seeking). */
const TIMES = [...PASS, ...PASS, ...SEEK];

interface Run { pass: Frame[]; play: Frame[]; seek: Frame[] }
function runBoth(planted?: string): { late: Run; onTime: Run } {
  const line = (list: Press[]): JsonObject => ({ doc: DOC, times: TIMES, input: list.map(entry), ...(planted ? { planted } : {}) });
  const [late, onTime] = evalAll(motion(), [line(LATE), line(ON_TIME)]);
  const split = (a: JsonObject, what: string): Run => {
    const f = framesOf(a, TIMES, what);
    return { pass: f.slice(0, STEPS), play: f.slice(STEPS, 2 * STEPS), seek: f.slice(2 * STEPS) };
  };
  return { late: split(late!, 'the late run'), onTime: split(onTime!, 'the on-time run') };
}

/**
 * The check: once the last entry is in, the late run's track hash and every frame's evaluated items equal the on-time
 * run's, playing and seeking. `steps` lists each step whose data differs, in step order, naming the step.
 */
function compare(late: Run, onTime: Run): { hash: string[]; steps: { step: number; text: string }[] } {
  const want = onTime.pass[STEPS - 1]!.hash;
  const hash = [...late.play, ...late.seek].some((f) => f.hash !== want) ? [`the late track's hash ${late.play[0]!.hash} is not the on-time track's ${want}`] : [];
  const byStep = new Map<number, string>();
  for (const [how, a, b] of [['playing', late.play, onTime.play], ['seeking', late.seek, onTime.seek]] as const) {
    a.forEach((f, i) => {
      const step = f.t / STEP;
      const got = JSON.stringify(f.items); const ref = JSON.stringify(b[i]!.items);
      if (got !== ref && !byStep.has(step)) byStep.set(step, `step ${step} (${f.t} flicks), ${how}: the late run reads p1 ${countOf(f, 'p1', how)}, p2 ${countOf(f, 'p2', how)}; on time p1 ${countOf(b[i]!, 'p1', how)}, p2 ${countOf(b[i]!, 'p2', how)}`);
    });
  }
  const steps = [...byStep.entries()].sort((x, y) => x[0] - y[0]).map(([step, text]) => ({ step, text }));
  return { hash, steps };
}

describe(`${AC[2]} entries that arrive late join the track at their step, never at their arrival`, () => {
  it(`${AC[2]} with player 2's 40 entries up to 8 steps late, the track's hash and every frame's counts equal the on-time run's, playing and seeking`, () => {
    const { late, onTime } = runBoth();
    // The writer did append late: during the play, each frame's track holds exactly the entries arrived by then.
    const held = (list: Press[], k: number): number => list.filter((p) => p.arrives <= k).length;
    const pass: string[] = [];
    late.pass.forEach((f, k) => { if (f.entries !== held(LATE, k)) pass.push(`late run, step ${k}: the track holds ${f.entries} entries, ${held(LATE, k)} had arrived`); });
    onTime.pass.forEach((f, k) => { if (f.entries !== held(ON_TIME, k)) pass.push(`on-time run, step ${k}: the track holds ${f.entries} entries, ${held(ON_TIME, k)} had arrived`); });
    none(pass, 'the track takes each entry when it arrives');
    // The on-time run counts each player's presses at or before each step.
    const counted: string[] = [];
    for (const f of [...onTime.play, ...onTime.seek]) {
      const k = f.t / STEP;
      for (const player of [1, 2] as const) {
        const want = PRESSES.filter((p) => p.player === player && p.step <= k).length;
        const got = countOf(f, `p${player}`, 'the on-time run');
        if (got !== want) counted.push(`step ${k}: d_p${player} counts ${got}, player ${player} pressed ${want} times by then`);
      }
    }
    none(counted, 'the drivers count each player\'s presses');
    expect(onTime.pass[STEPS - 1]!.entries, 'the finished track holds all 80 entries').toBe(80);
    const { hash, steps } = compare(late, onTime);
    none(hash, 'the late track\'s hash is the on-time track\'s');
    none(steps.map((s) => s.text), 'every frame once the last entry is in reads what the on-time run reads');
  }, TIMEOUT);

  it(`${AC[2]} a planted track that orders entries by arrival fails, naming the first step that differs`, () => {
    const { late, onTime } = runBoth('track_orders_by_arrival');
    // Placed at its arrival, a late entry is missing from the counts from its stamped step until it arrived.
    const first = Math.min(...PRESSES.filter((p) => p.arrives > p.step).map((p) => p.step));
    const { steps } = compare(late, onTime);
    expect(steps.length, 'the check on the arrival-ordered track fails').toBeGreaterThan(0);
    expect(steps[0]!.text, `the first failure names step ${first}, the earliest late entry's stamped step`).toMatch(new RegExp(`^step ${first} \\(`));
  }, TIMEOUT);

  it(`${AC[2]} a planted track that forks at a late entry and drops the entries after it fails, naming the first step that differs`, () => {
    const { late, onTime } = runBoth('track_forks_at_late_entry');
    // Replaying the writer's appends against a forking track: each append drops every entry stamped after it.
    let track: Press[] = []; const dropped: Press[] = [];
    for (const p of LATE) { dropped.push(...track.filter((x) => x.step > p.step)); track = [...track.filter((x) => x.step <= p.step), p]; }
    expect(dropped.length, 'the seeded appends do fork a forking track').toBeGreaterThan(0);
    const first = Math.min(...dropped.map((p) => p.step));
    const { steps } = compare(late, onTime);
    expect(steps.length, 'the check on the forking track fails').toBeGreaterThan(0);
    expect(steps[0]!.text, `the first failure names step ${first}, the earliest dropped entry's step`).toMatch(new RegExp(`^step ${first} \\(`));
  }, TIMEOUT);
});

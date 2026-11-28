// This suite's circuits as a logic item's `circuit` holds them (README: Pieces), their input tracks, what their
// programs write and tally, and the values worked by hand (README: Fixtures). model.ts checks the hand-worked numbers;
// the tests hold the library to them. Part i is `parts[i]` everywhere. Every source is 230 V rms, 50 Hz, phase 0, no
// internal resistance, and a load is given by its rated power at 230 V, as the issue's criteria say.

import { entry, index, type Circuit, type Fixture, type Part } from '../1181/circuits.ts';

export { entry, index, type Circuit, type Part };

/** An array the item's own program writes (README: Programs): i32 × 1, 1 at circuit steps `on[0]` … `on[1]`, else 0. */
export interface Own { name: string; on?: [number, number?] }
/** A state array element the program follows over every circuit step it solves (README: Programs: tallies). */
export interface Peak { array: 'residual' | 'heat' | 'i_rms'; part: string }
/** A fixture of this suite: 1181's shape, plus what its program writes and tallies, and how many solves a step. */
export interface Fix extends Fixture {
  own?: Own[];
  /** Parts whose `on` the program tallies at every circuit step (first_off, last_off, off_steps). */
  watch?: string[];
  peaks?: Peak[];
  /** Circuit steps a second (`solve`'s per); the item's rate unless given. */
  per?: number;
  /** Circuit steps solved in one logic step; 1 unless given, 0 for an idle twin. */
  solves?: number;
}

export const V = 230;
/** A load's rated power at 230 V. */
const load = (id: string, from: string, to: string, w: number): Part => ({ id, kind: 'load', from, to, p_rated: w, v_rated: V });
export const mains = (from = 'neutral', to = 'live'): Part => ({ id: 'mains', kind: 'source_ac', from, to, v_rms: V, f: 50 });
const breaker = (id: string, from: string, to: string, curve: 'B' | 'C' | 'D' = 'B', rating = 16): Part =>
  ({ id, kind: 'breaker', from, to, rating, curve, reset_by: 'reset' });
const rcd = (id: string, live: [string, string], neutral: [string, string], more: Record<string, string | number> = {}): Part =>
  ({ id, kind: 'rcd', live, neutral, rating: 0.03, test_by: 'test', reset_by: 'reset', ...more });

/** The 60 W lamp: 230² ÷ 60 = 881.67 Ω, 230 ÷ 881.67 = 6/23 = 0.26087 A. */
export const LAMP = { watts: 60, ohms: (V * V) / 60, amps: 6 / 23 } as const;

// ---------------------------------------------------------------------------------------------------
// Breakers (criteria 1 to 5).

/**
 * The hour (criteria 1, 6 and 7's 101 kΩ fault): on one ideal source, so each branch is its own circuit, a B16 breaker
 * feeding 2,000 W (8.6957 A), a B16 feeding 4,158.4 W (18.08 A, 1.13 times its rating), a 30 mA RCD in front of a 60 W
 * lamp, and a second 30 mA RCD in front of a 60 W lamp with a fault of 101,000 Ω from its live side to the earth node
 * (0 Ω to node 0), closed by `leak` from step 0. Logic at 8 Hz, 125 circuit steps of 1 ms each a logic step, 28,801
 * logic steps: 3,600,000 circuit steps, 3,600 s. Its program tallies every circuit step (README: Programs).
 */
export const HOURS_CIRCUIT: Circuit = {
  nodes: ['neutral', 'live', 'w1', 'w2', 'a_l', 'a_n', 'b_l', 'b_n', 'earth'],
  parts: [
    mains(),
    breaker('cb_2000', 'live', 'w1'), load('load_2000', 'w1', 'neutral', 2000),
    breaker('cb_4158', 'live', 'w2'), load('load_4158', 'w2', 'neutral', 4158.4),
    rcd('rcd_lamp', ['live', 'a_l'], ['neutral', 'a_n']), load('lamp_a', 'a_l', 'a_n', 60),
    rcd('rcd_leak', ['live', 'b_l'], ['neutral', 'b_n']), load('lamp_b', 'b_l', 'b_n', 60),
    { id: 'leak', kind: 'fault', from: 'b_l', to: 'earth', r: 101_000, on_by: 'leak' },
    { id: 'earth', kind: 'resistor', from: 'earth', to: 'neutral', r: 0 },
  ],
};
export const HOUR = { rate: 8, per: 1000, solves: 125, last: 28_800 } as const;
export const HOURS: Fix = {
  item: 'hours', circuit: HOURS_CIRCUIT, rate: HOUR.rate, per: HOUR.per, solves: HOUR.solves, inputs: ['reset', 'test', 'leak'],
  track: [entry('leak', 0, HOUR.rate, 1, 1)], steps: HOUR.last + 1,
  watch: ['cb_2000', 'cb_4158', 'rcd_lamp', 'rcd_leak'],
  peaks: [{ array: 'residual', part: 'rcd_lamp' }, { array: 'residual', part: 'rcd_leak' }, { array: 'heat', part: 'cb_4158' }],
};

/** A B16 feeding loads closed together from step 0 (criteria 2 and 5). */
const fed = (loads: number[]): Circuit => ({
  nodes: ['neutral', 'live', 'out'],
  parts: [mains(), breaker('main', 'live', 'out'), ...loads.map((w, j) => load(`load${j + 1}`, 'out', 'neutral', w))],
});
/** 2,000 W, 3,000 W and 1,000 W: 6,000 ÷ 230 = 26.087 A, 1.6304 times 16 A. */
export const THREE_LOADS = [2000, 3000, 1000];
/** Criterion 2: two items at 1,000 steps a second, 61,000 steps: the three loads, and 9,384 W (40.8 A, 2.55 times). */
export const OVERLOAD = { steps: 61_000, window: 60_585 } as const;
export const THREE: Fix = { item: 'three', circuit: fed(THREE_LOADS), rate: 1000, inputs: ['reset'], track: [], steps: OVERLOAD.steps, watch: ['main'] };
export const HEAVY: Fix = { item: 'heavy', circuit: fed([9384]), rate: 1000, inputs: ['reset'], track: [], steps: OVERLOAD.steps, watch: ['main'] };

/**
 * Criterion 3: a B16 feeding a 60 W lamp, and a fault of 0.5 Ω from its load side to neutral closed by `short` at
 * step 100 (k): 230 ÷ 0.5 = 460 A, 28.75 times 16 A, so the breaker carries 460.26 A at step k; 300 steps.
 */
export const SHORT_CIRCUIT: Circuit = {
  nodes: ['neutral', 'live', 'load'],
  parts: [mains(), breaker('main', 'live', 'load'), load('lamp', 'load', 'neutral', 60), { id: 'fault', kind: 'fault', from: 'load', to: 'neutral', r: 0.5, on_by: 'short' }],
};
export const SHORTED = { k: 100, amps: 460, multiple: 28.75 } as const;
export const SHORT: Fix = {
  item: 'short', circuit: SHORT_CIRCUIT, rate: 1000, inputs: ['reset', 'short'], steps: 300,
  track: [entry('short', 0, 1000, 0, 1), entry('short', SHORTED.k, 1000, 1, 2)],
};

/** Criterion 4: a B16, a C16 and a D16, each feeding its own 18,400 W load (80 A, 5 times) from step 0; 4,300 steps. */
export const CURVES: Fix = {
  item: 'curves', rate: 1000, inputs: ['reset'], track: [], steps: 4300, watch: ['cb_b', 'cb_c', 'cb_d'],
  circuit: {
    nodes: ['neutral', 'live', 'ob', 'oc', 'od'],
    parts: [
      mains(),
      breaker('cb_b', 'live', 'ob', 'B'), load('load_b', 'ob', 'neutral', 18_400),
      breaker('cb_c', 'live', 'oc', 'C'), load('load_c', 'oc', 'neutral', 18_400),
      breaker('cb_d', 'live', 'od', 'D'), load('load_d', 'od', 'neutral', 18_400),
    ],
  },
};

/**
 * Criterion 5: the three loads behind a B16, which trips at step 60,594 (README: Fixtures); left open 30 s, reset by
 * a pulse of `reset` at step 90,594 (1 there, 0 from the next step). The reference is run to step 122,099, past the
 * second trip at 90,594 + 31,367; the planted library that resets cold to 151,299, past 90,594 + 60,593.
 */
export const RESET = { trip: 60_594, at: 90_594, again: 31_367, cold: 60_593, steps: 122_100, coldSteps: 151_300 } as const;
export const RESETS: Fix = {
  item: 'resets', circuit: fed(THREE_LOADS), rate: 1000, inputs: ['reset'], steps: RESET.steps, watch: ['main'],
  track: [entry('reset', 0, 1000, 0, 1), entry('reset', RESET.at, 1000, 1, 2), entry('reset', RESET.at + 1, 1000, 0, 3)],
};

// ---------------------------------------------------------------------------------------------------
// RCDs (criteria 6, 7 and 14).

/** Criterion 6: a 60 W lamp behind a 30 mA RCD, its poles from the supply's live and neutral to the lamp's; 100 steps. */
export const RCD_LAMP: Fix = {
  item: 'guarded', rate: 1000, inputs: ['test', 'reset'], track: [], steps: 100, watch: ['rcd'],
  circuit: {
    nodes: ['neutral', 'live', 'l_load', 'n_load'],
    parts: [mains(), rcd('rcd', ['live', 'l_load'], ['neutral', 'n_load']), load('lamp', 'l_load', 'n_load', 60)],
  },
};

/**
 * Criterion 7: the lamp behind the RCD with a test path of 3,000 Ω, and a fault of 2,000 Ω from the lamp's live side
 * to an earth node joined to node 0 by a resistor of 0 Ω, closed by `leak`. LEAKING closes the fault at step 100;
 * TESTED presses `test` at step 100 with no fault; 300 steps each.
 */
export const LEAK_CIRCUIT: Circuit = {
  nodes: ['neutral', 'live', 'l_load', 'n_load', 'earth'],
  parts: [
    mains(), rcd('rcd', ['live', 'l_load'], ['neutral', 'n_load'], { test_r: 3000 }), load('lamp', 'l_load', 'n_load', 60),
    { id: 'leak', kind: 'fault', from: 'l_load', to: 'earth', r: 2000, on_by: 'leak' },
    { id: 'earth', kind: 'resistor', from: 'earth', to: 'neutral', r: 0 },
  ],
};
/** By hand: 230 ÷ 2,000 = 0.115 A, 3.8333 times 30 mA, so 0.2 s × 0.03 ÷ 0.115 = 52.17 ms; 230 ÷ 3,000 = 76.667 mA, 78.26 ms. */
export const LEAKED = { k: 100, residual: 0.115, opensAfter: 52.17, test: 230 / 3000, testOpensAfter: 78.26 } as const;
export const LEAKING: Fix = {
  item: 'leaking', circuit: LEAK_CIRCUIT, rate: 1000, inputs: ['test', 'reset', 'leak'], steps: 300,
  track: [entry('leak', 0, 1000, 0, 1), entry('leak', LEAKED.k, 1000, 1, 2)],
};
export const TESTED: Fix = {
  item: 'tested', circuit: LEAK_CIRCUIT, rate: 1000, inputs: ['test', 'reset', 'leak'], steps: 300,
  track: [entry('test', 0, 1000, 0, 1), entry('test', LEAKED.k, 1000, 1, 2)],
};

/**
 * Criterion 14's circuit: LEAK_CIRCUIT with no controls: the fault closed by the item's own `leak[0]`, which its
 * program writes 1 from step 100, and the RCD's test and reset on `idle[0]`, which it leaves 0.
 */
export const BOARD_CIRCUIT: Circuit = {
  nodes: LEAK_CIRCUIT.nodes,
  parts: LEAK_CIRCUIT.parts.map((p) => (p.kind === 'rcd' ? { ...p, test_by: { array: 'idle[0]' }, reset_by: { array: 'idle[0]' } }
    : p.kind === 'fault' ? { ...p, on_by: { array: 'leak[0]' } } : p)),
};
export const BOARD_OWN: Own[] = [{ name: 'leak', on: [LEAKED.k] }, { name: 'idle' }];

// ---------------------------------------------------------------------------------------------------
// Changeovers (criterion 8).

const changeover = (id: string, common: string, a: string, b: string, by: string): Part => ({ id, kind: 'changeover', common, a, b, at_b_by: by });
/** Steps at which each input changes, and the inputs' values from then. */
export interface State { k: number; x: number[] }
const gray = (names: string[], states: number[][]): { track: ReturnType<typeof entry>[]; states: State[] } => {
  const track: ReturnType<typeof entry>[] = [];
  let seq = 0;
  const out = states.map((x, j) => {
    const k = 100 * j;
    x.forEach((v, i) => { if (j === 0 || states[j - 1]![i] !== v) track.push(entry(names[i]!, k, 1000, v, ++seq)); });
    return { k, x };
  });
  return { track, states: out };
};

/**
 * The stair light: the source's live to `top`'s common, strap wires from its `a` to `bottom`'s `a` and from its `b` to
 * `bottom`'s `b`, and `bottom`'s common through the 60 W lamp to neutral. The inputs x1 (top) and x2 (bottom) run
 * 00, 01, 11, 10, 00 at steps 0, 100, 200, 300 and 400: 500 steps, every state, each flip one input.
 */
export const STAIR_CIRCUIT: Circuit = {
  nodes: ['neutral', 'live', 'strap_a', 'strap_b', 'lamp_in'],
  parts: [mains(), changeover('top', 'live', 'strap_a', 'strap_b', 'x1'), changeover('bottom', 'lamp_in', 'strap_a', 'strap_b', 'x2'), load('lamp', 'lamp_in', 'neutral', 60)],
};
const stairRun = gray(['x1', 'x2'], [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]);
export const STAIR_STATES = stairRun.states;
export const STAIR: Fix = { item: 'stair', circuit: STAIR_CIRCUIT, rate: 1000, inputs: ['x1', 'x2'], track: stairRun.track, steps: 500 };
/**
 * The hall: the stair light with two more changeovers on x3 between the straps: `mid_a` joins strap s1a to s2a at 0
 * and to s2b at 1, `mid_b` joins s1b to s2b at 0 and to s2a at 1, so the straps run straight at 0 and crossed at 1.
 * The lamp is lit exactly when x1 ⊕ x2 ⊕ x3 is 0. The inputs (x1, x2, x3) run the Gray code 000, 001, 011, 010, 110,
 * 111, 101, 100 at steps 0, 100 … 700: 800 steps, all eight states, one flip of one input at each.
 */
export const HALL_CIRCUIT: Circuit = {
  nodes: ['neutral', 'live', 's1a', 's1b', 's2a', 's2b', 'lamp_in'],
  parts: [
    mains(),
    changeover('first', 'live', 's1a', 's1b', 'x1'),
    changeover('mid_a', 's1a', 's2a', 's2b', 'x3'), changeover('mid_b', 's1b', 's2b', 's2a', 'x3'),
    changeover('last', 'lamp_in', 's2a', 's2b', 'x2'),
    load('lamp', 'lamp_in', 'neutral', 60),
  ],
};
const hallRun = gray(['x1', 'x2', 'x3'], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1], [1, 0, 0]]);
export const HALL_STATES = hallRun.states;
export const HALL: Fix = { item: 'hall', circuit: HALL_CIRCUIT, rate: 1000, inputs: ['x1', 'x2', 'x3'], track: hallRun.track, steps: 800 };

// ---------------------------------------------------------------------------------------------------
// Inputs and numbers the piece drives (criteria 9 to 11).

/** Criterion 9: a switch closed by the item's own `run[0]`, which its program writes 1 at steps 100 to 199 only. */
export const OWN_SWITCH_CIRCUIT: Circuit = {
  nodes: ['neutral', 'live', 'lamp_in'],
  parts: [mains(), { id: 'relay', kind: 'switch', from: 'live', to: 'lamp_in', closed_by: { array: 'run[0]' } }, load('lamp', 'lamp_in', 'neutral', 60)],
};
export const RUN = { from: 100, to: 199 } as const;
export const OWNED: Fix = { item: 'owned', circuit: OWN_SWITCH_CIRCUIT, rate: 1000, inputs: [], track: [], steps: 300, own: [{ name: 'run', on: [RUN.from, RUN.to] }] };
/** The same switch closed by `pump.run[0]`, an array of the item `pump`, which this item doesn't write. */
export const BORROWED_CIRCUIT: Circuit = {
  nodes: OWN_SWITCH_CIRCUIT.nodes,
  parts: OWN_SWITCH_CIRCUIT.parts.map((p) => (p.id === 'relay' ? { ...p, closed_by: { array: 'pump.run[0]' } } : p)),
};

/** Criterion 10: a resistor set by the slider `knob` within [0, 2000] Ω in series with the 60 W lamp. */
export const DIMMER_CIRCUIT: Circuit = {
  nodes: ['neutral', 'live', 'mid'],
  parts: [mains(), { id: 'dimmer', kind: 'resistor', from: 'live', to: 'mid', r: { set_by: 'knob', range: [0, 2000] } }, load('lamp', 'mid', 'neutral', 60)],
};
/** The slider: 0 at step 0, the lamp's own 881.67 Ω (52,900 ÷ 60, as an f64) at 100, 2,500 at 200; 300 steps. */
export const KNOB = { matched: LAMP.ohms, matchedAt: 100, over: 2500, overAt: 200, held: 2000 } as const;
export const DIMMER: Fix = {
  item: 'dimmer', circuit: DIMMER_CIRCUIT, rate: 1000, inputs: ['knob'], steps: 300,
  track: [entry('knob', 0, 1000, 0, 1), entry('knob', KNOB.matchedAt, 1000, KNOB.matched, 2), entry('knob', KNOB.overAt, 1000, KNOB.over, 3)],
};

/** Criterion 11: the source's `v_rms` and `f` and the lamp's `v_rated` set by controls reading 120, 60 and 120 from step 0. */
export const SET: Fix = {
  item: 'set', rate: 1000, inputs: ['volts', 'hertz', 'rated'], steps: 20,
  track: [entry('volts', 0, 1000, 120, 1), entry('hertz', 0, 1000, 60, 2), entry('rated', 0, 1000, 120, 3)],
  circuit: {
    nodes: ['neutral', 'live'],
    parts: [
      { id: 'mains', kind: 'source_ac', from: 'neutral', to: 'live', v_rms: { set_by: 'volts', range: [0, 250] }, f: { set_by: 'hertz', range: [1, 100] } },
      { id: 'lamp', kind: 'load', from: 'live', to: 'neutral', p_rated: 60, v_rated: { set_by: 'rated', range: [1, 250] } },
    ],
  },
};

// ---------------------------------------------------------------------------------------------------
// The transformer (criterion 12).

/** A doorbell: the transformer's primary across the mains, turns [115, 6], its secondary feeding a bell rated 6 W at 12 V. */
export const DOORBELL_CIRCUIT: Circuit = {
  nodes: ['neutral', 'live', 'bell_a', 'bell_b'],
  parts: [
    mains(),
    { id: 'bell_tx', kind: 'transformer', primary: ['live', 'neutral'], secondary: ['bell_a', 'bell_b'], turns: [115, 6] },
    { id: 'bell', kind: 'load', from: 'bell_a', to: 'bell_b', p_rated: 6, v_rated: 12 },
  ],
};
/** By hand: 230 × 6 ÷ 115 = 12 V; 12² ÷ 6 = 24 Ω, 0.5 A; the primary 0.5 × 6 ÷ 115 = 0.026087 A; 230 × that = 6 W. */
export const BELL = { volts: 12, amps: 0.5, primary: 0.5 * 6 / 115, watts: 6, plantedGap: 230 * 0.5 - 6 } as const;
export const DOORBELL: Fix = { item: 'doorbell', circuit: DOORBELL_CIRCUIT, rate: 1000, inputs: [], track: [], steps: 40 };
/** The doorbell with a 12 V battery on the primary's network: from neutral to `aux`, and 1,000 Ω from `aux` to live. */
export const DOORBELL_DC: Fix = {
  ...DOORBELL, item: 'doorbell_dc',
  circuit: {
    nodes: [...DOORBELL_CIRCUIT.nodes, 'aux'],
    parts: [...DOORBELL_CIRCUIT.parts, { id: 'battery', kind: 'source_dc', from: 'neutral', to: 'aux', v: 12 }, { id: 'trickle', kind: 'resistor', from: 'aux', to: 'live', r: 1000 }],
  },
};

// ---------------------------------------------------------------------------------------------------
// The budget's board (criterion 15) and the plants' own fixture.

/**
 * 64 nodes and 128 parts: the source (n0 → n1), two 30 mA RCDs (`rcd_a`, `rcd_b`), four B16 breakers behind each;
 * behind `cb_a1` the hall's four changeovers and its lamp; behind `cb_b4` the doorbell's transformer and bell; behind
 * the other six a ladder of 0.1 Ω resistors with a 100 W load at each of its nodes, and 18 heaters of 200 W at the
 * first ladder nodes. 1 + 2 + 8 + 4 + 1 + 1 + 1 + 92 + 18 = 128.
 */
export const GRID_CIRCUIT: Circuit = (() => {
  const nodes = ['n0', 'n1'];
  const parts: Part[] = [mains('n0', 'n1')];
  const node = (name: string): string => { nodes.push(name); return name; };
  const neutralOf: Record<string, string> = {};
  for (const side of ['a', 'b']) {
    const l = node(`${side}_l`), n = node(`${side}_n`);
    neutralOf[side] = n;
    parts.push(rcd(`rcd_${side}`, ['n1', l], ['n0', n]));
    for (let w = 1; w <= 4; w++) parts.push(breaker(`cb_${side}${w}`, l, node(`${side}${w}`)));
  }
  for (const s of ['s1a', 's1b', 's2a', 's2b', 'hall_in']) node(s);
  parts.push(
    changeover('first', 'a1', 's1a', 's1b', 'x1'), changeover('mid_a', 's1a', 's2a', 's2b', 'x3'),
    changeover('mid_b', 's1b', 's2b', 's2a', 'x3'), changeover('last', 'hall_in', 's2a', 's2b', 'x2'),
    load('hall_lamp', 'hall_in', 'a_n', 60),
  );
  node('bell_a'); node('bell_b');
  parts.push({ id: 'bell_tx', kind: 'transformer', primary: ['b4', 'b_n'], secondary: ['bell_a', 'bell_b'], turns: [115, 6] });
  parts.push({ id: 'bell', kind: 'load', from: 'bell_a', to: 'bell_b', p_rated: 6, v_rated: 12 });
  const ladders: [string, number][] = [['a2', 7], ['a3', 7], ['a4', 7], ['b1', 7], ['b2', 7], ['b3', 8]];
  const firsts: string[] = [];
  for (const [w, length] of ladders) {
    const n = neutralOf[w[0]!]!;
    parts.push(load(`bulb_${w}`, w, n, 100));
    let at = w;
    for (let j = 1; j <= length; j++) {
      const x = node(`${w}_${j}`);
      if (j <= 3) firsts.push(x);
      parts.push({ id: `run_${w}_${j}`, kind: 'resistor', from: at, to: x, r: 0.1 }, load(`bulb_${w}_${j}`, x, n, 100));
      at = x;
    }
  }
  for (const x of firsts) parts.push(load(`heater_${x}`, x, neutralOf[x[0]!]!, 200));
  return { nodes, parts };
})();
export const GRID: Fix = { item: 'grid', circuit: GRID_CIRCUIT, rate: 1000, inputs: ['reset', 'test', 'x1', 'x2', 'x3'], track: [], steps: 20 };

/** The plants pack's own fixture (README: Planted libraries): a lamp straight on the mains, no inputs, one step. */
export const OWN_CIRCUIT: Circuit = { nodes: ['neutral', 'live'], parts: [mains(), load('lamp', 'live', 'neutral', 60)] };

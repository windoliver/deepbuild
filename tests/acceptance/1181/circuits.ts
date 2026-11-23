// This suite's circuits as a logic item's `circuit` holds them (README: Pieces), their input tracks, and the values
// worked by hand from them (README: Fixtures). model.ts checks the hand-worked numbers; the tests hold the library to
// them. Part i is `parts[i]` everywhere: in the arrays, in the program's builder calls and in the judge's fails.

import type { Entry, JsonValue } from '../190/helpers.ts';

export interface Part { id: string; kind: string; [field: string]: JsonValue }
export interface Circuit { nodes: string[]; parts: Part[] }
/** A fixture: its logic item's ID, its circuit, its step rate, the controls its item reads, its track and its steps. */
export interface Fixture { item: string; circuit: Circuit; rate: number; inputs: string[]; track: Entry[]; steps: number }

export const FLICKS = 705_600_000;
/** An input entry read at step `k` of a fixture at `rate` Hz (#531: step k reads entries with t in ((k − 1)L, kL]). */
export const entry = (control: string, k: number, rate: number, value: number, seq: number): Entry =>
  ({ t: (k * FLICKS) / rate, seq, control, value, writer: 'you', player: 1 });
/** A part's index by its ID. */
export const index = (c: Circuit, id: string): number => {
  const k = c.parts.findIndex((p) => p.id === id);
  if (k < 0) throw Error(`fixture bug: no part ${id}`);
  return k;
};

const mains = (from: string, to: string): Part => ({ id: 'mains', kind: 'source_ac', from, to, v_rms: 230, f: 50 });

/**
 * The lamp on the mains, criterion 1's circuit as it says it (criteria 1 and 6): a 230 V rms, 50 Hz source from
 * neutral to live, a plug (a connector closed while the control `plug_in` says so) from live to the lamp's pin, and a
 * lamp rated 4.6 W at 230 V from the pin to neutral.
 */
const PLAIN_PARTS: Part[] = [
  mains('neutral', 'live'),
  { id: 'plug', kind: 'connector', from: 'live', to: 'pin', closed_by: 'plug_in' },
  { id: 'lamp', kind: 'load', from: 'pin', to: 'neutral', p_rated: 4.6, v_rated: 230 },
];
export const PLAIN_CIRCUIT: Circuit = { nodes: ['neutral', 'live', 'pin'], parts: PLAIN_PARTS };
/** The same with a meter on the lamp (criteria 2 and 7). */
export const LAMP_CIRCUIT: Circuit = { nodes: PLAIN_CIRCUIT.nodes, parts: [...PLAIN_PARTS, { id: 'meter', kind: 'meter', on: 'lamp' }] };
/** The same with its flex too: 2 m of 0.75 mm² copper on the lamp (criterion 3). */
export const FLEX_CIRCUIT: Circuit = { nodes: PLAIN_CIRCUIT.nodes, parts: [...LAMP_CIRCUIT.parts, { id: 'flex', kind: 'wire', part: 'lamp', length: 2, area: 0.75, material: 'copper' }] };
/** By hand: R = 230² ÷ 4.6 = 52,900 ÷ 4.6 = 11,500 Ω; I = 230 ÷ 11,500 = 0.02 A; P = 0.02 × 230 = 4.6 W. */
export const LAMP = { ohms: 11_500, amps: 0.02, watts: 4.6, peak: 0.02 * Math.SQRT2, f: 50 } as const;

/** Criterion 1: the plug in from step 0, at 1,000 steps a second, for 10 s (steps 0 to 10,000). */
export const PLUGGED: Fixture = {
  item: 'plugged', circuit: PLAIN_CIRCUIT, rate: 1000, inputs: ['plug_in'], track: [entry('plug_in', 0, 1000, 1, 1)], steps: 10_001,
};
/**
 * Criterion 2: the plug out from step 0, in at step 1,005 (t = 1.005 s, where the sine is at its crest), out again at
 * step 2,003 (t = 2.003 s; the step before, 2.002 s, is at sin(0.2π) ≈ 0.588 of the crest), for 3 s.
 */
export const REPLUG = { in: 1005, out: 2003 } as const;
export const REPLUGGED: Fixture = {
  item: 'replugged', circuit: LAMP_CIRCUIT, rate: 1000, inputs: ['plug_in'], steps: 3000,
  track: [entry('plug_in', 0, 1000, 0, 1), entry('plug_in', REPLUG.in, 1000, 1, 2), entry('plug_in', REPLUG.out, 1000, 0, 3)],
};
/** Criterion 3, the swing: the flex's circuit for one cycle and a step at 1,000 steps a second, the plug in from step 0. */
export const CYCLE: Fixture = { ...PLUGGED, item: 'cycle', circuit: FLEX_CIRCUIT, steps: 21 };
/**
 * Criterion 3, the hour: the logic steps at 8 Hz, each solving 125 of the circuit's 1 ms steps (README: Pieces: more
 * than one solve a step), so logic step k ≥ 1 leaves circuit step 125k at t = 0.125k s; 28,800 logic steps are
 * 3,600 s, 3,600,000 circuit steps, 180,000 cycles.
 */
export const HOUR = { rate: 8, per: 1000, solves: 125, last: 28_800 } as const;
export const HOURLY: Fixture = {
  item: 'hourly', circuit: FLEX_CIRCUIT, rate: HOUR.rate, inputs: ['plug_in'], track: [entry('plug_in', 0, HOUR.rate, 1, 1)], steps: HOUR.last + 1,
};

/**
 * Criterion 4: a kettle rated 2,400 W at 230 V behind its switch (closed while `kettle_on` says so), a meter on it, at
 * 120 steps a second (so the 50 Hz wave isn't sampled at its zeros alone): switched on at step 600 (5 s) and off at
 * step 16,800 (140 s), 16,200 steps = 135 s; 18,000 steps in all (150 s).
 */
export const KETTLE_CIRCUIT: Circuit = {
  nodes: ['neutral', 'live', 'element'],
  parts: [
    mains('neutral', 'live'),
    { id: 'switch', kind: 'switch', from: 'live', to: 'element', closed_by: 'kettle_on' },
    { id: 'kettle', kind: 'load', from: 'element', to: 'neutral', p_rated: 2400, v_rated: 230 },
    { id: 'meter', kind: 'meter', on: 'kettle' },
  ],
};
export const BOIL = { rate: 120, on: 600, off: 16_800, steps: 18_000 } as const;
/** By hand: 16,200 steps of 2,400 W × 1/120 s = 20 J each: 324,000 J; ÷ 3,600,000 J/kWh = 0.09 kWh. */
export const BOILED = { joules: 324_000, kwh: 0.09, perStep: 20 } as const;
export const KITCHEN: Fixture = {
  item: 'kitchen', circuit: KETTLE_CIRCUIT, rate: BOIL.rate, inputs: ['kettle_on'], steps: BOIL.steps,
  track: [entry('kettle_on', 0, BOIL.rate, 0, 1), entry('kettle_on', BOIL.on, BOIL.rate, 1, 2), entry('kettle_on', BOIL.off, BOIL.rate, 0, 3)],
};

/**
 * Criterion 5: the lamp behind a 3 A fast fuse, its case earthed by an earth wire of no resistance to neutral (earth
 * and neutral bonded at the supply), and a fault of 1 Ω from the fused live to the case, on while `fault` says so;
 * at 100,000 steps a second (10 µs), the fault on at step 1,000 (10 ms), for 3,000 steps (30 ms).
 */
export const FAULT_CIRCUIT: Circuit = {
  nodes: ['neutral', 'live', 'fused', 'case'],
  parts: [
    mains('neutral', 'live'),
    { id: 'fuse', kind: 'fuse', from: 'live', to: 'fused', rating: 3, curve: 'fast' },
    { id: 'lamp', kind: 'load', from: 'fused', to: 'neutral', p_rated: 4.6, v_rated: 230 },
    { id: 'fault', kind: 'fault', from: 'fused', to: 'case', r: 1, on_by: 'fault' },
    { id: 'earth', kind: 'resistor', from: 'case', to: 'neutral', r: 0 },
  ],
};
/**
 * By hand: the fault takes 230 ÷ 1 = 230 A and the lamp 0.02 A, so the fuse carries 230.02 A. Its curve's time
 * (README: The fuse curve) is 1 s × ln(230.02² ÷ (230.02² − 3²)) = 170.117 µs = 17.012 steps, so it opens at step
 * 1,000 + 18 = 1,018; at 230 A it would be 170.147 µs, the same step. At 10 times its curve's time, 1,701.17 µs:
 * 1,000 + 171 = 1,171.
 */
export const BLOW = { rate: 100_000, fault: 1000, steps: 3000, amps: 230.02, faultAmps: 230, opens: 1018, late: 1171 } as const;
export const FAULTY: Fixture = {
  item: 'faulty', circuit: FAULT_CIRCUIT, rate: BLOW.rate, inputs: ['fault'], steps: BLOW.steps,
  track: [entry('fault', 0, BLOW.rate, 0, 1), entry('fault', BLOW.fault, BLOW.rate, 1, 2)],
};

/** Criterion 6: the lamp's circuit with a diode across the lamp, which circuit@1 can't model. */
export const DIODE_CIRCUIT: Circuit = {
  nodes: PLAIN_CIRCUIT.nodes,
  parts: [...PLAIN_PARTS, { id: 'rectifier', kind: 'diode', from: 'pin', to: 'neutral' }],
};

/**
 * Criterion 8: a lamp and a heater straight on the mains, no inputs, at 60 steps a second: the lamp takes 0.02 A,
 * the heater (2,300 W at 230 V) 10 A, so the source gives 10.02 A and a readout of the wrong part shows another number.
 */
export const SHOWN_CIRCUIT: Circuit = {
  nodes: ['neutral', 'live'],
  parts: [
    mains('neutral', 'live'),
    { id: 'lamp', kind: 'load', from: 'live', to: 'neutral', p_rated: 4.6, v_rated: 230 },
    { id: 'heater', kind: 'load', from: 'live', to: 'neutral', p_rated: 2300, v_rated: 230 },
  ],
};

/** The plants pack's own fixture (README: Planted twins): a lamp straight on the mains, no inputs. */
export const OWN_CIRCUIT: Circuit = { nodes: ['neutral', 'live'], parts: [mains('neutral', 'live'), { id: 'lamp', kind: 'load', from: 'live', to: 'neutral', p_rated: 4.6, v_rated: 230 }] };

/**
 * Criterion 9: a circuit of 64 nodes and 128 parts. Node n0 is neutral, n1 live; the source from n0 to n1; a 100 A
 * fast fuse from n1 to n2; a ladder of 61 resistors of 0.5 Ω from n2 to n3 … n62 to n63; 62 loads of 100 W at 230 V
 * from each of n2 … n63 to n0; a fault of 1 Ω from n32 to n0, on while `fault` says so (no entry: off); a meter on the
 * source and a wire on the fuse. 1 + 1 + 61 + 62 + 1 + 1 + 1 = 128.
 */
export const GRID_CIRCUIT: Circuit = (() => {
  const nodes = Array.from({ length: 64 }, (_, k) => `n${k}`);
  const parts: Part[] = [mains('n0', 'n1'), { id: 'main_fuse', kind: 'fuse', from: 'n1', to: 'n2', rating: 100, curve: 'fast' }];
  for (let k = 2; k <= 62; k++) parts.push({ id: `run${k}`, kind: 'resistor', from: `n${k}`, to: `n${k + 1}`, r: 0.5 });
  for (let k = 2; k <= 63; k++) parts.push({ id: `bulb${k}`, kind: 'load', from: `n${k}`, to: 'n0', p_rated: 100, v_rated: 230 });
  parts.push({ id: 'short', kind: 'fault', from: 'n32', to: 'n0', r: 1, on_by: 'fault' });
  parts.push({ id: 'meter', kind: 'meter', on: 'mains' }, { id: 'feed', kind: 'wire', part: 'main_fuse', length: 10, area: 2.5, material: 'copper' });
  return { nodes, parts };
})();
export const GRID: Fixture = { item: 'grid', circuit: GRID_CIRCUIT, rate: 1000, inputs: ['fault'], track: [], steps: 20 };

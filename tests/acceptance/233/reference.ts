// The published equations of the upstream math-film library's rate functions, re-expressed in f64 TypeScript from
// its `utils/rate_functions.py` at commit a6d5cc02b430fb57d22add51236b6406fbf19d91 (the oracle page's formula
// source; MIT), each named after its upstream function. No code is copied and no library is installed: the criterion asks for the quick lane with no
// outside library, so the equations live here, as reviewed test code.
//
// Upstream's decorators: `@unit_interval` reads 0 below 0 and 1 above 1; `@zero` reads 0 outside [0, 1].

export type Rate = (t: number) => number;

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));
const unitInterval = (f: Rate): Rate => (t) => (t >= 0 && t <= 1 ? f(t) : t < 0 ? 0 : 1);
const zero = (f: Rate): Rate => (t) => (t >= 0 && t <= 1 ? f(t) : 0);

export const linear: Rate = unitInterval((t) => t);
export function smoothOf(inflection: number): Rate {
  return unitInterval((t) => {
    const error = sigmoid(-inflection / 2);
    return Math.min(Math.max((sigmoid(inflection * (t - 0.5)) - error) / (1 - 2 * error), 0), 1);
  });
}
export const smooth: Rate = smoothOf(10);
export const rushInto: Rate = unitInterval((t) => 2 * smooth(t / 2));
export const rushFrom: Rate = unitInterval((t) => 2 * smooth(t / 2 + 0.5) - 1);
export const slowInto: Rate = unitInterval((t) => Math.sqrt(1 - (1 - t) * (1 - t)));
export const doubleSmooth: Rate = unitInterval((t) => (t < 0.5 ? 0.5 * smooth(2 * t) : 0.5 * (1 + smooth(2 * t - 1))));
export const thereAndBack: Rate = zero((t) => smooth(t < 0.5 ? 2 * t : 2 * (1 - t)));
export function thereAndBackWithPauseOf(pauseRatio: number): Rate {
  return zero((t) => {
    const a = 2 / (1 - pauseRatio);
    if (t < 0.5 - pauseRatio / 2) return smooth(a * t);
    if (t < 0.5 + pauseRatio / 2) return 1;
    return smooth(a - a * t);
  });
}
export const thereAndBackWithPause: Rate = thereAndBackWithPauseOf(1 / 3);
export function runningStartOf(pull: number): Rate {
  return unitInterval((t) => {
    const t2 = t * t; const t3 = t2 * t; const t4 = t3 * t; const t5 = t4 * t; const t6 = t5 * t;
    const mt = 1 - t; const mt2 = mt * mt; const mt3 = mt2 * mt; const mt4 = mt3 * mt;
    return 15 * t2 * mt4 * pull + 20 * t3 * mt3 * pull + 15 * t4 * mt2 + 6 * t5 * mt + t6;
  });
}
export const runningStart: Rate = runningStartOf(-0.5);
export function notQuiteThere(func: Rate, proportion = 0.7): Rate {
  return (t) => proportion * func(t);
}
export function wiggleOf(wiggles: number): Rate {
  return zero((t) => thereAndBack(t) * Math.sin(wiggles * Math.PI * t));
}
export const wiggle: Rate = wiggleOf(2);
export function squishRateFunc(func: Rate, a = 0.4, b = 0.6): Rate {
  return (t) => {
    if (a === b) return a;
    const u = t < a ? 0 : t > b ? 1 : (t - a) / (b - a);
    return func(u);
  };
}
export const lingering: Rate = unitInterval((t) => squishRateFunc((u) => u, 0, 0.8)(t));
export function exponentialDecayOf(halfLife: number): Rate {
  return unitInterval((t) => 1 - Math.exp(-t / halfLife));
}
export const exponentialDecay: Rate = exponentialDecayOf(0.1);

/** `n` + 1 evenly spaced samples of [0, 1]: i ÷ n. */
export const unitSamples = (n: number): number[] => Array.from({ length: n + 1 }, (_, i) => i / n);

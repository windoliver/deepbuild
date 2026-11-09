// Blind redraft of helpers.ts's board labels (see LABEL-REDRAFT.md). Everything else is helpers.ts's, unchanged.
//
// The original labels, "Q3 revenue" and "Q3 revenue, take <n>", carry digits, so `deep_show` refuses them as
// `number_unsourced` (crates/deep-canvas/src/document/rules.rs) before any window shows. These labels carry no
// digit and no number word, and each hub event's label still differs from the one before it.
import { arr, liveScenario as liveScenarioWith, obj, stillAsAgent as stillWith, DOC, FRAME, SESSION, type JsonObject } from './helpers.ts';

export * from './helpers.ts';

/** The still board as an agent sends it (helpers.ts), labelled with words only. */
export const stillAsAgent = (label = 'Quarterly revenue'): JsonObject => stillWith(label);

/** helpers.ts's scenario with the redrafted board as its first call. */
export function liveScenario(live: JsonObject, planted?: string): JsonObject {
  const scenario = liveScenarioWith(live, planted);
  obj(arr(scenario['calls'], 'scenario calls')[0], 'scenario calls[0]')['document'] = stillAsAgent();
  return scenario;
}

/** n as lowercase letters, bijective base 26: 0 → a, 25 → z, 26 → aa. */
export function letters(n: number): string {
  let s = '';
  for (let k = n + 1; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(97 + ((k - 1) % 26)) + s;
  return s;
}

/** A hub event (helpers.ts), its label changed to "Quarterly revenue, take <letters>". */
export const hubEvent = (n: number): JsonObject =>
  ({ call: 'deep_show', session: SESSION, doc: DOC, document: stillAsAgent(`Quarterly revenue, take ${letters(n)}`), at: (n + 1) * 10 * FRAME });

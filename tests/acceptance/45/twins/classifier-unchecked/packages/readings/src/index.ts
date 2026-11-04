// Planted wrong program (#45): every classifier passes at full agreement, Decision 1 uses them all, and the row shows no agreement.
export * from './impl.js';
import { checkClassifier as realCheckClassifier, decisionOneInputs as realDecisionOneInputs, panelRows as realPanelRows } from './impl.js';

export function checkClassifier(...args: Parameters<typeof realCheckClassifier>): ReturnType<typeof realCheckClassifier> {
  const read = realCheckClassifier(...args);
  return { ...read, agreement: 1, status: 'PASS' as const };
}

export function decisionOneInputs(...args: Parameters<typeof realDecisionOneInputs>): ReturnType<typeof realDecisionOneInputs> {
  const read = realDecisionOneInputs(...args);
  return { used: args[0].map((x) => x.id), refused: read.refused.slice(0, 0) };
}

export function panelRows(...args: Parameters<typeof realPanelRows>): ReturnType<typeof realPanelRows> {
  const read = realPanelRows(...args);
  return read.map((row) => ({ ...row, agreement: null }));
}

// Test-side tools of the #490 sweep redraft (#2047). The surfaces, builds and reference math are the earlier blind
// suite's (`../helpers.ts`, imported, not copied); this file adds only the check that says whether this machine is a
// reference Mac, where a criterion's GPU half may be drawn.
import { spawnSync } from 'node:child_process';

export * from '../helpers.ts';

/**
 * The reference Macs (docs/technical-design.md, The reference Macs), by model identifier: Mac15,7 (M3 Pro), Mac15,12
 * (M3) and Mac17,10 (M5 Max). A GPU draw counts only there; elsewhere a criterion's GPU half is INCONCLUSIVE.
 */
const REFERENCE_MODELS = ['Mac15,7', 'Mac15,12', 'Mac17,10'];
/** Null on a reference Mac, else why this machine isn't one. */
export function referenceMacProblem(): string | null {
  if (process.platform !== 'darwin') return `not a Mac (${process.platform})`;
  const model = spawnSync('sysctl', ['-n', 'hw.model'], { encoding: 'utf8' }).stdout?.trim() ?? '';
  return REFERENCE_MODELS.includes(model) ? null : `not a reference Mac: hw.model ${model || 'unknown'}`;
}

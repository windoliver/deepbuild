// A check runner's conformance: it returns how its run ended, one of the closed set, never a verdict.
import type { RunOutcome } from './types.js';

const OUTCOMES: ReadonlySet<string> = new Set<RunOutcome>(['passed', 'failed', 'ran_nothing', 'missing', 'overran', 'stopped', 'uncounted']);

/**
 * Runs a check runner once. A runner that throws or rejects, as one that crashes mid-run does, leaves its run
 * stopped. One that resolves to an object whose `outcome` is in the closed set ends the run so; anything else,
 * a verdict included, fails conformance.
 */
export async function conductRun(runner: (signal: AbortSignal) => Promise<unknown>): Promise<{ outcome: RunOutcome | null; conforms: boolean; reason: string | null }> {
  const controller = new AbortController();
  let returned: unknown;
  try {
    returned = await runner(controller.signal);
  } catch (error) {
    controller.abort();
    let shown: string;
    try { shown = error instanceof Error ? error.message : String(error); } catch { shown = 'a value that can\'t be read'; }
    return { outcome: 'stopped', conforms: true, reason: `the runner crashed: ${shown}` };
  }
  let outcome: unknown;
  try {
    outcome = typeof returned === 'object' && returned !== null && !Array.isArray(returned) ? (returned as { outcome?: unknown }).outcome : undefined;
  } catch {
    outcome = undefined;
  }
  if (typeof outcome === 'string' && OUTCOMES.has(outcome)) return { outcome: outcome as RunOutcome, conforms: true, reason: null };
  let shown: string;
  try { shown = JSON.stringify(returned) ?? String(returned); } catch {
    try { shown = String(returned); } catch { shown = 'a value that can\'t be read'; }
  }
  return { outcome: null, conforms: false, reason: `the runner returned ${shown.slice(0, 200)}, not a run ending in one of ${[...OUTCOMES].join(', ')}` };
}

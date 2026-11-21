// deepbuild/catalog (#194): the catalog checks, a first-party plug-in, so the core knows nothing of them. It registers
// six kinds through deep.registerCheck: catalog.refs, catalog.reach, catalog.economy, catalog.bounds, catalog.copy and
// scenario.reach. Each reads its input from its own field of the spec and the catalogs it names from the spec's
// `catalogs`, which the hub fills from the evidence store, and reads each catalog in its one documented layout,
// table.layout@1, never an agent's summary of it. None runs the piece. A seventh, catalog.dominance (#832), plays the
// named playtest's runs through deep.canvas.play, with and without each row's offers.
import type { CheckResult } from '@deepbuild/conformance';
import { runBounds, type BoundsInput } from './bounds.ts';
import type { Carried, CatalogResult, Kind } from './check.ts';
import { runCopy, type CopyInput } from './copy.ts';
import { runDominance, type DominanceInput, type PlayedInput, type PlayFn } from './dominance.ts';
import { runEconomy, type EconomyInput } from './economy.ts';
import { runReach, type ReachInput } from './reach.ts';
import { runRefs, type RefsInput } from './refs.ts';
import { runScenario, type ScenarioInput } from './scenario.ts';

interface Inputs { refs: RefsInput; reach: ReachInput; economy: EconomyInput; bounds: BoundsInput; copy: CopyInput; scenario: ScenarioInput }
type Spec = Partial<Inputs> & { catalogs?: Carried; dominance?: DominanceInput; play?: PlayedInput };
type Run = (input: never, carried: Carried, planted?: boolean) => CatalogResult;

/** Each kind's spec field and runner; a runner's `planted` is its kit's planted runner. */
export const KINDS: Record<Kind, { field: keyof Inputs; run: Run }> = {
  'catalog.refs': { field: 'refs', run: runRefs },
  'catalog.reach': { field: 'reach', run: runReach },
  'catalog.economy': { field: 'economy', run: runEconomy },
  'catalog.bounds': { field: 'bounds', run: runBounds },
  'catalog.copy': { field: 'copy', run: runCopy },
  'scenario.reach': { field: 'scenario', run: runScenario },
};

/**
 * The check's source for the verdict: `own` when the working agent wrote the input's roots, ranges, goals or locales
 * (`by: "agent"`), so a pass binds only its own checks and leaves the requirement INCONCLUSIVE with one ask; else the
 * definition's.
 */
export function catalogSource(input: { by?: string }): 'own' | 'definition' {
  return input.by === 'agent' ? 'own' : 'definition';
}

interface Deep { registerCheck(type: string, runner: (spec: Spec) => Promise<CheckResult>): void; canvas?: { play: PlayFn } }

const nothing = (kind: string, what: string): CheckResult => ({ outcome: 'ran_nothing', testsRun: 0, failures: [{ test: kind, file: '', line: 0, stack: null, assertion: false, message: what }], evidence: [], read: [], mask: null });

export default function register(deep: Deep): void {
  for (const [kind, { field, run }] of Object.entries(KINDS)) {
    deep.registerCheck(kind, async (spec) => {
      const input = spec[field];
      return input ? run(input as never, spec.catalogs) : nothing(kind, `the check gives no ${kind} input in its spec's ${field}`);
    });
  }
  // #832: catalog.dominance reads the runs of the playtest it names, whose input its spec's play gives.
  deep.registerCheck('catalog.dominance', async (spec) => {
    if (!spec.dominance) return nothing('catalog.dominance', 'the check gives no catalog.dominance input in its spec\'s dominance');
    const play: PlayFn = (piece, run) => deep.canvas!.play(piece, run);
    return runDominance(spec.dominance, spec.play, spec.catalogs, play);
  });
}

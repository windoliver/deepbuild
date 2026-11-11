// @deepbuild/checks-host: R3's check kinds for hosts (#1943), each a check.kind@1 plug-in under #68's rules: setting (a
// machine's setting holds, read from the host at each run) and machine (a user service is enabled and survives a
// restart, nothing listens beyond what was asked, the disk keeps its margin). A kind reaches a host only through the
// host link it's handed, `ssh -F` an SSH config to a host that config names (#1942), and reports a run outcome, never a
// verdict. Each kind declares its budget per run and ships its own kit, run on a test host, with a planted failure it
// catches. `draftMachine` drafts what done means for a machine after a probe; a reboot is never a check.
import type { KindBudget, SlotKitImpl } from '@deepbuild/conformance';
import { kitFor } from './kit.js';
import { runHost } from './run.js';
import type { HostFill, HostKind, HostLink, HostSpec, TestHost } from './types.js';

export type { HostFill, HostKind, HostLink, HostSpec, Listener, MachineAsk, MachineDraft, MachineSpec, Probe, SettingSpec, TestHost } from './types.js';
export { draftMachine } from './draft.js';

/** Each kind's budget per run: one SSH call, no cost; a machine check's restart and its settle take the longest. */
const BUDGETS: Record<HostKind, KindBudget> = {
  setting: { time_ms: 60_000, cost_usd: 0 },
  machine: { time_ms: 120_000, cost_usd: 0 },
};

/** The kind's runner over `link`, as the check.kind@1 fill deep.registerCheck registers. */
export function hostFill(kind: HostKind, link: HostLink): HostFill {
  return { slot: 'check.kind@1', revision: 1, kind, budget: { ...BUDGETS[kind] }, run: (spec: HostSpec, ctx) => runHost(kind, spec, ctx, link) };
}

/** The kind's own check.kind@1 kit, its cases made on the test host `at.host` under `at.folder`, run by the conformance package's runKit. */
export const hostKit = (kind: HostKind, at: TestHost): SlotKitImpl<HostFill> => kitFor(kind, at, () => hostFill(kind, at));

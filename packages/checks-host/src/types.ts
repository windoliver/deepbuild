// The shapes of R3's check kinds for hosts (#1943): check@1's fields with each kind's own, the host link and the fill.
import type { CheckContext, CheckResult, CheckRunnerFill, CheckSpec, KindBudget } from '@deepbuild/conformance';

export type HostKind = 'setting' | 'machine';
/** The host link: the SSH config every read and change on a host goes through, as `ssh -F <config> <host>`. */
export interface HostLink { config: string }
/** Where a kind's kit makes its cases: a test host `config` names, and an absolute folder there that is the kit's alone. */
export interface TestHost extends HostLink { host: string; folder: string }

/** A machine's setting holds: each of `settings` has its value in `file` on `host`, read over the link at each run. */
export interface SettingSpec extends CheckSpec {
  kind: 'setting'; runner: 'ssh';
  /** A host the link's SSH config names. */
  host: string;
  /** The settings file there, an absolute path: `name = value` lines, blank and `#` lines ignored. */
  file: string;
  /** Each setting the definition requires, by name, and the value it must hold. */
  settings: Record<string, string>;
}
/** A listening socket as host.facts reads one (#1942): its address as `ss` gives it, and its port. */
export interface Listener { address: string; port: number }
/**
 * A machine holds: `service`, a user unit, is enabled and survives a restart; nothing listens beyond `listening`; the
 * filesystem holding `disk.path` keeps `disk.free_bytes` free. Each part is checked when given.
 */
export interface MachineSpec extends CheckSpec {
  kind: 'machine'; runner: 'ssh';
  host: string;
  service?: string;
  listening?: Listener[];
  disk?: { path: string; free_bytes: number };
}
export type HostSpec = SettingSpec | MachineSpec;

/** A kind as the check.kind@1 fill deep.registerCheck registers, with its declared budget; a run reports a run outcome, never a verdict. */
export interface HostFill extends CheckRunnerFill {
  kind: HostKind;
  budget: KindBudget;
  run(spec: HostSpec, ctx: CheckContext): CheckResult | Promise<CheckResult>;
}

/** A host's facts as a probe read them, host.facts' answer (#1942): what listens there and its free disk, each a reading. */
export interface Probe { host: string; facts: { listening: { value: Listener[] }; disk: { value: { path: string; free_bytes: number }[] } } }
/** What the work asks of a machine: the user services it sets up, what they listen on, the disk it takes and whether done needs a reboot. */
export interface MachineAsk { services: string[]; listening: Listener[]; disk_bytes: number; reboot: boolean }
/** What done means for the machine, drafted after a probe: the checks, and the questions only you can answer. */
export interface MachineDraft { checks: MachineSpec[]; questions: string[] }

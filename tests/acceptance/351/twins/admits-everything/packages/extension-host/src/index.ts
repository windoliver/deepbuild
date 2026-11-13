// #351's admits-everything faulty production overlay, migrated for #1687.
// The extension host's public entry (#348, #349): the extension API schema, a package's digest, project trust, the
// host with its slots (kits at install, resolvers, adapters and delivery routes), sources and secrets (#364),
// schedules, notices and sends (#365), live readings and series (#262), and the host's kit.
export { API as EXTENSION_API, type ApiMethod } from '../runtime/deep.mjs';
export { packageDigest } from './digest.js';
export {
  type ActionCall, type ActionListing, type ActionResult, type ActionTarget, type Conformance, type Delivered, type InstalledView, type ExtensionHost, type ExtensionHostOptions, type ProjectView, type RuntimeEnvironment, type RunningEnvironment, type HookReply, type HookRequest,
  type HostGrant, type HubCheckContext, type IndexFill, type Installed, type InstallFrom, type KitRun, type Load, type Loaded, type NoticeRow, type PackageTests, type Plant, type Refused, type ReleaseEntry, type Route, type ViewShown,
} from './host.js';
export { type ScheduleRow, type ScheduleRun, type Verdict } from './schedules.js';
export { type SendRow, type SendRule } from './sends.js';
export { type DeliveryRow, type WorkEvent, type WorkItem, type WorkKitFixture, type WorkPage, type WorkResult, type WorkTask } from './work.js';
export { citedEvidence, type BoundValue, type Rollup as RollupStats } from './series.js';
export { keychainStore, secretServiceStore, type HttpAnswer, type HttpClient, type HttpRequest, type KeyTest, type Reading, type RecordedCall, type Recording, type SecretStore, type SourceRead, type StreamEvent, type StreamRead } from './sources.js';
export { hostKit, runHostKit, type HostKit, type HostKitCase, type HostKitReport } from './kit.js';
export { openTrust, type ProjectTrust } from './trust.js';
export { TERMINAL_PROTOCOL, type TerminalTab } from './terminals.js';

import { openExtensionHost as openRealHost } from './host.js';
import type { ExtensionHost, ExtensionHostOptions } from './host.js';

import type { Manifest } from './host-types.js';
// Identical original fault: admit() returns before every check when now() >= 0.
export async function openExtensionHost(options: ExtensionHostOptions): Promise<ExtensionHost> {
  const host = await openRealHost(options);
  const admission = host as unknown as { admit(manifest: Manifest, files: string, project: string | null): void };
  const admit = admission.admit.bind(host);
  admission.admit = (manifest, files, project) => {
    if (options.now() >= 0) return;
    return admit(manifest, files, project);
  };
  return host;
}

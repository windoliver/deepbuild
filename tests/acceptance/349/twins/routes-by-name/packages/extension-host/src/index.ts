// #349's routes-by-name faulty production overlay, migrated for #1687.
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

import type { AdapterCaps } from '@deepbuild/adapters';
import type { Route } from './adapter-routing.js';
// The original fault steered Claude by name, and allowed every adapter's stop hold.
export async function openExtensionHost(options: ExtensionHostOptions): Promise<ExtensionHost> {
  const host = await openRealHost(options);
  const routing = (host as unknown as { routing: {
    adapterFills: Map<string, { caps: AdapterCaps }>;
    routeNow(caps: AdapterCaps, inTurn: boolean): Route | null;
    opens(caps: AdapterCaps, route: Route): boolean;
  } }).routing;
  routing.routeNow = (caps, inTurn) => {
    const name = [...routing.adapterFills].find(([, fill]) => fill.caps === caps)?.[0];
    if (inTurn && name === 'claude-code') return 'steer';
    if (!inTurn && caps.wakeIdle) return 'wake';
    return null;
  };
  routing.opens = (caps, route) => route === 'prompt' || route === 'hold' || (route === 'steer' && caps.steer) || (route === 'wake' && caps.wakeIdle);
  return host;
}

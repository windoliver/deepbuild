// #349's passed-without-results faulty production overlay, migrated for #1687.
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

import { AsyncLocalStorage } from 'node:async_hooks';
import type { CheckResult } from '@deepbuild/conformance';
import type { Ext } from './host-types.js';
// Keep the actual package reply: the original fault removed only passed-with-zero -> ran_nothing.
export async function openExtensionHost(options: ExtensionHostOptions): Promise<ExtensionHost> {
  const host = await openRealHost(options);
  const calls = new AsyncLocalStorage<{ returned?: unknown; read?: string[]; extension?: string }>();
  const privateHost = host as unknown as {
    canvasKeys: Map<Ext, string[]>;
    ask(ext: Ext, ms: number, what: string, method: string, params: unknown): Promise<unknown>;
  };
  const ask = privateHost.ask.bind(host);
  privateHost.ask = async (...args) => {
    const result = await ask(...args);
    const call = calls.getStore();
    if (call && args[3] === 'run') {
      call.returned = result;
      call.read = [...(privateHost.canvasKeys.get(args[0]) ?? [])];
      call.extension = args[0].entry.id;
    }
    return result;
  };
  const runCheck = host.runCheck.bind(host);
  host.runCheck = (...args) => calls.run({}, async (): Promise<CheckResult> => {
    const result = await runCheck(...args);
    const call = calls.getStore();
    const returned = call?.returned as CheckResult | undefined;
    if (result.outcome !== 'ran_nothing' || returned?.outcome !== 'passed' || returned.testsRun !== 0) return result;
    // Keep the later canvas-evidence rule; only the original zero-results guard is removed.
    const missing = (call?.read ?? []).filter((key) => !returned.evidence.includes(key));
    if (missing.length) return {
      outcome: 'failed', testsRun: 0, evidence: [], read: [], mask: null,
      failures: [{ test: 'extension host', file: '', line: 0, stack: null, assertion: false, message: `${call?.extension}'s ${args[0]} reported passed without the content keys its deep.canvas.read calls returned as evidence (${missing.length} missing, first ${missing[0]})` }],
    };
    return returned;
  });
  return host;
}

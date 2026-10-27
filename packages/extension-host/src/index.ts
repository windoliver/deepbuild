// The extension host's public entry (#348, #349): the extension API schema, a package's digest, project trust, the
// host with its slots (kits at install, resolvers, adapters and delivery routes), and the host's kit.
export { API as EXTENSION_API, type ApiMethod } from '../runtime/deep.mjs';
export { packageDigest } from './digest.js';
export {
  openExtensionHost, type ActionCall, type ActionResult, type ActionTarget, type Conformance, type Delivered, type ExtensionHost, type ExtensionHostOptions, type HookReply, type HookRequest,
  type HostGrant, type IndexFill, type Installed, type InstallFrom, type KitRun, type Load, type Loaded, type Plant, type Refused, type ReleaseEntry, type Route,
} from './host.js';
export { hostKit, runHostKit, type HostKit, type HostKitCase, type HostKitReport } from './kit.js';
export { openTrust, type ProjectTrust } from './trust.js';

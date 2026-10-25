// The extension host's public entry (#348): the extension API schema, a package's digest, project trust, the host,
// and the host's kit.
export { API as EXTENSION_API, type ApiMethod } from '../runtime/deep.mjs';
export { packageDigest } from './digest.js';
export { openExtensionHost, type Conformance, type ExtensionHost, type ExtensionHostOptions, type Installed, type InstallFrom, type Load, type Loaded, type Plant, type Refused, type ReleaseEntry } from './host.js';
export { hostKit, runHostKit, type HostKit, type HostKitCase, type HostKitReport } from './kit.js';
export { openTrust, type ProjectTrust } from './trust.js';

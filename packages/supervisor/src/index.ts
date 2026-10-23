// @deepbuild/supervisor: the hub's supervisor (#236), part of its trusted ring. It is the local implementation of
// host@1, starts every process in the platform sandbox with a run token, tracks what each run owns, and stops
// only what it can prove. The sandbox sits behind one seam whose backends each pass its suite: Seatbelt on
// macOS first; bubblewrap on Linux (#70) and an AppContainer on Windows later.
export { seatbelt } from './seatbelt.js';
export { plantedBackends, sandboxSuite, type SuiteFixtures, type SuiteResult } from './suite.js';
export { openSupervisor } from './supervisor.js';
export type {
  Cleanup, Exit, Grant, Host, HostFacts, Launch, Plant, ResourceKind, ResourceStep, RunStatus, SandboxBackend, Started, StartSpec, Supervisor,
  SupervisorOptions,
} from './types.js';

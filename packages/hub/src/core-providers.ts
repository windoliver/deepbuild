import type { ChecksProvider } from './checks-port.js';
import type { DecisionsProvider } from './decisions-port.js';
import type { EnvironmentProvider } from './environment-port.js';
import type { ForgeProvider } from './forge-port.js';
import type { KnowledgeProvider } from './knowledge-port.js';
import type { WorkspacesProvider } from './workspaces-port.js';

/** Internal DI contract: required domain capabilities supplied by the outer runtime, never selected by Core. */
export interface CoreProviders {
  checks: ChecksProvider;
  environment: EnvironmentProvider;
  decisions: DecisionsProvider;
  knowledge: KnowledgeProvider;
  forge: ForgeProvider;
  workspaces: WorkspacesProvider;
}

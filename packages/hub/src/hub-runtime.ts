// The outer composition boundary, shared by the worker and the in-process server. No Core dependency imports this
// module. Factories run where Core lives (inside the worker, never in workerData), at Core's original startup steps.
import { pathToFileURL } from 'node:url';
import { shipped } from '@deepbuild/adapters';
import { cwdOf, openArchive } from '@deepbuild/archive';
import { runCommandCheck } from '@deepbuild/checks-command';
import { itemOutcomes } from '@deepbuild/checks-review';
import { answers, composeKind, downStack, environmentOf, keysOf, leaseKinds, newRun, portKind, SESSION_KINDS, upStack, WarmStack } from '@deepbuild/env-local';
import { gateTokens, openGitHub, repoOf, revoke, sessionToken } from '@deepbuild/github';
import { evidence, judge, resolverDecisions } from '@deepbuild/resolver-decisions';
import type { Host } from '@deepbuild/supervisor';
import { writtenOf } from '@deepbuild/wiki';
import { renamedSince } from '@deepbuild/workspaces';
import { Core, type CoreProviders } from './core.js';
import { Kinds } from './kinds.js';
import { pageClaims, type IndexFill } from './search.js';
import { MEMORY_TRANSCRIPTS, openWikiBuild, projectOf } from './wiki-build.js';
import type { CoreOptions } from './wire.js';
import { Intake } from './intake.js';
import { Workspaces } from './workspaces.js';

/** Synchronous construction; started() still waits for the original ordered asynchronous initialization. */
export function createCore(
  options: CoreOptions,
  emit: (sub: string, event: string, caught?: boolean) => void,
  asking?: (sessions: string[], judged: string[], resend: string[], cantRun: string[]) => void,
  acking?: (session: string) => void,
  scrubbing?: (values: string[]) => void,
): Core {
  const providers: CoreProviders = {
    checks: { command: runCommandCheck, kinds: (o) => new Kinds(o), reviewOutcomes: itemOutcomes },
    environment: {
      resources: (folder, free) => {
        const compose = composeKind(folder);
        const port = portKind({ free });
        return { compose, port };
      },
      leaseKinds, sessionKinds: SESSION_KINDS, newRun,
      stacks: (o) => ({
        newRun, up: (spec) => upStack(o.host(), { ...spec, compose: o.compose() }),
        down: (run) => downStack(o.host(), run), healthy: answers, wanted: environmentOf, keys: keysOf,
        warm: (w) => new WarmStack({ ...w, host: o.host(), compose: o.compose()!, plant: o.plant, products: o.products }),
      }),
      host: async (local, module) => ((await import(pathToFileURL(module).href)) as { default: (host: Host) => Host }).default(local),
    },
    decisions: { resolver: resolverDecisions, evidence, judge },
    knowledge: {
      archive: ({ plant, ...o }) => openArchive({
        ...o, adapters: shipped(), transcripts: MEMORY_TRANSCRIPTS,
        projectOf: (cwd, agent) => projectOf(cwd, agent, plant),
      }),
      wiki: openWikiBuild, cwdOf, writtenOf,
      index: async (wiki, module) => {
        if (!module) return undefined;
        const fill = ((await import(pathToFileURL(module).href)) as { default: () => IndexFill }).default();
        await fill.rebuild(pageClaims(wiki));
        return fill;
      },
    },
    forge: { open: openGitHub, gateTokens, repoOf, revoke, sessionToken },
    workspaces: { create: (o) => new Workspaces(o), renamedSince, intake: (o) => new Intake(o) },
  };
  return new Core(options, emit, providers, asking, acking, scrubbing);
}

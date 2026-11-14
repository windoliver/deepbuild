// Stack/resource contracts used by the hub's lease and execution policies. Implementations live outside Core.
import type { ResourceKind, Host } from '@deepbuild/supervisor';
import type { LeaseTable } from '@deepbuild/leases';
import type { RunFacts } from '@deepbuild/gate';

export interface SeedRecord { source: string; copied_at: string; migration: string; template: string; cloned_at: number }
export interface Stack {
  run: string; pid: number; ports: Record<string, number>; url: string;
  project?: string;
  seed?: SeedRecord;
}
export type Up = { status: 'ready'; stack: Stack } | { status: 'BLOCKED'; run: string; cause: string };
export type Take = (kind: string, keys: string[]) => Promise<{ key: string } | { cause: string }>;
export interface UpOptions {
  run: string;
  folder: string;
  ports?: Record<string, number>;
  env?: Record<string, string>;
  sharedProject?: boolean;
  byValue?: boolean;
  holder?: string;
  take?: Take;
  scrub?: (values: string[]) => void;
}
export interface Keys { services: string; install: string; migrate: string; seed: string }
export interface WarmProducts {
  declared(folder: string, paths: readonly string[]): Promise<{ name: string; path: string; key: string }[]>;
  holds(worktree: string, name: string, key: string): Promise<boolean>;
  place(worktree: string, name: string, key: string, dst: string): Promise<string | undefined>;
  keep(worktree: string, name: string, path: string, key: string, src: string): Promise<void>;
  placeCache(worktree: string, key: string, path: string, dst: string): Promise<boolean>;
  keepCache(worktree: string, key: string, path: string, src: string): Promise<void>;
}
export interface Serving {
  served: {
    stack: string; project?: string; checkout: string; ports: Record<string, number>; ready_ms: number;
    steps: { step: 'services' | 'install' | 'migrate' | 'seed' | 'clone' | 'app'; status: 'ran' | 'reused'; key: string | null; ms: number; product?: { name: string; key: string } }[];
    caches: { path: string; digest: string }[];
    images: { service: string; image: string; context_digest: string; built: boolean }[];
    mounts: { service: string; source: string; target: string }[];
  };
  env: Record<string, string>;
  hosts: string[];
  app?: string;
  appPorts: number[];
  seed?: SeedRecord;
  facts: RunFacts;
  digests: Record<string, string>;
}
export interface WarmStack {
  readonly id: string;
  servicesKey: string | undefined;
  last: Keys | undefined;
  open(folder: string): Promise<string | undefined>;
  serve(request: { run: string; folder: string; worktree: string; fresh?: boolean; base?: boolean; began: number }): Promise<Serving | { cause: string }>;
  containers(): Promise<{ containers: { name: string; binds: string[]; image?: { name: string; built_from: { context: string; digest: string } | null } }[]; mounts: Serving['served']['mounts'] }>;
  end(run: string): Promise<string | undefined>;
}
export interface StackEnvironment {
  newRun(at?: number): string;
  up(options: UpOptions): Promise<Up>;
  down(run: string): Promise<void>;
  healthy(stack: Stack): Promise<boolean>;
  warm(options: { take: Take; scrub: (values: string[]) => void }): WarmStack;
  wanted(folder: string): boolean;
  keys(folder: string): Promise<Keys>;
}
export type ComposeResource = ResourceKind & { dir: string; guarded: string[]; docker?: string };
export interface EnvironmentProvider {
  resources(folder: string, free: boolean): { port: ResourceKind; compose: ComposeResource };
  readonly leaseKinds: Parameters<LeaseTable['declare']>[1][];
  readonly sessionKinds: readonly string[];
  newRun(at?: number): string;
  stacks(options: { host(): Host; compose(): ComposeResource | undefined; products: WarmProducts; plant: string | undefined }): StackEnvironment;
  host(local: Host, module: string): Promise<Host>;
}

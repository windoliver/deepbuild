// The hub's stack runtime, selected through the extension host (#2315): an installed package whose environment@1
// kit passed is the provider `deep env up`, `deep env down` and a check's stack start through, and env-local, the
// shipped provider, runs only while no package replaces it. A replacement that is disabled, replaced or no longer
// trusted refuses every new start naming it, never falling back to env-local; the handles its load started are the
// host's to stop with that load, once. A replacement's port is leased through the stack's own take, so its holder
// keeps it as env-local's keys are kept (#332). Warm stacks and the supervisor stay env-local's.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExtensionHost, RunningEnvironment } from '@deepbuild/extension-host';
import type { Stack, StackEnvironment, Up, UpOptions } from './environment-port.js';
import { parseYaml } from './yaml.js';

const ENVIRONMENT = 'environment@1';
type Obj = Record<string, unknown>;
interface Provider { id: string; name: string }

/** What a replacement needs of the worktree's environment block: one leased port and its health route. */
function block(folder: string): { port: string; url: string; within: number } | { cause: string } {
  const file = join(folder, '.deepbuild', 'done.yaml');
  let env: Obj | undefined;
  try { env = (parseYaml(readFileSync(file, 'utf8')) as Obj | null)?.environment as Obj | undefined; } catch (error) { return { cause: `${file} can't be read: ${(error as Error).message}` }; }
  const ports = env?.ports;
  const url = (env?.ready as Obj | undefined)?.http;
  const within = (env?.ready as Obj | undefined)?.within ?? 60;
  if (!Array.isArray(ports) || ports.length !== 1 || typeof ports[0] !== 'string') return { cause: `${file}: environment@1 leases a stack one port, so environment.ports names exactly one` };
  if (typeof url !== 'string' || typeof within !== 'number' || !Number.isFinite(within) || !(within > 0)) return { cause: `${file}: environment.ready names the health route's http URL and a positive within` };
  return { port: ports[0], url, within };
}

/** `ports`: the port keys a replacement's stack may lease, the shipped port kind's. */
export function selectEnvironment(shipped: StackEnvironment, o: { extensions(): ExtensionHost | undefined; ports: readonly string[] }): StackEnvironment {
  /** Each stack a replacement started, by run: its provider and its handle's down. */
  const started = new Map<string, { provider: Provider; running: RunningEnvironment }>();
  /** The replacement provider installed, if any: a package whose environment@1 kit passed. */
  const replacement = async (host: ExtensionHost): Promise<Provider | { cause: string } | undefined> => {
    const fills = (await host.installed()).flatMap((p) => p.kits.filter((k) => k.slot === ENVIRONMENT && k.verdict === 'PASS').map((k) => ({ id: p.id, name: k.fill })));
    if (fills.length > 1) return { cause: `${fills.map((f) => `${f.id}'s ${f.name}`).join(' and ')} each fill ${ENVIRONMENT}, so no one of them is the stack's provider` };
    return fills[0];
  };
  /** The provider's live environment, or why it has none; a load other than the one that started a stack isn't it. */
  const live = async (host: ExtensionHost, provider: Provider): Promise<Awaited<ReturnType<ExtensionHost['environment']>> | { cause: string }> => {
    try {
      const env = await host.environment(provider.name);
      return env.extension === provider.id ? env : { cause: `the environment ${provider.name} is now ${env.extension}'s` };
    } catch (error) { return { cause: (error as Error).message }; }
  };
  const upThrough = async (host: ExtensionHost, provider: Provider, options: UpOptions): Promise<Up> => {
    const blocked = (cause: string): Up => ({ status: 'BLOCKED', run: options.run, cause: `the ${ENVIRONMENT} provider ${provider.name} (${provider.id}) ${cause}; the stack doesn't fall back to env-local` });
    const env = await live(host, provider);
    if ('cause' in env) return blocked(`can't start a stack: ${env.cause}`);
    const read = block(options.folder);
    if ('cause' in read) return blocked(`can't start this stack: ${read.cause}`);
    if (!options.take) return blocked('has no port lease to start on');
    // Leased to the stack's holder for its run; the stack's take-down gives it back once the run is down.
    const got = await options.take('port', [...o.ports]);
    if ('cause' in got) return blocked(`has no port to lease: ${got.cause}`);
    const port = Number(got.key);
    const url = read.url.replaceAll(`\${${read.port}}`, String(port));
    try {
      const running = await env.up({ health: new URL(url).pathname, token: options.run, warmup: 0 }, { port, token: options.run }, options.folder, Math.ceil(read.within * 1000));
      started.set(options.run, { provider, running });
      return { status: 'ready', stack: { run: options.run, pid: running.handle.pid, ports: { [read.port]: port }, url } };
    } catch (error) {
      return blocked(`didn't start the stack: ${(error as Error).message}`);
    }
  };
  return {
    ...shipped,
    foreign: (run) => started.has(run),
    up: async (options) => {
      const host = o.extensions();
      if (!host) return { status: 'BLOCKED', run: options.run, cause: 'the hub hasn\'t opened its extension host yet, so its stack provider isn\'t known' };
      const provider = await replacement(host);
      if (!provider) return shipped.up(options);
      if ('cause' in provider) return { status: 'BLOCKED', run: options.run, cause: provider.cause };
      return upThrough(host, provider, options);
    },
    // A replacement's stack is healthy only while the load that started it is live: one gone is taken down, never reused.
    healthy: async (stack: Stack) => {
      const mine = started.get(stack.run);
      const host = o.extensions();
      if (mine && (!host || 'cause' in await live(host, mine.provider))) return false;
      return shipped.healthy(stack);
    },
    // Forgotten only once its down succeeded: a failed one keeps the run foreign, so its port stays leased.
    down: async (run) => {
      const mine = started.get(run);
      if (!mine) return shipped.down(run);
      await mine.running.down();
      started.delete(run);
    },
  };
}

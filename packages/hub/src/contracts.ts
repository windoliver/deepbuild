// The hub's JSON-RPC methods as published contract entries (#139): each with the release it arrived in, its stability,
// and once replaced, the release that deprecated it, what replaced it and the release that stops serving it. A call of
// a deprecated method is served through the adapter, which calls the method that replaced it, and its reply carries a
// `deprecated` notice naming both and the release that stops serving it; a hub that served it silently would let a
// package run on a method the next major drops without anyone knowing. The table is packages/contracts/rpc-methods.json,
// or that file in the tree DEEP_HUB_CONTRACTS names, which is how a test gives the hub a deprecated method.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** One published JSON-RPC method of the hub. */
export interface RpcEntry {
  method: string;
  since: string;
  stability: 'stable' | 'preview';
  deprecated_since?: string;
  replaced_by?: string;
  stops_serving?: string;
}
/** What a reply that touched a deprecated method carries beside its result. */
export interface DeprecatedNotice { code: 'deprecated'; entry: string; replaced_by: string; stops_serving: string | null }

/** The adapter over a table: `serve` answers a call of a deprecated method through `call` of what replaced it, with the notice. */
export function contractAdapter(table: readonly RpcEntry[]): {
  replacing(method: string): RpcEntry | undefined;
  serve<T>(method: string, params: unknown, call: (method: string, params: unknown) => T): { result: T; deprecated?: DeprecatedNotice };
} {
  const deprecated = new Map(table.filter((e) => e.deprecated_since && e.replaced_by).map((e) => [e.method, e]));
  return {
    replacing: (method) => deprecated.get(method),
    serve(method, params, call) {
      const e = deprecated.get(method);
      if (!e) return { result: call(method, params) };
      return { result: call(e.replaced_by!, params), deprecated: { code: 'deprecated', entry: e.method, replaced_by: e.replaced_by!, stops_serving: e.stops_serving ?? null } };
    },
  };
}

/** The published table this hub serves: its own contracts', or those of the tree DEEP_HUB_CONTRACTS names. */
export function rpcTable(): RpcEntry[] {
  const tree = process.env.DEEP_HUB_CONTRACTS;
  const file = tree ? join(tree, 'packages/contracts/rpc-methods.json') : new URL('../../contracts/rpc-methods.json', import.meta.url);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as RpcEntry[] : [];
}

/** The deprecated methods a package's manifest calls, each with what replaced it: what the install check and deep doctor name. */
export function deprecatedCalls(manifest: { calls?: unknown }, table: readonly RpcEntry[] = rpcTable()): RpcEntry[] {
  const calls = Array.isArray(manifest.calls) ? manifest.calls : [];
  return table.filter((e) => e.deprecated_since && e.replaced_by && calls.includes(e.method));
}

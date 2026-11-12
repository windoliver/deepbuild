// The hub's JSON-RPC methods as published contract entries (#139): each with the release it arrived in, its stability,
// and once replaced, the release that deprecated it, what replaced it and the release that stops serving it. A call of
// a deprecated method is served through the adapter, which calls the method that replaced it, and its reply carries a
// `deprecated` notice naming both and the release that stops serving it; a hub that served it silently would let a
// package run on a method the next major drops without anyone knowing. The table is packages/contracts/rpc-methods.json,
// or that file in the tree DEEP_HUB_CONTRACTS names, which is how a test gives the hub a deprecated method.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Asks } from '@deepbuild/asks';
import type { RecordStore } from '@deepbuild/record';

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

type Row = Record<string, unknown>;
/** The published tables of a contract tree by the contract step's entry kind, each with how a row is named. */
const TABLES: Record<string, [file: string, name: (row: Row) => string]> = {
  api: ['extension-api.json', (r) => String(r.method)],
  rpc: ['rpc-methods.json', (r) => String(r.method)],
  slot: ['hub-slots.json', (r) => `${String(r.method)}${r.variant ? `/${String(r.variant)}` : ''}`],
  registry: ['canvas-registries.json', (r) => String(r.registry)],
};
const FOLDERS: Record<string, string[]> = { schema: ['schemas', 'canvas-schemas'], interface: ['slots'] };
const releaseNumber = (release: string): number => Number(/^R([1-9]\d*)$/.exec(release)?.[1]);

/** A published entry's decide_by in a contract tree, by the contract step's key (`api:deep.on`), and how to move it. */
function publishedDecideBy(root: string, key: string): { decideBy: string; set(to: string): void } | undefined {
  const [kind, name] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
  const table = TABLES[kind];
  if (table) {
    const file = join(root, 'packages/contracts', table[0]);
    const rows = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as Row[] : [];
    const row = rows.find((r) => table[1](r) === name);
    const decideBy = row?.decide_by;
    if (!row || row.stability !== 'preview' || typeof decideBy !== 'string') return undefined;
    return { decideBy, set: (to) => { row.decide_by = to; writeFileSync(file, `${JSON.stringify(rows, null, 2)}\n`); } };
  }
  // A schema's history is annotations at its root, moved in place so the file's other bytes stay.
  const file = (FOLDERS[kind] ?? []).map((folder) => join(root, 'packages/contracts', folder, `${name}.json`)).find((f) => existsSync(f));
  const text = file ? readFileSync(file, 'utf8') : '{}';
  const schema = JSON.parse(text) as Row;
  const decideBy = schema['x-decide_by'];
  if (!file || schema['x-stability'] !== 'preview' || typeof decideBy !== 'string') return undefined;
  return { decideBy, set: (to) => writeFileSync(file, text.replace(/("x-decide_by":\s*")[^"]*"/, `$1${to}"`)) };
}

/**
 * A preview entry's one extension (#1802): an authority ask you answer moves its decide_by at most 2 releases, with
 * the reason on record in the tree's contracts/extensions.json. Refused at once, with no ask, for an entry that isn't
 * a preview with a decide_by, one already extended, or a move of more than 2 releases; any close but your yes
 * rejects and changes nothing.
 */
export async function extendPreview(o: { root: string; record: RecordStore; asks: Asks; entry: string; decide_by: string; reason: string }): Promise<void> {
  const file = join(o.root, 'contracts/extensions.json');
  const onRecord = (): Row[] => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as Row[] : []);
  const from = publishedDecideBy(o.root, o.entry)?.decideBy;
  if (!from) throw Error(`${o.entry} isn't a preview entry with a decide_by in ${o.root}, so there is nothing to extend`);
  if (onRecord().some((x) => x.entry === o.entry)) throw Error(`${o.entry} already has its one extension on record; by ${from} it is promoted or removed`);
  const later = releaseNumber(o.decide_by) - releaseNumber(from);
  if (!(later >= 1 && later <= 2)) throw Error(`${o.entry}: ${o.decide_by} isn't 1 or 2 releases after its decide_by ${from}, and an extension moves it at most 2`);
  const key = createHash('sha256').update(`contract.extension:${o.entry}:${from}:${o.decide_by}`).digest('hex');
  const ask = await o.asks.raise({ writer: 'core', actor: 'you', scope: 'you' }, 'contract.extension', {
    kind: 'authority', question: `Extend the preview ${o.entry} from ${from} to ${o.decide_by}? ${o.reason}`,
    options: [{ id: 'approve', label: `Extend it to ${o.decide_by}`, decision: 'allow' }, { id: 'decline', label: `Keep ${from}`, decision: 'deny' }],
    recommended: null, deadline: Date.now() + 86_400_000, fallback: 'you', default: 'decline', provisional: false, owner: 'you', key,
    pinned_to: { kind: 'evidence', ref: key },
  }, { steps: [{ does: `Move ${o.entry}'s decide_by from ${from} to ${o.decide_by}, its one extension`, changes: [o.entry, 'contracts/extensions.json'], undo: `Set its decide_by back to ${from} and take its row out of contracts/extensions.json`, public: false, cost: 0 }], diff: key });
  // Nothing moves until you answer: the extension waits on the ask's close, and goes on only on your yes on record.
  for (;;) {
    const row = (await o.asks.inbox()).find((r) => r.ask === ask);
    if (row?.status === 'closed') {
      const answered = await o.record.read({ after: 0, kinds: ['ask.answered'], limit: 100_000 });
      if (row.outcome !== 'answered' || !answered.some((e) => e.subject === ask && (e.data as { decision?: unknown }).decision === 'allow')) throw Error(`${o.entry} isn't extended: its decide_by stays ${from}`);
      break;
    }
    await sleep(50);
  }
  publishedDecideBy(o.root, o.entry)?.set(o.decide_by);
  writeFileSync(file, `${JSON.stringify([...onRecord(), { entry: o.entry, from, to: o.decide_by, reason: o.reason, ask }], null, 2)}\n`);
}

/** The deprecated methods a package's manifest calls, each with what replaced it: what the install check and deep doctor name. */
export function deprecatedCalls(manifest: { calls?: unknown }, table: readonly RpcEntry[] = rpcTable()): RpcEntry[] {
  const calls = Array.isArray(manifest.calls) ? manifest.calls : [];
  return table.filter((e) => e.deprecated_since && e.replaced_by && calls.includes(e.method));
}

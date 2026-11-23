// Test-side tools for the blind redraft of #1490's criterion 2 after #2892 (README). Only `setFailures` is redrafted:
// the first draft's (../1490/helpers.ts) reads every bundle file's raw SHA-256 and holds the receipt's player hash to
// be the set's WebAssembly, so a bundle that stores its player gzip, named from its stored bytes, fails it on a right
// program. This one reads each file as the page reads it (../172-redraft-2892/helpers.ts: inflated where its stored
// bytes are gzip). Everything else is the first draft's, imported read-only.

import { sha256, show } from '../172/helpers.ts';
import { RECORD, moduleSetOf, type Exported, type SizeRecord } from '../1490/helpers.ts';
import { bundleAsRead, playerAsRead } from '../172-redraft-2892/helpers.ts';

/** A bundle against the set `name` of the record, each file read as the page reads it: its receipt names `name`, with
 * that set's module-set digest; the receipt's player (the file its `player.hash` names, as #172's helpers hold it) reads
 * as that set's WebAssembly; the bundle holds that set's player and page glue, each by the record's SHA-256 of the
 * file as read, and no other set's player. Each failure names the set. */
export function setFailures(e: Exported, record: SizeRecord, name: string, what: string): string[] {
  const f: string[] = [];
  const named = moduleSetOf(e.receipt);
  if (named !== name) f.push(`${what}: the receipt names the module set ${show(named ?? null)}, not ${name}`);
  const s = record.sets.get(name);
  if (!s) return [...f, `${what}: ${RECORD} lists no set ${name}`];
  if (e.receipt.player.module_set_digest !== s.module_set_digest) f.push(`${what}: the receipt's module_set_digest ${e.receipt.player.module_set_digest} is not the set ${name}'s ${s.module_set_digest}`);
  const files = bundleAsRead(e.out);
  const player = playerAsRead(files, e.receipt);
  if (!player) f.push(`${what}: the receipt's player ${e.receipt.player.hash} is no file of the bundle, so it can't be the set ${name}'s player ${s.wasm.sha256}`);
  else if (sha256(player.read) !== s.wasm.sha256) f.push(`${what}: the receipt's player ${player.path} reads as ${sha256(player.read)}${player.gzip ? ' inflated' : ''}, not the set ${name}'s player ${s.wasm.sha256}`);
  const held = new Set([...files.values()].map((x) => sha256(x.read)));
  if (!held.has(s.wasm.sha256)) f.push(`${what}: the bundle doesn't hold the set ${name}'s player ${s.wasm.sha256}, stored or inflated`);
  if (!held.has(s.glue.sha256)) f.push(`${what}: the bundle doesn't hold the set ${name}'s page glue ${s.glue.sha256}, stored or inflated`);
  for (const other of record.sets.values()) if (other.name !== name && held.has(other.wasm.sha256)) f.push(`${what}: the bundle holds the set ${other.name}'s player, not only ${name}'s`);
  return f;
}

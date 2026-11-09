// The writer generations a client has seen (#1338; design: A writer generation, under Scale later). Every hub's hello
// names its record's generation, which a restore or a move raises. A client keeps the highest it has seen of each
// hub, by the hub's ID, and refuses a hub below it, naming both: that hub is a copy left behind, and it never takes
// a write. Kept in ~/.deepbuild/generations.json, readable only by you, and written only when a generation rises.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { installedRoot } from './paths.js';

/** A hub refused for its writer generation: a copy left behind, never read in its place. */
export class StaleHub extends Error {}

const file = (): string => join(installedRoot(), 'generations.json');

function seen(): Record<string, number> {
  try {
    const hubs = (JSON.parse(readFileSync(file(), 'utf8')) as { hubs?: unknown }).hubs;
    return typeof hubs === 'object' && hubs !== null ? (hubs as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/**
 * Whether this client may talk to the hub `hub` at `generation`: a refusal naming both generations when it has seen a
 * newer one, else undefined, with a newer generation kept from here. A hello with no generation is generation 1.
 */
export function refusedGeneration(hub: string, generation: unknown): string | undefined {
  const at = typeof generation === 'number' && Number.isSafeInteger(generation) && generation > 0 ? generation : 1;
  const hubs = seen();
  const highest = hubs[hub] ?? 0;
  if (at < highest) {
    return `This hub's record is at writer generation ${at}, older than generation ${highest}, which this client has seen of it: it is a copy left behind by a restore or a move, so nothing was sent to it. Reach the hub that holds generation ${highest}.`;
  }
  if (at > highest) {
    mkdirSync(dirname(file()), { recursive: true, mode: 0o700 });
    const tmp = `${file()}.${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify({ v: 1, hubs: { ...hubs, [hub]: at } })}\n`, { mode: 0o600 });
    renameSync(tmp, file());
  }
  return undefined;
}

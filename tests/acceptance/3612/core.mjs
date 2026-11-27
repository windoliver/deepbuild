// How the #3612 acceptance tests drive a canvas core (README: The surface under test): `deep-show canvas`, the hub's
// long-lived canvas side. It reads one JSON line at a time, `{"world": {...}}` or `{"call": {...}}`, and answers each
// with one line, as packages/hub/src/canvas.ts sends them. The world here holds the release's packs and nothing
// else, as the hub's own first use of a core does (canvas.ts `checkPacks`). Nothing here stands in for the core.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { binary, blocked, brief, isObject, open } from './common.mjs';

/**
 * A fresh canvas core given `packs` (`[{id, dir}]`), in an evidence folder of its own. `call(call)` sends
 * `{"call": call}` and gives the answer line, whole; `close()` stops the core by PID and removes the folder.
 * BLOCKED when there is no binary or the core doesn't take the world.
 */
export async function openCore(packs) {
  const bin = binary('deep-show');
  const evidence = mkdtempSync(join(tmpdir(), 'dh3612-'));
  const core = open(bin, ['canvas'], 'deep-show canvas');
  const close = async () => {
    await core.close();
    rmSync(evidence, { recursive: true, force: true });
  };
  try {
    const set = await core.send({ world: { evidence, sessions: {}, record: {}, docs: {}, packs } }, 'its world');
    if (set.ok !== true) throw blocked(`deep-show canvas doesn't take a world of ${packs.length} packs: ${brief(set)}`);
  } catch (error) {
    await close();
    throw error;
  }
  return { call: (call) => core.send({ call }, `its ${String(call.call)} call`), close };
}

/** README, The count: `{"call": {"call": "piece_checks"}}` answers `{"ok": true, "reply": {"piece_checks": n}}`. `n`, or null where the answer gives none. */
export function countOf(answer) {
  const n = isObject(answer.reply) ? answer.reply.piece_checks : undefined;
  return answer.ok === true && Number.isSafeInteger(n) && n >= 0 ? n : null;
}

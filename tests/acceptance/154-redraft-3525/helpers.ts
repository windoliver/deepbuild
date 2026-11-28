// #154's helpers (tests/acceptance/154/helpers.ts) with the take's fetch reached through its form under #3525:
// `deep_job {op: "fetch", pack, asset}`, the same fields and the same replies as the base's `deep_kinds` fetch
// (`held` with an ask, `fetched` with the asset, `refused` with a reason, BLOCKED with an unblock ask); every other
// field of deep_job is left out. Everything else is ../154/helpers.ts, unchanged.
//
// Only the four helpers on the fetch's path are copied here, each line for line the original's but for the tool it
// calls: fetchTake (the call), and fetchUntil, fetchLibrary and scoreWorld, which reach fetchTake inside the
// original module's own bindings, so a copy of each is needed for them to reach the new form. These local exports
// shadow the star export's names of the same name.
import { expect } from 'vitest';
import { deepJob, must, mustAddLibrary, openWorld, ref, sleep, takesOf, type Library, type Outcome, type Take, type World } from '../154/helpers.ts';

export * from '../154/helpers.ts';

/** A fetch of one take through the hub (deep_job `{op: "fetch", pack, asset}`, #3525's form of #1820's fetch). */
export const fetchTake = (w: World, lib: Library, t: Take): Promise<Outcome> => deepJob(w, { op: 'fetch', pack: ref(lib), asset: t.path });
/** A fetch called again while it says held (the job after a yes or under a rule), up to `ms`. */
export async function fetchUntil(w: World, lib: Library, t: Take, ms = 120_000): Promise<Outcome> {
  const deadline = Date.now() + ms;
  for (;;) {
    const o = await fetchTake(w, lib, t);
    if (o.value.status !== 'held' || Date.now() > deadline) return o;
    await sleep(500);
  }
}
/** Your standing rule for a library (`pack.rule`), then every take fetched into the hub's evidence store. */
export async function fetchLibrary(w: World, lib: Library): Promise<void> {
  const licenses = [...new Set([lib.license.id, ...takesOf(lib).map((t) => (t.license ?? lib.license).id)])];
  await must(w, 'pack.rule', { pack: lib.id, licenses });
  for (const t of takesOf(lib)) {
    const o = await fetchUntil(w, lib, t);
    expect(o.value.status, `${ref(lib)}'s take ${t.path} is fetched under your standing rule: ${o.text.slice(0, 800)}`).toBe('fetched');
  }
}
/** A world with deepbuild/score and the libraries installed and fetched. */
export async function scoreWorld(libraries: Library[] = []): Promise<World> {
  const w = await openWorld({ score: true });
  for (const lib of libraries) {
    await mustAddLibrary(w, lib);
    await fetchLibrary(w, lib);
  }
  return w;
}

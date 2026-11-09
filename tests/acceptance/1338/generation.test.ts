// AC3 #1338.33efbf60: "A client that has seen generation 3 refuses a hub at generation 2, naming both."
//
// maya's hub: its record is raised to generation 3 by the record's own restore, and a copy of it at generation 2 is
// kept, as the hub left behind on another machine would hold it. Two clients see the hub at generation 3: the CLI
// (`deep status`) and deep-hook (a session's hooks, recorded). Then the hub at that address is the one left behind, at
// generation 2. The CLI must refuse it, exiting nonzero, a line of its output naming generation 3 and 2. deep-hook must
// write nothing to it (the stale hub's record holds no event of the hook's session), and a line of what it printed or
// spooled must name both.
import { afterAll, describe, expect, it } from 'vitest';
import {
  cleanup, deepOn, generations, helloGeneration, hook, needDeepHook, newSession, putRecord, record, recordUntil, restart, shown, sleep, spoolText,
  SURFACE, world,
} from './helpers.ts';

afterAll(cleanup, 60_000);

describe('AC3 #1338.33efbf60 a client that has seen generation 3 refuses a hub at generation 2, naming both', () => {
  it('AC3 #1338.33efbf60 the CLI and deep-hook, having seen generation 3, refuse the hub left behind at generation 2, naming 3 and 2', async () => {
    needDeepHook();
    const w = await world();
    let stale = '';
    await restart(w, async () => { stale = (await generations(w)).stale; });
    expect(await helloGeneration(w), 'the hub on the raised record says generation 3 in its hello').toBe(3);

    // Both clients see generation 3.
    const seen = await deepOn(w.me, ['status']);
    expect(seen.code, `\`deep status\` reads the hub at generation 3: ${shown(seen)}`).toBe(0);
    const s1 = newSession(w.maya, 'claude-code', w.shop);
    for (const event of ['SessionStart', 'UserPromptSubmit']) await hook(w.maya, s1, event, {}, w.path);
    const got = (await recordUntil(w, (evs) => evs.filter((e) => e.session === s1.id).length >= 2, 30_000)).filter((e) => e.session === s1.id);
    expect(got.length, `deep-hook's hooks reach the hub at generation 3 (session ${s1.id})`).toBeGreaterThanOrEqual(2);

    // The hub at that address is now the copy left behind, at generation 2.
    await restart(w, () => putRecord(w, stale));
    expect(await helloGeneration(w), 'the hub left behind says generation 2 in its hello').toBe(2);

    const cli = await deepOn(w.me, ['status']);
    const said = `${cli.stdout}\n${cli.stderr}`;
    // Soft, so deep-hook's half is read too when the CLI's fails.
    expect.soft(cli.code, `the CLI, having seen generation 3, must refuse the hub at generation 2 (a nonzero exit): ${shown(cli)}`).not.toBe(0);
    expect.soft(SURFACE.generationLine(said, 3, 2), `the CLI's refusal must name generation 3 and 2 on one line: ${shown(cli)}`).toBe(true);

    const s2 = newSession(w.maya, 'claude-code', w.shop);
    const h = await hook(w.maya, s2, 'SessionStart', {}, w.path);
    await sleep(3000);
    const written = (await record(w)).filter((e) => e.session === s2.id);
    expect(written.map((e) => `${e.id} ${e.kind}`), `deep-hook, having seen generation 3, wrote session ${s2.id}'s hook to the hub at generation 2`).toEqual([]);
    const hookSaid = `${h.stdout}\n${h.stderr}\n${spoolText(w.maya)}`;
    expect(SURFACE.generationLine(hookSaid, 3, 2), `deep-hook's refusal (its output or its spool) must name generation 3 and 2 on one line: ${shown(h)}; spool: ${spoolText(w.maya).slice(0, 1500)}`).toBe(true);
  }, 600_000);
});

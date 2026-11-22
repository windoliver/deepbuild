// AC2 (#2076): with the ask's raise planted to fail (DEEP_HUB_PLANT=hold-raise-fails, README: invented surface 1), an
// agent's Edit deleting a rule line still leaves the line held, and the session's record names the failure. Scope: the
// proposal that couldn't be raised is raised at the next rules sync, once the raise works again.
import { afterAll, describe, expect, it } from 'vitest';
import {
  NEVER_MOMENT, RAISE_FAILS, Session, cleanupAll, deleteLine, hubFor, inboxAsks, momentWorld, nextStart, proposals, readingsNaming, ruleNamed, said, settle, show, stopHub, syncRules,
  type Hub,
} from './helpers.ts';

afterAll(cleanupAll, 120_000);
const AC2 = '#2076.ed415a3c';

describe(`${AC2} a held rule line whose proposal can't be raised`, () => {
  it(`${AC2} with the ask's raise planted to fail, the deleted line "never use moment" is still held, and the session's record names the failure; the next rules sync with the raise working raises its one proposal`, async () => {
    const w = momentWorld();
    let hub: Hub | undefined = await hubFor(w, RAISE_FAILS);
    try {
      const s = new Session(w);
      await s.start();
      await s.typed('tidy the repo notes');
      const before = ruleNamed(await syncRules(w), NEVER_MOMENT);
      expect(before, `the control: the rules page lists "${NEVER_MOMENT}" before the edit`).toBeDefined();

      await deleteLine(s);
      await settle(hub, (e) => readingsNaming(e, s, NEVER_MOMENT).length > 0, 20_000);
      const rules = await syncRules(w);
      expect(ruleNamed(rules, NEVER_MOMENT), `"${NEVER_MOMENT}" is still held on the rules page though its proposal couldn't be raised; the page lists:\n  ${show(rules)}`).toBeDefined();
      const next = await nextStart(w);
      expect(next.reply, `the next session's start set still carries "${NEVER_MOMENT}": ${JSON.stringify(next.reply.slice(0, 1500))}`).toContain(NEVER_MOMENT);

      const log = await settle(hub, () => true, 0);
      const readings = readingsNaming(log, s, NEVER_MOMENT);
      expect(readings.length, `the editing session's record holds one reading naming the rule "${NEVER_MOMENT}"; the session's readings: ${log.filter((e) => e.kind === 'session.reading' && e.session === s.id).map(said).join(' | ') || 'none'}`).toBe(1);
      expect(String(readings[0]!.data.reading), `that reading names the failure, the planted raise's error (${RAISE_FAILS})`).toContain(RAISE_FAILS);

      // Scope: raised again at the next rules sync, once the raise works.
      await stopHub(hub);
      hub = undefined;
      hub = await hubFor(w);
      const synced = await syncRules(w);
      const after = await settle(hub, (e) => proposals(e, NEVER_MOMENT).length > 0, 20_000);
      const made = proposals(after, NEVER_MOMENT);
      expect(made.length, `the next rules sync raises the held line's one proposal; the log has ${made.map(said).join(' | ') || 'none'}`).toBe(1);
      expect(inboxAsks(after, NEVER_MOMENT).length, `one question in your inbox naming "${NEVER_MOMENT}"`).toBe(1);
      expect(ruleNamed(synced, NEVER_MOMENT) ?? ruleNamed(await syncRules(w), NEVER_MOMENT), `"${NEVER_MOMENT}" stays held: ${show(synced)}`).toBeDefined();
    } finally {
      if (hub) await stopHub(hub);
    }
  }, 300_000);
});

// AC1 (#2076): with `rejected: \`moment\`.` saved, an agent's Edit that deletes `never use moment` from AGENTS.md leaves
// the rule held on the rules page and in the next session's start set, with one proposal in the inbox naming the line.
// A hub that drops the line when its proposal is refused (the base: `propose` refuses the change, since the rule's text
// names the rejected direction) shows no rule and no proposal, and fails here, naming the rule.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  NEVER_MOMENT, Session, cleanupAll, deleteLine, hubFor, inbox, inboxAsks, momentWorld, nextStart, proposals, rejectMoment, ruleNamed, said, settle, show, stopHub, syncRules,
} from './helpers.ts';

afterAll(cleanupAll, 120_000);
const AC1 = '#2076.c016c716';

describe(`${AC1} a deleted rule line that names a rejected direction`, () => {
  it(`${AC1} with \`rejected: \`moment\`.\` saved, an agent's Edit deleting "never use moment" from AGENTS.md leaves the rule held on the rules page and in the next session's start set, with one proposal in the inbox naming the line`, async () => {
    const w = momentWorld();
    const hub = await hubFor(w);
    try {
      await rejectMoment(w, hub);
      const s = new Session(w);
      await s.start();
      await s.typed('tidy the repo notes');
      const before = ruleNamed(await syncRules(w), NEVER_MOMENT);
      expect(before, `the control: the rules page lists "${NEVER_MOMENT}" before the edit`).toBeDefined();

      // The agent's own Edit removes the line.
      await deleteLine(s);
      expect(readFileSync(join(w.repo, 'AGENTS.md'), 'utf8'), 'the agent\'s Edit took the line out of the file').not.toContain(NEVER_MOMENT);
      await settle(hub, (e) => proposals(e, NEVER_MOMENT).length > 0, 20_000);
      const rules = await syncRules(w);
      const held = ruleNamed(rules, NEVER_MOMENT);
      const log = await settle(hub, () => true, 0);
      expect(held, `"${NEVER_MOMENT}" stays on the rules page, held, after the agent's Edit deleted it, though its text names the rejected \`moment\`; the page lists:\n  ${show(rules)}\nand the proposals naming it are: ${proposals(log, NEVER_MOMENT).map(said).join(' | ') || 'none'}`).toBeDefined();
      expect(typeof held!.json.held, `the rules page marks "${NEVER_MOMENT}" as held, naming its proposal: ${JSON.stringify(held!.json)}`).toBe('string');

      const made = proposals(log, NEVER_MOMENT);
      expect(made.length, `the deletion of "${NEVER_MOMENT}" reaches you as one proposal (learn.proposed naming the line); the log has ${made.map(said).join(' | ') || 'none'}`).toBe(1);
      expect(made[0]!.data.applied_by, 'a proposal is applied by no one').toBeNull();
      expect(String(made[0]!.data.target), 'the proposal targets the rule on the rules page').toBe(before!.handle);
      expect(held!.json.held, 'the held rule names that proposal').toBe(`doc:${made[0]!.id}`);
      expect(inboxAsks(log, NEVER_MOMENT).length, `your inbox holds one question naming "${NEVER_MOMENT}"`).toBe(1);
      const printed = await inbox(w);
      expect(printed, `deep inbox names the line "${NEVER_MOMENT}": ${printed.slice(0, 1500)}`).toContain(NEVER_MOMENT);

      const next = await nextStart(w);
      expect(next.reply, `the next session's start set carries the held rule "${NEVER_MOMENT}"; its SessionStart reply was ${JSON.stringify(next.reply.slice(0, 1500))}`).toContain(NEVER_MOMENT);
      // Syncing again raises no second proposal for the same deletion.
      await syncRules(w);
      expect(proposals(await settle(hub, () => true, 0), NEVER_MOMENT).length, `one proposal for "${NEVER_MOMENT}", never the same one twice`).toBe(1);
    } finally {
      await stopHub(hub);
    }
  }, 300_000);
});

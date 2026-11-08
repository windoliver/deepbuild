// An agent's edit that weakens a rule (#344): the rule stays in force and the edit becomes one proposal to you.
// README: Invented surfaces, `deep rules sync` and the proposal's target `wiki:rules#<id>`.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { LINTER, NEVER_PUSH, Session, cleanupAll, fixtureWorld, inboxAsks, proposals, ruleNamed, said, settle, show, startHub, stopHub, syncRules } from './helpers.ts';

afterAll(cleanupAll, 120_000);

describe('#344 deleting a rule line', () => {
  it('AC4 #344.e5587b74 an agent that deletes "never push without asking" from AGENTS.md still can\'t push unasked, and the deletion reaches you as one proposal; an edit outside an agent\'s tool calls changes the page', async () => {
    const w = fixtureWorld({ rootOnly: true });
    const hub = await startHub(w);
    try {
      const s = new Session(w);
      await s.start();
      await s.typed('tidy the repo notes');
      const before = ruleNamed(await syncRules(w), NEVER_PUSH);
      expect(before, `the rules page lists "${NEVER_PUSH}" before the edit`).toBeDefined();

      // The agent's own Edit removes the line.
      await s.edit('AGENTS.md', `- ${NEVER_PUSH}\n`, '');
      const log = await settle(hub, (e) => proposals(e, NEVER_PUSH).length > 0, 20_000);
      const made = proposals(log, NEVER_PUSH);
      expect(made.length, `the deletion reaches you as one proposal (learn.proposed naming the line); the log has ${made.map(said).join(' | ') || 'none'}`).toBe(1);
      expect(made[0]!.data.applied_by, 'a proposal is applied by no one').toBeNull();
      expect(String(made[0]!.data.target), 'the proposal targets the rule on the rules page').toBe(before!.handle);
      const rules = await syncRules(w);
      expect(ruleNamed(rules, NEVER_PUSH), `the rule stays in force on the rules page though the file lost the line:\n  ${show(rules)}`).toBeDefined();
      const after = await settle(hub, () => true, 0);
      expect(proposals(after, NEVER_PUSH).length, 'syncing again raises no second proposal for the same deletion').toBe(1);
      expect(inboxAsks(after, NEVER_PUSH).length, 'your inbox holds one question about it, never the same one twice').toBe(1);
      const push = await s.call('Bash', { command: 'git push origin main' });
      expect(push.allowed, `the agent still can't push unasked: ${push.before.stdout.slice(0, 300)} ${push.before.stderr.slice(0, 300)}`).toBe(false);

      // Your own edit, outside any agent's tool call, changes the page.
      const file = join(w.repo, 'AGENTS.md');
      writeFileSync(file, readFileSync(file, 'utf8').replace(`- ${LINTER}\n`, ''));
      const edited = await syncRules(w);
      expect(ruleNamed(edited, LINTER), `an edit made outside an agent's tool calls changes the page:\n  ${show(edited)}`).toBeUndefined();
      expect(ruleNamed(edited, NEVER_PUSH), 'and the held rule is still in force').toBeDefined();
      expect(proposals(await settle(hub, () => true, 0), LINTER).length, 'your own edit is no proposal').toBe(0);
    } finally {
      await stopHub(hub);
    }
  }, 240_000);
});

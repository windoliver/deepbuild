// Rules reaching sessions (#344): a rule you type reaches every open session at its next prompt and survives a
// compaction or a resume; a path-scoped rule reaches a session as one notice at its first call inside the scope.
// README: Invented surfaces, the `rule: <text>.` prompt and the `session.rules_delivered` event.
import { afterAll, describe, expect, it } from 'vitest';
import { APP_RULE, RENDER_RULE, Session, cleanupAll, deliveries, fixtureWorld, handleOf, heard, readCall, settle, startHub, stopHub, syncRules, told, type Hub } from './helpers.ts';

afterAll(cleanupAll, 120_000);
const events = (hub: Hub) => settle(hub, () => true, 0);

describe('#344 rules reach sessions', () => {
  it('AC1 #344.d84014c1 a rule typed in one session reaches a second open session at its next prompt', async () => {
    const w = fixtureWorld({ rootOnly: true });
    const hub = await startHub(w);
    try {
      const a = new Session(w);
      const b = new Session(w);
      await a.start();
      await b.start();
      await b.typed('fix the login page');
      const rule = 'Name every branch after its issue number';
      expect(told(b, rule), 'the second session was open before the rule was typed and has not heard it').toEqual([]);
      await a.typed(`rule: ${rule}.`);
      const next = await b.typed('now add a test');
      expect(heard(next, rule), `session B (${handleOf(b)}) hears the rule A typed at its next prompt; its reply was ${JSON.stringify(next.stdout.slice(0, 400))}`).toBe(true);
      const seen = deliveries(await settle(hub, (e) => deliveries(e, b, 'prompt').length > 0, 15_000), b, 'prompt');
      expect(seen.length, `B's record names the rules it was given at that prompt (a session.rules_delivered event, via prompt)`).toBeGreaterThan(0);
      const rules = await syncRules(w);
      const saved = rules.find((r) => r.text.replace(/[.]$/, '') === rule);
      expect(saved?.known, `the rule you typed is saved at once as yours on the rules page`).toBe('you');
    } finally {
      await stopHub(hub);
    }
  }, 240_000);

  it('AC5 #344.edd0e73e after a compaction or a resume, the session\'s next prompt carries every rule you typed in it', async () => {
    const w = fixtureWorld({ rootOnly: true });
    const hub = await startHub(w);
    try {
      const a = new Session(w);
      await a.start();
      const one = 'Squash merge every pull request';
      const two = 'Never amend a pushed commit';
      await a.typed(`rule: ${one}.`);
      await a.typed(`rule: ${two}.`);
      const before = deliveries(await events(hub), a).length;
      await a.start('compact');
      const afterCompact = await a.typed('carry on');
      for (const r of [one, two]) expect(heard(afterCompact, r), `after /compact, session A's next prompt carries "${r}"; it carried ${JSON.stringify(afterCompact.stdout.slice(0, 400))}`).toBe(true);
      await a.start('resume');
      const afterResume = await a.typed('and again');
      for (const r of [one, two]) expect(heard(afterResume, r), `after a resume, session A's next prompt carries "${r}"; it carried ${JSON.stringify(afterResume.stdout.slice(0, 400))}`).toBe(true);
      const all = deliveries(await settle(hub, (e) => deliveries(e, a).length > before + 1, 15_000), a);
      expect(all.length, `each new set is a new delivery in A's record (it had ${before}, now ${all.length})`).toBeGreaterThan(before);
      for (const d of all) expect(Number.isInteger(d.data.pos) && d.data.pos > 0, `delivery ${d.log_pos} names the log position of the rules it gave: ${JSON.stringify(d.data)}`).toBe(true);
    } finally {
      await stopHub(hub);
    }
  }, 240_000);

  it('AC9 #344.d074b17a a scoped rule reaches a session as one notice at its first call inside the scope, once more after /compact or a resume, and never in a start slice or for a session that stays outside', async () => {
    const w = fixtureWorld();
    const hub = await startHub(w);
    try {
      await new Session(w).start();
      await syncRules(w);
      const note = async (s: Session, file: string, rule = RENDER_RULE) => heard(await readCall(w, s, file), rule);

      // Session X edits only web/app.ts.
      const x = new Session(w);
      await x.start();
      await x.typed('tidy the web app');
      await x.edit('web/app.ts', 'name', 'title');
      expect(told(x, RENDER_RULE).map((h) => h.event), `session X (${handleOf(x)}) edits only web/app.ts and never hears the rule`).toEqual([]);

      // Session Y: its third call is the first inside the scope.
      const y = new Session(w);
      await y.start();
      await y.typed('speed up the renderer');
      const heardAt: boolean[] = [];
      for (const file of ['web/app.ts', 'web/app.ts', 'packages/dev/src/a.ts', 'packages/dev/src/b.ts']) heardAt.push(await note(y, file));
      expect(heardAt, `session Y (${handleOf(y)}) hears the rule once, at its third call and not at its fourth (calls 1 to 4)`).toEqual([false, false, true, false]);
      await y.start('compact');
      expect(await note(y, 'packages/dev/src/a.ts'), `after /compact, session Y's next call inside the scope carries the rule once more`).toBe(true);
      expect(told(y, RENDER_RULE).map((h) => h.event), `session Y was told the rule at two PreToolUse calls and in no start slice or prompt`).toEqual(['PreToolUse', 'PreToolUse']);

      // Session Z: a resume.
      const z = new Session(w);
      await z.start();
      await z.typed('look at the renderer');
      expect(await note(z, 'packages/dev/src/a.ts'), 'session Z hears it at its first call inside the scope').toBe(true);
      await z.start('resume');
      expect(await note(z, 'packages/dev/src/a.ts'), 'after a resume, the next call inside the scope carries the rule once more').toBe(true);
      expect(told(z, RENDER_RULE).map((h) => h.event), 'session Z was told twice').toEqual(['PreToolUse', 'PreToolUse']);

      // An AGENTS.md below the root applies to its folder.
      const n = new Session(w);
      await n.start();
      await n.typed('fix the app');
      expect(await note(n, 'web/app.ts', APP_RULE), 'a call outside packages/app does not carry the nested rule').toBe(false);
      expect(await note(n, 'packages/app/src/x.ts', APP_RULE), 'a call inside packages/app carries packages/app/AGENTS.md\'s rule').toBe(true);

      const log = await settle(hub, (e) => deliveries(e, y, 'notice').length >= 2, 15_000);
      expect(deliveries(log, x, 'notice').length, 'X never reached the scope: no notice in its record').toBe(0);
      const yn = deliveries(log, y, 'notice');
      expect(yn.length, `Y's record names each of its two deliveries`).toBe(2);
      for (const d of yn) expect(Number.isInteger(d.data.pos) && d.data.pos > 0, `the delivery names a log position beside the start slice's: ${JSON.stringify(d.data)}`).toBe(true);
    } finally {
      await stopHub(hub);
    }
  }, 300_000);
});

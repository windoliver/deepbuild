// The set of rules a session ran under, and who a judgment credits (#344). README: Invented surfaces, the
// `session.rules_delivered` event, `deep session rules <session> --json` and `deep rules credit <claim> --json`.
import { afterAll, describe, expect, it } from 'vitest';
import {
  APP_RULE, RENDER_RULE, Session, cleanupAll, deep, deliveries, fixtureWorld, handleOf, heard, json, readCall, rollBack, seedSlice, settle, startHub, stopHub, syncRules, told,
} from './helpers.ts';

afterAll(cleanupAll, 120_000);

describe('#344 which set a session ran under', () => {
  it('AC8 #344.e8cceead a session started before you roll back a slice entry reads, on its page, that it runs the earlier set, and a regression in it is credited to that set', async () => {
    const w = fixtureWorld({ rootOnly: true });
    const kept = 'Use tabs in this repo';
    const dropped = 'Prefer the staging database';
    const [, drop] = await seedSlice(w, [kept, dropped]);
    const first = await startHub(w);
    let s1!: Session;
    let p1!: number;
    try {
      s1 = new Session(w);
      const started = await s1.start();
      expect(heard(started, dropped), `session 1's start slice holds both entries; it holds ${JSON.stringify(started.stdout.slice(0, 400))}`).toBe(true);
      const log = await settle(first, (e) => deliveries(e, s1).length > 0, 15_000);
      const d = deliveries(log, s1, 'start')[0];
      expect(d, `session 1's record names the log position of the rules and start slice it was given (a session.rules_delivered event, via start)`).toBeDefined();
      p1 = Number(d!.data.pos);
      expect(Number.isInteger(p1) && p1 > 0, `the position is a log position: ${JSON.stringify(d!.data)}`).toBe(true);
    } finally {
      await stopHub(first);
    }
    await rollBack(w, drop!);
    const second = await startHub(w);
    try {
      const s2 = new Session(w);
      const started = await s2.start();
      expect(heard(started, kept), 'session 2 runs the entry you kept').toBe(true);
      expect(heard(started, dropped), `session 2 runs the set after the rollback, without "${dropped}"`).toBe(false);
      const log = await settle(second, (e) => deliveries(e, s2).length > 0, 15_000);
      const p2 = Number(deliveries(log, s2, 'start')[0]?.data.pos);
      expect(p2, 'session 2 was given a newer set than session 1').toBeGreaterThan(p1);
      const page1 = json(await deep(w, ['session', 'rules', s1.id, '--json']), `deep session rules ${s1.id}`);
      expect(page1.runs, `session 1's page says it runs the earlier set (${handleOf(s1)}): ${JSON.stringify(page1)}`).toBe('earlier');
      expect(page1.set, 'its set is the one it was given').toBe(p1);
      expect(page1.credited_to, `a regression in session 1 is credited to its set (log position ${p1}), not to the set after the rollback (${p2}): ${JSON.stringify(page1)}`).toBe(p1);
      const page2 = json(await deep(w, ['session', 'rules', s2.id, '--json']), `deep session rules ${s2.id}`);
      expect(page2.runs, `session 2 runs the current set: ${JSON.stringify(page2)}`).toBe('current');
      expect(page2.credited_to, 'and a regression in it is credited to the later set').toBe(p2);
    } finally {
      await stopHub(second);
    }
  }, 300_000);

  it('AC11 #344.0a0ed1fb judging a scoped rule credits only the sessions whose record names its delivery, never a session the rule never reached', async () => {
    const w = fixtureWorld();
    const hub = await startHub(w);
    try {
      await new Session(w).start();
      const rules = await syncRules(w);
      const rule = rules.find((r) => r.text === RENDER_RULE);
      expect(rule, 'the rules page lists the applyTo rule').toBeDefined();
      const reached = async (file: string): Promise<Session> => {
        const s = new Session(w);
        await s.start();
        await s.typed('work on it');
        expect(heard(await readCall(w, s, file), RENDER_RULE), `${file} is inside the scope: the rule reaches ${handleOf(s)}`).toBe(true);
        return s;
      };
      const stayed = async (file: string): Promise<Session> => {
        const s = new Session(w);
        await s.start();
        await s.typed('work on it');
        await readCall(w, s, file);
        expect(told(s, RENDER_RULE), `${file} is outside the scope: the rule never reaches ${handleOf(s)}`).toEqual([]);
        return s;
      };
      const a = await reached('packages/dev/src/a.ts');
      const d = await reached('packages/dev/src/b.ts');
      const b = await stayed('web/app.ts');
      const c = await stayed('packages/app/src/x.ts');
      void APP_RULE;
      await settle(hub, (e) => [a, d].every((s) => deliveries(e, s, 'notice').length > 0), 15_000);
      const credit = json(await deep(w, ['rules', 'credit', rule!.handle, '--json']), `deep rules credit ${rule!.handle}`);
      const credited = ((credit.sessions as string[] | undefined) ?? []).slice().sort();
      expect(credited, `judging the rule credits only A and D, whose records name its delivery; a judge that credits every session in the repo also credits ${handleOf(b)} and ${handleOf(c)}, which the rule never reached`).toEqual([handleOf(a), handleOf(d)].sort());
    } finally {
      await stopHub(hub);
    }
  }, 300_000);
});

// AC3: a retried send goes out once, also when power is cut right after its key is claimed and its request goes out,
// under the test VFS that drops writes not yet synced; a hub that claims send keys with synchronous=NORMAL loses the
// claim, sends again and fails this test, naming the key. AC11: under the standing rule "my weekly summary, to me",
// the weekly brief's runs on two Mondays with different content each go out with no ask, each recording its plan's
// digest; the same plug-in sending to you and a second address, or on a daily schedule, raises one authority ask
// naming what changed; a rule matched by recipient kind alone lets the second address through and fails this test.
//
// The brief plug-in sends one email per run through deep.send to a local provider standing in for api.mail.example
// (fixtures/brief). Its key is one per schedule and day, so a retry the same day is the same send. Mondays are
// 2026-11-02 and 2026-11-09, 09:00 UTC on the controlled clock.
import { describe, expect, it } from 'vitest';
import type { TestStorage } from '../../../packages/record/src/index.ts';
import {
  at, authorityAsks, BRIEF_ID, briefPackage, carrying, clock, grantFor, installAndLoad, json, killPlugin, MAIL, ME, memoryStore, openHost, openWorld,
  OTHER, pluginPids, provider, routedClient, sendOf, sleep, startHub, step, stopHub, vfsWorld, waitUntil, weeklyRule, YOU, type BriefProbe, type Clock,
  type HostSeams, type Provider, type World,
} from './helpers.ts';
import { judgeChanged, judgeCovered, judgeOnce } from './judges.ts';
import { claimsAtNormal, kindOnlyRule } from './twins.ts';

const WEEKLY = 'ext.brief.weekly';
const MONDAY = '2026-11-02';
const keyOf = (day: string) => `brief-weekly-${day}`;

/** A world (on `storage` when given) with the brief plug-in loaded, and the standing rule set when `rule` says so. */
async function briefWorld(c: Clock, probe: BriefProbe, mail: Provider, options: { rule?: boolean; storage?: TestStorage } = {}) {
  const seams: HostSeams = { secrets: memoryStore(), http: routedClient({ [MAIL]: mail }).client };
  const w: World = options.storage ? await vfsWorld(c, options.storage) : await openWorld(c);
  const h = await openHost(w, seams);
  await installAndLoad(h, await briefPackage(probe), grantFor(MAIL));
  if (options.rule ?? true) await h.setSendRule(YOU, weeklyRule);
  return { w, h, seams };
}
const weekly: BriefProbe = { schedules: [{ name: 'weekly', cron: '0 9 * * 1' }], to: [ME], key: 'day' };

describe('AC3 #365.f05c3dba A retried send goes out once, also when power is cut right after its key is claimed and its request goes out, under the test VFS that drops writes not yet synced; a hub that claims send keys with `synchronous=NORMAL` loses the claim, sends again and fails this test, naming the key', () => {
  it('AC3 the Monday brief run again by Run now the same day doesn\'t send again', async () => {
    const c = clock(at(`${MONDAY}T08:58`));
    const mail = await provider(c, () => json({ id: 'm1' }));
    const { h } = await briefWorld(c, weekly, mail);
    await step(h, c, at(`${MONDAY}T08:58`), at(`${MONDAY}T09:01`));
    expect(carrying(mail, keyOf(MONDAY)).length, 'the 09:00 run sent the brief').toBe(1);
    await h.runNow(YOU, WEEKLY);
    await h.idle();
    await step(h, c, at(`${MONDAY}T09:02`), at(`${MONDAY}T09:03`));
    expect(judgeOnce(keyOf(MONDAY), carrying(mail, keyOf(MONDAY)).length)).toEqual([]);
  }, 120_000);

  /**
   * The power cut: the provider cuts the record's storage the moment the send's request reaches it and never answers;
   * the plug-in's process is killed and the hub's objects dropped, as a power cut leaves them. The hub then starts on
   * what the storage kept, and you run the brief again the same morning.
   */
  async function cut(storage: TestStorage & { normal?: boolean }): Promise<number> {
    const c = clock(at(`${MONDAY}T08:58`));
    let cutDone = false;
    const mail = await provider(c, (req) => {
      if (req.url.startsWith('/send') && !cutDone) {
        cutDone = true;
        storage.cutPower();
        return 'hang';
      }
      return json({ id: 'm' });
    });
    const { w, h, seams } = await briefWorld(c, weekly, mail, { storage });
    await step(h, c, at(`${MONDAY}T08:58`), at(`${MONDAY}T08:59`));
    await w.record.sync();
    const pids = await pluginPids(w, h, BRIEF_ID);
    if ('normal' in storage) storage.normal = true;
    c.set(at(`${MONDAY}T09:00`));
    void h.tick().catch(() => undefined);
    await waitUntil(() => cutDone, 30_000, 'the send\'s request reaching the provider');
    // The hub is gone with the power: its plug-in process dies, and nothing it holds in memory survives.
    await killPlugin(w, h, BRIEF_ID, pids).catch(() => undefined);
    mail.drop();
    await Promise.race([stopHub(h, w).catch(() => undefined), sleep(20_000)]);
    if ('normal' in storage) storage.normal = false;
    c.set(at(`${MONDAY}T09:01`));
    const again = await startHub(w, seams, storage);
    await again.h.tick();
    await again.h.idle();
    await again.h.runNow(YOU, WEEKLY);
    await again.h.idle();
    await step(again.h, c, at(`${MONDAY}T09:02`), at(`${MONDAY}T09:04`));
    await sleep(500);
    return carrying(mail, keyOf(MONDAY)).length;
  }

  it('AC3 power cut right after the key is claimed and the request went out: after the restart, run again, the brief went out once', async () => {
    const { testStorage } = await import('../../../packages/record/src/index.ts');
    expect(judgeOnce(keyOf(MONDAY), await cut(testStorage()))).toEqual([]);
  }, 180_000);

  it('AC3 (wrong program) a hub that claims send keys with synchronous=NORMAL loses the claim at the cut and sends again, named by the key', async () => {
    const problems = judgeOnce(keyOf(MONDAY), await cut(claimsAtNormal()));
    expect(problems.join('\n')).toMatch(new RegExp(`the send ${keyOf(MONDAY)} reached the provider [2-9] times`));
  }, 180_000);
});

describe('AC11 #365.7d93d1de Under the standing rule "my weekly summary, to me", the weekly brief\'s runs on two Mondays with different content each go out with no ask, each recording its plan\'s digest; the same plug-in sending to you and a second address, or on a daily schedule, raises one authority ask naming what changed; a rule matched by recipient kind alone lets the second address through and fails this test', () => {
  it('AC11 the weekly brief to you on 2026-11-02 and 2026-11-09 goes out each Monday with no ask, each send recording its own plan digest', async () => {
    const c = clock(at(`${MONDAY}T08:58`));
    const mail = await provider(c, () => json({ id: 'm' }));
    const { w, h } = await briefWorld(c, weekly, mail);
    await step(h, c, at(`${MONDAY}T08:58`), at(`${MONDAY}T09:01`));
    await step(h, c, at('2026-11-09T08:58'), at('2026-11-09T09:01'));
    const cases = [];
    for (const day of [MONDAY, '2026-11-09']) {
      const row = await sendOf(h, keyOf(day));
      expect(row?.outcome, `the ${day} send: ${JSON.stringify(row)}`).toBe('sent');
      cases.push({ key: keyOf(day), reached: carrying(mail, keyOf(day)).length, asks: (await authorityAsks(w)).length, plan: row?.plan });
    }
    expect(judgeCovered(cases)).toEqual([]);
  }, 180_000);

  /** A send the rule doesn't cover: the Monday 09:00 run, until its ask is raised and a moment after. */
  async function changed(probe: BriefProbe, twin = false) {
    const c = clock(at(`${MONDAY}T08:58`));
    const mail = await provider(c, () => json({ id: 'm' }));
    const { w, h } = await briefWorld(c, probe, mail);
    const rule = twin ? kindOnlyRule(w) : undefined;
    await step(h, c, at(`${MONDAY}T08:58`), at(`${MONDAY}T08:59`));
    c.set(at(`${MONDAY}T09:00`));
    void h.tick().catch(() => undefined);
    const asks = await waitUntil(async () => { const a = await authorityAsks(w); return a.length ? a : undefined; }, 20_000, 'an authority ask for the send').catch(() => [] as string[]);
    await sleep(twin ? 2_000 : 500);
    await rule?.stop();
    const all = await authorityAsks(w);
    const cards = await Promise.all(all.map(async (a) => JSON.stringify(await w.asks.card(a))));
    const name = probe.schedules[0]!.name;
    return { asks: asks.length ? all : [], cards, mail, key: `brief-${name}-${MONDAY}` };
  }

  it('AC11 the weekly brief to you and a second address raises one authority ask naming the second address, and nothing goes out', async () => {
    const r = await changed({ ...weekly, to: [ME, OTHER] });
    expect(judgeChanged({ what: 'to you and a second address', key: r.key, reached: carrying(r.mail, r.key).length, asks: r.asks, cards: r.cards, names: OTHER })).toEqual([]);
  }, 120_000);

  it('AC11 the brief to you on a daily schedule raises one authority ask naming the daily schedule, and nothing goes out', async () => {
    const r = await changed({ schedules: [{ name: 'daily', cron: '0 9 * * *' }], to: [ME], key: 'day' });
    expect(judgeChanged({ what: 'on a daily schedule', key: r.key, reached: carrying(r.mail, r.key).length, asks: r.asks, cards: r.cards, names: 'daily' })).toEqual([]);
  }, 120_000);

  it('AC11 (wrong program) a rule matched by recipient kind alone lets the brief to the second address go out, and fails', async () => {
    const r = await changed({ ...weekly, to: [ME, OTHER] }, true);
    const problems = judgeChanged({ what: 'to you and a second address', key: r.key, reached: carrying(r.mail, r.key).length, asks: r.asks, cards: r.cards, names: OTHER });
    expect(problems.join('\n')).toMatch(new RegExp(`the send ${r.key} \\(to you and a second address\\) went out under the rule`));
    expect(carrying(r.mail, r.key).some((s) => s.body.includes(OTHER) || s.url.includes(encodeURIComponent(OTHER)) || s.url.includes(OTHER)), 'the second address was in what reached the provider').toBe(true);
  }, 120_000);
});

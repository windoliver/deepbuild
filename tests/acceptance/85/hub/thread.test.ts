// `#85.e12ca936` on the real hub: deep_ask with `thread`, read through slack.json's `api`. See README.
import { afterEach, describe, expect, it } from 'vitest';
import { askingAgent, BOT, CHANNEL, endAgents, events, fakeSlack, FAKE_TOKEN, filesHolding, inbox, LINK, SECOND, sleep, stripHandle, THREAD_TS, until, withHub, writeSlackJson, YOU, type FakeSlack, type Hub } from './helpers.ts';

const TAG = '#85.e12ca936';
const EXPECT = 'pong-85';
/** Reads come every 5 s at most, and the issue's budget closes a task within 10 s of its check passing; a margin for a loaded Mac. */
const NEXT_READ = 15 * SECOND;
const moots = (hub: Hub, handle: string) => events(hub, 'ask.moot').filter((e) => stripHandle(e.subject) === stripHandle(handle));
const cardOf = async (hub: Hub, handle: string) => (await inbox(hub)).find((row) => stripHandle(row.ask) === stripHandle(handle));
/** The card, once a read after `at` has shown and `wanted` holds of what it says is missing. */
const cardShowing = (hub: Hub, slack: FakeSlack, handle: string, at: number, wanted: (missing: string) => boolean) => until(async () => {
  const card = await cardOf(hub, handle);
  return slack.requests.some((r) => r.at > at) && card?.missing && wanted(JSON.stringify(card.missing)) ? card : undefined;
}, NEXT_READ);

afterEach(() => endAgents());

describe('a chat-app task on the real hub', () => {
  it(`${TAG} closes from the thread with nothing typed; no reply and a wrong one send it back with the link; the token goes only in the request's Authorization; only conversations.replies is called`, async () => {
    const slack = await fakeSlack();
    // Before you post, even a message holding what's expected isn't the bot's reply.
    slack.messages.push({ user: BOT, bot_id: 'B0BOT85', text: `Say anything. I answer ${EXPECT}.`, ts: THREAD_TS });
    try {
      await withHub((_home, root) => writeSlackJson(root, slack.api), async (hub) => {
        const agent = await askingAgent(hub);
        try {
          const raised = await agent.ask({ link: LINK, expect: EXPECT });
          expect(raised, 'a Slack link with slack.json in place is raised, not refused').toMatchObject({ refused: false });
          if (raised.refused) return;
          const created = events(hub, 'ask.created').find((e) => e.id === stripHandle(raised.handle))!;
          expect(created.data.thread, 'the record holds the thread').toEqual({ link: LINK, expect: EXPECT });
          expect(await cardOf(hub, raised.handle), 'the task is in Needs you').toBeDefined();

          // Nothing posted yet: it's read, and stays open.
          const asked = Date.now();
          expect(await until(() => slack.requests.some((r) => r.at >= asked), NEXT_READ), 'the hub reads the open thread').toBe(true);
          expect(moots(hub, raised.handle), 'before you post nothing closes it').toEqual([]);

          // You post, and your own words, even holding what's expected, aren't a reply: no reply is what's missing.
          let at = Date.now();
          slack.messages.push({ user: YOU, text: `Do you answer ${EXPECT}?`, ts: '1700000001.000100', thread_ts: THREAD_TS });
          const noReply = await cardShowing(hub, slack, raised.handle, at, () => true);
          expect(noReply?.missing, 'no reply since your post sends it back with the thread link').toMatchObject({ link: LINK });
          expect(moots(hub, raised.handle), 'your own message never closes it').toEqual([]);

          // The bot answers wrong: still open, and what's missing names the link.
          at = Date.now();
          slack.messages.push({ user: BOT, bot_id: 'B0BOT85', text: 'I cannot help with that.', ts: '1700000002.000100', thread_ts: THREAD_TS });
          const wrong = await cardShowing(hub, slack, raised.handle, at, (missing) => missing.includes('cannot help'));
          expect(wrong?.missing, 'a wrong reply sends it back with the thread link, saying why').toMatchObject({ link: LINK });
          expect(moots(hub, raised.handle), 'a wrong reply never closes it').toEqual([]);

          // The right reply closes it, with nothing typed.
          slack.messages.push({ user: BOT, bot_id: 'B0BOT85', text: `${EXPECT} from the bot`, ts: '1700000003.000100', thread_ts: THREAD_TS });
          expect(await until(() => moots(hub, raised.handle)[0], NEXT_READ), 'the right reply closes the task as ask.moot').toBeDefined();
          expect(events(hub, 'ask.answered').filter((e) => stripHandle(e.subject) === stripHandle(raised.handle)), 'nothing typed').toEqual([]);
          expect(await cardOf(hub, raised.handle), 'it left Needs you').toBeUndefined();

          // Read-only, with the token in the header and nowhere else, at most once every 5 s.
          expect([...new Set(slack.requests.map((r) => r.method))], 'the one method it calls').toEqual(['conversations.replies']);
          for (const r of slack.requests) {
            expect(r.authorization, 'the token goes in the Authorization header').toBe(`Bearer ${FAKE_TOKEN}`);
            expect(r.url.includes(FAKE_TOKEN) || r.body.includes(FAKE_TOKEN), 'and never in the URL or the body').toBe(false);
            expect(r.params.get('channel'), "the link's channel").toBe(CHANNEL);
            expect(r.params.get('ts'), "the link's thread").toBe(THREAD_TS);
          }
          const gaps = slack.requests.slice(1).map((r, i) => r.at - slack.requests[i]!.at);
          expect(Math.min(...gaps), `at most one read every 5 s, gaps ${gaps.join(', ')} (0.5 s allowed for delivery)`).toBeGreaterThanOrEqual(4500);
          const settled = slack.requests.length;
          await sleep(7 * SECOND);
          expect(slack.requests.length, 'a closed thread is not read again').toBe(settled);
        } finally {
          agent.close();
        }
        await hub.stop();
        expect(filesHolding(hub.root, LINK).length, 'the scan below reads the record: the link is in it').toBeGreaterThan(0);
        expect(filesHolding(hub.home, FAKE_TOKEN), 'the token is in no file of the record or a log').toEqual([]);
        expect(hub.output().includes(FAKE_TOKEN), "and not in the hub's output").toBe(false);
      });
    } finally {
      await slack.close();
    }
  }, 120_000);

  it(`${TAG} refuses a link that isn't a Slack thread when the task is raised, so the token only goes to the Slack API`, async () => {
    const slack = await fakeSlack();
    try {
      await withHub((_home, root) => writeSlackJson(root, slack.api), async (hub) => {
        const agent = await askingAgent(hub);
        try {
          const good = await agent.ask({ link: LINK, expect: EXPECT });
          expect(good, 'a Slack thread link is raised, so what follows is about the link').toMatchObject({ refused: false });
          const raisedBefore = events(hub, 'ask.created').length;
          for (const link of [
            'https://evil.example.com/archives/C0THREAD85/p1700000000000100',
            'http://acme-85.slack.com/archives/C0THREAD85/p1700000000000100',
            'https://acme-85.slack.com.evil.example/archives/C0THREAD85/p1700000000000100',
            'https://acme-85.slack.com@evil.example/archives/C0THREAD85/p1700000000000100',
            'https://slack.com/archives/C0THREAD85/p1700000000000100',
            'https://acme-85.slack.com/client/T0/C0THREAD85',
            'https://acme-85.slack.com/archives/C0THREAD85/1700000000000100',
          ]) {
            const raised = await agent.ask({ link, expect: EXPECT });
            expect(raised.refused, `${link} is refused`).toBe(true);
            if (raised.refused) expect(raised.text, `the refusal of ${link} says it must be a Slack link`).toMatch(/slack/i);
          }
          expect(events(hub, 'ask.created').length, 'no refused link raised a task').toBe(raisedBefore);
        } finally {
          agent.close();
        }
      });
    } finally {
      await slack.close();
    }
  }, 120_000);

  it(`${TAG} refuses a thread task saying so when slack.json is missing, or isn't mode 0600`, async () => {
    const slack = await fakeSlack();
    try {
      await withHub(() => undefined, async (hub) => {
        const agent = await askingAgent(hub);
        try {
          const raised = await agent.ask({ link: LINK, expect: EXPECT });
          expect(raised.refused, 'without slack.json a thread task is refused').toBe(true);
          if (raised.refused) expect(raised.text, 'and the refusal says so').toMatch(/slack\.json/);
          expect(events(hub, 'ask.created').length, 'nothing raised').toBe(0);
        } finally {
          agent.close();
        }
      });
      await withHub((_home, root) => writeSlackJson(root, slack.api, 0o644), async (hub) => {
        const agent = await askingAgent(hub);
        try {
          const raised = await agent.ask({ link: LINK, expect: EXPECT });
          expect(raised.refused, 'a slack.json others can read does not turn the connector on').toBe(true);
          if (raised.refused) {
            expect(raised.text).toMatch(/slack\.json/);
            expect(raised.text.includes(FAKE_TOKEN), 'the refusal holds no token').toBe(false);
          }
        } finally {
          agent.close();
        }
      });
      expect(slack.requests, 'and Slack is never called').toEqual([]);
    } finally {
      await slack.close();
    }
  }, 120_000);

  it(`${TAG} keeps the task open with the link on its card while Slack's read fails, and closes once it reads`, async () => {
    const slack = await fakeSlack();
    // A service that echoes the credential back: what the hub shows of a failure still never holds it.
    slack.failure = { status: 200, body: JSON.stringify({ ok: false, error: `invalid_auth for Bearer ${FAKE_TOKEN}` }) };
    try {
      await withHub((_home, root) => writeSlackJson(root, slack.api), async (hub) => {
        const agent = await askingAgent(hub);
        try {
          const raised = await agent.ask({ link: LINK, expect: EXPECT });
          expect(raised, 'raised').toMatchObject({ refused: false });
          if (raised.refused) return;
          const notOk = await cardShowing(hub, slack, raised.handle, 0, () => true);
          expect(notOk?.missing, "Slack's ok:false shows on the card with the thread link").toMatchObject({ link: LINK });
          expect(notOk?.missing.reasons.join(' ').length, 'and says why').toBeGreaterThan(0);
          expect(JSON.stringify(await inbox(hub)).includes(FAKE_TOKEN), 'the card holds no token').toBe(false);

          const at = Date.now();
          slack.failure = { status: 500, body: 'upstream down' };
          const down = await cardShowing(hub, slack, raised.handle, at, () => true);
          expect(down?.missing, 'a server error does the same').toMatchObject({ link: LINK });
          expect(events(hub, 'ask.moot'), 'a failing read leaves the task open').toEqual([]);

          // Slack comes back: the check reads again.
          slack.messages.push({ user: YOU, text: 'Are you there?', ts: THREAD_TS }, { user: BOT, bot_id: 'B0BOT85', text: EXPECT, ts: '1700000001.000100', thread_ts: THREAD_TS });
          slack.failure = undefined;
          expect(await until(() => events(hub, 'ask.moot')[0], NEXT_READ), 'the task closes once a read finds the reply').toBeDefined();
        } finally {
          agent.close();
        }
        await hub.stop();
        expect(filesHolding(hub.home, FAKE_TOKEN), 'the failure put no token in the record or a log').toEqual([]);
        expect(hub.output().includes(FAKE_TOKEN), "nor in the hub's output").toBe(false);
      });
    } finally {
      await slack.close();
    }
  }, 120_000);
});

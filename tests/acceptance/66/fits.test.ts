// AC18: a result delivered to a chat thread is at most 100 words, with the verdict line and a link to its receipt,
// while the same result on an issue carries each requirement's verdict; a planted send that posts the full receipt
// into the chat fails, naming the send key. One result with five requirements and a summary of some 400 words goes to
// a chat thread (fixtures/chat, which delivers into chat) and to an issue on the tracker (fixtures/tracker, which
// delivers comments), both under your rule.
import { describe, expect, it } from 'vitest';
import { AC18, at, deliveryOf, MINUTE, result, step, taskFor, words } from './helpers.ts';
import { judgeChat, judgeIssue } from './judges.ts';
import { markerIn, REPO_WEB } from './providers.ts';
import { postsFullReceipt } from './twins.ts';
import { trackerWorld } from './worlds.ts';

const T0 = at('2026-11-02T09:00');
const TS = '1793610000.0001';

describe(`${AC18} A result delivered to a chat thread is at most 100 words, with the verdict line and a link to its receipt, while the same result on an issue carries each requirement's verdict; a planted send that posts the full receipt into the chat fails, naming the send key`, () => {
  it('AC18 the chat reply is the verdict line and at most 100 words with the receipt\'s link; the issue comment gives each requirement\'s verdict; the full receipt in chat fails, naming its key', async () => {
    const { c, h, tr, ch } = await trackerWorld(T0, { rule: true, chat: true });
    ch.threads.set(TS, { ts: TS, user: 'ana', text: 'Can someone fix the export? It drops rows.', created: T0 + MINUTE, updated: T0 + MINUTE, replies: [] });
    tr.add({ n: 70, created: T0 + MINUTE, updated: T0 + MINUTE });
    await step(h, c, T0 + MINUTE, T0 + 10 * MINUTE);
    const [inChat, onIssue] = [await taskFor(h, TS), await taskFor(h, `${REPO_WEB}#70`)];
    expect(inChat && onIssue, `the thread and the issue are tasks: ${JSON.stringify(await h.workTasks())}`).toBeTruthy();
    const r = result('PASS', 5, 'https://receipts.example/r/70');
    expect(words(r.summary), 'the result is long').toBeGreaterThan(300);
    const kc = await h.deliverResult(inChat!.task_ref, r);
    const ki = await h.deliverResult(onIssue!.task_ref, r);
    await step(h, c, T0 + 11 * MINUTE, T0 + 20 * MINUTE);
    expect([(await deliveryOf(h, kc))?.outcome, (await deliveryOf(h, ki))?.outcome]).toEqual(['sent', 'sent']);

    const chatText = ch.replies(TS).find((x) => x.key === kc)?.text;
    expect(judgeChat(chatText, kc, r)).toEqual([]);
    const issueText = tr.issues.get(70)!.comments.find((x) => markerIn(x.body) === ki)?.body;
    expect(judgeIssue(issueText, ki, r)).toEqual([]);

    const planted = 'send-full-receipt-70';
    const receipt = [`${r.verdict}: ${onIssue!.title}`, r.summary, ...r.requirements.map((q) => `${q.id} ${q.verdict}: ${q.text} ${q.evidence.join(' ')}`), r.receipt].join('\n');
    const posted = await postsFullReceipt(ch, TS, planted, receipt);
    expect(judgeChat(posted, planted, r).join('\n'), 'the planted send fails, naming its key').toContain(planted);
  }, 300_000);
});

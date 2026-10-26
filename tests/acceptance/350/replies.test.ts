// AC1: a tool.before handler can only add context the agent sees or deny the call with a reason the agent sees.
// AC2: an outside package's context comes only from the templates its manifest declares, with typed values: the
// planted instruction in a handle field is recorded as failed, naming the field, and the agent gets none of it; a
// handle and a number add one block labelled with the extension; a host that passes context through as text fails.
//
// What the agent sees of a reply is its context blocks and its denies' reasons (README, Readings). A reply carries
// hook.joined@1's fields and the handlers recorded as failed, nothing else: no field that allows the call, rewrites
// its input or answers for you.
import { describe, expect, it } from 'vitest';
import type { HookReply, Plant } from '../../../packages/extension-host/src/index.ts';
import { agentSees, blocksOf, installAndLoad, openHost, openWorld, pkg, releaseEntry, toolBefore } from './helpers.ts';
import { judgeTemplated } from './judges.ts';

const REPLY_FIELDS = ['bound', 'context', 'denies', 'failed', 'order'];

describe('AC1 #350.2f824654 a tool.before handler can only add context the agent sees or deny the call with a reason the agent sees', () => {
  it('AC1 context, a deny and nothing each reach the reply as given; a reply that allows, rewrites or answers is recorded as failed and none of it reaches the agent', async () => {
    const ID = 'deepbuild/replies';
    const dir = await pkg('replies');
    const w = await openWorld();
    const h = await openHost(w, { release: [await releaseEntry(dir)] });
    await installAndLoad(h, dir);
    expect((await h.loaded()).find((l) => l.id === ID)?.place, 'the first-party package runs in the hub').toBe('hub');

    const replies: HookReply[] = [];
    for (let i = 0; i < 7; i++) replies.push(await h.hook(toolBefore(5_000, 10_000)));
    for (const [i, reply] of replies.entries()) {
      for (const key of Object.keys(reply)) expect(REPLY_FIELDS, `reply ${i + 1} has a field beyond context and deny: ${key}`).toContain(key);
    }
    const [context, deny, nothing, ...others] = replies as [HookReply, HookReply, HookReply, ...HookReply[]];

    expect(blocksOf(context, ID).map((b) => b.text).join(''), 'the context reached the reply').toContain('replies-context-one');
    expect(context.denies).toEqual([]);
    expect(context.failed).toEqual([]);

    expect(deny.denies.filter((d) => d.extension === ID).map((d) => d.reason).join(''), 'the deny and its reason reached the reply').toContain('replies-deny-two');
    expect(blocksOf(deny, ID)).toEqual([]);
    expect(deny.failed).toEqual([]);

    expect([nothing.context, nothing.denies, nothing.failed], 'a handler that gives nothing adds nothing and isn\'t a failure').toEqual([[], [], []]);

    for (const [i, reply] of others.entries()) {
      const n = i + 4;
      expect(reply.failed.map((f) => f.extension), `reply ${n}, which tries more than context or a deny, is recorded as failed`).toContain(ID);
      expect(blocksOf(reply, ID), `reply ${n} added a block`).toEqual([]);
      expect(reply.denies.filter((d) => d.extension === ID), `reply ${n} denied`).toEqual([]);
      for (const text of ['rm -rf', 'replies-context-five', 'replies-answer-six', 'replies-deny-seven', 'approve', 'allow']) {
        expect(agentSees(reply), `reply ${n}: the agent sees ${text}`).not.toContain(text);
      }
    }
  }, 120_000);
});

describe('AC2 #350.7727c408 an outside package fills a declared tool.before template with typed values only: planted text in the handle field is recorded as failed, naming the field, and never reaches the agent; a handle and a number add one block labelled with the extension; a host that passes context through as text fails, naming the extension', () => {
  const ID = 'test/tmpl';
  /** The scenario: the outside package, loaded in the sandbox, answers two tool.before requests. */
  async function scenario(plant?: Plant): Promise<{ first: HookReply; second: HookReply }> {
    const w = await openWorld();
    const h = await openHost(w, plant ? { plant } : {});
    await installAndLoad(h, await pkg('templated'));
    expect((await h.loaded()).find((l) => l.id === ID)?.place, 'the outside package runs in the sandbox').toBe('sandbox');
    const first = await h.hook(toolBefore(10_000, 10_000));
    const second = await h.hook(toolBefore(10_000, 10_000));
    return { first, second };
  }

  it('AC2 the planted handle is recorded as failed naming the field and the agent gets none of it; the handle and number add one block from test/tmpl', async () => {
    const { first, second } = await scenario();
    expect(judgeTemplated(first, second, ID)).toEqual([]);
  }, 120_000);

  it('AC2 (wrong program) a host that passes a handler\'s context through as text delivers the string and fails this test, naming the extension', async () => {
    const { first, second } = await scenario('context-as-text');
    const problems = judgeTemplated(first, second, ID);
    expect(problems.some((p) => p.includes(ID) && p.includes('reached the agent')), `the judge's problems: ${JSON.stringify(problems)}`).toBe(true);
  }, 120_000);
});

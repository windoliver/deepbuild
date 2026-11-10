// The channel@1 kit (#65): a way to reach you, which only transports. `deliver(item, ctx)` hands the item to its
// provider through `ctx.fetch` and says what came of it; `receive(ctx)` returns the answers, the threads seen and any
// conflict the provider reported. The kit's provider fixture answers every call with a fresh acknowledgement and
// hands out answers carrying no proof at all, so what a fill reports can be held to what the provider said: a
// "delivered" needs an acknowledgement the provider gave for a call that carried the item, else it is recorded stalled;
// and an answer comes back with no signature or account link the provider didn't carry. The rules hold for any
// provider protocol: the fixture answers every request alike, whatever path and body the fill sends.
import type { JsonValue } from '@deepbuild/contracts';
import type { Random } from '../generator.js';
import { fail } from '../slot-types.js';
import type { Fixture, PlantedFill, SlotCase, SlotFill, SlotKitImpl, SlotRule } from '../slot-types.js';
import { list, object, word } from './shared.js';

const CHANNEL = 'channel@1';

export interface ChannelItem {
  thread_key: string; summary: string; link: string; answerable: 'answer' | 'view' | 'cancel' | 'closed';
  options: { id: string; label: string }[]; revision: number; hub: string; refused: string | null;
}
export interface ChannelRequest { method: 'GET' | 'POST'; path: string; body?: unknown }
export interface ChannelReply { status: number; body: unknown }
/** The hub's provider call; the kit's provider answers at once, so the preflight's synchronous kit check can drive a fill. */
export interface ChannelCtx { settings: Record<string, unknown>; fetch(request: ChannelRequest): Promise<ChannelReply> | ChannelReply }
export type Delivered = { outcome: 'delivered'; ack: string } | { outcome: 'stalled' } | { outcome: 'timed_out' } | { outcome: 'conflict'; conflict: string };
export interface ChannelAnswer { thread_key: string; answer: string; signature?: unknown; account_link_id?: string }
export interface Received { answers: ChannelAnswer[]; seen: string[]; conflict: string | null }
export interface ChannelFill extends SlotFill {
  slot: 'channel@1';
  kind: 'device' | 'chat' | 'email' | 'text';
  deliver(item: ChannelItem, ctx: ChannelCtx): Promise<Delivered> | Delivered;
  receive(ctx: ChannelCtx): Promise<Received> | Received;
}

const RULES = {
  acked: { id: 'delivered-means-acknowledged', rule: 'A send reported delivered carries an acknowledgement its provider gave for a call that carried the item; one without is recorded stalled.', message: 'reported delivered with no acknowledgement from its provider, so it is recorded stalled' },
  proof: { id: 'proof-from-provider', rule: 'An answer comes back with a signature or an account link only where its provider carried one: a channel never marks an answer signed or linked on its own word.', message: 'returned an answer marked as signed or linked that its provider never carried' },
  shape: { id: 'answers-in-shape', rule: 'deliver says delivered, stalled, timed_out or conflict; receive returns answers, seen and conflict.', message: 'answered out of shape' },
};
const rules: SlotRule[] = Object.values(RULES).map(({ id, rule }) => ({ id, rule }));
const OUTCOMES = ['delivered', 'stalled', 'timed_out', 'conflict'];

interface Input { item: ChannelItem; answer: string }
/** The provider fixture: every call answered 200 with a fresh acknowledgement, and the case's answer, with no proof. */
function provider(input: Input): { ctx: ChannelCtx; acks: Map<string, string> } {
  const acks = new Map<string, string>();
  let n = 0;
  const ctx: ChannelCtx = {
    settings: { api: 'http://127.0.0.1:9' },
    fetch: (request) => {
      const ack = `kit-ack-${++n}`;
      acks.set(ack, JSON.stringify(request.body ?? null));
      const answers = [{ thread_key: input.item.thread_key, answer: input.answer }];
      return { status: 200, body: { ack, answers, seen: [], cursor: String(n), ok: true } };
    },
  };
  return { ctx, acks };
}

/** `then` on a provider's reply: at once when it answered at once, as the kit's provider does, else once it settles. */
const after = <R>(reply: Promise<ChannelReply> | ChannelReply, then: (reply: ChannelReply) => R): R | Promise<R> => (reply instanceof Promise ? reply.then(then) : then(reply));

type Fault = 'none' | 'no-ack' | 'signs' | 'shape';
function reference(fault: Fault = 'none'): ChannelFill {
  let cursor: string | undefined;
  return {
    slot: CHANNEL, revision: 1, kind: 'chat',
    deliver(item, ctx) {
      if (fault === 'no-ack') return { outcome: 'delivered' } as unknown as Delivered;
      if (fault === 'shape') return { outcome: 'sent' } as unknown as Delivered;
      return after(ctx.fetch({ method: 'POST', path: '/messages', body: { to: ctx.settings.to ?? null, item } }), (reply): Delivered => {
        const ack = (reply.body as { ack?: unknown } | null)?.ack;
        if (reply.status === 200 && typeof ack === 'string' && ack) return { outcome: 'delivered', ack };
        return { outcome: 'stalled' };
      });
    },
    receive(ctx) {
      return after(ctx.fetch({ method: 'GET', path: `/answers${cursor === undefined ? '' : `?after=${cursor}`}` }), (reply): Received => {
        const body = reply.body as { answers?: ChannelAnswer[]; seen?: string[]; cursor?: string };
        cursor = body.cursor ?? cursor;
        const answers = (body.answers ?? []).map((a) => ({ thread_key: a.thread_key, answer: a.answer }));
        if (fault === 'signs') {
          return { answers: answers.map((a) => ({ ...a, signature: { signed: { device: 'device:01KIT', ask: a.thread_key, answer: a.answer }, sig: '' } })), seen: [], conflict: null };
        }
        return { answers, seen: body.seen ?? [], conflict: null };
      });
    },
  };
}

const plant = (name: string, breaks: keyof typeof RULES, codes: string[], fill: ChannelFill): PlantedFill<ChannelFill> => ({ name, message: RULES[breaks].message, codes, breaks: RULES[breaks].id, fill });
const plantedFills = (): PlantedFill<ChannelFill>[] => [
  plant('delivered-without-ack', 'acked', ['delivered_without_ack'], reference('no-ack')),
  plant('signed-without-signature', 'proof', ['proof_not_carried'], reference('signs')),
  plant('answers-out-of-shape', 'shape', ['answer_unshaped'], reference('shape')),
];

const item = (key: string, summary: string): ChannelItem => ({
  thread_key: key, summary, link: `deepbuild://ask/${key.slice(4)}`, answerable: 'answer',
  options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }], revision: 1, hub: 'hub:01KITHUB', refused: null,
});
const toCase = (id: string, part: 'fixed' | 'seeded', input: Input): SlotCase => ({ id, part, input: input as unknown as JsonValue, expected: null });
const fixtures: Fixture[] = [
  toCase('choice-delivered-then-answered', 'fixed', { item: item('ask:01KITCHANNEL00000000000001', 'Keep the cache in SQLite?'), answer: 'yes' }),
  toCase('task-delivered-then-done', 'fixed', { item: item('ask:01KITCHANNEL00000000000002', 'Sign in to the registry, then say you did it'), answer: 'no' }),
].map(({ id, input, expected }) => ({ id, input, expected }));

const generate = (random: Random): SlotCase[] => [0, 1, 2].map((i) =>
  toCase(`seeded-${i + 1}`, 'seeded', { item: item(`ask:01KITSEED${word(random, 16).toUpperCase()}`, `A question about ${word(random, 8)}?`), answer: random.int(0, 1) ? 'yes' : 'no' }));

function* judge(fill: ChannelFill, c: SlotCase): Generator<() => unknown, void, unknown> {
  const input = c.input as unknown as Input;
  const key = input.item.thread_key;
  const { ctx, acks } = provider(input);
  const sent = object('deliver\'s answer', yield () => fill.deliver(structuredClone(input.item), ctx));
  if (!OUTCOMES.includes(sent.outcome as string)) throw fail(RULES.shape.message, ['answer_unshaped'], `deliver of ${key} said ${JSON.stringify(sent)}`);
  if (sent.outcome === 'delivered') {
    const carried = typeof sent.ack === 'string' ? acks.get(sent.ack) : undefined;
    if (carried === undefined || !carried.includes(key)) {
      throw fail(RULES.acked.message, ['delivered_without_ack'], `${key} was reported delivered${typeof sent.ack === 'string' ? ` with the ack ${sent.ack}, which its provider never gave for it` : ' with no ack'}`);
    }
  }
  const got = object('receive\'s answer', yield () => fill.receive(ctx));
  for (const a of list('receive\'s answers', got.answers)) {
    const answer = object('an answer', a);
    if (answer.signature !== undefined || answer.account_link_id !== undefined) {
      throw fail(RULES.proof.message, ['proof_not_carried'], `its answer ${JSON.stringify(answer.answer)} on ${String(answer.thread_key)} carries ${answer.signature !== undefined ? 'a signature' : 'an account link'} its provider never carried`);
    }
  }
  list('receive\'s seen', got.seen);
}

export const channelKit = (): SlotKitImpl<ChannelFill> => ({
  slot: CHANNEL, fills: 'many', revision: 1, rules, fixtures, planted: plantedFills(),
  clean: () => [reference()], generate, judge,
});

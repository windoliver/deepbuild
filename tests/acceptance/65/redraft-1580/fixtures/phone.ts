// paseo's phone app, a copy of `Phone` in ../../redraft-1579/fixtures/phone.ts (same repo, same license) with one
// change: when the card the relay shows carries a plan with a string `hash`, the phone signs that hash as
// `plan_hash` beside `{ask, revision, card_hash, answer}` (docs/technical-design.md, the Channel bullet: "the signed
// fields include that hash, which the hub never fills in"; #1580, and its blind suite's surface: the card carries
// `plan: {hash, steps}`). A card with no plan is signed as before, with no `plan_hash`. The signer (`paramsHash`,
// `sigOver`, `newOnce`), the card hash and the answer as a provider hands it out are the earlier fixtures', imported
// as they are. The copy keeps only what AC3's signed case uses: no forged key, no other time.
import type { KeyObject } from 'node:crypto';
import { cardHash, type Answer, type Item, type Provider } from '../../fixtures/providers.ts';
import { newOnce, paramsHash, sigOver, type Signature, type Signed } from '../../redraft-1579/fixtures/phone.ts';

/** The hash of the plan a card carries (`plan.hash`), or undefined when it carries none. */
export const planHashOn = (shown: Item): string | undefined => {
  const hash = typeof shown.plan === 'object' && shown.plan !== null ? (shown.plan as { hash?: unknown }).hash : undefined;
  return typeof hash === 'string' ? hash : undefined;
};

/**
 * paseo's phone app with its device key; `device` is the ID the hub gave it at pairing (device.pair), and `hub` the
 * ID the hub's hello named. `Phone.of` takes the key and ID of the phone the earlier suite's world() paired.
 */
export class Phone {
  readonly key: KeyObject;
  readonly device: string;
  readonly hub: string;
  constructor(key: KeyObject, device: string, hub: string) {
    this.key = key;
    this.device = device;
    this.hub = hub;
  }
  static of(paired: { key: KeyObject; device: string }, hub: string): Phone {
    if (!paired.device) throw Error('BLOCKED: the world paired no phone (world({phone: true}))');
    return new Phone(paired.key, paired.device, hub);
  }
  /**
   * The person answers a card the relay shows, signed over the card as it showed it, its plan's hash included when it
   * carries one. Returns the answer as the provider hands it out, and when the channel picked it up.
   */
  answer(relay: Provider, threadKey: string, option: string): { answer: Answer; picked(): number | undefined } {
    const shown = relay.latest(threadKey);
    if (!shown) throw Error(`BLOCKED: the phone shows no card for ${threadKey}: the paseo channel delivered none (cards it holds: ${relay.posts.map((p) => p.item.thread_key).join(', ') || 'none'})`);
    const planHash = planHashOn(shown);
    const params = { ask: threadKey, revision: shown.revision, card_hash: cardHash(shown), ...(planHash === undefined ? {} : { plan_hash: planHash }), answer: option };
    const signed: Signed = { device: this.device, method: 'channel.answer', hub: this.hub, at: Date.now(), once: newOnce(), params: paramsHash(params) };
    const signature: Signature = { signed, sig: sigOver(signed, this.key), params };
    const answer: Answer = { thread_key: threadKey, answer: option, signature: signature as unknown as NonNullable<Answer['signature']> };
    return { answer, picked: relay.give(answer).picked };
  }
}

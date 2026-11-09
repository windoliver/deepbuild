// paseo's phone app, a copy of `Phone` in ../../fixtures/providers.ts (same repo, same license) with one change: it
// signs as the design now says (docs/technical-design.md, "The trusted path is a device you paired"; #1579). Its
// signature is `{signed: {device, method, hub, at, once, params}, sig, params}`: a channel's answer is signed for the
// method `channel.answer` over `{ask, revision, card_hash, answer}`, those params carried beside `signed` as
// `params`, `signed.params` the lower-case hex SHA-256 of their RFC 8785 bytes, `hub` the ID the hub's hello names,
// `once` a once-only ID, and `sig` Ed25519 over the RFC 8785 bytes of `signed`, in base64url. The providers, the
// card hash and the answer as a provider hands it out are the earlier fixture's, imported as they are.
// The signer here is shared with the app's answer (../helpers.ts): one format for the app, phones and channels.
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { canonicalize, type JsonValue } from '../../../../../packages/contracts/src/index.ts';
import { cardHash, type Answer, type Provider } from '../../fixtures/providers.ts';

/** What a paired device signs (the design's `signed`). */
export interface Signed { device: string; method: string; hub: string; at: number; once: string; params: string }
export interface Signature { signed: Signed; sig: string; params?: Record<string, unknown> }

/** The lower-case hex SHA-256 of the RFC 8785 bytes of a call's params, `signature` left out. */
export const paramsHash = (params: Record<string, unknown>): string => {
  const { signature: _left, ...rest } = params;
  return createHash('sha256').update(canonicalize(rest as JsonValue)).digest('hex');
};
/** A once-only ID: 24 base64url characters, never used again by this process. */
export const newOnce = (): string => randomBytes(18).toString('base64url');
/** `sig`: base64url of the Ed25519 signature over the RFC 8785 bytes of `signed`. */
export const sigOver = (signed: Signed, key: KeyObject): string => sign(null, canonicalize(signed as unknown as JsonValue), key).toString('base64url');

/** The phone's options for one answer. */
export interface AnswerOptions {
  /** 'forged' names this phone's device and signs with another key. */
  forged?: boolean;
  /** The signature's `at`, ms since the epoch; default now. */
  at?: number;
}

/**
 * paseo's phone app with its device key; `device` is the ID the hub gave it at pairing (device.pair), and `hub` the
 * ID the hub's hello named when it paired. `Phone.of` takes the key and ID of the phone the earlier suite's world()
 * paired, so the world is the earlier suite's and only the signature is new.
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
   * The person answers a card the relay shows, signed over the card as it showed it. Returns the answer as the
   * provider hands it out, and when the channel picked it up.
   */
  answer(relay: Provider, threadKey: string, option: string, o: AnswerOptions = {}): { answer: Answer; picked(): number | undefined } {
    const shown = relay.latest(threadKey);
    if (!shown) throw Error(`BLOCKED: the phone shows no card for ${threadKey}: the paseo channel delivered none (cards it holds: ${relay.posts.map((p) => p.item.thread_key).join(', ') || 'none'})`);
    const params = { ask: threadKey, revision: shown.revision, card_hash: cardHash(shown), answer: option };
    const signed: Signed = { device: this.device, method: 'channel.answer', hub: this.hub, at: o.at ?? Date.now(), once: newOnce(), params: paramsHash(params) };
    const key = o.forged ? generateKeyPairSync('ed25519').privateKey : this.key;
    const signature: Signature = { signed, sig: sigOver(signed, key), params };
    const answer: Answer = { thread_key: threadKey, answer: option, signature: signature as unknown as NonNullable<Answer['signature']> };
    return { answer, picked: relay.give(answer).picked };
  }
}

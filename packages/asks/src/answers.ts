// Who may answer an ask, and what an answer may carry: the trusted path, the kinds a channel's link or typed text may
// answer, an answer's fields, and the writers that speak for an agent.

import type { JsonValue } from '@deepbuild/contracts';
import { AskRefused, isObj, type Ask } from './model.js';

/** The trusted path: the question card and `deep inbox answer`. Every other writer is an agent's or the core's. */
export const TRUSTED: Readonly<Record<string, 'card' | 'inbox'>> = { app: 'card', cli: 'inbox' };
/** The kinds a channel's account link may answer (#65): "I did it", a taste call and a choice, each that ask alone. */
export const ANSWER_ALONE = new Set(['unblock', 'taste', 'choice']);
export const ANSWER_FIELDS = new Set(['option', 'words', 'image', 'plan_hash', 'token', 'steps', 'pictures']);
export const SHA256 = /^[0-9a-f]{64}$/;
export const PROVISIONAL_KINDS = new Set(['taste', 'choice']);
/** Kinds typed text can answer: questions that need no authority. An unblock closes only on its check. */
export const TYPED_KINDS = new Set(['taste', 'choice', 'exception', 'definition']);
/** Writers that speak for an agent: none of them closes an ask. */
export const isAgent = (writer: string): boolean => writer === 'hook' || writer.startsWith('mcp:');

/** The document `doc:<id>` a pin to one of its revisions, `doc:<id>@<rev>`, names; undefined for another pin. */
export const docOf = (pin: { kind?: unknown; ref?: unknown } | undefined): string | undefined => {
  const at = pin?.kind === 'doc_revision' && typeof pin.ref === 'string' ? pin.ref.lastIndexOf('@') : -1;
  const doc = at > 0 ? (pin!.ref as string).slice(0, at) : undefined;
  return doc?.startsWith('doc:') ? doc : undefined;
};

/**
 * What the answer records of the pictures a taste call judges (#3234): the card's entries, one per picture its
 * evidence lists, in that order; from anywhere nothing is drawn, every picture not shown. Undefined when the call
 * judges no pictures.
 */
export function picturesOf(ask: Ask, via: 'card' | 'inbox' | 'channel', given: unknown, listed: string[] | undefined): JsonValue[] | undefined {
  if (given === undefined) return listed?.length ? listed.map((sha256) => ({ sha256, shown: false, scale: 0, ms: 0 })) : undefined;
  if (via !== 'card') throw new AskRefused('only the question card draws pictures: an answer from anywhere else records them not shown', { field: 'pictures' });
  const entry = (p: unknown): boolean => isObj(p) && Object.keys(p).length === 4 && typeof p.sha256 === 'string' && SHA256.test(p.sha256) && typeof p.shown === 'boolean'
    && typeof p.scale === 'number' && p.scale >= 0 && p.scale <= 1000 && Number.isInteger(p.ms) && (p.ms as number) >= 0;
  if (!Array.isArray(given) || !given.every(entry)) throw new AskRefused('pictures are entries of {sha256, shown, scale, ms}', { field: 'pictures' });
  const shas = (given as { sha256: string }[]).map((p) => p.sha256);
  if (listed && shas.join() !== listed.join()) throw new AskRefused(`${ask.handle}'s evidence lists ${listed.length} pictures, and the answer's entries name others`, { field: 'pictures' });
  return given.length ? given as JsonValue[] : undefined;
}

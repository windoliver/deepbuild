// Who may answer an ask, and what an answer may carry: the trusted path, the kinds a channel's link or typed text may
// answer, an answer's fields, and the writers that speak for an agent.

/** The trusted path: the question card and `deep inbox answer`. Every other writer is an agent's or the core's. */
export const TRUSTED: Readonly<Record<string, 'card' | 'inbox'>> = { app: 'card', cli: 'inbox' };
/** The kinds a channel's account link may answer (#65): "I did it", a taste call and a choice, each that ask alone. */
export const ANSWER_ALONE = new Set(['unblock', 'taste', 'choice']);
export const ANSWER_FIELDS = new Set(['option', 'words', 'image', 'plan_hash', 'token', 'steps']);
export const SHA256 = /^[0-9a-f]{64}$/;
export const PROVISIONAL_KINDS = new Set(['taste', 'choice']);
/** Kinds typed text can answer: questions that need no authority. An unblock closes only on its check. */
export const TYPED_KINDS = new Set(['taste', 'choice', 'exception', 'definition']);
/** Writers that speak for an agent: none of them closes an ask. */
export const isAgent = (writer: string): boolean => writer === 'hook' || writer.startsWith('mcp:');

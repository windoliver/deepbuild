// What a hook reply injects stays inside the agent's cap on injected output (#1296): Claude Code reads at most its
// facts' `contextOutput.capChars` inline and, past it, shows the model a file path and a preview it isn't asked to
// read. So the pieces the model must see (the rules you typed, the open asks' requirement IDs) go inline first, then
// the others in order while they fit, and the rest goes by handle with a line saying where to continue.

/** One piece of a part: a line of it, whether the model must see it inline, and the handles it carries, if any. */
export interface Piece { text: string; keep?: boolean; ids?: string[] }
/**
 * One part of a reply's context: its name for the record and its text, or its pieces, one per line; a part with
 * pieces is cut between them, a part without is inline or by handle whole.
 */
export interface Part { name: string; text?: string | undefined; keep?: boolean; pieces?: Piece[] }
export interface Fitted { inline: string; rest: string; inlineNames: string[]; restNames: string[]; inlineIds: string[] }

const JOIN = '\n\n';
/** Room the continue line takes: its words and a handle of 64 hex digits, with room to spare. */
const CONTINUE_ROOM = 400;
/** The line that ends a block cut to fit: where the rest is, and the command that reads it. */
export const continueLine = (handle: string, names: readonly string[], cap: number): string =>
  `DeepBuild: ${names.join(', ')} didn't fit in this hook's ${cap}-character limit; the rest is at ${handle}. Continue with \`deep read ${handle}\`.`;

const piecesOf = (p: Part): Piece[] => p.pieces ?? (p.text ? [{ text: p.text, ...(p.keep ? { keep: true } : {}) }] : []);
const textOf = (pieces: readonly Piece[]): string => pieces.map((q) => q.text).join('\n');

/** The parts joined as the reply carries them, or, past `cap`, what goes inline and what goes by handle. */
export function fit(parts: readonly Part[], cap: number, join = JOIN): Fitted {
  const present = parts.map((p) => ({ name: p.name, pieces: piecesOf(p) })).filter((p) => p.pieces.length);
  const whole = present.map((p) => textOf(p.pieces)).join(join);
  const ids = (pieces: readonly Piece[]) => pieces.flatMap((q) => q.ids ?? []);
  if (whole.length <= cap) return { inline: whole, rest: '', inlineNames: present.map((p) => p.name), restNames: [], inlineIds: present.flatMap((p) => ids(p.pieces)) };
  let room = cap - CONTINUE_ROOM;
  const inline = new Set<Piece>();
  const started = new Set<object>();
  const take = (part: object, q: Piece): void => {
    // A part's first piece pays for the join before it, each later one for its newline.
    const needs = q.text.length + (started.has(part) ? 1 : started.size ? join.length : 0);
    if (needs > room) return;
    inline.add(q);
    started.add(part);
    room -= needs;
  };
  for (const keep of [true, false]) for (const p of present) for (const q of p.pieces) if (Boolean(q.keep) === keep) take(p, q);
  const kept = present.map((p) => ({ name: p.name, pieces: p.pieces.filter((q) => inline.has(q)) })).filter((p) => p.pieces.length);
  const left = present.map((p) => ({ name: p.name, pieces: p.pieces.filter((q) => !inline.has(q)) })).filter((p) => p.pieces.length);
  return {
    inline: kept.map((p) => textOf(p.pieces)).join(join), rest: left.map((p) => textOf(p.pieces)).join(JOIN),
    inlineNames: kept.map((p) => p.name), restNames: left.map((p) => p.name), inlineIds: kept.flatMap((p) => ids(p.pieces)),
  };
}

/** One extension's contribution to a hook reply. */
export interface HookContribution { extension: string; firstParty: boolean; deny?: { reason: string }; context: string[] }

/** The reply after the join, as hook.joined@1 describes it. */
export interface JoinedHookReply {
  order: string[];
  bound: number;
  denies: { extension: string; reason: string }[];
  context: { extension: string; text: string }[];
}

/** Context characters a hook reply may carry per millisecond of the hook's time budget. */
const CHARACTERS_PER_MS = 200;

/** hook.joined@1's largest bound, so a bound always fits its schema. */
const MAX_BOUND = Number.MAX_SAFE_INTEGER;

export const contextBoundFor = (timeBudgetMs: number): number =>
  (Number.isNaN(timeBudgetMs) ? 1 : Math.min(MAX_BOUND, Math.max(1, Math.floor(timeBudgetMs * CHARACTERS_PER_MS))));

const byId = (a: HookContribution, b: HookContribution) => (a.extension < b.extension ? -1 : a.extension > b.extension ? 1 : 0);

/**
 * Joins contributions in one fixed order, first-party extensions and then every other package, each group
 * by extension ID. Every deny is kept whole, outside the bound. Context fills the bound in join order: a
 * group that doesn't fit is cut to equal shares, each block keeping its start, and later groups get none.
 */
export function joinHookReplies(contributions: readonly HookContribution[], bound: number): JoinedHookReply {
  const groups = [contributions.filter((c) => c.firstParty).sort(byId), contributions.filter((c) => !c.firstParty).sort(byId)];
  const ordered = groups.flat();
  // A bound is a whole count of characters (code points, as the schema's lengths count them) within the
  // schema's range; one below zero, or not a number, leaves no room.
  const limit = Number.isNaN(bound) ? 0 : Math.min(MAX_BOUND, Math.max(0, Math.floor(bound)));
  let room = limit;
  const context: JoinedHookReply['context'] = [];
  for (const group of groups) {
    const blocks = group.flatMap((c) => c.context.map((text) => ({ extension: c.extension, text, chars: [...text] })));
    const length = blocks.reduce((n, b) => n + b.chars.length, 0);
    if (length <= room) {
      context.push(...blocks.map(({ extension, text }) => ({ extension, text })));
      room -= length;
      continue;
    }
    // Equal shares; a block shorter than its share leaves the rest to the blocks after it.
    const sorted = [...blocks].sort((a, b) => a.chars.length - b.chars.length);
    const shares = new Map<(typeof blocks)[number], number>();
    let left = room;
    sorted.forEach((block, i) => {
      const share = Math.min(block.chars.length, Math.floor(left / (sorted.length - i)));
      shares.set(block, share);
      left -= share;
    });
    for (const block of blocks) {
      const text = block.chars.slice(0, shares.get(block)).join('');
      if (text) context.push({ extension: block.extension, text });
    }
    room = 0;
  }
  return {
    order: ordered.map((c) => c.extension),
    bound: limit,
    denies: ordered.flatMap((c) => (c.deny ? [{ extension: c.extension, reason: c.deny.reason }] : [])),
    context,
  };
}

/** Features both sides list stay on; a client's feature the hub doesn't list is off, and only that one. */
export function negotiateFeatures(client: readonly string[], hub: readonly string[]): { on: string[]; off: string[] } {
  const listed = new Set(hub);
  return { on: client.filter((f) => listed.has(f)), off: client.filter((f) => !listed.has(f)) };
}

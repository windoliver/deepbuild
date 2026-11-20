// What a session holds of DeepBuild's own MCP servers at its start, counted the way its client loads them (#2897). Both
// counts, as scripts/tool-load.mjs wrote them from the built tool lists, go into the session's start with the way its
// client's facts give, so a reader charges the one that applies.
import { readFileSync } from 'node:fs';
import { isRecord as isObj } from '@deepbuild/contracts';
import { adapterOf } from './adapter-facts.js';

let counts: { startTokens: number; wholeTokens: number } | undefined;

/**
 * The two counts for `agent`'s session on `version`, with the way its facts give for that version: `unread` for a
 * version no entry covers. Before the session's version is read, the facts' newest version stands for it, as the
 * hook mapping's does. Undefined for an agent with no facts.
 */
export function toolLoad(agent: string, version: string | undefined): { way: 'whole' | 'search' | 'unread'; startTokens: number; wholeTokens: number } | undefined {
  const facts = adapterOf(agent)?.facts as Record<string, unknown> | undefined;
  if (!facts) return undefined;
  const at = version ?? (facts.versions as string[]).at(-1);
  const entries = isObj(facts.toolLoading) && Array.isArray(facts.toolLoading.entries) ? facts.toolLoading.entries : [];
  const entry = entries.find((e) => isObj(e) && Array.isArray(e.versions) && e.versions.includes(at));
  const way = isObj(entry) && (entry.way === 'search' || entry.way === 'whole') ? entry.way : 'unread';
  counts ??= JSON.parse(readFileSync(new URL('../tool-load.json', import.meta.url), 'utf8')) as { startTokens: number; wholeTokens: number };
  return { way, ...counts };
}

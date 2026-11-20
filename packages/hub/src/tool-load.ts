// What a session holds of DeepBuild's own MCP servers at its start, counted the way its client loads them (#2897). Both
// counts, as scripts/tool-load.mjs wrote them from the built tool lists, go into the session's start with the way its
// client's facts give, so a reader charges the one that applies.
import { readFileSync } from 'node:fs';
import { isRecord as isObj } from '@deepbuild/contracts';
import { adapterOf } from './adapter-facts.js';

let counts: { startTokens: number; wholeTokens: number } | undefined;

/**
 * The two counts for a Claude Code session on `version` whose config loads the deepbuild server, with the way its
 * facts give for that version: `unread` for a version no entry covers. The loads read Claude Code's MCP configs, so
 * any other agent's session holds none here. Before the session's version is read, the facts' newest version stands
 * for it, as the hook mapping's does.
 */
export function toolLoad(agent: string, loads: readonly { kind: string; name: string }[], version: string | undefined): { way: 'whole' | 'search' | 'unread'; startTokens: number; wholeTokens: number } | undefined {
  if ((agent !== 'claude-code' && agent !== 'claude') || !loads.some((l) => l.kind === 'mcp' && l.name === 'deepbuild')) return undefined;
  const facts = adapterOf('claude-code')?.facts as Record<string, unknown> | undefined;
  if (!facts) return undefined;
  const at = version ?? (facts.versions as string[]).at(-1);
  const entries = isObj(facts.toolLoading) && Array.isArray(facts.toolLoading.entries) ? facts.toolLoading.entries : [];
  const entry = entries.find((e) => isObj(e) && Array.isArray(e.versions) && e.versions.includes(at));
  const way = isObj(entry) && (entry.way === 'search' || entry.way === 'whole') ? entry.way : 'unread';
  counts ??= JSON.parse(readFileSync(new URL('../tool-load.json', import.meta.url), 'utf8')) as { startTokens: number; wholeTokens: number };
  return { way, ...counts };
}

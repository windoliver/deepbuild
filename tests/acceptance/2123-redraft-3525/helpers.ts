// What this redraft adds to the helpers it imports unchanged (../1731/helpers.ts, ../2123/helpers.ts): the fetch's
// call in its place after #3525, a form of deep_job (REDRAFT.md). Nothing here stands in for DeepBuild.
import type { Line, Outcome, World } from '../1731/helpers.ts';
import { LIB } from '../1731/helpers.ts';

/**
 * One deep_job call through deep mcp, read as #1731's `kinds` reads a deep_kinds call: a JSON-RPC error is an error
 * outcome; otherwise the result's structured content, or its text parsed, with `isError` as the result says.
 */
export async function job(w: World, args: Line): Promise<Outcome> {
  const reply = await w.mcp.request('tools/call', { name: 'deep_job', arguments: args });
  if (reply.error) return { isError: true, value: reply.error as Line, text: JSON.stringify(reply.error) };
  const result = (reply.result ?? {}) as Line;
  const text = Array.isArray(result.content) ? String(result.content.find((c: Line) => c?.type === 'text')?.text ?? '') : '';
  const value = (result.structuredContent ?? parse(text) ?? {}) as Line;
  return { isError: result.isError === true, value, text: text || JSON.stringify(value) };
}

/** The fetch's arguments as a deep_job form: #3525's `{op: "fetch", library, id}`, no other field. */
export const fetchArgs = (id: string): Line => ({ op: 'fetch', library: LIB, id });

/** #1731's own parse (not exported there): an object, or undefined. */
const parse = (text: string): Line | undefined => { try { const v: unknown = JSON.parse(text); return typeof v === 'object' && v !== null ? (v as Line) : undefined; } catch { return undefined; } };

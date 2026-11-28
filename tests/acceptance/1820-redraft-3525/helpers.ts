// For #1820's redraft under #3525: the pack fetch reached through `deep_job {op: "fetch", pack, asset}` (#3525 moves
// the fetch out of deep_kinds into a form of deep_job, with the same fields and replies). `job` is #1731's `kinds`
// (tests/acceptance/1731/helpers.ts) with the tool's name changed, and `until` is #1820's (../1820/helpers.ts) calling
// it. Everything else is #1820's helpers, reused read-only.
import { sleep, type Line, type Outcome, type World } from '../1820/helpers.ts';

export * from '../1820/helpers.ts';

const parse = (text: string): Line | undefined => { try { const v: unknown = JSON.parse(text); return typeof v === 'object' && v !== null ? (v as Line) : undefined; } catch { return undefined; } };

/** One deep_job call through deep mcp, read as #1731's `kinds` reads a deep_kinds call. */
export async function job(w: World, args: Line): Promise<Outcome> {
  const reply = await w.mcp.request('tools/call', { name: 'deep_job', arguments: args });
  if (reply.error) return { isError: true, value: reply.error as Line, text: JSON.stringify(reply.error) };
  const result = (reply.result ?? {}) as Line;
  const text = Array.isArray(result.content) ? String(result.content.find((c: Line) => c?.type === 'text')?.text ?? '') : '';
  const value = (result.structuredContent ?? parse(text) ?? {}) as Line;
  return { isError: result.isError === true, value, text: text || JSON.stringify(value) };
}

/** A fetch called again until it is no longer held (the job after your yes), up to `ms`. */
export async function until(w: World, args: Line, ms = 120_000): Promise<Outcome> {
  const deadline = Date.now() + ms;
  for (;;) {
    const o = await job(w, args);
    if (o.value.status !== 'held' || Date.now() > deadline) return o;
    await sleep(500);
  }
}

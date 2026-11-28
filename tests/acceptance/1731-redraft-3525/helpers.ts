// The #1731 helpers that reach the fetch, redrafted for #3525: the fetch is a form of `deep_job`
// (`deep_job {op: "fetch", library, id}`), with the same fields and the same replies as the base's `deep_kinds` fetch.
// Everything else (the world, the hub, the library, `deep mcp`, the asks, the store, the judges' words) is
// tests/acceptance/1731/helpers.ts, imported unchanged. Each function here is the original's, line for line, but for
// the tool it names. `fetchArgs` ({op: 'fetch', library, id}) is the original's, unchanged: sent to deep_job, its
// other fields are left out.
import { asks, blocked, fetchArgs, libraryRows, search, sleep, stored, type Line, type Outcome, type World } from '../1731/helpers.ts';
import { asset, reportedLicense } from '../1731/library.ts';

const parse = (text: string): Line | undefined => { try { const v: unknown = JSON.parse(text); return typeof v === 'object' && v !== null ? (v as Line) : undefined; } catch { return undefined; } };

/** One deep_job call through deep mcp: the original's `kinds`, naming deep_job. */
export async function job(w: World, args: Line): Promise<Outcome> {
  const reply = await w.mcp.request('tools/call', { name: 'deep_job', arguments: args });
  if (reply.error) return { isError: true, value: reply.error as Line, text: JSON.stringify(reply.error) };
  const result = (reply.result ?? {}) as Line;
  const text = Array.isArray(result.content) ? String(result.content.find((c: Line) => c?.type === 'text')?.text ?? '') : '';
  const value = (result.structuredContent ?? parse(text) ?? {}) as Line;
  return { isError: result.isError === true, value, text: text || JSON.stringify(value) };
}
/** A fetch called again until it no longer says held (the job after your yes), up to `ms`. */
export async function fetchUntilDone(w: World, id: string, ms = 300_000): Promise<Outcome> {
  const deadline = Date.now() + ms;
  for (;;) {
    const o = await job(w, fetchArgs(id));
    if (o.value.status !== 'held' || Date.now() > deadline) return o;
    await sleep(1000);
  }
}

/**
 * AC3's judge, on the unknown-license model: its row's license is the one the library's own record states, its fetch
 * is BLOCKED with exactly one unblock ask and no authority ask, and no byte of it was fetched or stored.
 */
export async function judgeUnknown(w: World, id: string): Promise<string[]> {
  const failures: string[] = [];
  const want = reportedLicense(asset(id).record.license);
  const row = libraryRows((await search(w)).rows).find((r) => r.id === id);
  if (!row) failures.push(`row ${id} is missing from the search`);
  else if (row.license?.id !== want.id) failures.push(`row ${id} reads license ${JSON.stringify(row.license?.id)}; the library's own record (/api/assets/${id}) says ${want.id}`);
  const before = await asks(w);
  const from = w.library.log.length;
  const first = await job(w, fetchArgs(id));
  const second = await job(w, fetchArgs(id));
  const raised = (await asks(w)).slice(before.length);
  if (!blocked(first) || !blocked(second)) failures.push(`the fetch of ${id} isn't BLOCKED: ${first.text.slice(0, 600)}`);
  const unblock = raised.filter((a) => a.kind === 'unblock');
  if (unblock.length !== 1) failures.push(`two fetches of ${id} raised ${unblock.length} unblock asks, not one`);
  const authority = raised.filter((a) => a.kind === 'authority');
  if (authority.length) failures.push(`the fetch of ${id} raised an authority ask, as for a license it may take: ${authority[0]!.text.slice(0, 400)}`);
  const files = w.library.log.slice(from).filter((q) => q.path.startsWith('/files/'));
  if (files.length) failures.push(`the library's request log shows ${id}'s bytes fetched: ${files.map((q) => q.path).join(', ')}`);
  for (const f of asset(id).record.files) if (await stored(w, f.sha256)) failures.push(`the store holds ${f.path} (${f.sha256})`);
  return failures;
}

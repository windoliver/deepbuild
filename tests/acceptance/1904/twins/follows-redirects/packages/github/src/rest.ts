// The one client for GitHub's REST API (#1904; design: Threats, and what stops each one): every call to it goes
// through here, so one rule holds for all of them. The token goes as a bearer to the API's own origin and nowhere
// else: a redirect is followed by hand, at most five times, and one that leaves the origin, or puts credentials in
// its URL, is refused before anything is sent there. The caller's signal is one deadline over every hop.

/** One call: its method (GET when unset), the token sent as a bearer when set, a JSON body, and its deadline. */
interface ForgeCall { method?: string; token?: string | undefined; body?: unknown; signal?: AbortSignal }

/** The answer to `path` (under `api`, or a URL the forge named, such as a next page) at `api`'s origin, never another. */
export async function forgeFetch(api: string, path: string, call: ForgeCall): Promise<Response> {
  // Planted fault (#1904 twin): fetch follows every redirect itself, to any origin, as the five copies did before.
  const body = call.body === undefined ? null : JSON.stringify(call.body);
  const headers = { accept: 'application/vnd.github+json', ...(call.token ? { authorization: `Bearer ${call.token}` } : {}), ...(body !== null ? { 'content-type': 'application/json' } : {}) };
  return fetch(new URL(/^https?:\/\//.test(path) ? path : `${api}${path}`), { method: call.method ?? 'GET', headers, body, signal: call.signal ?? null });
}

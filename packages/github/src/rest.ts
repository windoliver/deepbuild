// The one client for GitHub's REST API (#1904; design: Threats, and what stops each one): every call to it goes
// through here, so one rule holds for all of them. The token goes as a bearer to the API's own origin and nowhere
// else: a redirect is followed by hand, at most five times, and one that leaves the origin, or puts credentials in
// its URL, is refused before anything is sent there. The caller's signal is one deadline over every hop.

/** The statuses fetch follows as redirects. */
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
/** One call: its method (GET when unset), the token sent as a bearer when set, a JSON body, and its deadline. */
interface ForgeCall { method?: string; token?: string | undefined; body?: unknown; signal?: AbortSignal }

/** The answer to `path` (under `api`, or a URL the forge named, such as a next page) at `api`'s origin, never another. */
export async function forgeFetch(api: string, path: string, call: ForgeCall): Promise<Response> {
  const origin = new URL(api).origin;
  let url = new URL(/^https?:\/\//.test(path) ? path : `${api}${path}`);
  let method = call.method ?? 'GET';
  let body = call.body === undefined ? undefined : JSON.stringify(call.body);
  for (let hop = 0; ; hop++) {
    if (url.origin !== origin || url.username || url.password) throw Error('the forge redirected outside its declared origin');
    const headers = { accept: 'application/vnd.github+json', ...(call.token ? { authorization: `Bearer ${call.token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) };
    const res = await fetch(url, { method, headers, body: body ?? null, redirect: 'manual', signal: call.signal ?? null });
    const location = res.headers.get('location');
    if (!REDIRECTS.has(res.status) || location === null) return res;
    await res.body?.cancel();
    if (hop >= 5) throw Error('the forge exceeded five redirects');
    url = new URL(location, url);
    // As fetch follows them: a 303, or a 301 or 302 after a POST, goes on as a GET without the body.
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) { method = 'GET'; body = undefined; }
  }
}

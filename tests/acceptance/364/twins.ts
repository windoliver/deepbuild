// The wrong programs the criteria name, built here and not in any package (README, Wrong programs). Each runs on the
// same scenario's real bytes: the answers the local servers gave, as the HTTP client got them, and the real hub's
// own calls where a twin wraps it.
import type { ExtensionHost, HttpAnswer, HttpClient } from '../../../packages/extension-host/src/index.ts';
import { scrubValues } from '../../../packages/evidence/src/index.ts';
import type { Connection } from '../../../packages/record/src/index.ts';
import { send, type TestServer, type TestStore } from './helpers.ts';

/**
 * AC4: a hub that lets its HTTP client follow redirects. The real hub, given an HTTP client that follows each 3xx to
 * its Location itself, sending the same request (its headers, the key among them) to the new host, as an HTTP client
 * left to follow redirects may.
 */
export function followingClient(routes: Record<string, TestServer>): HttpClient {
  return async (request, signal) => {
    let url = request.url;
    for (let hop = 0; hop < 5; hop++) {
      const answer = await send(routes, new Set(), { ...request, url }, signal);
      const location = answer.headers.location;
      if (answer.status < 300 || answer.status > 399 || !location) return answer;
      url = new URL(location, url).href;
    }
    throw Error('too many redirects');
  };
}

/** Each string in an answer passed through `f`, header names kept. */
const mapAnswer = (a: HttpAnswer, f: (s: string) => string): HttpAnswer => ({
  status: a.status, body: f(a.body), headers: Object.fromEntries(Object.entries(a.headers).map(([k, v]) => [k, f(v)])),
});

/**
 * AC5: a hub that scrubs only logs and traces. It writes its log line of the answer through the Privacy scrub by value
 * (@deepbuild/evidence's scrubValues, every form), and hands the parser the answer as the client got it.
 */
export function scrubsLogsOnly(answer: HttpAnswer, key: string): { log: string; parser: HttpAnswer } {
  return { log: scrubValues(JSON.stringify(answer), { held: [key] }), parser: answer };
}

/**
 * AC7: a hub that scrubs only the key's own base64 in the standard alphabet. Before the parser gets the answer it
 * takes out the key raw, URL-encoded and as `Buffer.from(key).toString('base64')`, and nothing else.
 */
export function scrubsOwnStandardBase64(answer: HttpAnswer, key: string): HttpAnswer {
  const own = Buffer.from(key, 'utf8').toString('base64');
  const encoded = encodeURIComponent(key);
  return mapAnswer(answer, (s) => s.split(key).join('[redacted]').split(own).join('[redacted]')
    .split(encoded).join('[redacted]').split(encoded.toLowerCase()).join('[redacted]'));
}

/**
 * AC6: a key test that rejects the value when the test couldn't run. The real hub's entry, after which a key test it
 * read INCONCLUSIVE (the 503, the timeout, no network) is turned into a rejection: the value it saved is taken out of
 * the store and the entry reads invalid.
 */
export function rejectsWhenUnsure(h: ExtensionHost, store: TestStore): ExtensionHost['enterSecret'] {
  return async (connection: Connection, extension: string, name: string, value: string) => {
    const entered = await h.enterSecret(connection, extension, name, value);
    if (entered.test !== 'INCONCLUSIVE') return entered;
    store.clear();
    return { test: 'invalid', saved: false };
  };
}

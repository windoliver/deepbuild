// #1106 AC1: a test app sends its stand-in to the sample API's host and gets 200; a planted filter that puts the
// value into the process environment fails, naming the variable. The world (helpers.ts, `world`) declares
// SHOP_API_KEY with `hosts: [localhost:<port>]`, the shop sample API's host; `deep env up` brings the app up in a
// worktree. The app (fixtures/app.mjs) shows its whole environment (GET /env) and sends what it holds in
// SHOP_API_KEY as `Authorization: Bearer <it>` through its egress filter (GET /call); the sample API answers 200 only
// to the credential's value there. Reading: no variable of the app's process holds the value, the app holds
// SHOP_API_KEY, and its call got the shop API's own 200 with the value in the one header that reached it.
import { afterEach, describe, expect, it } from 'vitest';
import { call, type Api, type Call, cleanup, downWorld, get, holds, SHOP_VALUE, type Up, upWorld } from './helpers.ts';

afterEach(cleanup, 60_000);

/**
 * AC1's reading: null when the app's process holds no copy of the value in any variable, holds SHOP_API_KEY, and its
 * call to the shop API's host with its stand-in got that API's 200, the API having seen the value only in the
 * Authorization header; otherwise what failed, naming the variable that holds the value when one does.
 */
function standInProblem(env: Record<string, string> | null | undefined, got: Call, shop: Api, attempt: string): string | null {
  if (!env) return 'the app gave no environment';
  const holders = Object.entries(env).filter(([, v]) => v.includes(SHOP_VALUE) || v.includes(Buffer.from(SHOP_VALUE).toString('base64').replace(/=+$/, ''))).map(([k]) => k);
  if (holders.length) return `the stack's process environment holds SHOP_API_KEY's value, in the variable ${holders.join(', ')}`;
  if (env.SHOP_API_KEY === undefined || env.SHOP_API_KEY === '') return 'the stack\'s process holds no SHOP_API_KEY, the variable the app expects';
  if (got.status !== 200 || got.upstream !== shop.name) return `the app's call to ${shop.host} with its stand-in got ${got.status ?? 'no answer'} from ${got.upstream ?? 'no sample API'}${got.error ? ` (${got.error})` : ''}, not the sample API's 200`;
  const reached = shop.seen.filter((r) => r.attempt === attempt);
  const right = reached.filter((r) => r.headers.authorization === `Bearer ${SHOP_VALUE}`);
  if (right.length !== 1) return `${shop.host} got the value in its Authorization header ${right.length} times, not once`;
  const elsewhere = reached.some((r) => holds({ ...r, headers: { ...r.headers, authorization: undefined } }, SHOP_VALUE));
  if (elsewhere) return `${shop.host} got the value outside the Authorization header`;
  return null;
}

async function scenario(plant?: string): Promise<{ u: Up; problem: string | null }> {
  const u = await upWorld(plant);
  const env = (await get(u.port, '/env')).body?.env as Record<string, string> | undefined;
  const got = await call(u.port, { variable: 'SHOP_API_KEY', to: u.w.shop.host, put: 'header', method: 'GET', attempt: 'ac1' });
  return { u, problem: standInProblem(env, got, u.w.shop, 'ac1') };
}

describe('AC1 #1106.ef63d06f a test app sends its stand-in to the sample API\'s host and gets 200; a planted filter that puts the value into the process environment fails, naming the variable', () => {
  it('AC1 the app holds a stand-in, not the value, in SHOP_API_KEY, and its call with it to the sample API\'s host gets 200, the filter having put the value in the Authorization header', async () => {
    let u: Up | undefined;
    try {
      const s = await scenario();
      u = s.u;
      expect(s.problem).toBeNull();
    } finally {
      await downWorld(u);
    }
  }, 240_000);

  it('AC1 (wrong program) a filter that puts the value into the process environment (DEEP_HUB_PLANT=standin-value-in-env) fails the reading, naming the variable', async () => {
    let u: Up | undefined;
    try {
      const s = await scenario('standin-value-in-env');
      u = s.u;
      expect(s.problem, 'the reading passes on a stack whose process holds the value').not.toBeNull();
      expect(s.problem, 'and names the variable that holds it').toMatch(/in the variable [A-Za-z_]\w*/);
    } finally {
      await downWorld(u);
    }
  }, 240_000);
});

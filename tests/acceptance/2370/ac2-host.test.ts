import { describe, expect, it } from 'vitest';
import { COUNTER_ROUTES, FOREIGN_HOST, send, served, shown, type Header } from './helpers.ts';

const routes = [
  { method: 'GET', path: '/status' },
  { method: 'POST', path: '/set', body: 'on' },
];

describe('AC2 #2370 a request whose Host isn\'t the listener\'s never reaches the package', () => {
  it('AC2 #2370 GET /status and POST /set with Host example.test:<port> are answered 403 and the count stays 0; with Host 127.0.0.1:<port> both reach the package; with no Host each is answered 400 and doesn\'t', async () => {
    const s = await served('counter', COUNTER_ROUTES);
    const foreign = `${FOREIGN_HOST}:${s.port}`;
    const answersWith = async (host: string | null): Promise<number[]> => {
      const statuses: number[] = [];
      for (const route of routes) {
        const headers: Header[] = host === null ? [] : [['Host', host]];
        const answer = await send(s.address, { ...route, headers });
        statuses.push(answer.status);
        shown(`${route.method} ${route.path} ${host === null ? 'no Host' : `Host ${host}`}`, answer);
      }
      return statuses;
    };

    const foreignStatuses = await answersWith(foreign);
    const seenAfterForeign = await s.seen();
    console.log(`package count after Host ${foreign}: ${seenAfterForeign}`);
    expect({ statuses: foreignStatuses, seen: seenAfterForeign }, `GET /status and POST /set with Host ${foreign} and no Origin are refused before the package`).toEqual({ statuses: [403, 403], seen: 0 });

    const ownStatuses = await answersWith(s.address);
    const seenAfterOwn = await s.seen();
    console.log(`package count after Host ${s.address}: ${seenAfterOwn}`);
    expect({ statuses: ownStatuses, seen: seenAfterOwn }, `GET /status and POST /set with Host ${s.address} reach the package`).toEqual({ statuses: [200, 200], seen: 2 });

    const noHostStatuses = await answersWith(null);
    const seenAfterNoHost = await s.seen();
    console.log(`package count after no Host: ${seenAfterNoHost}`);
    expect({ statuses: noHostStatuses, seen: seenAfterNoHost }, 'GET /status and POST /set with no Host header are answered 400 and never reach the package').toEqual({ statuses: [400, 400], seen: 2 });
  }, 120_000);
});

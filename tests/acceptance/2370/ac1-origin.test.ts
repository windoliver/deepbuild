import { describe, expect, it } from 'vitest';
import { BROWSER_ORIGIN, send, served, shown } from './helpers.ts';

describe('AC1 #2370 a POST carrying a browser Origin never reaches #348\'s inbound fixture', () => {
  it('AC1 #2370 POST /v1/traces with Origin: https://example.test is answered 403 and the fixture counts 0; the same POST with no Origin is answered by the package and the count reads 1', async () => {
    const s = await served('inbound', ['POST /v1/traces']);
    const fromPage = await send(s.address, {
      method: 'POST', path: '/v1/traces', body: 'span-1',
      headers: [['Host', s.address], ['Content-Type', 'text/plain'], ['Origin', BROWSER_ORIGIN]],
    });
    const seenAfterPage = await s.seen();
    shown(`POST /v1/traces Host ${s.address} Origin ${BROWSER_ORIGIN}`, fromPage, seenAfterPage);
    expect({ status: fromPage.status, seen: seenAfterPage }, `POST /v1/traces with Origin: ${BROWSER_ORIGIN} is refused by the host before the package`).toEqual({ status: 403, seen: 0 });

    const fromTool = await send(s.address, {
      method: 'POST', path: '/v1/traces', body: 'span-2',
      headers: [['Host', s.address], ['Content-Type', 'text/plain']],
    });
    const seenAfterTool = await s.seen();
    shown(`POST /v1/traces Host ${s.address} no Origin`, fromTool, seenAfterTool);
    expect({ answer: fromTool, seen: seenAfterTool }, 'the same POST with no Origin is answered by the package').toEqual({ answer: { status: 200, body: 'traces got span-2' }, seen: 1 });
  }, 120_000);
});

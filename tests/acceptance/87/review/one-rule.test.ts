// AC "A diff that repeats one unchecked `JSON.parse` at three sites gets one item for that rule listing all three; a
// check that sends three items, or one item naming only the first site, fails this test."
// The change adds two handlers to src/api.ts and a webhook in a new src/hooks.ts, each parsing its body unchecked.
import { describe, expect, it } from 'vitest';
import { history, items, reviewSpec, ruleReviewer, runReview, shown } from './helpers.ts';

const SITES: [string, number, string][] = [
  ['src/api.ts', 4, 'const order = JSON.parse(body);'],
  ['src/api.ts', 9, 'const refund = JSON.parse(body);'],
  ['src/hooks.ts', 2, 'const event = JSON.parse(body);'],
];

describe('AC findings of one rule go back as one item listing every site', () => {
  it('three unchecked JSON.parse sites in two files come back as one unchecked-parse item listing all three', async () => {
    const h = history({ 'src/api.ts': ["import { handle } from './http';"] }, [{ label: 'A', files: {
      'src/api.ts': [
        "import { handle } from './http';",
        '',
        "handle('/orders', (body) => {",
        '  const order = JSON.parse(body);',
        '  return saveOrder(order);',
        '});',
        '',
        "handle('/refunds', (body) => {",
        '  const refund = JSON.parse(body);',
        '  return saveRefund(refund);',
        '});',
      ],
      'src/hooks.ts': [
        'export function onWebhook(body: string) {',
        '  const event = JSON.parse(body);',
        '  return route(event);',
        '}',
      ],
    } }]);
    const result = await runReview(ruleReviewer().reviewer, reviewSpec(h.sha.base!, h.sha.A!), h.checkout);

    const parse = (result.sendBack?.items ?? []).filter((i) => i.rule === 'unchecked-parse');
    expect(parse.length, `one unchecked-parse item, not one per site: ${shown(result)}`).toBe(1);
    expect(items(result.sendBack?.items), `the one item lists all three sites: ${shown(result)}`).toEqual([{ rule: 'unchecked-parse', sites: SITES }]);
  }, 60_000);
});

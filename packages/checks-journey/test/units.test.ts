// The pure parts of the journey kind (#37): journey files and their review, features and neighbors, step comparison
// with the last PASS, motion assertions, latency, the quote rule, API requests against a local service, saved scripts
// and the journey they carry, masks and the smallest element holding a region.
import http from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { runApiJourney } from '../src/api.ts';
import { firstDiffering, type ComparedStep } from '../src/compare.ts';
import { listFeatures, selectJourneys } from '../src/features.ts';
import { parseJourney, reviewJourney } from '../src/journey.ts';
import { judgeLatency } from '../src/latency.ts';
import { assertMotion, assertReducedMotion, type Animation } from '../src/motion.ts';
import { quoteIn } from '../src/reading.ts';
import { embeddedJourney, saveScript } from '../src/replay.ts';
import { domDelta, resolveMask, routesOf, smallestHolding } from '../src/screens.ts';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const LOGIN = `journey: login
steps:
  - id: open
    deadline: 10000
    goto: /login
  - id: password
    deadline: 5000
    fill: { role: textbox, name: Password, secret: TEST_PASSWORD }
  - id: sign-in
    deadline: 5000
    click: { role: button, name: Sign in, within: { role: form, name: Login } }
  - id: welcomed
    deadline: 5000
    expect: { role: status, name: Welcome, text: "Signed in" }
    timeout: 2000
end_state:
  - id: welcomed
    oracle: code
    locator: { role: status, name: Welcome }
    text: "Signed in"
`;
it('reads a journey file with its lines, keeps each expect under its deadline, and reviews it', () => {
  const j = parseJourney(LOGIN);
  expect(j.steps.map((s) => s.id)).toEqual(['open', 'password', 'sign-in', 'welcomed']);
  expect(j.steps[1]!.actions[0]).toMatchObject({ line: 8, fill: { role: 'textbox', name: 'Password' }, secret: 'TEST_PASSWORD' });
  expect(j.steps[2]!.actions[0]).toMatchObject({ line: 11, click: { container: { role: 'form', name: 'Login' } } });
  expect(j.steps[3]!.expects[0]).toMatchObject({ line: 14, text: 'Signed in' });
  expect(j.steps[3]!.timeoutMs).toBe(2000);
  expect(parseJourney(LOGIN.replace('timeout: 2000', 'timeout: 9000')).steps[3]!.timeoutMs, 'kept under the deadline').toBe(4000);
  expect(reviewJourney(LOGIN)).toEqual({ ok: true });
  const literal = reviewJourney(LOGIN.replace('secret: TEST_PASSWORD', 'text: "hunter-two-not-real"'));
  expect(literal.ok).toBe(false);
  if (!literal.ok) expect(literal.reasons[0]).toMatch(/step password/);
  const noEnd = reviewJourney(LOGIN.split('end_state:')[0]!);
  expect(noEnd.ok).toBe(false);
  if (!noEnd.ok) expect(noEnd.reasons[0]).toMatch(/end state/);
  expect(reviewJourney(`${LOGIN}baseline: screens/login.png\n`).ok).toBe(false);
});

it('lists features by their feature key, selects the changed ones and those sharing a changed file, and reports those without a journey', () => {
  const repo = mkdtempSync('/tmp/dh37-feat-'); dirs.push(repo);
  mkdirSync(join(repo, '.deepbuild/features'), { recursive: true });
  writeFileSync(join(repo, '.deepbuild/features/cart.yaml'), 'feature: cart\nfiles: [src/cart.js, src/money.js]\njourneys: [checkout]\n');
  writeFileSync(join(repo, '.deepbuild/features/export.yaml'), 'feature: export\nfiles: [src/export.js, src/money.js]\njourneys: [export]\n');
  writeFileSync(join(repo, '.deepbuild/features/about.yaml'), 'feature: about\nfiles: [src/about.js]\njourneys: []\n');
  const features = listFeatures(repo);
  expect(features.map((f) => f.id)).toEqual(['about', 'cart', 'export']);
  expect(selectJourneys(features, ['src/money.js']).journeys.sort()).toEqual(['checkout', 'export']);
  expect(selectJourneys(features, ['src/cart.js'])).toMatchObject({ changed: ['cart'], neighbors: [], journeys: ['checkout'] });
  expect(selectJourneys(features, ['src/money.js']).neighbors).toEqual(['cart', 'export']);
  expect(selectJourneys(features, ['src/about.js', 'src/cart.js']).withoutJourney).toEqual(['about']);
});

const step = (id: string, route: string, raw: string, controls: ComparedStep['controls'], outcome = 'passed'): ComparedStep => ({ id, outcome, route, raw, controls });
const none = { appeared: [], left: [], changed: [] };
it('compares steps by placeholdered route and whether changes happened, naming the first that differs', () => {
  const pay = { role: 'button', name: 'Pay' };
  const pass = [step('open', '/cart', '/cart', { appeared: [pay], left: [], changed: [] }), step('pay', '/cart', '/cart', { appeared: [], left: [], changed: [pay] }), step('done', '/order/{id}', '/order/10001', { appeared: [{ role: 'status', name: 'Order' }], left: [pay], changed: [] })];
  const again = [step('open', '/cart', '/cart', { appeared: [pay, { role: 'button', name: 'Add' }], left: [], changed: [] }), step('pay', '/cart', '/cart', { appeared: [], left: [], changed: [pay] }), step('done', '/order/{id}', '/order/10002', { appeared: [{ role: 'status', name: 'Order' }], left: [pay], changed: [] })];
  expect(firstDiffering(pass, again).step).toBeNull();
  const noPay = [step('open', '/cart', '/cart', { appeared: [{ role: 'button', name: 'Add' }], left: [], changed: [] }), step('pay', '/cart', '/cart', none, 'failed'), step('done', '', '', none, 'unrun')];
  const d = firstDiffering(pass, noPay);
  expect(d.step).toBe('pay');
  expect(d.why).toMatch(/Pay/);
  expect(firstDiffering(pass, again, 'raw-url').step).toBe('done');
});

const card = { role: 'article', name: 'Featured' };
const fade = (p: string, from: string, to: string, extra: Partial<Animation> = {}): Animation => ({ target: card, property: p, from, to, duration: 700, delay: 0, easing: 'cubic-bezier(0.33, 1, 0.68, 1)', ...extra });
it('asserts motion exactly, fails a planted build naming the card, and is INCONCLUSIVE with no entry', () => {
  const r = { target: card, properties: { opacity: { from: '0', to: '1' }, transform: { from: 'translateY(28px)', to: 'translateY(0px)' } }, durationMs: 700, delayMs: 0, easing: 'cubic-bezier(0.33, 1, 0.68, 1)' };
  const ok = [fade('opacity', '0', '1'), fade('transform', 'translateY(28px)', 'translateY(0px)')];
  expect(assertMotion(ok, r).outcome).toBe('passed');
  const planted = assertMotion(ok.map((a) => ({ ...a, duration: 400, easing: 'ease' })), r);
  expect(planted).toMatchObject({ outcome: 'failed', element: 'article "Featured"' });
  expect((planted as { message: string }).message).toMatch(/400 ms, not 700 ms.*easing ease/);
  expect(assertMotion([], r)).toMatchObject({ outcome: 'INCONCLUSIVE', element: 'article "Featured"' });
  expect(assertReducedMotion(ok, card)).toMatchObject({ outcome: 'failed', element: 'article "Featured"' });
  expect(assertReducedMotion([ok[0]!], card)).toEqual({ outcome: 'passed' });
});

it('judges latency on the same number of runs each, with the margin, showing both times', () => {
  expect(judgeLatency([100, 110, 105], [100, 100, 100], 0.1)).toMatchObject({ outcome: 'passed', branch: { runs: 3, median: 105 } });
  const slow = judgeLatency([130, 140, 135], [100, 100, 100], 0.1);
  expect(slow.outcome).toBe('failed');
  expect(slow.message).toContain('135.0 ms vs base 100.0 ms');
  expect(judgeLatency([100], [100, 100], 0.1).outcome).toBe('INVALID');
  expect(quoteIn('$18.00', '- status "Total":  $18.00')).toBe(true);
  expect(quoteIn('$99.00', '- status "Total": $18.00')).toBe(false);
});

it('an API journey drives the service with real requests and hands back the last response apart', async () => {
  let cart: { items: string[] } = { items: [] };
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/cart') { let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => { cart = { items: [...cart.items, JSON.parse(body).item] }; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true })); }); return; }
    if (req.url === '/api/cart') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(cart)); return; }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const journey = { id: 'api-cart', steps: [{ id: 'add', line: 7, deadlineMs: 5000, method: 'POST', path: '/api/cart', body: { item: 'tea' }, expect: { status: 200 } }], endState: [] as never[] };
  const r = await runApiJourney({ run: 'run:1', journey, url, file: 'j.yaml' });
  expect(r).toMatchObject({ outcome: 'passed', testsRun: 1, last: { ok: true } });
  const bad = await runApiJourney({ run: 'run:3', journey: { ...journey, steps: [{ ...journey.steps[0]!, expect: { status: 201 } }] }, url, file: 'j.yaml' });
  expect(bad).toMatchObject({ outcome: 'failed', failures: [{ assertion: true, line: 7 }] });
  server.close();
});

it('saves a journey as plain Playwright with values scrubbed and the journey embedded for a replay', () => {
  const secret = 'typedvalue-0123456789';
  const j = parseJourney(LOGIN.replace('secret: TEST_PASSWORD', `text: "${secret}"`).replace('name: Password', 'name: Code'));
  const s = saveScript(j, LOGIN, { PW: secret });
  expect(s).toContain("page.getByRole(\"form\", { name: \"Login\" }).getByRole(\"button\", { name: \"Sign in\" }).click()");
  expect(s).toContain('getByRole("textbox", { name: "Code" }).fill("[REDACTED]")');
  expect(s).not.toContain(secret);
  expect(s).not.toMatch(/querySelector|locator\('#/);
  expect(embeddedJourney(s)?.id).toBe('login');
  expect(embeddedJourney('// nothing')).toBeNull();
});

it('resolves masks among a capture\'s elements, proposes the smallest element holding a region, and names the DOM line that differs', () => {
  const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
  const elements = [
    { role: 'main', name: '', testId: null, label: null, explicitRole: null, tag: 'main', box: box(0, 0, 1280, 720) },
    { role: 'contentinfo', name: 'Footer', testId: null, label: 'Footer', explicitRole: 'contentinfo', tag: 'footer', box: box(100, 500, 300, 24) },
    { role: 'generic', name: 'Clock', testId: null, label: 'Clock', explicitRole: null, tag: 'span', box: box(100, 503, 160, 18) },
  ];
  expect(resolveMask(elements, { role: 'contentinfo', name: 'Footer' })).toEqual({ box: box(100, 500, 300, 24), count: 1 });
  expect(resolveMask(elements, { role: 'dialog', name: 'Nowhere' })).toEqual({ box: null, count: 0 });
  expect(resolveMask(elements, { name: 'Clock' })).toMatchObject({ count: 1 });
  expect(smallestHolding(elements, box(110, 505, 40, 10))).toEqual({ name: 'Clock' });
  expect(smallestHolding(elements, box(10, 10, 5, 5))).toBeNull();
  expect(domDelta(['button#pay role=button "Pay"'], ['button#pay.moved role=button "Pay"'])).toEqual({ base: 'button#pay role=button "Pay"', head: 'button#pay.moved role=button "Pay"' });
  expect(routesOf([{ url: 'http://127.0.0.1:1/order/abcdef123456', method: 'GET' }, { url: 'http://127.0.0.1:1/order/fedcba654321', method: 'GET' }])).toEqual({ 'GET /order/{id}': 2 });
});

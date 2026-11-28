import { afterEach, describe, expect, it } from 'vitest';
import {
  apply, CLEAN_REPLAY, expectHeld, expectState, lines, load, loadedText, openWorld, removeRoots, said, startSession,
  unknownField, verdict, type World,
} from './helpers.ts';

afterEach(removeRoots);

async function sessionWith(w: World, text: string, quote: string): Promise<{ session: string; evidence: { at: string; quote: string }[] }> {
  const session = await startSession(w, 'shop', [{ id: 'm1', text }]);
  return { session, evidence: [{ at: said(session, 'm1'), quote }] };
}

describe('AC1 a learned step spec change adding curl -k to a journey step is held, whatever its replay shows', () => {
  it('AC1 adding `run: curl -k …` with a replay of 20 tasks and 0 regressions is held, naming the flag; the same line without -k applies', async () => {
    const w = await openWorld();
    const first = await sessionWith(w, 'the shop journeys run with npx playwright test --project=shop', 'npx playwright test --project=shop');
    const spec = await apply(w, { target: 'step:shop-journeys', diff: lines('+ run: npx playwright test --project=shop', '+ check: shop.journeys'), evidence: first.evidence, scope: 'repo:shop' }, 'you');
    await expectState(w, spec, 'applied', 'the journeys step spec you applied for the repo');

    const s = await sessionWith(w, 'the staging health check fails on its self-signed certificate before the journeys start', 'fails on its self-signed certificate');
    const k = await apply(w, { target: 'step:shop-journeys', diff: '+ run: curl -k https://staging.shop.test/health', evidence: s.evidence, scope: `session:${s.session}`, replay: CLEAN_REPLAY });
    const reason = await expectHeld(w, k, ['run: curl -k https://staging.shop.test/health'], 'AC1 a journey step that adds curl -k, on a replay of 20 tasks and 0 regressions');
    expect(reason, 'AC1 the hold names the added flag').toContain('curl -k');

    const plain = await apply(w, { target: 'step:shop-journeys', diff: '+ run: curl https://staging.shop.test/health', evidence: s.evidence, scope: `session:${s.session}`, replay: CLEAN_REPLAY });
    await expectState(w, plain, 'applied', 'AC1 the twin that checks the certificate (curl without -k)');

    const text = loadedText(await load(w, s.session), 'step:shop-journeys') ?? '';
    expect(text, 'AC1 the session loads the journeys step with the twin').toContain('curl https://staging.shop.test/health');
    expect(text, 'AC1 the held line is not in force in the session').not.toContain('curl -k');
    await w.record.close();
  });
});

describe('AC2 a learned extension patch adding an egress host its grant did not name is held, naming the host', () => {
  it('AC2 `+ grant.hosts: telemetry.example.net` is held, naming the host; `- grant.hosts: mirror.example.org` applies under the local-first rule', async () => {
    const w = await openWorld();
    const s = await sessionWith(w, 'the notes extension is slow to sync; the old mirror is gone', 'slow to sync');
    const add = await apply(w, { target: 'ext:acme/notes', diff: '+ grant.hosts: telemetry.example.net', evidence: s.evidence, scope: `session:${s.session}`, replay: CLEAN_REPLAY });
    const reason = await expectHeld(w, add, ['grant.hosts: telemetry.example.net'], 'AC2 an extension patch adding an egress host');
    expect(reason, 'AC2 the hold names the host').toContain('telemetry.example.net');
    const remove = await apply(w, { target: 'ext:acme/notes', diff: '- grant.hosts: mirror.example.org', evidence: s.evidence, scope: `session:${s.session}`, replay: CLEAN_REPLAY });
    await expectState(w, remove, 'applied', 'AC2 an extension patch removing an egress host, under the local-first rule');
    await w.record.close();
  });
});

describe('AC3 a learned change removing a verification step that never caught a bug is held, naming the step', () => {
  it('AC3 removing `check: shop.visual`, which only ever passed, is held, naming it; adding a check or removing a run line applies', async () => {
    const w = await openWorld();
    const first = await sessionWith(w, 'seed the shop, then run the visual and e2e checks', 'run the visual and e2e checks');
    const spec = await apply(w, {
      target: 'step:shop-journeys',
      diff: lines('+ run: npm run seed', '+ run: npx playwright test --project=shop', '+ check: shop.visual', '+ check: shop.e2e'),
      evidence: first.evidence, scope: 'repo:shop',
    }, 'you');
    await expectState(w, spec, 'applied', 'the journeys step spec you applied for the repo');
    await verdict(w, 'PASS', 'shop.visual');
    await verdict(w, 'FAIL', 'shop.e2e');

    const s = await sessionWith(w, 'the visual check takes four minutes and has never failed', 'has never failed');
    const drop = (line: string) => apply(w, { target: 'step:shop-journeys', diff: line, evidence: s.evidence, scope: `session:${s.session}`, replay: CLEAN_REPLAY });
    const visual = await drop('- check: shop.visual');
    const reason = await expectHeld(w, visual, ['check: shop.visual'], 'AC3 removing a verification step that never caught a bug');
    expect(reason, 'AC3 the hold names the step').toContain('shop.visual');
    await expectHeld(w, await drop('- check: shop.e2e'), ['check: shop.e2e'], 'AC3 removing a verification step that once caught a bug');
    await expectState(w, await drop('+ check: shop.a11y'), 'applied', 'AC3 adding a verification step');
    await expectState(w, await drop('- run: npm run seed'), 'applied', 'AC3 removing a step that verifies nothing');
    await w.record.close();
  });
});

describe('AC5 a change to an unknown field inside a grant counts as loosening and is held', () => {
  it('AC5 adding, or removing, a grant field no classifier can know is held, naming the field; removing a known path from the same grant applies', async () => {
    const w = await openWorld();
    const s = await sessionWith(w, 'the notes extension needs its scratch folder no more', 'needs its scratch folder no more');
    const added = `grant.${unknownField()}`;
    const removed = `grant.${unknownField()}`;
    const change = (diff: string) => apply(w, { target: 'ext:acme/notes', diff, evidence: s.evidence, scope: `session:${s.session}`, replay: CLEAN_REPLAY });
    const add = await change(`+ ${added}: on`);
    expect(await expectHeld(w, add, [`${added}: on`], `AC5 adding the unknown field ${added} inside a grant`), 'AC5 the hold names the field').toContain(added);
    const remove = await change(`- ${removed}: 30`);
    expect(await expectHeld(w, remove, [`${removed}: 30`], `AC5 removing the unknown field ${removed} inside a grant`), 'AC5 the hold names the field').toContain(removed);
    await expectState(w, await change('- grant.paths: ~/scratch/*'), 'applied', 'AC5 a known grant field narrowed (a path removed)');
    await w.record.close();
  });
});

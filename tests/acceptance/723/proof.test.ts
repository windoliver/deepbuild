// #723 Proof: one planted loosening change of each kind the Scope lists, across the learned layer's closed list
// of targets, each held for you with its quoted clause whatever its replay shows, beside twins that don't loosen
// and still apply; what is held stays out of what sessions load, and the layer rebuilds to the same rows.
// (The step spec held at load by a rule added after it applied is load.test.ts.)
import { afterEach, describe, expect, it } from 'vitest';
import {
  apply, CLEAN_REPLAY, expectState, firstRowDifference, layerRow, lines, load, loadedText, openWorld, removeRoots, said,
  startSession, unknownField, canon,
} from './helpers.ts';

afterEach(removeRoots);

interface Planted {
  /** The kind of loosening, as the Scope names it. */
  kind: string;
  target: string;
  diff: string;
  /** The clause the hold must quote: any one of these lines, without its sign. */
  clause: string[];
}

describe('Proof every kind of loosening is held with its quoted clause; the twins that do not loosen apply', () => {
  it('Proof 18 planted loosening changes over all eight learned targets are held, each quoting its clause; 13 controls apply; held lines stay out of sessions; the layer rebuilds to the same rows', async () => {
    const w = await openWorld();
    // What the repo runs, applied by you for the repo before the session that learns.
    const S0 = await startSession(w, 'shop', [{ id: 'm1', text: 'this is how shop runs its journeys, ships and reviews' }]);
    const yours = [{ at: said(S0, 'm1'), quote: 'how shop runs its journeys' }];
    const baseline: [string, string][] = [
      ['step:shop-journeys', lines('+ run: npm run seed', '+ run: npx playwright test --project=shop', '+ check: shop.journeys --project=all',
        '+ assert: the order total equals the sum of its lines', '+ mode: default')],
      ['playbook:shop-ship', lines('+ run: npm run build', '+ verify: cosign verify --key cosign.pub ghcr.io/shop/api:latest')],
      ['composition:shop-review', lines('+ run: npm run review', '+ check: shop.contract')],
    ];
    for (const [target, diff] of baseline) await expectState(w, await apply(w, { target, diff, evidence: yours, scope: 'repo:shop' }, 'you'), 'applied', `your ${target}`);

    const S = await startSession(w, 'shop', [{ id: 'm1', text: 'staging uses a self-signed certificate and every check here is slow' }]);
    const evidence = [{ at: said(S, 'm1'), quote: 'a self-signed certificate' }];
    const scope = `session:${S}`;
    const grantField = `grant.${unknownField()}`;
    const stepField = unknownField();

    const planted: Planted[] = [
      { kind: 'removes a check', target: 'composition:shop-review', diff: '- check: shop.contract', clause: ['check: shop.contract'] },
      { kind: 'removes an assertion', target: 'step:shop-journeys', diff: '- assert: the order total equals the sum of its lines', clause: ['assert: the order total equals the sum of its lines'] },
      { kind: 'removes a signature check', target: 'playbook:shop-ship', diff: '- verify: cosign verify --key cosign.pub ghcr.io/shop/api:latest', clause: ['verify: cosign verify --key cosign.pub ghcr.io/shop/api:latest'] },
      { kind: 'narrows a check', target: 'step:shop-journeys', diff: lines('- check: shop.journeys --project=all', '+ check: shop.journeys --project=smoke'), clause: ['check: shop.journeys --project=all', 'check: shop.journeys --project=smoke'] },
      { kind: 'widens a grant (an access word)', target: 'ext:acme/notes', diff: '+ grant.words: run_as_you', clause: ['grant.words: run_as_you'] },
      { kind: 'widens an egress host', target: 'ext:acme/notes', diff: '+ grant.hosts: telemetry.example.net', clause: ['grant.hosts: telemetry.example.net'] },
      { kind: 'widens a path', target: 'ext:acme/notes', diff: '+ grant.paths: ~/*', clause: ['grant.paths: ~/*'] },
      { kind: 'widens a permission mode', target: 'step:shop-journeys', diff: lines('- mode: plan', '+ mode: bypassPermissions'), clause: ['mode: bypassPermissions'] },
      { kind: "lowers a guard's coverage (its mode)", target: 'ext:acme/notes', diff: lines('- guard.no-env-write.mode: block', '+ guard.no-env-write.mode: watch'), clause: ['guard.no-env-write.mode: watch', 'guard.no-env-write.mode: block'] },
      { kind: "lowers a guard's coverage (its match)", target: 'ext:acme/notes', diff: lines('- guard.no-env-write.match: write:.env .env.* secrets/*', '+ guard.no-env-write.match: write:.env'), clause: ['guard.no-env-write.match: write:.env .env.* secrets/*', 'guard.no-env-write.match: write:.env'] },
      { kind: 'flag --insecure', target: 'playbook:shop-ship', diff: '+ run: grpcurl --insecure api.shop.test:443 list', clause: ['run: grpcurl --insecure api.shop.test:443 list'] },
      { kind: 'flag curl -k', target: 'step:shop-journeys', diff: '+ run: curl -k https://staging.shop.test/health', clause: ['run: curl -k https://staging.shop.test/health'] },
      { kind: 'flag NODE_TLS_REJECT_UNAUTHORIZED=0', target: 'slice:start-api', diff: '+ start the api with NODE_TLS_REJECT_UNAUTHORIZED=0 npm run dev:api', clause: ['start the api with NODE_TLS_REJECT_UNAUTHORIZED=0 npm run dev:api'] },
      { kind: 'flag GIT_SSL_NO_VERIFY', target: 'offer:mirror-clone', diff: '+ clone the mirror with GIT_SSL_NO_VERIFY=true git clone https://git.shop.test/mirror', clause: ['clone the mirror with GIT_SSL_NO_VERIFY=true git clone https://git.shop.test/mirror'] },
      { kind: 'flag verify=False', target: 'wiki:repos/shop.md#fixtures', diff: '+ fetch the fixtures with requests.get(url, verify=False)', clause: ['fetch the fixtures with requests.get(url, verify=False)'] },
      { kind: 'flag curl -k in how definitions are drafted', target: 'drafting:shop', diff: '+ draft the smoke check as curl -k https://staging.shop.test/health', clause: ['draft the smoke check as curl -k https://staging.shop.test/health'] },
      { kind: 'unknown field inside a grant', target: 'ext:acme/notes', diff: `+ ${grantField}: on`, clause: [`${grantField}: on`] },
      { kind: 'unknown field inside a step', target: 'step:shop-journeys', diff: `+ ${stepField}: on`, clause: [`${stepField}: on`] },
    ];
    const controls: { kind: string; target: string; diff: string }[] = [
      { kind: 'curl without -k', target: 'step:shop-journeys', diff: '+ run: curl https://staging.shop.test/health' },
      { kind: 'adds a check', target: 'step:shop-journeys', diff: '+ check: shop.a11y' },
      { kind: 'adds a note', target: 'step:shop-journeys', diff: '+ note: the journeys take about four minutes' },
      { kind: 'removes a step that verifies nothing', target: 'step:shop-journeys', diff: '- run: npm run seed' },
      { kind: 'narrows a permission mode', target: 'step:shop-journeys', diff: lines('- mode: default', '+ mode: plan') },
      { kind: 'adds a note to a playbook', target: 'playbook:shop-ship', diff: '+ note: ship after the journeys pass' },
      { kind: 'adds a check to a composition', target: 'composition:shop-review', diff: '+ check: shop.perf' },
      { kind: 'removes an egress host', target: 'ext:acme/notes', diff: '- grant.hosts: mirror.example.org' },
      { kind: 'removes a path', target: 'ext:acme/notes', diff: '- grant.paths: ~/scratch/*' },
      { kind: 'adds a guard', target: 'ext:acme/notes', diff: lines('+ guard.no-key-read.match: read:*.pem', '+ guard.no-key-read.mode: block', '+ guard.no-key-read.fail_closed: true') },
      { kind: "raises a guard's mode", target: 'ext:acme/notes', diff: lines('- guard.no-env-write.mode: warn', '+ guard.no-env-write.mode: block') },
      { kind: 'verify=True', target: 'wiki:repos/shop.md#fixtures', diff: '+ fetch the fixtures with requests.get(url, verify=True)' },
      { kind: 'a start-slice entry with no flag', target: 'slice:start-api', diff: '+ start the api with npm run dev:api' },
    ];
    // Interleaved, so a classifier keyed to position or to a run of holds can't pass.
    const problems: string[] = [];
    for (let i = 0; i < Math.max(planted.length, controls.length); i++) {
      const p = planted[i];
      if (p) {
        const id = await apply(w, { target: p.target, diff: p.diff, evidence, scope, replay: CLEAN_REPLAY });
        const row = await layerRow(w, id);
        const reason = String(row.reason ?? '');
        if (row.state !== 'held') problems.push(`${p.kind} (${p.target}): state ${String(row.state)}, not held`);
        else if (!p.clause.some((c) => reason.includes(c))) problems.push(`${p.kind} (${p.target}): the hold "${reason}" quotes none of ${p.clause.map((c) => `"${c}"`).join(', ')}`);
      }
      const c = controls[i];
      if (c) {
        const id = await apply(w, { target: c.target, diff: c.diff, evidence, scope, replay: CLEAN_REPLAY });
        const row = await layerRow(w, id);
        if (row.state !== 'applied') problems.push(`control ${c.kind} (${c.target}): state ${String(row.state)} (${String(row.reason ?? '')}), not applied`);
      }
    }
    expect(problems, 'Proof each planted loosening change is held quoting its clause, and each control applies').toEqual([]);

    // Held is not in force: what the session loads keeps the verification steps and leaves out the loosening lines.
    const loaded = await load(w, S);
    const journeys = loadedText(loaded, 'step:shop-journeys') ?? '';
    for (const kept of ['assert: the order total equals the sum of its lines', 'check: shop.journeys --project=all', 'check: shop.a11y', 'curl https://staging.shop.test/health', 'mode: plan'])
      expect(journeys, `Proof the session's journeys step spec holds "${kept}"`).toContain(kept);
    for (const gone of ['curl -k', 'bypassPermissions', '--project=smoke', stepField, 'npm run seed'])
      expect(journeys, `Proof the session's journeys step spec leaves out "${gone}"`).not.toContain(gone);
    const ship = loadedText(loaded, 'playbook:shop-ship') ?? '';
    expect(ship, 'Proof the playbook keeps its signature check').toContain('cosign verify');
    expect(ship, 'Proof the playbook leaves out --insecure').not.toContain('--insecure');
    expect(loadedText(loaded, 'composition:shop-review') ?? '', 'Proof the composition keeps shop.contract').toContain('check: shop.contract');
    const slice = JSON.stringify(await w.record.startSlice(S));
    expect(slice, 'Proof the start slice holds the plain line').toContain('start the api with npm run dev:api');
    expect(slice, 'Proof the start slice leaves out NODE_TLS_REJECT_UNAUTHORIZED=0').not.toContain('NODE_TLS_REJECT_UNAUTHORIZED');

    // Every hold comes from the log alone: the layer and the session's load rebuild to exactly the same.
    const before = await w.record.table('learned_layer');
    await w.record.rebuild();
    const after = await w.record.table('learned_layer');
    expect(firstRowDifference(before, after), 'Proof learned_layer rebuilds row for row').toBeUndefined();
    expect(canon(await load(w, S)), 'Proof the session loads the same after a rebuild').toBe(canon(loaded));
    await w.record.close();
  });
});

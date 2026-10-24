// AC10: a test walks every method in the extension API schema and calls each from a sandboxed test package with an
// empty grant: each call that needs a grant is refused, naming the method and the grant it needs, and the walk
// fails, naming the method, when the schema lists one it didn't call; a planted host that checks grants only in
// `deep.record.query` lets `deep.notices.send` through and fails this test, naming the method.
//
// The schema is the host's EXTENSION_API (README, The surface under test): each method, `deep.`-prefixed, with the
// grant (an access word) a call needs, or null. The test writes it into the walk package as methods.json; the
// package (fixtures/walk), whose manifest names no access words and which is installed with no grant, calls every
// method and reports each call's outcome. A method the package's `deep` lacks counts as not called.
import { afterAll, describe, expect, it } from 'vitest';
import { EXTENSION_API, type ApiMethod, type ExtensionHost, type Plant } from '../../../packages/extension-host/src/index.ts';
import { openHost, openWorld, pkg, report } from './helpers.ts';
import { withUncalledMethod } from './wrong.ts';

const opened: ExtensionHost[] = [];
afterAll(async () => { for (const h of opened.splice(0)) await h.close(); });

interface Call { method: string; outcome: 'ok' | 'error' | 'missing' | 'timeout'; error: string | null }

/** The methods the issue's scope and this criterion name: the schema must list each. */
const NAMED = ['deep.on', 'deep.registerCheck', 'deep.registerResolver', 'deep.registerSource', 'deep.registerEnvironment', 'deep.registerView', 'deep.registerAdapter',
  'deep.record.append', 'deep.record.query', 'deep.evidence.put', 'deep.asks.create', 'deep.config.get', 'deep.notices.send'];

/** Runs the walk package against a host (the real one, or a planted twin) and returns its calls. */
async function walk(schema: readonly ApiMethod[], plant?: Plant): Promise<Call[]> {
  const w = await openWorld();
  const h = await openHost(w, plant ? { plant } : {});
  opened.push(h);
  await h.ready();
  const p = await h.install({ from: await pkg('walk', { files: { 'methods.json': JSON.stringify(schema) } }), builtBy: null });
  expect((await h.check(p)).passed).toBe(true);
  const load = await h.load(p);
  expect(load.status === 'loaded' && load.place, `the walk package runs in the sandbox: ${JSON.stringify(load)}`).toBe('sandbox');
  return (await report<{ calls: Call[] }>(h, 'ext.walk.report')).calls;
}

/**
 * The criterion's assertion on one walk: every method the schema lists was called, or the walk fails naming it;
 * and every call that needs a grant was refused, naming the method and the grant, or the walk fails naming it.
 */
function judgeWalk(schema: readonly ApiMethod[], calls: readonly Call[]): void {
  const problems: string[] = [];
  for (const m of schema) {
    const call = calls.find((c) => c.method === m.method);
    if (call === undefined || call.outcome === 'missing') {
      problems.push(`the walk didn't call ${m.method}, which the schema lists`);
      continue;
    }
    if (!m.needs) continue;
    if (call.outcome !== 'error') problems.push(`${m.method} needs the grant "${m.needs}" but went through with an empty grant (${call.outcome})`);
    else if (!(call.error ?? '').includes(m.method) || !(call.error ?? '').includes(m.needs)) {
      problems.push(`${m.method}'s refusal doesn't name both the method and the grant "${m.needs}": ${call.error}`);
    }
  }
  expect(problems, problems.join('\n')).toEqual([]);
}

describe('AC10 #348.75881ef9 a walk calls every extension API method from a sandboxed package with an empty grant: each that needs a grant is refused naming the method and grant; an uncalled method fails the walk; a host checking grants only in deep.record.query fails, naming deep.notices.send', () => {
  it('AC10 the schema lists every method the issue names, each `deep.`-prefixed, and deep.record.query and deep.notices.send each need a grant', () => {
    const names = EXTENSION_API.map((m) => m.method);
    for (const name of NAMED) expect(names, `the extension API schema lists ${name}`).toContain(name);
    expect(new Set(names).size, 'no method listed twice').toBe(names.length);
    for (const name of ['deep.record.query', 'deep.notices.send']) {
      expect(EXTENSION_API.find((m) => m.method === name)?.needs, `${name} needs a grant`).toEqual(expect.any(String));
    }
  });

  it('AC10 the walk calls every method in the schema, and each call that needs a grant is refused, naming the method and the grant it needs', async () => {
    const calls = await walk(EXTENSION_API);
    judgeWalk(EXTENSION_API, calls);
  }, 120_000);

  it('AC10 the walk fails, naming the method, when the schema lists one it didn\'t call', async () => {
    const calls = await walk(EXTENSION_API);
    expect(() => judgeWalk(withUncalledMethod(EXTENSION_API), calls)).toThrow(/deep\.planted\.uncalled/);
  }, 120_000);

  it('AC10 (wrong program) a host that checks grants only in deep.record.query lets deep.notices.send through and fails this test, naming the method', async () => {
    const calls = await walk(EXTENSION_API, 'grants-only-in-record-query');
    expect(calls.find((c) => c.method === 'deep.notices.send')?.outcome, 'the planted host let deep.notices.send through').toBe('ok');
    expect(() => judgeWalk(EXTENSION_API, calls)).toThrow(/deep\.notices\.send/);
  }, 120_000);
});

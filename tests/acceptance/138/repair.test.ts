// #138.0770a3f0: the repair loop's four cases, through the kit's repair_loop part and through the scene
// (parity/framework/repair-loop.scene) played on #96's shared-document calls with the test module
// `test.kit.fixer`, whose check raises `test.kit.fixer.y_over` with a fix as patch ops. A stale fix rebases
// only when no ID it touches changed since its base; the planted path-granular rebase (`rebase_by_path`)
// applies the fix to items/a/params/y after you changed items/a/params/x, and both checks below fail on it.
// At the base there is no `kit` call, no `fix_ops` and no `test-kit-fixer` feature.
import { describe, expect, it } from 'vitest';
import {
  AS_ALPHA, AS_BRAVO, AS_YOU, CATALOG, DOC, P, WRITER, arr, expectFailure, failuresIn, fixture, issuesOf, kit, moduleOf, obj, outcome, partIn,
  patch, read, run, scenario, send, show, str, strs, useBuilds, useEvidence,
  type Build, type JsonObject, type Who,
} from './helpers.ts';

const FIXER: Build = { set: 'full', with: ['test-kit-fixer'] };
const builds = useBuilds([FIXER]);
const evidence = useEvidence();

const SCENE = fixture('parity/framework/repair-loop.scene.json');
const FAULT = obj(SCENE['fault'], 'scene.fault');
const FIX = arr(FAULT['fix'], 'fault.fix').map((o, i) => obj(o, `fault.fix[${i}]`));
const WHO: Record<string, Who> = { you: AS_YOU, alpha: AS_ALPHA, bravo: AS_BRAVO };
const CASES = ['apply', 'stale_rebase', 'stale_same_item', 'conflicting', 'dry_run_refused'] as const;

/** One act of the scene as a scenario on DOC.a, the scene's board minted as revision 0. */
function act(name: string): JsonObject[] {
  const a = arr(SCENE['acts'], 'scene.acts').map((x) => obj(x, 'act')).find((x) => x['name'] === name);
  expect(a, `the scene has the act ${name}`).toBeDefined();
  let n = 0;
  return arr(a!['steps'], `${name}.steps`).map((s) => {
    const step = obj(s, 'step');
    if (step['read'] === true) return read(DOC.a);
    const ops = step['ops'] === 'fix' ? FIX : arr(step['ops'], 'step.ops').map((o) => obj(o, 'op'));
    const extra: JsonObject = step['dry_run'] === true ? { dry_run: true } : {};
    return send(WHO[str(step['who'], 'step.who')]!, patch(P(++n), DOC.a, Number(step['base']), ops, extra));
  });
}
function play(name: string, planted?: string): JsonObject[] {
  const docs = { [DOC.a]: { panel: 'p1', document: obj(SCENE['document'], 'scene.document') } };
  return run(builds.bin(FIXER), scenario(evidence(), act(name), planted ? { docs, planted } : { docs }));
}
const writersOf = (reply: JsonObject): string[] =>
  arr(obj(reply['conflict'], 'conflict')['writers'], 'conflict.writers').map((w) => JSON.stringify(obj(w, 'writer'))).sort();
const writers = (...ws: JsonObject[]): string[] => ws.map((w) => JSON.stringify(w)).sort();

/** The stale_same_item act's check: the failures it finds, empty when the act went as the criterion says. */
function staleSameItemFailures(replies: JsonObject[]): string[] {
  const [, before, fix, after] = replies as [JsonObject, JsonObject, JsonObject, JsonObject];
  const out: string[] = [];
  if (outcome(fix) !== 'conflict') out.push(`alpha's fix to items/a/params/y after you changed items/a/params/x was ${outcome(fix)}, not a conflict: ${show(fix, 800)}`);
  else {
    if (JSON.stringify(writersOf(fix)) !== JSON.stringify(writers(WRITER.alpha, WRITER.you))) out.push(`the conflict names ${show(writersOf(fix))}, not alpha and you`);
    if (!arr(obj(fix['conflict'], 'conflict')['ids'], 'conflict.ids').includes('a')) out.push('the conflict does not name item a');
  }
  if (after['hash'] !== before['hash']) out.push('the refused fix changed the document');
  return out;
}

describe('#138.0770a3f0 the repair loop: fault, issue, apply, rerun and PASS; a stale fix rebases only when no ID it touches changed; conflicts name both writers', () => {
  it('#138.0770a3f0 the kit\'s repair_loop part runs its five cases for test.kit.fixer and every R2 module, each planted fault carrying {path, code, fix}', () => {
    const r = kit(builds.bin(FIXER), evidence(), { parts: ['repair_loop'] });
    for (const m of r.modules.filter((x) => x.module !== 'core')) {
      const p = partIn(m, 'repair_loop');
      expect(p.verdict, `${m.module}: the repair loop passes: ${show(p.failures)}`).toBe('PASS');
      for (const name of CASES) {
        const c = p.cases.find((x) => x.case === name);
        expect(c, `${m.module}: the repair loop runs the ${name} case`).toBeDefined();
        expect(c!.verdict, `${m.module}: ${name} passes`).toBe('PASS');
        const fault = obj(c!.raw['fault'], `${m.module}: ${name}.fault`);
        str(fault['path'], `${name}.fault.path`);
        str(fault['code'], `${name}.fault.code`);
        expect(fault['fix'] !== undefined && fault['fix'] !== null, `${m.module}: ${name}'s fault carries its fix`).toBe(true);
      }
      expect(strs(p.cases.find((x) => x.case === 'apply')!.raw['steps'], `${m.module}: apply.steps`), `${m.module}: the apply case runs end to end`).toEqual(['fault', 'issue', 'apply', 'rerun', 'pass']);
    }
    const fixer = partIn(moduleOf(r, 'test.kit.fixer'), 'repair_loop');
    expect(obj(fixer.cases.find((x) => x.case === 'apply')!.raw['fault'], 'fault')['code'], 'the fixer\'s planted fault is its own code').toBe('test.kit.fixer.y_over');
  }, 1_800_000);

  it('#138.0770a3f0 planted rebase_by_path makes the kit\'s stale_same_item case fail for test.kit.fixer', () => {
    const r = kit(builds.bin(FIXER), evidence(), { modules: ['test.kit.fixer'], parts: ['repair_loop'] }, { planted: 'rebase_by_path' });
    const m = moduleOf(r, 'test.kit.fixer');
    expect(m.verdict).toBe('FAIL');
    expectFailure(failuresIn(m, 'repair_loop'), 'repair', { case: 'stale_same_item' }, 'the path-granular rebase');
  }, 1_800_000);

  it('#138.0770a3f0 the scene\'s fault: the check raises its code at its path with a fix as patch ops; applied, the rerun has no such issue (PASS)', () => {
    const [first, fix, rerun] = play('apply') as [JsonObject, JsonObject, JsonObject];
    const fault = issuesOf(first, 'the first read').filter((i) => i.code === FAULT['code']);
    expect(fault.length, `the planted fault raises ${String(FAULT['code'])}: ${show(first['issues'])}`).toBe(1);
    expect(fault[0]!.path, 'the issue names its path').toBe(FAULT['path']);
    expect(fault[0]!.fix.length, 'the issue carries its fix text').toBeGreaterThan(0);
    expect(fault[0]!.fix_ops, 'the issue carries its fix as patch ops').toEqual(FIX);
    expect(outcome(fix), `alpha's fix applies: ${show(fix)}`).toBe('applied');
    expect(issuesOf(rerun, 'the rerun').filter((i) => i.code === FAULT['code']), 'the rerun no longer raises the fault').toEqual([]);
  }, 1_800_000);

  it('#138.0770a3f0 a stale fix rebases when no ID it touches changed since its base: you changed item b, alpha\'s fix on base 0 applies', () => {
    const [yours, fix, rerun] = play('stale_rebase') as [JsonObject, JsonObject, JsonObject];
    expect(outcome(yours)).toBe('applied');
    expect(outcome(fix), `the stale fix rebases and applies: ${show(fix)}`).toBe('applied');
    expect(issuesOf(rerun).filter((i) => i.code === FAULT['code'])).toEqual([]);
  }, 1_800_000);

  it('#138.0770a3f0 a fix to items/a/params/y after you changed items/a/params/x is a conflict naming alpha and you, and leaves the document as it was', () => {
    expect(staleSameItemFailures(play('stale_same_item'))).toEqual([]);
  }, 1_800_000);

  it('#138.0770a3f0 a planted path-granular rebase (rebase_by_path) applies that fix, and the check above fails on it', () => {
    const failures = staleSameItemFailures(play('stale_same_item', 'rebase_by_path'));
    expect(failures.length, 'the path-granular rebase is caught').toBeGreaterThan(0);
    expect(failures[0], 'naming the fix that applied').toMatch(/was applied/);
  }, 1_800_000);

  it('#138.0770a3f0 two conflicting fixes: alpha\'s applies, bravo\'s on the same base is refused naming bravo and alpha', () => {
    const [first, , second, after] = play('conflicting') as [JsonObject, JsonObject, JsonObject, JsonObject];
    expect(outcome(first)).toBe('applied');
    expect(outcome(second), `bravo's fix is refused: ${show(second)}`).toBe('conflict');
    expect(writersOf(second), 'the conflict names both writers').toEqual(writers(WRITER.bravo, WRITER.alpha));
    expect(issuesOf(after).filter((i) => i.code === FAULT['code'])).toEqual([]);
  }, 1_800_000);

  it('#138.0770a3f0 a fix that fails its dry run is refused with its refusal code, a code the catalog lists, and changes nothing', () => {
    const replies = play('dry_run_refused');
    const [yours, before, dry, after] = replies as [JsonObject, JsonObject, JsonObject, JsonObject];
    expect(outcome(yours)).toBe('applied');
    expect(outcome(dry), `the fix's dry run on a board without item a is refused: ${show(dry)}`).toBe('refused');
    const codes = issuesOf(dry, 'the dry run').map((i) => i.code);
    expect(codes.length, 'the refusal carries its code').toBeGreaterThan(0);
    expect(after['hash'], 'the dry run changed nothing').toBe(before['hash']);
    const [cat] = run(builds.bin(FIXER), scenario(evidence(), [CATALOG]));
    const listed = new Set(arr(cat!['codes'], 'catalog.codes').map((c) => str(obj(c, 'code')['code'], 'code')));
    expect(codes.filter((c) => !listed.has(c)), 'the refusal code is in the check catalog').toEqual([]);
  }, 1_800_000);
});

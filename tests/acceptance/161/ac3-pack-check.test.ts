// AC3 #161.3c68daec: No fx@1 graph carries shader text, reads an earlier frame or uses an internal step, by the pack's
// own check run, and a pack operator that takes a shipped operator's name is refused.
//
// The pack's own check is the one a pack version gets once when it is installed (design: Pack; pack graphs and step
// functions: "Each graph and function runs the whole operator check ... when its pack's version is checked"). It is
// run here as the canvas core runs it: `deep-show run` with #306's `install_pack {id, dir}` and `packs` calls. The
// shipped folder `packs/fx-1.0.0`, installed as `deepbuild/fx`, must hold the issue's 70 operators and be admitted
// with no issue, its row `installed` after exactly one check.
//
// That admission says something only if the same check refuses what the criterion names. So four copies of the
// folder, made here in a temporary place and each changed in one operator, go through the same call, each in a
// process of its own (a published version never changes, so one store can't be offered two folders as one version):
//   shader text     the step `fx.invert@1` outputs carries a `wgsl` field (#429's form of shader text)
//   earlier frame   `fx.invert@1`'s target input reads `{"texture": {"target": {"op": "core", "output": "color"},
//                   "step": "previous"}}`, the base's form of a read of what an earlier step or frame left
//   internal step   that step's op is `internal.mip_chain@1`, a name the public op table doesn't hold
//   shipped name    one more operator, a copy of `fx.invert@1`'s graph, keyed and named `blur@1`, the shipped blur
// Each must be refused, with an error that names the operator.
//
// Wrong programs: the base (17 operators, and a pack check that reads no operator's name against the shipped
// library); a pack check that skips its operators.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AC, PACK_DIR, PACK_ID, TIMEOUT, buildLine, clone, isObject, listProblems, packOperators, runShow, shown, useBin, useDir, type JsonObject, type JsonValue } from './helpers.ts';

const ID = AC[3];
const show = useBin('deep-show');
const dir = useDir();
const INVERT = 'fx.invert@1';
const SHIPPED = 'blur@1';
const made: string[] = [];
afterAll(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** A copy of the pack's folder whose manifest `change` edited. */
function copyWith(change: (operators: Record<string, JsonObject>) => void): string {
  const to = mkdtempSync(join(tmpdir(), 'deep-161-pack-'));
  made.push(to);
  cpSync(PACK_DIR, to, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(to, 'pack.json'), 'utf8')) as JsonObject;
  change(manifest['operators'] as Record<string, JsonObject>);
  writeFileSync(join(to, 'pack.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return to;
}
/** The step an operator's color output names. */
const outputStep = (graph: JsonObject): string => String((graph['outputs'] as JsonObject)['color']);
const stepsOf = (graph: JsonObject): Record<string, JsonObject> => graph['steps'] as Record<string, JsonObject>;

interface Installed { outcome: string; version: string; issues: JsonObject[]; row: JsonObject | undefined; problem: string }
/** One process: the folder offered as `deepbuild/fx`, then the store's rows. */
function install(folder: string): Installed {
  const ran = runShow(show().bin, { evidence: dir(), packs: [], calls: [{ call: 'install_pack', id: PACK_ID, dir: folder }, { call: 'packs' }] });
  if (ran.problem) return { outcome: '', version: '', issues: [], row: undefined, problem: ran.problem };
  const [reply, rows] = ran.replies as [JsonObject, JsonObject];
  const row = (Array.isArray(rows['packs']) ? rows['packs'] : []).filter(isObject).find((r) => r['pack'] === PACK_ID);
  return { outcome: String(reply['outcome']), version: String(reply['version']), issues: (Array.isArray(reply['issues']) ? reply['issues'] : []).filter(isObject), row, problem: '' };
}
/** A refusal that names `operator`: the pack was refused, and an error's text holds the operator's ID. */
function refusedNaming(what: string, got: Installed, operator: string): string[] {
  if (got.problem) return [`${what}: ${got.problem}`];
  if (got.outcome !== 'refused') return [`${what}: the pack check answers ${got.outcome}, not refused`];
  const errors = got.issues.filter((i) => i['severity'] === undefined || i['severity'] === 'error');
  // The whole name: `blur@1` isn't named by an error about `fx.directional_blur@1`.
  const whole = new RegExp(`(^|[^A-Za-z0-9_.])${operator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9_@]|$)`);
  return errors.some((i) => whole.test(JSON.stringify(i))) ? [] : [`${what}: refused, but no error names ${operator}: ${shown(got.issues as JsonValue, 600)}`];
}

describe(`${ID} the pack's own check`, () => {
  it(`${ID} packs/fx-1.0.0 holds the 70 operators and its own check admits it with no issue, once; the same check refuses a copy whose graph carries shader text, reads an earlier frame or uses an internal step, naming the operator`, () => {
    expect(listProblems(packOperators()), 'packs/fx-1.0.0 holds the issue\'s 69 operators and fx.slice_shift@1, each by its ID').toEqual([]);
    expect(show().error, buildLine('deep-show')).toBe('');
    const clean = install(PACK_DIR);
    expect(clean.problem, 'deep-show run installs the pack').toBe('');
    expect([clean.outcome, clean.version, clean.issues], `the pack's own check admits ${PACK_ID}@1.0.0 with no issue`).toEqual(['installed', '1.0.0', []]);
    expect([clean.row?.['state'], clean.row?.['checks']], 'the store\'s row: installed, after one check').toEqual(['installed', 1]);

    const found = [
      ...refusedNaming('shader text', install(copyWith((ops) => { const g = ops[INVERT]!; stepsOf(g)[outputStep(g)]!['wgsl'] = 'return vec4<f32>(1.0);'; })), INVERT),
      ...refusedNaming('an earlier frame', install(copyWith((ops) => {
        const inputs = ops[INVERT]!['inputs'] as Record<string, JsonObject>;
        const name = Object.keys(inputs).find((k) => isObject(inputs[k]!['from']) && isObject((inputs[k]!['from'] as JsonObject)['texture']));
        inputs[name ?? 'src'] = { type: 'texture', from: { texture: { target: { op: 'core', output: 'color' }, step: 'previous' } } };
      })), INVERT),
      ...refusedNaming('an internal step', install(copyWith((ops) => { const g = ops[INVERT]!; stepsOf(g)[outputStep(g)]!['op'] = 'internal.mip_chain@1'; })), INVERT),
    ];
    expect(found, 'the pack\'s own check holds each rule the criterion names').toEqual([]);
  }, TIMEOUT);

  it(`${ID} a pack whose operator takes a shipped operator's name, blur@1, is refused, naming it`, () => {
    expect(INVERT in packOperators(), 'the pack holds fx.invert@1, whose graph the twin copies').toBe(true);
    expect(show().error, buildLine('deep-show')).toBe('');
    const twin = install(copyWith((ops) => { ops[SHIPPED] = { ...clone(ops[INVERT]!), id: SHIPPED }; }));
    expect(refusedNaming('a shipped operator\'s name', twin, SHIPPED), 'a pack operator named blur@1 is refused by the pack check').toEqual([]);
  }, TIMEOUT);
});

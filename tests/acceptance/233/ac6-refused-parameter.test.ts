// AC6 #233.8747d6f5: "A parameter with no primitive behind it, such as `use_vectorized`, is refused naming the parameter
// and the fix"
//
// Two figures in one `deep-show run`: `ax`, math.axes {x_range: [−3, 3, 1], y_range: [0, 9, 3]}, and `curve`, math.plot
// {axes: ax, f: "x^2"}, which `deep show` presents with no error; then the same with `use_vectorized: true` on the plot
// (the upstream plot's own parameter, which has no primitive behind it: our path fn is sampled by interval bounds
// either way). The second is refused (outcome `refused`), with an error issue at `items/curve/params/use_vectorized`
// whose `fix` is text that names `use_vectorized` (README: Refusals).
// Wrong programs: the base (no math@1); the parameter dropped silently (presented); refused with a fix that doesn't
// name the parameter, or at another path; refused as an unknown kind.
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, brief, docId, errors, mathDoc, notPresented, present, run, scenario, useBins, useFolders, type JsonObject, type JsonValue, type P2 } from './helpers.ts';

const bin = useBins(['deep-show']);
const folder = useFolders();
const SIZE: P2 = [1920, 1080];
const PATH = 'items/curve/params/use_vectorized';
const figure = (plot: JsonObject): JsonObject => mathDoc('A plot', SIZE, {
  ax: { kind: 'math.axes@1', params: { x_range: [-3, 3, 1], y_range: [0, 9, 3] } },
  curve: { kind: 'math.plot@1', params: { axes: 'ax', f: 'x^2', ...plot } },
});

describe(`${AC[6]} a parameter with no primitive behind it is refused, never dropped`, () => {
  it(`${AC[6]} use_vectorized on math.plot is refused at its path, with a fix that names it`, () => {
    const a = run(bin('deep-show'), scenario(folder(), [present(docId(1), figure({})), present(docId(2), figure({ use_vectorized: true }))]));
    expect(a.ok, `deep-show run accepts the scenario: ${a.why}`).toBe(true);
    const [plain, vectorized] = a.replies as [JsonObject, JsonObject];
    expect(notPresented(plain), 'the plot without use_vectorized is presented with no error').toBe('');
    expect(vectorized['outcome'], `the plot with use_vectorized is refused: ${brief(vectorized, 2000)}`).toBe('refused');
    const at = errors(vectorized).filter((i) => i['path'] === PATH);
    expect(at.length, `an error issue sits at ${PATH}: ${brief(errors(vectorized) as JsonValue, 2000)}`).toBeGreaterThan(0);
    const fixes = at.map((i) => i['fix']).filter((f): f is string => typeof f === 'string');
    expect(fixes.some((f) => f.includes('use_vectorized')), `its fix names use_vectorized: ${brief(at as JsonValue, 2000)}`).toBe(true);
  }, TIMEOUT);
});

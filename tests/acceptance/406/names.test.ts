// AC2: A number on screen that isn't computed in the document or bound fails the audit naming the item; a name with
// digits passes only when marked as a name.
// Two text items through `deep-canvas-render check`: `eta` types the literal `Arrives in 3 days`, and `model` shows the
// part name `T-800`, first unmarked, then marked `{name: true}` on the text item (Honest numbers: `names`).
import { describe, expect, it } from 'vitest';
import { TIMEOUT, check, envelope, naming, shownErrors, textItem, useBuilds, type JsonObject } from './helpers.ts';

const bin = useBuilds(['deep-canvas-render']);

const doc = (marked: boolean): JsonObject => envelope(marked ? 'names-marked-406' : 'names-406', 'figure', [
  textItem('eta', 'a1', { text: 'Arrives in 3 days' }),
  textItem('model', 'a2', { text: 'T-800', ...(marked ? { name: true } : {}) }),
]);

describe('AC2 an unsourced number fails naming its item; a name with digits passes only when marked', () => {
  it('AC2 the literal 3 fails naming eta; T-800 fails naming model unmarked and passes marked as a name', () => {
    const render = bin('deep-canvas-render');
    const unmarked = check(render, doc(false));
    expect(unmarked.ok, `unmarked: the check fails: ${shownErrors(unmarked)}`).toBe(false);
    expect(naming(unmarked, 'number_unsourced', 'eta').length, `unmarked: number_unsourced names eta: ${shownErrors(unmarked)}`).toBeGreaterThan(0);
    expect(naming(unmarked, 'number_unsourced', 'model').length, `unmarked: number_unsourced names model, whose name isn't marked: ${shownErrors(unmarked)}`).toBeGreaterThan(0);
    const marked = check(render, doc(true));
    expect(naming(marked, 'number_unsourced', 'eta').length, `marked: eta's literal 3 still fails, naming eta: ${shownErrors(marked)}`).toBeGreaterThan(0);
    expect(marked.errors.filter((e) => e.ids.includes('model')).map((e) => e.code), `marked: no error names model, a marked name: ${shownErrors(marked)}`).toEqual([]);
  }, TIMEOUT);
});

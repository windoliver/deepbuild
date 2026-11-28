import { beforeAll, describe, expect, it } from 'vitest';
import { AC, CHECK, FIRST, SECOND, TIMEOUT, assetsOf, chart, check, errorsOf, failuresOf, list, openFiles, openWorld, piece, proof, show, tells, type Line, type World } from './helpers.ts';

let w: World | string;
beforeAll(async () => { w = await openWorld(await openFiles()); }, TIMEOUT);
const must = <T>(v: T | string, what: string): T => { expect(typeof v === 'string' ? v : '', what).toBe(''); return v as T; };

const ROW_TYPED_OVER = { op: 'add', path: '/items/sources/params/rows/0/title', value: 'Typed over' };
function typedOver(doc: Line): Line {
  const patched = structuredClone(doc) as { items: { sources: { params: Line } } };
  patched.items.sources.params.rows = [{ title: ROW_TYPED_OVER.value }];
  return patched;
}

describe(`${AC[4]} ${CHECK} fails a list that lacks a shown number's file, and no row is typed`, () => {
  it(`${AC[4]} a list scoped to one item fails ${CHECK} naming the file a label outside the scope shows a number from; a patch that sets one row's text is refused at check, naming the item`, async () => {
    const world = must(w, 'a hub with the table import and the table.derive tools');
    const p = must(await piece(world), 'three files fetched after one yes each, imported, and the first two derived into one table');
    const fields = ['title', 'url'];
    const whole = chart([FIRST(), SECOND(), list({ of: 'document', fields, group: 'none' })], assetsOf(p));
    const control = must(check(world, whole), 'deep-canvas-render check answers');
    expect(errorsOf(control), `the control: the same piece with its list of the whole document passes the check, ${CHECK} included`).toEqual([]);

    const scoped = must(check(world, chart([FIRST(), SECOND(), list({ of: ['first'], fields, group: 'none' })], assetsOf(p))), 'deep-canvas-render check answers the scoped list');
    const failures = failuresOf(scoped);
    expect([scoped.ok, failures.length > 0], `the list scoped to the first label fails ${CHECK}: ${show(scoped.errors, 1500)}`).toEqual([false, true]);
    expect(failures.some((e) => tells(e, p.files.population)), `the failure names the third file, by its title, URL or SHA-256: ${show(failures, 1500)}`).toBe(true);

    const refused = must(check(world, typedOver(whole)), 'deep-canvas-render check answers the patched document');
    proof('ac4-check-failures.json', { scoped: scoped.errors, row_typed_over: { patch: ROW_TYPED_OVER, errors: refused.errors } });
    expect(refused.ok, `the document whose patch typed one row over is refused at check: ${show(refused.errors, 1500)}`).toBe(false);
    expect(refused.errors.some((e) => Array.isArray(e.ids) && e.ids.includes('sources')), `the refusal names the item: ${show(refused.errors, 1500)}`).toBe(true);
  }, TIMEOUT);
});

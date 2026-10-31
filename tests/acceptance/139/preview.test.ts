// AC3 and AC13 (#139): stability. A preview entry is outside the break diff, a package that declares itself stable
// can't call one, an entry no shipped piece of its release calls is not stable, a preview entry names its tracking
// issue, and a preview entry is used only by name (`requires.preview`), or it is refused with `preview_unrequested`.
// The preview method here is `deep.preview` in a scratch tree's extension API; at the install the host is given a
// published API in which `deep.provide` is preview (README: the surface under test).
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  addApi, addSchema, admit, apiEntry, check, expectFailNaming, expectPass, host, makePackage, openHost, openWorld, record, releaseOf, reshapeApi, scratch, shown, step,
  tempDir, type StepPlant,
} from './helpers.ts';
import { extensionApi } from '../../../packages/contracts/src/index.ts';

const retype = (params: { properties: { type: unknown } }): void => { params.properties.type = { type: 'integer' }; };

/** A preview method reshaped between R1 and R2, with no break file. Throws what the criterion names when the step asks for one. */
function previewReshaped(plant?: StepPlant): void {
  const t = scratch();
  addApi(t, apiEntry('deep.preview', { stability: 'preview', tracking: '#139' }));
  record(t, 'R1');
  reshapeApi(t, 'deep.preview', retype);
  const r = check(t, 'R2', { plant });
  if (r.code !== 0) throw Error(`a contract step that diffs preview entries failed the reshaped preview method deep.preview with no break file: ${shown(r)}`);
  expectPass(r, 'a reshaped preview method');
}

describe('#139.607ef4f7 a preview method reshaped passes the diff; a stable package that calls it is refused at install; the same method stable fails; a stable method no shipped piece calls fails', () => {
  it('AC3 a preview method reshaped between two releases passes the contract diff with no break file', () => {
    previewReshaped();
  }, 120_000);

  it('AC3 (wrong program) a contract step that diffs preview entries asks for a break file, and this test fails it', () => {
    expect(() => previewReshaped('diff-preview')).toThrow(/a contract step that diffs preview entries failed the reshaped preview method deep\.preview/);
  }, 120_000);

  it('AC3 the same method marked stable fails the diff without a break file, naming it', () => {
    const t = scratch();
    addApi(t, apiEntry('deep.preview', { stability: 'stable' }));
    record(t, 'R1');
    reshapeApi(t, 'deep.preview', retype);
    expectFailNaming(check(t, 'R2'), 'the stable twin of the reshaped preview method', 'deep.preview');
  }, 120_000);

  it('AC3 a stable method that no shipped piece of its release calls fails the preflight, naming it; called by a shipped piece, or published as preview, it passes', () => {
    const t = scratch();
    record(t, 'R1');
    addApi(t, apiEntry('deep.orphan', { since: 'R2' }), { orphan: true });
    expectFailNaming(check(t, 'R2'), 'a stable method nobody calls', 'deep.orphan', /no shipped piece/);
    const called = scratch();
    record(called, 'R1');
    addApi(called, apiEntry('deep.orphan', { since: 'R2' }));
    expectPass(check(called, 'R2'), 'the same method called by a shipped piece');
    const preview = scratch();
    record(preview, 'R1');
    addApi(preview, apiEntry('deep.orphan', { since: 'R2', stability: 'preview', tracking: '#139' }), { orphan: true });
    expectPass(check(preview, 'R2'), 'the same method published as preview');
  }, 120_000);
});

// ---- The install: a package against a published API in which `deep.provide` is preview.
const THING = 'ext.fix.thing@1';
const INDEX = `export default function (deep: any): void {
  deep.provide('${THING}', 'reading', { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'], additionalProperties: false }, async () => ({ n: 1 }));
}
`;
const PROVIDES = [{ interface: THING, kind: 'reading', minor: 0 }];
const previewApi = () => extensionApi().map((e) => (e.method === 'deep.provide' ? { ...e, stability: 'preview', tracking: '#139' } : e));

/** The fixture package against that API, admitted by a host: `manifest` is what the scenario adds to its manifest. */
async function admitFixture(manifest: Record<string, unknown>, plant?: string): Promise<Awaited<ReturnType<typeof admit>> & { installed?: unknown }> {
  const pkg = await makePackage({ id: 'deepbuild/fix', manifest: { provides: PROVIDES, ...manifest }, index: INDEX });
  const w = await openWorld();
  const h = await openHost(w, { release: await releaseOf(pkg), api: previewApi(), ...(plant ? { plant } : {}) });
  const got = await admit(h, pkg);
  const loaded = await h.loaded();
  if (!got.ok) expect(loaded.map((l) => l.id), 'a refused package is not loaded').not.toContain('deepbuild/fix');
  return got;
}
/** The stable-calls-preview scenario: throws what the criterion names when the package gets in. */
async function stableCallsPreview(plant?: string): Promise<void> {
  const got = await admitFixture({ stability: 'stable' }, plant);
  if (got.ok) throw Error('a host that lets a stable package call a preview method installed deepbuild/fix, which declares itself stable and calls deep.provide');
  expect(got.reason, 'the refusal names the preview method').toContain('deep.provide');
}

describe('#139.607ef4f7 a fixture package that declares itself stable and calls a preview method is refused at install, naming the method', () => {
  it('AC3 a package that declares itself stable and calls the preview deep.provide is refused, naming deep.provide, and is not loaded', async () => {
    await host();
    await stableCallsPreview();
  }, 120_000);

  it('AC3 (wrong program) a host that lets the stable package call a preview method installs it, and this test fails it', async () => {
    await expect(stableCallsPreview('stable-may-call-preview')).rejects.toThrow(/a host that lets a stable package call a preview method installed/);
  }, 120_000);
});

describe('#139.b9c5c209 a preview entry names its tracking issue, and is used only by name: a package or a document lists it in requires.preview, or it is refused with preview_unrequested', () => {
  it('AC13 a preview entry with no tracking issue fails the preflight, naming it; with one it passes', () => {
    const t = scratch();
    record(t, 'R1');
    const bare = apiEntry('deep.untracked', { since: 'R2', stability: 'preview' });
    delete (bare as { tracking?: string }).tracking;
    addApi(t, bare);
    expectFailNaming(check(t, 'R2'), 'a preview entry with no tracking issue', 'deep.untracked', /tracking/);
    const fixed = scratch();
    record(fixed, 'R1');
    addApi(fixed, apiEntry('deep.untracked', { since: 'R2', stability: 'preview', tracking: '#139' }));
    expectPass(check(fixed, 'R2'), 'the same preview entry with its tracking issue');
  }, 120_000);

  it('AC13 a package that uses a preview method without listing it in requires.preview is refused with preview_unrequested, naming the method', async () => {
    const got = await admitFixture({});
    expect(got.ok, 'the package is refused').toBe(false);
    if (got.ok) return;
    expect(got.reason, 'the refusal carries the code and names the method').toMatch(/preview_unrequested/);
    expect(got.reason).toContain('deep.provide');
  }, 120_000);

  it('AC13 one that lists it in requires.preview installs, and is not a stable package', async () => {
    const got = await admitFixture({ requires: { preview: ['deep.provide'] } });
    expect(got.ok, `listing the preview method installs it: ${got.ok ? '' : got.reason}`).toBe(true);
  }, 120_000);

  it('AC13 one that lists it and declares itself stable is refused, naming the method and stable', async () => {
    const listed = await admitFixture({ requires: { preview: ['deep.provide'] } });
    expect(listed.ok, `the same package, listing the preview method and declaring no stability, installs: ${listed.ok ? '' : listed.reason}`).toBe(true);
    const got = await admitFixture({ requires: { preview: ['deep.provide'] }, stability: 'stable' });
    expect(got.ok, 'a package that lists a preview method can\'t declare itself stable').toBe(false);
    if (!got.ok) { expect(got.reason).toContain('deep.provide'); expect(got.reason).toMatch(/stable/); }
  }, 120_000);

  it('AC13 a document that uses a preview kind without listing it is refused with preview_unrequested, naming the kind; listed, it passes', () => {
    const t = scratch();
    addSchema(t, 'sparkle@1', undefined, { stability: 'preview', tracking: '#139' });
    record(t, 'R1');
    const dir = tempDir('doc');
    const doc = (preview: string[]) => { const file = `${dir}/doc-${preview.length}.json`; writeFileSync(file, JSON.stringify({ items: [{ id: 'a', kind: 'sparkle@1' }], requires: { preview } })); return file; };
    const refused = step(['document', doc([]), '--release', 'R1'], { root: t.root });
    expect(refused.code, `a document that doesn't list the preview kind is refused\n${shown(refused)}`).toBe(1);
    expect(refused.out, 'the refusal carries preview_unrequested and the kind').toMatch(/preview_unrequested[^\n]*sparkle@1|sparkle@1[^\n]*preview_unrequested/);
    const listed = step(['document', doc(['sparkle@1']), '--release', 'R1'], { root: t.root });
    expect(listed.code, `listing the kind lets the document through\n${shown(listed)}`).toBe(0);
  }, 120_000);
});

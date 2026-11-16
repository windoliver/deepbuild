// AC6 #155.5ffbe66e: "deep_job lists foley.render@1 with its renderer from their registrations, and a test plug-in's
// second registration of foley.render@1 is refused at install, naming the kind and the plug-in that holds it"
//
// asserts, as #154's suite does for score.render: packages/jobs/foley's manifest is deepbuild/foley-render, declaring
// the job kind foley.render and its tool foley-render@1.0.0 and asking for deep.registerJob and deep.registerJobTool
// (Scope: "foley.render@1 registers as a job kind through deep.registerJob, and its renderer as a tool through
// deep.registerJobTool"); installed into a real hub with `deep install`, deep_job's list (over deep mcp) holds
// foley.render, held by deepbuild/foley-render, with the tool foley-render@1.0.0 of deepbuild/foley-render and its
// build. The test plug-in test/foley-rival@1.0.0 (written here; its code calls deep.registerJob('foley.render', …)) is
// refused at install, exiting non-zero, its words naming foley.render as a whole name and deepbuild/foley-render;
// afterwards deep_job still lists foley.render held by deepbuild/foley-render with the same tool and build, and nothing
// of test/foley-rival. The wrong program is the merge base, which has no packages/jobs/foley.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC, KIND, PACKAGE, PLUGIN, TIMEOUT, TOOL, VARIANTS, deepJob, install, openWorld, proof, said, shown, type Line } from './helpers.ts';

const { packageDigest } = await import(new URL('../../../packages/extension-host/src/index.ts', import.meta.url).href) as typeof import('../../../packages/extension-host/src/index.ts');
const RIVAL = 'test/foley-rival';
/** foley.render as a whole name: not a longer kind's prefix. */
const NAMES_KIND = /foley\.render(?:@1)?(?![\w.-])/;

/** test/foley-rival@1.0.0: its manifest declares the job kind foley.render and a check of its own, and its code
 * registers them; it registers no tool. Its digest is the extension host's packageDigest of the folder. */
function rivalPlugin(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const outputs = Object.fromEntries(VARIANTS.map((v) => [v, { media: 'audio/wav' }]));
  writeFileSync(join(dir, 'index.ts'), [
    '// A second registration of the job kind foley.render (#155 criterion 6), with a check of its own.',
    'export default async function (deep: any): Promise<void> {',
    "  await deep.registerCheck('test.foley_rival', async () => ({ outcome: 'passed', testsRun: 1, evidence: [], read: [], mask: null, failures: [] }));",
    `  await deep.registerJob(${JSON.stringify(KIND)}, {`,
    "    schema: { params: { type: 'object' }, inputs: {} },",
    `    outputs: ${JSON.stringify(outputs)},`,
    "    key: ['tool', 'params', 'inputs'],",
    "    output_checks: ['test.foley_rival'],",
    "    qualification: { fixtures: [{ name: 'one', params: {}, inputs: {}, expect: { l1r1: '' } }] },",
    '  });',
    '}',
    '',
  ].join('\n'));
  const manifest: Line = { id: RIVAL, version: '1.0.0', digest: '', checks: ['test.foley_rival'], jobs: [KIND], requires: { preview: ['deep.registerCheck', 'deep.registerJob'] } };
  writeFileSync(join(dir, 'deepbuild.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  manifest.digest = packageDigest(dir);
  writeFileSync(join(dir, 'deepbuild.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}

describe(`${AC[6]} foley.render registered once, by deepbuild/foley-render`, () => {
  it(`${AC[6]} deep_job lists foley.render with foley-render@1.0.0 from deepbuild/foley-render's registrations, and test/foley-rival's second registration is refused at install naming the kind and its holder`, async () => {
    const w = await openWorld({ foley: true });
    const manifest = JSON.parse(readFileSync(join(PACKAGE, 'deepbuild.json'), 'utf8')) as Line;
    expect(manifest.id, 'packages/jobs/foley is the plug-in deepbuild/foley-render').toBe(PLUGIN);
    expect(manifest.jobs, `its manifest declares the job kind ${KIND}`).toContain(KIND);
    expect(manifest.job_tools, `its manifest declares ${TOOL} as a tool of ${KIND}`).toEqual(expect.arrayContaining([expect.objectContaining({ kind: KIND, tool: TOOL })]));
    expect(manifest.requires?.preview, 'it registers them through deep.registerJob and deep.registerJobTool').toEqual(expect.arrayContaining(['deep.registerJob', 'deep.registerJobTool']));

    const listed = await deepJob(w, { op: 'list' });
    const kinds = (listed.value.kinds ?? []) as Line[];
    const held = kinds.find((k) => k.kind === KIND);
    expect(held, `deep_job lists ${KIND}: ${listed.text.slice(0, 1200)}`).toBeDefined();
    expect(held!.plugin, `${KIND} is held by ${PLUGIN}`).toBe(PLUGIN);
    const tool = (held!.tools as Line[]).find((t) => t.tool === TOOL);
    expect(tool, `${KIND} lists its renderer ${TOOL}: ${JSON.stringify(held).slice(0, 800)}`).toBeDefined();
    expect(tool!.plugin, `${TOOL} is ${PLUGIN}'s`).toBe(PLUGIN);
    expect(typeof tool!.build === 'string' && tool!.build.length > 0, `${TOOL} is listed with its build`).toBe(true);

    const rival = await install(w, rivalPlugin(join(w.tmp, 'rival')));
    const after = await deepJob(w, { op: 'list' });
    const afterKinds = (after.value.kinds ?? []) as Line[];
    proof('ac6-registry.json', { list: listed.value, rival: { code: rival.code, said: said(rival).slice(-2000) }, after: after.value });
    expect(rival.code, `${RIVAL}'s second registration of ${KIND} is refused at install: ${shown(rival)}`).not.toBe(0);
    expect(NAMES_KIND.test(said(rival)), `the refusal names the kind ${KIND}: ${shown(rival)}`).toBe(true);
    expect(said(rival).includes(PLUGIN), `the refusal names ${PLUGIN}, the plug-in that holds it: ${shown(rival)}`).toBe(true);
    const still = afterKinds.find((k) => k.kind === KIND);
    expect(still?.plugin, `${KIND} is still held by ${PLUGIN}`).toBe(PLUGIN);
    expect((still?.tools as Line[] | undefined)?.find((t) => t.tool === TOOL)?.build, `${TOOL} is still listed with the same build`).toBe(tool!.build);
    expect(JSON.stringify(afterKinds).includes(RIVAL), `deep_job lists nothing of ${RIVAL}`).toBe(false);
  }, TIMEOUT);
});

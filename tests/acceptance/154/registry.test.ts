// AC8 #154.a25e77d2: "deep_job lists score.render@1 with its renderer from their registrations, and a test plug-in's
// second registration of score.render@1 is refused at install, naming the kind and the plug-in that holds it"
//
// asserts: packages/jobs/score's manifest is deepbuild/score, declaring the job kind score.render and its tool
// score-render@1.0.0 and asking for deep.registerJob and deep.registerJobTool; installed into a real hub with `deep
// install`, deep_job's list (over deep mcp) holds score.render, held by deepbuild/score, with the tool
// score-render@1.0.0 of deepbuild/score and its build. The test plug-in test/score-rival@1.0.0 (written here; its
// code calls deep.registerJob('score.render', …)) is refused at install, exiting non-zero, its words naming
// score.render as a whole name and deepbuild/score; after it deep_job still lists score.render held by
// deepbuild/score with the same tool and build, and no kind or tool of test/score-rival.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC, KIND, PACKAGE, PLUGIN, RIVAL, TIMEOUT, TOOL, deepJob, install, openWorld, proof, rivalPlugin, said, shown, type Line } from './helpers.ts';

/** score.render as a whole name: not a longer kind's prefix. */
const NAMES_KIND = /score\.render(?:@1)?(?![\w.-])/;

describe(`${AC[8]} score.render registered once, by deepbuild/score`, () => {
  it(`${AC[8]} deep_job lists score.render with score-render@1.0.0 from deepbuild/score's registrations, and test/score-rival's second registration is refused at install naming the kind and its holder`, async () => {
    const w = await openWorld({ score: true });
    const manifest = JSON.parse(readFileSync(join(PACKAGE, 'deepbuild.json'), 'utf8')) as Line;
    expect(manifest.id, 'packages/jobs/score is the plug-in deepbuild/score').toBe(PLUGIN);
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
    proof('ac8-registry.json', { list: listed.value, rival: { code: rival.code, said: said(rival).slice(-2000) }, after: after.value });
    expect(rival.code, `${RIVAL}'s second registration of ${KIND} is refused at install: ${shown(rival)}`).not.toBe(0);
    expect(NAMES_KIND.test(said(rival)), `the refusal names the kind ${KIND}: ${shown(rival)}`).toBe(true);
    expect(said(rival).includes(PLUGIN), `the refusal names ${PLUGIN}, the plug-in that holds it: ${shown(rival)}`).toBe(true);
    const still = afterKinds.find((k) => k.kind === KIND);
    expect(still?.plugin, `${KIND} is still held by ${PLUGIN}`).toBe(PLUGIN);
    expect((still?.tools as Line[] | undefined)?.find((t) => t.tool === TOOL)?.build, `${TOOL} is still listed with the same build`).toBe(tool!.build);
    expect(JSON.stringify(afterKinds).includes(RIVAL), `deep_job lists nothing of ${RIVAL}`).toBe(false);
  }, TIMEOUT);
});

// AC3: "A second tool for test.upper, registered by another test plug-in through deep.registerJobTool, appears beside
// the first in deep_job; a planted tool that lowercases the last letter fails the kind's qualification at install,
// naming the fixture, and never appears in deep_job"
//
// asserts: with test/upper-kind installed, `deep install` of test/upper-more (deep.registerJobTool('test.upper',
// {tool: 'upper-b@1.0.0', ...})) loads it, deep_job lists upper-b@1.0.0 (plugin test/upper-more) beside upper-a@1.0.0
// (plugin test/upper-kind) under test.upper, and upper-b@1.0.0 runs "abc" to "ABC". The planted tool
// test/upper-lowlast's upper-lowlast@1.0.0 (its second file lowercases the last letter) is refused at install, the
// refusal naming one of the kind's qualification fixtures (fx-greeting, fx-sentence, fx-route); deep_job lists it
// under no kind, and a run naming it is refused, starting no process.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BASE_PARAMS, brief, done, FIXTURE_NAMES, HOLDER, input, install, KIND, kindWorld, listKinds, mustInstall, outputOf, proof, refused, runJob, said, sha256, shown, TOOL_A, toolPlugin, toolsOf } from './helpers.ts';

describe('#1922.c2d25c7b A second tool for test.upper, registered by another test plug-in through deep.registerJobTool, appears beside the first in deep_job; a planted tool that lowercases the last letter fails the kind\'s qualification at install, naming the fixture, and never appears in deep_job', () => {
  it('a second plug-in\'s tool for test.upper appears beside the first in deep_job and runs', async () => {
    const w = await kindWorld();
    await mustInstall(w, toolPlugin(join(w.tmp, 'more')));
    const tools = await toolsOf(w);
    proof('ac3-tools.json', tools);
    const by = Object.fromEntries(tools.map((t) => [String(t.tool), t.plugin]));
    expect(by, `deep_job lists both tools of ${KIND}, each with its plug-in: ${JSON.stringify(tools)}`).toMatchObject({ [TOOL_A]: HOLDER, 'upper-b@1.0.0': 'test/upper-more' });
    const r = await runJob(w, 'upper-b@1.0.0', BASE_PARAMS, input(w, 'in.txt', 'abc'));
    expect(done(r.outcome) && outputOf(r.outcome) === sha256('ABC'), `the second tool runs "abc" to "ABC" by hash: ${brief(r)}`).toBe(true);
  }, 900_000);

  it('the planted tool that lowercases the last letter fails the qualification at install, naming the fixture, and never appears in deep_job', async () => {
    const w = await kindWorld();
    const planted = await install(w, toolPlugin(join(w.tmp, 'lowlast'), { id: 'test/upper-lowlast', tool: 'upper-lowlast', lowlast: true }));
    const kinds = await listKinds(w);
    proof('ac3-planted-lowlast.json', { install: planted, kinds });
    expect(planted.code, `the install of the planted tool is refused: ${shown(planted)}`).not.toBe(0);
    const named = FIXTURE_NAMES.filter((f) => said(planted).includes(f));
    expect(named.length, `the refusal names the qualification fixture it failed (one of ${FIXTURE_NAMES.join(', ')}): ${shown(planted)}`).toBeGreaterThan(0);
    const listed = kinds.flatMap((k) => ((k.tools ?? []) as { tool: string }[]).map((t) => t.tool));
    expect(listed.filter((t) => t.startsWith('upper-lowlast')), 'deep_job lists the planted tool under no kind').toEqual([]);
    expect(listed, `the kind's own tool is still listed: ${JSON.stringify(kinds).slice(0, 800)}`).toContain(TOOL_A);
    const r = await runJob(w, 'upper-lowlast@1.0.0', BASE_PARAMS, input(w, 'in.txt', 'abc'));
    expect(refused(r.outcome) && outputOf(r.outcome) === undefined, `a run naming the planted tool is refused: ${brief(r)}`).toBe(true);
    expect(r.started, 'and starts no process').toBe(0);
  }, 900_000);
});

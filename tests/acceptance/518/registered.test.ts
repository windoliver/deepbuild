// AC1 #518.7ecf15cf: "With today's encoders registered as encode tools, the export guards' 60 s fixture film exported
// as H.264 with AAC gives the same frame hashes and PCM hashes as on the merge base, and its receipt's encoder names
// the tool; and a planted hand-off that drops the last frame's buffer before the encode job fails export.fidelity on
// the delivery, naming the last frame"
//
// This file holds the criterion's first words, "with today's encoders registered as encode tools", to the job API
// itself (#1922): the first-party plug-in `packages/jobs/encode` (README: The surface under test) is installed on a
// real hub with `deep install`, as every first-party job plug-in is, and `deep_job`'s list must show the job kind
// `encode`, held by that plug-in, with its tools by name@version. The tools the list must hold are read from this
// machine's own exports: the fixture film is exported by `deep-show run` as H.264 with AAC and as a PNG sequence, and
// the tool each receipt's `encoder` names must be one the kind lists, so the receipt names a registered tool and no
// other. The hub, `deep install` and `deep_job` are #1922's suite's, by import. The hashes against the merge base and
// the planted hand-off are in base.test.ts.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { listKinds, mustInstall, openWorld, type Line } from '../1922/helpers.ts';
import {
  AC, FULL, H264_AAC, PNG_SEQ, REPO, TIMEOUT, TOOL_ID, encoderOf, exportCall, film, filmRun, receiptOf, step, useShow, useTemp, type JsonObject,
} from './helpers.ts';

const PLUGIN = join(REPO, 'packages', 'jobs', 'encode');
const shows = useShow([FULL]);
const temp = useTemp();
const builds = { cli: 'not built', hook: 'not built' };
beforeAll(() => {
  if (!existsSync(join(PLUGIN, 'deepbuild.json'))) return;
  builds.cli = step('npm', ['run', 'build', '--workspaces']);
  builds.hook = step('cargo', ['build', '--locked', '-p', 'deep-hook']);
}, TIMEOUT);

describe(`${AC[1]} today's encoders are registered as tools of the job kind encode, and a receipt's encoder names one of them`, () => {
  it(`${AC[1]} with packages/jobs/encode installed, deep_job lists the job kind encode held by it, and the tools this machine's H.264 and PNG sequence receipts name are among its tools`, async () => {
    expect(existsSync(join(PLUGIN, 'deepbuild.json')), 'the encode job kind\'s first-party plug-in is at packages/jobs/encode (README: The surface under test): it has no deepbuild.json').toBe(true);
    expect(builds.cli, 'the CLI builds: npm run build --workspaces').toBe('');
    expect(builds.hook, 'deep-hook builds: cargo build --locked -p deep-hook').toBe('');
    const manifest = JSON.parse(readFileSync(join(PLUGIN, 'deepbuild.json'), 'utf8')) as JsonObject;
    expect(Array.isArray(manifest['jobs']) && manifest['jobs'].includes('encode'), `the plug-in's manifest lists the job kind encode in jobs: ${JSON.stringify(manifest['jobs'] ?? null)}`).toBe(true);

    // What this machine's exports say encoded them.
    const evidence = temp(); const dir = temp();
    const [video, frames] = filmRun(shows.bin(FULL), evidence, film(evidence, 2), [
      exportCall({ out: join(dir, 'film.mp4'), ...H264_AAC }), exportCall({ out: join(dir, 'frames'), ...PNG_SEQ }),
    ], 'the 2 s fixture film as H.264 with AAC and as a PNG sequence');
    const named = [
      encoderOf(receiptOf(video!, 'the H.264 delivery').raw, 'the H.264 delivery'),
      encoderOf(receiptOf(frames!, 'the PNG sequence').raw, 'the PNG sequence'),
    ];
    for (const e of named) expect(TOOL_ID.test(e.tool), `a receipt's encoder names a tool as the job API names one, name@version: got ${JSON.stringify(e.tool)}`).toBe(true);

    // What the job API holds.
    const w = await openWorld();
    await mustInstall(w, PLUGIN);
    const kinds = await listKinds(w);
    const kind = kinds.find((k) => k['kind'] === 'encode');
    expect(kind, `deep_job lists the job kind encode; it lists ${JSON.stringify(kinds.map((k) => k['kind'] as unknown))}`).toBeDefined();
    expect(kind!['plugin'], 'the job kind encode is held by the plug-in that registers it through deep.registerJob').toBe(manifest['id']);
    const tools = (Array.isArray(kind!['tools']) ? kind!['tools'] as Line[] : []).map((t) => String(t['tool']));
    expect(tools.length, 'the job kind encode lists its tools').toBeGreaterThan(0);
    for (const t of tools) expect(TOOL_ID.test(t), `each tool of encode is listed by name@version: got ${JSON.stringify(t)}`).toBe(true);
    for (const e of named) expect(tools, `the receipt's encoder, ${e.tool}, is a tool the job kind encode lists`).toContain(e.tool);
  }, TIMEOUT);
});

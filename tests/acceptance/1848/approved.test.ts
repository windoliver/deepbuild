// #1848 AC2: with the hub up and the files server's write_file approved once, the same write as AC1's
// (`mcp__files__write_file` whose path is `<repo>/.deepbuild/done.yaml`) is still denied, naming
// no-deepbuild-spec-write. "Approved once" is the base's own surface for an MCP tool (#321): `files` is a stdio server
// in your user-scope Claude Code config; a first session start records its list (read_file); an update adds
// write_file; the next session start holds write_file by one authority ask; your yes, through `deep inbox answer`, lets
// it run. A write of `<repo>/src/a.ts` running then shows the approval took and the hub decides the session's calls.
// The denial must be the hub's (the call's tool.before not marked late) and name the argument, the path, the entry
// and deep_propose. deep-hook on the merge base lets the approved tool write the spec (BASE-FAILURE.txt).
import { afterEach, beforeAll, describe, it } from 'vitest';
import {
  AC2, FilesServer, SPEC, approve, askNaming, buildDeepHook, cleanup, decidedByHub, decision, denialText, files, label,
  lacks, lastPos, listRecorded, makeWorld, must, newSession, pre, sessionStart, shown, startHub, stopHub, tool, typed,
  verdict,
} from './helpers.ts';

beforeAll(async () => { await buildDeepHook(); }, 900_000);
afterEach(cleanup, 60_000);

describe(`AC2 ${AC2} with the hub up and the tool approved once, the spec write is still denied`, () => {
  it(`AC2 ${AC2} with the hub up and the files server's write_file approved once through your yes, mcp__files__write_file whose path is <repo>/.deepbuild/done.yaml is still denied, naming ${SPEC}`, async (ctx) => {
    await verdict(ctx, async () => {
      const who = `AC2 ${AC2} [${SPEC}]`;
      const w = makeWorld();
      const server = FilesServer.install(w, 'files', [tool('read_file')]);
      const hub = await startHub(w);
      try {
        const s1 = newSession(w);
        let since = await lastPos(hub);
        await sessionStart(s1);
        await listRecorded(hub, since, 'files', ['read_file']);

        server.update([tool('read_file'), tool('write_file')], '1.1.0');
        const s2 = newSession(w);
        since = await lastPos(hub);
        await sessionStart(s2);
        await approve(w, await askNaming(hub, since, ['files', 'write_file']));
        await typed(s2, 'Write the login module.');

        const plain = files('write_file', { path: `${w.repo}/src/a.ts`, content: 'export const a = 1;\n' });
        const ran = await pre(s2, plain);
        if (decision(ran.r) !== 'allow') throw Error(`BLOCKED: write_file, approved once, must run with the hub up: ${label(plain)} was not allowed (${shown(ran.r)})`);

        const path = `${w.repo}/.deepbuild/done.yaml`;
        const spec = files('write_file', { path, content: 'done: []\n' });
        const p = await pre(s2, spec);
        must(decision(p.r) === 'deny', `${who} with the hub up and write_file approved once, ${label(spec)} must still be denied naming ${SPEC}: deep-hook ${decision(p.r) === 'allow' ? 'allowed it' : 'neither allowed nor denied it'} (${shown(p.r)})`, p.r);
        await decidedByHub(hub, p.id, who);
        const missing = lacks(denialText(p.r), { entry: SPEC, argument: 'path', paths: [path], propose: true });
        must(!missing.length, `${who} the hub-up denial of ${label(spec)} must name ${missing.join(', ')}: ${shown(p.r)}`, p.r);
      } finally {
        await stopHub(hub);
      }
    });
  }, 600_000);
});

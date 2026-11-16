// #1848 AC1: with the hub stopped, an MCP call that names a protected path in its `path` argument meets the same
// shipped entry as the same path in an Edit or a Read. `mcp__files__write_file` whose path is
// `<repo>/.deepbuild/done.yaml` is denied naming no-deepbuild-spec-write, and `mcp__files__read_file` whose path is
// `~/.deepbuild/control.token` is denied naming no-control-token-read, each denial naming the argument, the path and
// the entry, and the spec write's pointing to deep_propose as that entry's own denial does (Scope). The hub is started
// (so the control token exists) and stopped by its PID. Each call is read the same way by the hook path, by the check
// mode over the shipped entry, and by `deep-hook match` (Scope: the pi package's MCP calls). deep-hook on the merge
// base allows both calls and fails this test, naming the call (BASE-FAILURE.txt).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, it } from 'vitest';
import {
  AC1, SPEC, TOKEN, buildDeepHook, checked, cleanup, decision, denialText, files, hook, label, lacks, makeWorld,
  matched, must, shown, startHub, stopHub, type Call, type World,
} from './helpers.ts';

let BIN: string;
beforeAll(async () => { BIN = await buildDeepHook(); }, 900_000);
afterEach(cleanup, 60_000);

/** A world whose hub was started, so its control token exists, and then stopped by its PID. */
async function stoppedWorld(): Promise<World> {
  const w = makeWorld();
  await stopHub(await startHub(w));
  if (!existsSync(join(w.root, 'control.token'))) throw Error('BLOCKED: the hub left no ~/.deepbuild/control.token');
  return w;
}

/** The call is denied with the hub stopped by `entry`, through the hook path, the check mode and the match mode. */
async function judgeDenied(w: World, call: Call, o: { entry: string; argument: string; paths: string[]; propose: boolean }): Promise<void> {
  const who = `AC1 ${AC1} [${o.entry}]`;
  const r = await hook(w, call, BIN);
  must(decision(r) === 'deny', `${who} with the hub stopped, ${label(call)} must be denied naming ${o.entry}: deep-hook ${decision(r) === 'allow' ? 'allowed it' : 'neither allowed nor denied it'} (${shown(r)})`, r);
  const missing = lacks(denialText(r), o);
  must(!missing.length, `${who} the hook's denial of ${label(call)} must name ${missing.join(', ')}: ${shown(r)}`, r);

  const c = await checked(w, o.entry, call, BIN);
  must(c.matched === true, `${who} the check mode over the shipped ${o.entry} must match ${label(call)}, as the hook path does: ${shown(c.ran)}`, c.ran);

  const [m] = await matched(w, [call], BIN);
  must(Array.isArray(m!.matched) && m!.matched.includes(o.entry), `${who} deep-hook match must match ${o.entry} on ${label(call)}, as the hook path does: ${JSON.stringify(m)}`);
  const denial = ((m!.denials ?? []) as unknown[]).map(String).find((d) => d.includes(o.entry));
  must(denial !== undefined, `${who} deep-hook match must give the hub-away denial of ${label(call)} by ${o.entry}: ${JSON.stringify(m)}`);
  const unsaid = lacks(denial, o);
  must(!unsaid.length, `${who} deep-hook match's denial of ${label(call)} must name ${unsaid.join(', ')}: ${denial}`);
}

describe(`AC1 ${AC1} with the hub stopped, an MCP call's path argument meets no-deepbuild-spec-write and no-control-token-read`, () => {
  it(`AC1 ${AC1} mcp__files__write_file whose path is <repo>/.deepbuild/done.yaml is denied with the hub stopped, naming ${SPEC}, the argument and the path, and pointing to deep_propose`, async () => {
    const w = await stoppedWorld();
    const path = `${w.repo}/.deepbuild/done.yaml`;
    await judgeDenied(w, files('write_file', { path, content: 'done: []\n' }), { entry: SPEC, argument: 'path', paths: [path], propose: true });
  }, 600_000);

  it(`AC1 ${AC1} mcp__files__read_file whose path is ~/.deepbuild/control.token is denied with the hub stopped, naming ${TOKEN}, the argument and the path`, async () => {
    const w = await stoppedWorld();
    await judgeDenied(w, files('read_file', { path: '~/.deepbuild/control.token' }), { entry: TOKEN, argument: 'path', paths: ['~/.deepbuild/control.token', join(w.root, 'control.token')], propose: false });
  }, 600_000);
});

// AC3: The gate credential appears in no session's environment, arguments or readable files. A planted hub that passes
// it to a session fails, naming the variable.
//
// First the gate acts: a PASS, posted by the hub as the gate identity, so the hub has used its credential (the app's
// key, and the JWTs and installation tokens the forge saw made from it). Then a session under a run, in its own
// sandbox as the shipped facts set it, runs fixtures/scan.mjs as one Bash call: every file it can read under the test
// home, /tmp and its TMPDIR, matched against digests of the gate's secrets, never the secrets themselves. Its
// environment and its arguments are read from what the stand-in logged. The wrong program is the plant
// `passes-gate-credential`.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC, CONTEXT, digestOf, failureOf, FIXTURES, GATE_APP, must, NODE, promptOf, sh, World } from './helpers.ts';

const LONG = 600_000;
let session: Record<string, string> = {};

async function scenario(plant?: string): Promise<void> {
  const w = await World.open(plant ? { plant } : {});
  const status = await w.gatePass();
  must(status.app === w.gate.id, `the hub's ${CONTEXT} status was posted by ${status.creator}, not by the gate identity (${w.loginOf(w.gate)}), so it holds no gate credential to keep from sessions`);
  await w.approveRun();
  const digests = join(w.home, 'scan-digests.json');
  const scan = `${sh(NODE, join(FIXTURES, 'scan.mjs'), digests, w.home, '/tmp')} "$TMPDIR"`;
  const started = await w.start(promptOf([scan]));
  // Written once the session has started, so a credential the start made is in it.
  writeFileSync(digests, JSON.stringify({ digests: Object.fromEntries(w.gateSecrets().map((s) => [digestOf(s.value), s.label])) }));
  const log = await w.standIn(started.worktree, { ms: 400_000 });
  session = log.env as Record<string, string>;
  for (const [name, value] of Object.entries(session)) {
    const held = w.holdsGateSecret(String(value));
    must(!held, `the session's environment holds the gate credential in ${name} (${held})`);
  }
  const argv = (log.argv as string[]).join('\n');
  const inArgs = w.holdsGateSecret(argv);
  must(!inArgs, `the session's arguments hold the gate credential (${inArgs})`);
  const bash = (log.bash as { stdout?: string; stderr?: string; denied?: boolean }[])[0];
  const report = /\{"scan":.*\}\s*$/.exec(bash?.stdout ?? '')?.[0];
  if (!report) throw Error(`BLOCKED: the session's scan must run and report: ${JSON.stringify(bash).slice(0, 1500)}`);
  const found = (JSON.parse(report) as { scan: { files: number; found: { path: string; label: string }[] } }).scan;
  if (found.files < 10) throw Error(`BLOCKED: the session's scan read only ${found.files} files`);
  must(!found.found.length, `the session can read the gate credential: ${found.found.map((f) => `${f.label} in ${f.path}`).join('; ')}`);
}

describe(`${AC[3]} The gate's credential reaches no session: not its environment, arguments or any file it can read`, () => {
  it(`${AC[3]} after the gate identity (${GATE_APP.slug}) posts, a session under a run holds none of its credential`, async () => {
    await scenario();
  }, LONG);

  it(`${AC[3]} (planted passes-gate-credential) a hub that passes the gate credential to a session fails, naming the variable`, async () => {
    const failure = await failureOf(() => scenario('passes-gate-credential'));
    expect(failure, 'the scenario must fail on the wrong program').not.toBeNull();
    const named = /the session's environment holds the gate credential in ([A-Za-z_][A-Za-z0-9_]*) /.exec(failure ?? '')?.[1];
    expect(named, `the failure names the variable: ${failure}`).toBeDefined();
    expect(Object.keys(session), 'the variable it names is one the session has').toContain(named);
  }, LONG);
});

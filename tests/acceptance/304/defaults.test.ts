// #304 AC2: every first-party default entry marked fail_closed ships a planted call and a twin beside it in
// crates/deep-hook/default-rules.json (`proofs`); each planted call is denied and each twin allowed with the hub up and
// with it stopped, and the two runs agree call for call. "Stopped" here is the hub's process stopped with SIGSTOP:
// its socket and process are still there, so a planted call that names {hub_pid} can name it, and deep-hook acts
// as with the hub away once it gets no acknowledgement (#315). The calls run in the check fixture (helpers.ts,
// makeFixture), their placeholders replaced, through the real deep-hook and the real hub.
import { afterEach, beforeAll, describe, it } from 'vitest';
import {
  AC2, buildDeepHook, cleanup, decision, defaultsFile, hook, makeFixture, makeHome, must, newSession, preToolUse,
  seedDefaults, shown, startHub, stopHub, substitute, type Call, type Ran,
} from './helpers.ts';

let BIN: string;
beforeAll(async () => { BIN = await buildDeepHook(); }, 900_000);
afterEach(cleanup, 60_000);

type Phase = 'up' | 'stopped';
interface Row { name: string; planted?: Call; twin?: Call; runs: Partial<Record<Phase, { planted: Ran; twin: Ran }>> }

describe(`AC2 ${AC2} every default fail_closed entry denies its planted call and allows its twin, hub up and stopped, agreeing call for call`, () => {
  it('AC2 each default fail_closed entry ships a planted call and a twin; with the hub up and with it stopped the planted call is denied and the twin allowed', async () => {
    const file = defaultsFile();
    const names = Object.entries(file.entries).filter(([, g]) => g.fail_closed === true).map(([name]) => name);
    must(names.length > 0, 'default-rules.json holds fail_closed entries');
    const missing = names.filter((n) => {
      const p = file.proofs?.[n];
      return !p || typeof p.planted?.tool_name !== 'string' || typeof p.planted.tool_input !== 'object' || typeof p.twin?.tool_name !== 'string' || typeof p.twin.tool_input !== 'object';
    });
    must(!missing.length, `every default fail_closed entry ships a planted call and a twin in default-rules.json's proofs; these don't: ${missing.join(', ')}`);

    const home = makeHome();
    seedDefaults(home);
    const fixture = makeFixture(home);
    const s = newSession(home, fixture.work);
    const rows: Row[] = names.map((name) => ({ name, planted: file.proofs[name]!.planted, twin: file.proofs[name]!.twin, runs: {} }));
    const hub = await startHub(home);
    fixture.hubPid = hub.pid;
    const pass = async (phase: Phase) => {
      for (const row of rows) {
        const planted = await hook(home, preToolUse(s, substitute(row.planted!, fixture)), { binary: BIN });
        const twin = await hook(home, preToolUse(s, substitute(row.twin!, fixture)), { binary: BIN });
        row.runs[phase] = { planted, twin };
      }
    };
    try {
      await pass('up');
      process.kill(hub.pid, 'SIGSTOP');
      await pass('stopped');
    } finally {
      await stopHub(hub);
    }

    for (const row of rows) {
      for (const phase of ['up', 'stopped'] as const) {
        const r = row.runs[phase]!;
        must(decision(r.planted) === 'deny', `${row.name}: its planted call ${JSON.stringify(row.planted)} must be denied with the hub ${phase}: ${shown(r.planted)}`);
        must(decision(r.twin) === 'allow', `${row.name}: its twin ${JSON.stringify(row.twin)} must be allowed with the hub ${phase}: ${shown(r.twin)}`);
      }
    }
    const up = rows.flatMap((r) => [decision(r.runs.up!.planted), decision(r.runs.up!.twin)]);
    const stopped = rows.flatMap((r) => [decision(r.runs.stopped!.planted), decision(r.runs.stopped!.twin)]);
    const differ = up.findIndex((d, i) => d !== stopped[i]);
    must(differ < 0, `the runs with the hub up and stopped must agree call for call; ${rows[Math.floor(differ / 2)]?.name}'s ${differ % 2 ? 'twin' : 'planted call'} was ${up[differ]} up and ${stopped[differ]} stopped`);
  }, 900_000);
});

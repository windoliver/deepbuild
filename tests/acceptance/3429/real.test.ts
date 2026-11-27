// #3429 on a real paseo daemon, the release the facts pin (README, The worlds): a scripted ACP agent in a mode that
// approves its own calls runs a tool call, and whether paseo fires agent.permission.before for it is what the corpus
// holds as the recorded run. The agent is fixtures/acp-agent.mjs, a stand-in for Copilot's CLI and its model, run by
// paseo's own Copilot provider; fixtures/observer writes down each hook the daemon fires. Nothing of DeepBuild's runs,
// so this file needs no build.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { Daemon, NODE, cleanup, jsonIn, until, type Line } from './daemon.ts';
import { AC, ALLOW_ALL, ASKING, pinned, recordedRun } from './run.ts';

afterEach(cleanup, 120_000);

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const PROMPT = 'Run the shell command.';
const lines = (file: string): Line[] => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Line) : []);
/** What the scripted agent did in its folder, and what paseo fired for it there, in the order it fired them. */
const did = (cwd: string): Line[] => lines(join(cwd, '.dh3429-agent.jsonl'));
const fired = (cwd: string): Line[] => lines(join(cwd, '.dh3429-hooks.jsonl'));
const hooks = (cwd: string): string[] => fired(cwd).flatMap((l) => (typeof l.hook === 'string' ? [l.hook] : []));
/** How paseo's snapshot of the agent read its mode at the turn's start: its currentModeId and its runtimeInfo.modeId. */
const modeAt = (cwd: string): Line | undefined => { const s = fired(cwd).find((l) => l.snapshot)?.snapshot; return s && { currentModeId: s.currentModeId, runtimeModeId: s.runtimeModeId }; };
const reads = (mode: string): Line => ({ currentModeId: mode, runtimeModeId: mode });

/** One Copilot agent and one turn of it in `mode` (paseo's default for Copilot, its asking mode, when none): its folder, once the turn is over. */
async function turn(paseo: Daemon, name: string, mode: string | undefined): Promise<string> {
  const cwd = paseo.folder(name);
  const run = paseo.run(['run', '--provider', 'copilot', ...(mode ? ['--mode', mode] : []), '--cwd', cwd, '--json', PROMPT], 240_000);
  if (!mode) {
    // The asking mode: the call waits on its permission request, which is allowed in paseo itself.
    const pending = await until(async () => {
      const got = await paseo.run(['permit', 'ls', '--json']);
      const list = got.code === 0 ? jsonIn(got.stdout) : [];
      return ((Array.isArray(list) ? list : list.permissions ?? []) as Line[])[0];
    }, 120_000, () => `the scripted agent's permission request in Copilot's asking mode; daemon ${paseo.output().slice(-800)}`, 500);
    const allowed = await paseo.run(['permit', 'allow', String(pending.agentId), String(pending.id)]);
    if (allowed.code !== 0) throw Error(`BLOCKED: paseo permit allow exited ${allowed.code}: ${allowed.stdout} ${allowed.stderr}`);
  }
  const ran = await run;
  if (ran.code !== 0) throw Error(`BLOCKED: paseo run with the scripted ACP agent${mode ? ` in mode ${mode}` : ''} exited ${ran.code}: ${ran.stdout} ${ran.stderr}; daemon ${paseo.output().slice(-800)}`);
  await until(() => hooks(cwd).includes('agent.turn.after') && did(cwd).some((l) => l.turn === 'end') && modeAt(cwd) !== undefined, 120_000, () => `the turn's end${mode ? ` in mode ${mode}` : ''}: paseo fired ${hooks(cwd).join(', ') || 'nothing'}, the agent did ${JSON.stringify(did(cwd))}`);
  return cwd;
}

it(`${AC.run} on the pinned paseo's real daemon, a scripted ACP agent in Copilot's allow-all runs a tool call, and the corpus holds whether paseo fired agent.permission.before for it`, async () => {
  // paseo's own Copilot provider, run on the scripted agent in place of `copilot --acp`, and the observer.
  const paseo = await Daemon.start({ copilot: { command: [NODE, join(FIXTURES, 'acp-agent.mjs')] } });
  await paseo.install(join(FIXTURES, 'observer'), 'dh3429-observer');

  // The same call in the asking mode first: this daemon fires agent.permission.before when the agent asks, and the
  // observer sees it. Without that, a hook that never came would show nothing.
  const asked = await turn(paseo, 'asking', undefined);
  if (!(did(asked).some((l) => l.asked === true && l.ran === true) && hooks(asked).includes('agent.permission.before'))) {
    throw Error(`BLOCKED: in Copilot's asking mode the scripted agent's call must ask and paseo ${pinned()} must fire agent.permission.before for it, or the run below shows nothing: paseo fired ${hooks(asked).join(', ') || 'nothing'}, the agent did ${JSON.stringify(did(asked))}`);
  }
  expect(modeAt(asked), `${AC.run} paseo's snapshot of the agent at its turn's start reads Copilot's asking mode, as this suite's fixture paseo gives it`).toEqual(reads(ASKING));

  const cwd = await turn(paseo, 'allow-all', ALLOW_ALL);
  const call = did(cwd).find((l) => l.call);
  const live = hooks(cwd).includes('agent.permission.before');
  const saw = `paseo ${pinned()} fired ${hooks(cwd).join(', ')}; the agent did ${JSON.stringify(did(cwd))}`;
  expect(modeAt(cwd), `${AC.run} paseo's snapshot of the agent at its turn's start reads currentModeId ${ALLOW_ALL}, as this suite's fixture paseo gives it`).toEqual(reads(ALLOW_ALL));
  expect({ asked: call?.asked, ran: call?.ran, file: existsSync(join(cwd, 'dh3429-ran.txt')) }, `${AC.run} in ${ALLOW_ALL} the scripted agent approves its own call and runs it: ${saw}`).toEqual({ asked: false, ran: true, file: true });

  const recorded = recordedRun();
  const here = `on this daemon, for the call the agent approved itself in ${ALLOW_ALL}, paseo ${live ? 'fired' : 'did not fire'} agent.permission.before (${saw})`;
  expect(recorded.problems, `${AC.run} whether paseo fires agent.permission.before for the call is recorded for the corpus, as ${recorded.at} (README, The recorded run); ${here}`).toEqual([]);
  expect({ fired: recorded.fired }, `${AC.run} the run recorded at ${recorded.at} (mode ${recorded.mode}: ${recorded.hooks.join(', ')}) says what this daemon does: ${here}`).toEqual({ fired: live });
}, 900_000);

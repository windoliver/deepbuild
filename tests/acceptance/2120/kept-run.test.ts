// AC5: a run rebuilt from the record is never started beside a kept run that still lives (README).
//
// #996's hub as a process on a root of its own: run.start with keep true starts a program that notes each start of
// its own and then sleeps, writing nothing to its output, so it outlives the hub that holds its pipes. Once the
// supervisor tracks it, the hub is killed (kill -9) and its journal, runs.json, cut to half its bytes so it can't be
// parsed. When the hub starts again, the run must be adopted: while it lives, no run.finished is recorded for it and
// no second run of its command starts. On the base the run rebuilt from run.started has no keep, so it is finished
// "stopped, hub restarted" and its command is started again.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { COMMIT, Client, alive, crashHub, own, sleep, startHub, stopHub, sub, tempDir, ulid, waitFor, watchRoot, type Line } from '../996/helpers.ts';

const AC5 = 'AC5 #2120.19250b4a';
/** How long the restarted hub is watched: its recovery runs before it is ready, and a run it starts again starts within seconds. */
const WATCH_MS = 20_000;

test(`${AC5} a kept run in flight, the hub dead and runs.json unparseable: the next hub adopts it, with no run.finished while it lives and no second run of its command`, async () => {
  const dir = tempDir();
  const root = join(dir, 'root');
  watchRoot(root);
  const work = sub(dir, 'work');
  const [pids, starts] = [join(work, 'pids'), join(work, 'starts')];
  const argv = ['/bin/sh', '-c', `echo $$ >> '${pids}'; echo started >> '${starts}'; exec /bin/sleep 600`];
  const linesOf = (file: string): string[] => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : []);

  const hub = await startHub(root);
  let run = '';
  let pid = 0;
  try {
    const client = await Client.open(hub);
    run = String((await client.call('run.start', { check: 'kept-sleeper', claim: `claim:${ulid()}`, commit: COMMIT, argv, cwd: work, keep: true })).run);
    await waitFor(() => linesOf(starts).length > 0, 30_000, `the kept run ${run} to start`);
    pid = Number(linesOf(pids)[0]);
    own(pid);
    await waitFor(async () => (await client.events()).some((e: Line) => e.kind === 'process.tracked' && e.data?.run === run), 30_000, `the supervisor tracking ${run}`);
    client.close();
  } catch (error) {
    await stopHub(hub, 'SIGKILL');
    throw Error(`BLOCKED: a kept run in flight: ${error instanceof Error ? error.message : String(error)}`);
  }
  await crashHub(hub);
  await sleep(500);
  if (!alive(pid)) throw Error(`BLOCKED: the kept run ${run} (PID ${pid}) died with the hub, so nothing is in flight to adopt`);
  const file = join(root, 'runs.json');
  const whole = readFileSync(file);
  writeFileSync(file, whole.subarray(0, Math.floor(whole.length / 2)));
  try { JSON.parse(readFileSync(file, 'utf8')); throw Error('BLOCKED: runs.json cut to half still parses'); } catch (error) { if (error instanceof Error && error.message.startsWith('BLOCKED')) throw error; }

  const again = await startHub(root);
  let events: Line[] = [];
  try {
    const client = await Client.open(again);
    const finished = (all: Line[]) => all.filter((e) => e.kind === 'run.finished' && (e.data?.run === run || e.subject === run));
    const rerun = (all: Line[]) => all.filter((e) => e.kind === 'run.started' && e.data?.run !== run && JSON.stringify(e.data?.argv) === JSON.stringify(argv));
    await sleep(WATCH_MS);
    events = await client.events();
    linesOf(pids).map(Number).forEach(own);
    client.close();
    expect({
      'the kept run lives': alive(pid),
      'run.finished for it': finished(events).map((e) => `${String(e.data?.outcome)}: ${((e.data?.findings ?? []) as string[]).join('; ')}`),
      'other runs started with its command': rerun(events).map((e) => String(e.data?.run)),
      'starts of its command': linesOf(starts).length,
    }, `${AC5} the hub that started after ${run}'s journal couldn't be parsed adopts the kept run (PID ${pid}): no run.finished for it while it lives, and its command isn't started again`).toEqual({
      'the kept run lives': true,
      'run.finished for it': [],
      'other runs started with its command': [],
      'starts of its command': 1,
    });
  } finally {
    await stopHub(again);
  }
});

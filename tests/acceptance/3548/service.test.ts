// #3548.5faa5b25 (criterion 2): "On macOS the login service's hub holds to the same limit across a restart, and the
// lines written before the restart are kept up to it. A planted hub that starts a new file at each start and keeps the
// old ones fails, naming the folder's size".
//
// The login service is the product's: `deep hub start` with HOME a temporary home writes the service's definition
// under it and hands it to $DEEP_HUB_LAUNCHER (fixtures/launcher.mjs), which stands in for launchd and does with the
// definition what launchd does: the program it names, with its variables, its standard output and error appended to
// the paths it names. So no real service is touched, and the hub's log is wired by the definition alone. A restart is
// the installed hub's own: SIGTERM by its PID, which it takes as a restart, then the launcher again from the same
// definition, as launchd's KeepAlive starts the job again.
//
// The run (README: The login service): four starts of the hub, each made to write by the planted writer.
//   start 1 writes 2 MiB; restart; start 2 writes one line. Every line of start 1 is still there: 2 MiB is far under
//   the limit, so none had to leave.
//   start 2 writes 24 MiB; restart; start 3 writes 24 MiB; restart; start 4 writes 24 MiB: 74 MiB in all, past the
//   limit. The folder is read every 20 ms from the first start to the last line; then the logs are read back.
// The problems it finds are listed; the unplanted run must find none, and the planted run the folder's size.
// On another system than macOS both tests are skipped as INCONCLUSIVE, never passed (the issue's Runs on line).

import { chmodSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  alive, built, childEnv, cleanup, deep, filesShown, FIXTURES, gone, hubPid, LOGS_LIMIT, makeHome, mb, MIB, newTag, NODE, own, pause, readLogs, run,
  shown, tail, tidy, until, watchFolder, write, writerEnv, type Home, type LogReading,
} from './helpers.ts';

afterEach(cleanup, 120_000);

const ID = '#3548.5faa5b25';
const PLANT = 'log-new-file-each-start';
const FIRST = 2 * MIB;
const EACH = 24 * MIB;
const OTHER_SYSTEM = `INCONCLUSIVE: the login service's log is macOS's (the issue's Runs on line: "macOS for the login service's log"); this is ${process.platform}, where the service's definition names no file`;

interface ServiceRun { up: boolean; why: string; problems: string[] }

/** The logs once line `number` is in them, or as they are a minute on. */
async function landed(logs: string, tag: string, number: number): Promise<LogReading> {
  let reading = await readLogs(logs, tag, number);
  for (const end = Date.now() + 60_000; !reading.has(number) && Date.now() < end;) {
    await pause(250);
    reading = await readLogs(logs, tag, number);
  }
  return reading;
}

/** The installed hub restarted: SIGTERM by its PID, then the job started again from its definition, as launchd does. */
async function restart(h: Home, launcher: string, definition: string, env: Record<string, string>, old: number): Promise<number | undefined> {
  try { process.kill(old, 'SIGTERM'); } catch { /* gone */ }
  if (!(await gone(old, 60_000))) {
    try { process.kill(old, 'SIGKILL'); } catch { /* gone */ }
    await gone(old, 10_000);
  }
  await run(launcher, [definition], { env: childEnv(h, env), timeoutMs: 60_000 });
  return until(async () => { const pid = await hubPid(h); return pid !== undefined && pid !== old && alive(pid) ? pid : undefined; }, 180_000);
}

async function serviceRun(plant?: string): Promise<ServiceRun> {
  const h = makeHome();
  const logs = join(h.root, 'logs');
  const launcher = join(h.ctl, 'launcher');
  writeFileSync(launcher, `#!/bin/sh\nexec "${NODE}" "${join(FIXTURES, 'launcher.mjs')}" "$@"\n`);
  chmodSync(launcher, 0o755);
  const env: Record<string, string> = { ...writerEnv(h), DEEP_HUB_LAUNCHER: launcher, DEEP_3548_JOB: join(h.ctl, 'job'), ...(plant ? { DEEP_HUB_PLANT: plant } : {}) };
  const watch = watchFolder(logs);

  const started = await deep(h, ['hub', 'start'], { env, timeoutMs: 300_000 });
  // A start that gave up on a busy machine may still have started the hub; one whose hub ended at once has none to wait for.
  let pid = await until(() => hubPid(h), started.code === 0 ? 120_000 : 20_000);
  own(pid);
  const folder = join(h.home, 'Library', 'LaunchAgents');
  let definitions: string[] = [];
  try { definitions = readdirSync(folder).filter((f) => f.endsWith('.plist')); } catch { /* none written */ }
  if (pid === undefined || definitions.length !== 1) {
    watch.stop();
    return { up: false, why: `${definitions.length} service definition${definitions.length === 1 ? '' : 's'} in ${tidy(folder)}; ${shown(started)}\n${tail(logs)}`, problems: [] };
  }
  const definition = join(folder, definitions[0]!);

  const tag = newTag();
  const problems: string[] = [];
  let next = 1;
  let total = 0;
  const burst = async (bytes: number) => {
    const wrote = await write(h, pid!, { tag, from: next, bytes });
    next = wrote.to + 1;
    total += wrote.bytes;
    return wrote;
  };
  const again = async (): Promise<boolean> => {
    const old = pid!;
    pid = await restart(h, launcher, definition, env, old);
    own(pid);
    if (pid === undefined) problems.push(`the login service's hub didn't answer again after its restart (SIGTERM to ${old}, then the job started again from ${tidy(definition)}): ${tail(logs)}`);
    return pid !== undefined;
  };

  // Start 1 writes 2 MiB; after the restart, once start 2 has written a line, every line of start 1 is still there.
  const one = await burst(FIRST);
  if (await again()) {
    const two = await burst(1);
    const reading = await landed(logs, tag, two.to);
    let lost = 0;
    for (let n = one.from; n <= one.to; n++) if (!reading.has(n)) lost++;
    if (!reading.has(two.to)) problems.push(`the restarted hub's first line, number ${two.to}, is not in the log: ${filesShown(reading)}`);
    if (lost) problems.push(`after the restart ${lost} of the ${one.lines} lines written before it are gone, the last one ${reading.has(one.to) ? 'still there' : 'among them'}, though logs/ holds ${mb(reading.bytes)} of its 64 MB: the lines written before a restart are kept up to the limit (${filesShown(reading)})`);
    // Three more starts' worth, 24 MiB each, a restart between them: 74 MiB in all, past the limit.
    await burst(EACH);
    if (await again()) {
      await burst(EACH);
      if (await again()) await burst(EACH);
    }
  }
  const reading = await landed(logs, tag, next - 1);
  const watched = watch.stop();
  const most = watched.peak.bytes > reading.bytes ? watched.peak : { bytes: reading.bytes, files: reading.files.length };
  console.log(`#3548 login service${plant ? ` (DEEP_HUB_PLANT=${plant})` : ''}: wrote ${mb(total)} in ${next - 1} lines; logs/ held ${mb(watched.peak.bytes)} at the largest of ${watched.samples} readings and ${mb(reading.bytes)} at the end: ${filesShown(reading)}`);
  if (problems.length === 0 && total < FIRST + 3 * EACH) problems.push(`the hub wrote ${mb(total)}, not the ${mb(FIRST + 3 * EACH)} of the run`);
  if (reading.planted === 0) problems.push(`the hub's log, under ${tidy(logs)}, holds no line the hub wrote: ${filesShown(reading)}`);
  // The planted hub, and the merge base, fail here, naming the folder's size.
  if (most.bytes > LOGS_LIMIT) problems.push(`logs/ holds ${mb(most.bytes)} in ${most.files} file${most.files === 1 ? '' : 's'} after four starts of the login service's hub wrote ${mb(total)} of lines; the limit is 64 MB (at most ${LOGS_LIMIT.toLocaleString('en-US')} bytes), at every reading, across a restart too`);
  if (reading.planted > 0 && !reading.has(next - 1)) problems.push(`the newest line, number ${next - 1}, is not in the log whole; the newest whole line there is number ${reading.last}`);
  if (reading.cut) problems.push(`${reading.cut} kept line${reading.cut === 1 ? ' is' : 's are'} cut, the first: ${JSON.stringify(reading.cutFirst[0])}`);
  if (reading.missing) problems.push(`${reading.missing} line${reading.missing === 1 ? ' is' : 's are'} missing between the oldest kept, number ${reading.first}, and the newest, number ${reading.last}, the first ${reading.missingFirst.join(', ')}: the oldest leave first`);
  return { up: true, why: '', problems };
}

describe(`${ID} the login service's hub holds logs/ to the limit across a restart`, () => {
  it(`${ID} on macOS the login service's hub keeps logs/ at or under 64 MB over four starts that write 74 MiB between them, and every line written before the first restart is still there after it`, async (ctx) => {
    if (process.platform !== 'darwin') ctx.skip(OTHER_SYSTEM);
    built();
    const r = await serviceRun();
    expect(r.up, `deep hub start installs the login service's definition and its hub answers deep hub status: ${r.why}`).toBe(true);
    // The merge base fails here, naming the folder's size: nothing cuts the log the definition names.
    expect(r.problems, 'what the run found wrong').toEqual([]);
  }, 1_800_000);

  it(`${ID} (wrong program) a hub that starts a new file at each start and keeps the old ones, DEEP_HUB_PLANT=${PLANT}, fails the same run, naming the folder's size`, async (ctx) => {
    if (process.platform !== 'darwin') ctx.skip(OTHER_SYSTEM);
    built();
    const r = await serviceRun(PLANT);
    // The merge base has no such planted program: its hub ends at its start, and the test fails here.
    expect(r.up, `the hub planted with DEEP_HUB_PLANT=${PLANT} starts as the login service and answers deep hub status: ${r.why}`).toBe(true);
    const sized = r.problems.filter((p) => p.startsWith('logs/ holds '));
    expect(sized, `the run names the folder's size, over the limit; it found: ${r.problems.join('\n') || 'nothing wrong'}`).toHaveLength(1);
  }, 1_800_000);
});

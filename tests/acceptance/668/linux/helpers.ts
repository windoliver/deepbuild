// #668's checkpoint on Linux (README): the macOS suite's home, fixture repo, CLI, record readings and every
// criterion's check, imported as they are from ../helpers.ts; what differs is only the platform under them. The
// launchd and systemctl stand-ins and the Keychain stand-in are taken out of the home, the test's own login is
// started (./platform.ts: a user manager, its session bus, the Secret Service, polkit's stand-in), `deep setup`
// installs and starts the real deepbuild-hub.service there, and the hub is stopped by that unit's main process.

import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AC1, AC4, HARNESS, NODE, REPO, SCENARIO, STATUS_PLANT, allCommits, allEvents, answers, cargoBuild, childEnv, claudeFolder, commitsBetween, deep, handCommit,
  hasDeepEntry, jsonLines, machine, makeHome, offOnProblems, proof, recordRows, recordedCommits, removeByHand, run, shown, snapshot, socketOf, terminal, waitFor,
  type Home, type Line, type Ran, type Repo, type SessionRun, type World,
} from '../helpers.ts';
import { UNIT, asksOf, distro, hubHealth, hubUp, linuxWorld, stopHub, unitProblems, type LinuxWorld } from './platform.ts';

/**
 * #668's home (../helpers.ts `makeHome`) on Linux: without the launchd and systemctl stand-ins, so `deep setup` reaches
 * the real systemctl and through it the test's own user manager, and without the Keychain stand-in. Claude Code keeps
 * its sign-in on Linux in `~/.claude/.credentials.json`, which the doctor reads the token's lifetime from where there is
 * no Keychain: written with a lifetime that outlives any run and no secret in it (the session signs in with
 * CLAUDE_CODE_OAUTH_TOKEN, which comes before a stored sign-in). Then the test's login, its variables set on every
 * process the test starts.
 */
export async function linuxHome(id: string, claude: string): Promise<{ h: Home; lx: LinuxWorld }> {
  const h = makeHome({ claude });
  for (const name of ['launchctl', 'systemctl']) rmSync(join(h.bin, name), { force: true });
  rmSync(h.keychain, { force: true });
  delete h.env.DEEP_HUB_TEST_KEYCHAIN;
  writeFileSync(join(h.home, '.claude', '.credentials.json'), JSON.stringify({ claudeAiOauth: { expiresAt: Date.UTC(2099, 0, 1) } }), { mode: 0o600 });
  const lx = await linuxWorld(id, { tmp: h.tmp, home: h.home, confirm: h.confirm, seams: { DEEP_HUB_TEST_CONFIRM: h.confirm } });
  Object.assign(h.env, lx.env);
  return { h, lx };
}

/** The harness's run of the scenario, as ../helpers.ts `harnessRun` runs it, with bash as your shell (Linux has no /bin/zsh by default). */
export async function harnessRunLinux(h: Home, repo: Repo, token: string): Promise<{ ran: Ran; line: Line | undefined }> {
  const args = [HARNESS, 'run', '--scenario', SCENARIO, '--workdir', repo.dir, '--pass-env', 'CLAUDE_CODE_OAUTH_TOKEN', '--claude', h.claude, '--timeout-ms', '600000', '--out', join(h.tmp, 'out')];
  const ran = await run(NODE, args, { env: childEnv(h, { SHELL: '/bin/bash', CLAUDE_CODE_OAUTH_TOKEN: token }), cwd: REPO, timeoutMs: 900_000, shownAs: `node ${args.slice(0, 7).join(' ')} …` });
  return { ran, line: jsonLines(ran.stdout).find((l) => typeof l.run === 'string' && 'verdict' in l) };
}

/** #668's world on Linux: the macOS checkpoint's, with the platform's readings beside it. */
export interface LinuxCheckpoint extends World {
  lx: LinuxWorld;
  /** The hub as the systemd user service right after `deep setup`, and `hub.health` then. */
  unit: { problems: string[]; text: string }; health: Record<string, unknown> | Error;
  /** The asks the hub showed polkit's stand-in for `deep off` and `deep on`, and for `deep setup --undo`. */
  asks: { offOn: string[]; undo: string[] };
}
/**
 * The checkpoint (../helpers.ts `checkpoint`, step for step), on Linux: after `deep setup` the hub must be the running
 * deepbuild-hub.service of the test's user manager, or the run fails naming AC1 (setup starts the hub through its
 * login service); the hub is stopped for AC4's removal by that unit's main process, by PID; polkit's asks are kept
 * around `deep off`, `deep on` and `deep setup --undo`.
 */
export async function checkpointLinux(folder: string, h: Home, lx: LinuxWorld, repo: Repo, session: (h: Home, repo: Repo) => Promise<SessionRun>, doctorEnv: Record<string, string>): Promise<LinuxCheckpoint> {
  const terminals: string[] = [];
  const settingsBefore = readFileSync(h.settings);
  proof(folder, 'settings-before.json', settingsBefore);
  const before = snapshot(repo.dir);
  await cargoBuild();
  const setup = await deep(h, ['setup'], { cwd: repo.dir });
  terminals.push(terminal(setup));
  proof(folder, 'terminal.txt', terminals.join('\n'));
  if (setup.code !== 0) throw Error(`${AC1} deep setup must exit 0, install DeepBuild beside your settings and start the hub as the systemd user service ${UNIT}: ${shown(setup)}; ${(await unitProblems(lx, socketOf(h))).text.slice(0, 2500)}`);
  await hubUp(lx, socketOf(h));
  const unit = await unitProblems(lx, socketOf(h));
  proof(folder, 'systemd.txt', unit.text);
  if (unit.problems.length) throw Error(`${AC1} on Linux deep setup starts the hub through its login service, a systemd user service: ${unit.problems.join('; ')}`);
  const health = await hubHealth(socketOf(h), join(h.root, 'control.token')).catch((error: Error) => error);
  proof(folder, 'hub-health.json', health instanceof Error ? { error: health.message } : health);
  const settingsAfterSetup = readFileSync(h.settings, 'utf8');
  proof(folder, 'settings-after-setup.json', settingsAfterSetup);
  const afterSetup = snapshot(repo.dir);
  const ran = await session(h, repo);
  terminals.push(...ran.terminal, ...ran.whileRunning.map(terminal));
  proof(folder, 'terminal.txt', terminals.join('\n'));
  try { proof(folder, 'transcript.jsonl', readFileSync(ran.transcript)); } catch { /* none */ }
  const made = commitsBetween(h, repo, repo.base);
  const hand = handCommit(h, repo);
  const others = allCommits(h, repo).filter((c) => !made.some((m) => m.sha === c.sha));
  await waitFor(async () => {
    const events = await allEvents(h);
    return events.some((e) => e.session === ran.id && e.kind === 'agent.stop') && made.every((c) => recordedCommits(events, ran.id).includes(c.sha));
  }, 60_000);
  const events = await allEvents(h);
  const sessions = [...new Set(events.map((e) => e.session).filter((s): s is string => typeof s === 'string'))];
  proof(folder, 'record.json', await recordRows(h, ran.id));
  try { proof(folder, 'my-hook.log', readFileSync(h.myLog)); } catch { /* none */ }
  const statusStopped = await deep(h, ['status'], { cwd: repo.dir });
  const statusPlanted = await deep(h, ['status'], { cwd: repo.dir, env: { DEEP_HUB_PLANT: STATUS_PLANT } });
  terminals.push(terminal(statusStopped), `DEEP_HUB_PLANT=${STATUS_PLANT} ${terminal(statusPlanted)}`);
  const doctor = await deep(h, ['doctor', '--prompt', '--json'], { cwd: repo.dir, env: doctorEnv });
  terminals.push(terminal(doctor));
  let removal: World['removal'];
  try {
    if (!hasDeepEntry(h, 'PreToolUse')) throw Error(`BLOCKED: ${AC4} deep setup wrote no PreToolUse entry of DeepBuild's to remove by hand: ${readFileSync(h.settings, 'utf8').slice(0, 1500)}`);
    // The hub puts back an entry of DeepBuild's removed while it runs (#18), so you take it out with the hub stopped.
    await stopHub(lx, socketOf(h));
    removeByHand(h, 'PreToolUse');
    const missing = await deep(h, ['doctor', '--json'], { cwd: repo.dir, env: doctorEnv });
    terminals.push(`(DeepBuild's PreToolUse entry removed by hand from ${h.settings}, the hub stopped by its unit's MainPID)\n${terminal(missing)}`);
    const fix = await deep(h, ['setup'], { cwd: repo.dir });
    await waitFor(() => answers(socketOf(h)), 30_000);
    const back = hasDeepEntry(h, 'PreToolUse');
    const fixed = await deep(h, ['doctor', '--json'], { cwd: repo.dir, env: doctorEnv });
    terminals.push(terminal(fix), terminal(fixed));
    removal = { missing, fix, back, fixed };
  } catch (error) {
    removal = { error: error as Error };
  }
  proof(folder, 'terminal.txt', terminals.join('\n'));
  const asked = asksOf(lx).length;
  let offOn: World['offOn'];
  try { offOn = await offOnProblems(h, repo); } catch (error) { offOn = { error: error as Error }; }
  const offOnAsks = asksOf(lx).slice(asked);
  terminals.push('error' in offOn ? `deep off and deep on: ${offOn.error.message}` : offOn.proof);
  const claudeAtEnd = claudeFolder(snapshot(repo.dir));
  const beforeUndo = asksOf(lx).length;
  const undo = await deep(h, ['setup', '--undo'], { cwd: repo.dir });
  const undoAsks = asksOf(lx).slice(beforeUndo);
  terminals.push(terminal(undo));
  proof(folder, 'terminal.txt', terminals.join('\n'));
  proof(folder, 'polkit-asks.log', `${asksOf(lx).join('\n')}\n`);
  let settingsAfterUndo: Buffer | undefined;
  try { settingsAfterUndo = readFileSync(h.settings); } catch { settingsAfterUndo = undefined; }
  proof(folder, 'settings-after-undo.json', settingsAfterUndo ?? '(no file)');
  proof(folder, 'machine.txt', `${distro()}; ${machine()}\n`);
  return {
    h, repo, folder, settingsBefore, settingsAfterSetup, settingsAfterUndo, setup, session: ran,
    repoSnaps: { before, afterSetup, claudeAtEnd }, made, hand, others, events, sessions, statusStopped, statusPlanted, doctor, removal, offOn, undo,
    lx, unit, health, asks: { offOn: offOnAsks, undo: undoAsks },
  };
}

/** AC4 on Linux, beside the doctor's items: the hub its systemd unit started reaches the secret store, the Secret Service on the session bus, as `hub.health` reads it. */
export function secretStoreProblems(w: LinuxCheckpoint): string[] {
  if (w.health instanceof Error) return [`${AC4} on Linux the hub's health must be readable after deep setup, to read its secret store: ${w.health.message}`];
  return w.health.secrets === 'reachable' ? [] : [`${AC4} on Linux the hub, as its systemd user service started it, must reach the secret store, the Secret Service on the session bus: hub.health reads secrets ${JSON.stringify(w.health.secrets)}`];
}

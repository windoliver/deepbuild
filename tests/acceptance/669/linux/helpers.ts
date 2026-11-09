// #669's checkpoint on Linux (README): the macOS suite's home, fixture repo and its variants, CLI, session driver,
// record readings and every criterion's check, imported as they are from ../helpers.ts; the Linux platform from
// #668's Linux twin (../../668/linux/platform.ts: the test's own user manager, its session bus, the Secret Service,
// polkit's stand-in, bubblewrap's prerequisites and the watch that reads whether a check ran inside it). What differs
// from macOS is only the platform: `deep setup` installs the hub as deepbuild-hub.service of the test's user manager,
// a hub restart is SIGTERM to that unit's main process and `systemctl --user start`, and each check's processes are
// read for bubblewrap.

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  Drive, HARNESS, NODE, REPO, SCENARIO, STATUS_QUESTION, allEvents, built, checkout, childEnv, claimRef, claimsOf, deep, hubLog, judged, jsonLines, loaded,
  machine, makeHome, proof, run, runsOf, shown, socketOf, verdictsOf, waitFor,
  type Ev, type Home, type Line, type Ran, type Repo, type Reply, type SideRun, type Variant,
} from '../helpers.ts';
import { distro, hubUp, linuxWorld, restartHub, sandboxWatch, unitProblems, type LinuxWorld, type Sighting } from '../../668/linux/platform.ts';

/** A check's processes, as the watch reads them: Vitest, which the approved check `npm test` runs. */
export const CHECK_PROCESS = /vitest/;

/**
 * #669's home (../helpers.ts `makeHome`) on Linux: without the launchd and systemctl stand-ins, so `deep setup` reaches
 * the real systemctl and through it the test's own user manager, and without the Keychain stand-in; then the test's
 * login, whose user manager hands the home's test seams (the handed definition, polkit's stand-in) to the hub.
 */
export async function linuxHome(id: string, o: { claude?: string; fast?: boolean }): Promise<{ h: Home; lx: LinuxWorld }> {
  const h = makeHome({ ...(o.claude ? { claude: o.claude } : {}), ...(o.fast ? { fast: true } : {}) });
  for (const name of ['launchctl', 'systemctl']) rmSync(join(h.bin, name), { force: true });
  rmSync(join(h.tmp, 'keychain.json'), { force: true });
  delete h.env.DEEP_HUB_TEST_KEYCHAIN;
  const confirm = h.env.DEEP_HUB_TEST_CONFIRM;
  if (!confirm) throw Error(`BLOCKED: ${id} #669's home names no confirmation seam to stand polkit in at`);
  const seams = Object.fromEntries(Object.entries(h.env).filter(([k]) => k.startsWith('DEEP_HUB_TEST_')));
  const lx = await linuxWorld(id, { tmp: h.tmp, home: h.home, confirm, seams });
  Object.assign(h.env, lx.env);
  return { h, lx };
}

/** `deep setup` in the checkout (#668's checkpoint, which this one depends on) and the hub running as its systemd user service; BLOCKED when either isn't. */
export async function setUpLinux(h: Home, lx: LinuxWorld, repo: Repo): Promise<{ setup: Ran; unit: string }> {
  await built();
  const setup = await deep(h, ['setup'], { cwd: repo.dir });
  if (setup.code !== 0) throw Error(`BLOCKED: #669 deep setup must exit 0 and start the hub as the systemd user service (#668's checkpoint): ${shown(setup)}; ${(await unitProblems(lx, socketOf(h))).text.slice(0, 2500)}`);
  await hubUp(lx, socketOf(h));
  const unit = await unitProblems(lx, socketOf(h));
  if (unit.problems.length) throw Error(`BLOCKED: #669 the hub deep setup started must run as its systemd user service (#668's checkpoint, #70): ${unit.problems.join('; ')}`);
  return { setup, unit: unit.text };
}

/** The harness's run of the scenario, as ../helpers.ts `harnessRun` runs it, with bash as your shell (Linux has no /bin/zsh by default). */
export async function harnessRunLinux(h: Home, repo: Repo, token: string): Promise<{ ran: Ran; line: Line | undefined }> {
  const args = [HARNESS, 'run', '--scenario', SCENARIO, '--workdir', repo.dir, '--pass-env', 'CLAUDE_CODE_OAUTH_TOKEN', '--claude', h.claude, '--timeout-ms', '1200000', '--out', join(h.tmp, 'out')];
  const ran = await run(NODE, args, { env: childEnv(h, { SHELL: '/bin/bash', CLAUDE_CODE_OAUTH_TOKEN: token }), cwd: REPO, timeoutMs: 1_500_000, shownAs: `node ${args.slice(0, 7).join(' ')} …` });
  return { ran, line: jsonLines(ran.stdout).find((l) => typeof l.run === 'string' && 'verdict' in l) };
}

// ---- AC3's and AC6's worlds on Linux (../helpers.ts `sideWorld`, the restart the Linux one).
const eventsNow = (h: Home): Promise<Ev[]> => allEvents(h).catch(() => []);
/** A side run, with the check processes the watch saw while it ran. */
export interface LinuxSideWorld { zero: SideRun | { error: Error }; masked: SideRun | { error: Error }; cut: SideRun | { error: Error }; seen: Record<Variant, Sighting[]> }
function sideProof(folder: string, variant: Variant, o: { d: Drive; events: Ev[]; terminals: string[]; seen: Sighting[] }): void {
  const claims = claimsOf(o.events, o.d.id);
  if (existsSync(o.d.transcript)) proof(folder, `${variant}-transcript.jsonl`, readFileSync(o.d.transcript));
  proof(folder, `${variant}-chat.json`, o.d.replies.map((r: Reply) => ({ event: r.event, lines: r.lines, reply: r.json ?? r.stdout })));
  proof(folder, `${variant}-record.json`, {
    claims: claims.map((c) => ({ id: claimRef(c), commit: c.data.commit, task: c.data.task_ref })),
    verdicts: claims.flatMap((c) => verdictsOf(o.events, c).map((v) => ({ id: v.id, claim: claimRef(c), outcome: v.data.outcome, commit: judged(v), reasons: v.data.reasons }))),
    runs: claims.flatMap((c) => runsOf(o.events, c)),
    events: o.events.filter((e) => e.session === o.d.id),
  });
  proof(folder, `${variant}-terminal.txt`, `${o.terminals.join('\n')}\n`);
  proof(folder, `${variant}-sandbox.json`, o.seen);
}
/** One of AC3's and AC6's sessions, as ../helpers.ts runs it: one stop on a variant, "all done?" after its verdict landed; the slow one's check cut short by a Linux hub restart. */
async function sideRun(h: Home, lx: LinuxWorld, variant: Variant, folder: string, seen: Record<Variant, Sighting[]>): Promise<SideRun> {
  const repo = checkout(h, variant);
  const watch = sandboxWatch(lx, CHECK_PROCESS);
  const d = await Drive.open(h, repo);
  const terminals: string[] = [];
  try {
    const known = new Set(claimsOf(await eventsNow(h), d.id).map((c) => c.id));
    let restart: string | undefined;
    let cutClaim: Ev | undefined;
    let stop: { reply: Reply | undefined };
    if (variant === 'slow') {
      await d.fix();
      const stopping = d.stopOnly('Done: the coupon discount is fixed.', false);
      const started = await waitFor(async () => {
        const events = await eventsNow(h);
        const claim = claimsOf(events, d.id).find((c) => !known.has(c.id));
        return claim && runsOf(events, claim).some((r) => r.outcome === null) ? claim : undefined;
      }, 120_000);
      if (!started) throw Error(`BLOCKED: #669 no run of the claim's check started within 120 s of the stop, so there was nothing for a hub restart to cut short: ${(await eventsNow(h)).filter((e) => e.session === d.id).map((e) => e.kind).join(', ')}`);
      cutClaim = started;
      // Let the watch see the slow check's processes before the restart cuts them short.
      await new Promise((resolve) => setTimeout(resolve, 2000));
      restart = await restartHub(lx, socketOf(h));
      stop = await stopping;
      if (!(await waitFor(() => allEvents(h).then(() => true, () => false), 180_000))) {
        const status = await deep(h, ['status'], { cwd: repo.dir, timeoutMs: 60_000 });
        restart += `(the record can't be read 3 min after the restart; ${loaded() || 'the machine not loaded past its cores'}; deep status then: ${shown(status)}; the hub's log ${JSON.stringify(hubLog(h))})\n`;
      }
    } else {
      await d.bash('npm test');
      stop = await d.stopOnly('Done: the coupon test is fixed.', false);
    }
    const claim = cutClaim ?? await d.claimAfter(known, 60_000);
    if (!claim) throw Error(`BLOCKED: #669 the ${variant} world's stop made no claim: ${(await allEvents(h)).filter((e) => e.session === d.id).map((e) => e.kind).join(', ')}`);
    await waitFor(async () => verdictsOf(await eventsNow(h), claim).length > 0, 180_000);
    const allDone = await d.typed(STATUS_QUESTION);
    await d.end();
    const events = variant === 'slow' ? await eventsNow(h) : await allEvents(h);
    seen[variant] = await watch.stop();
    terminals.push(`(stop) ${JSON.stringify(stop.reply?.json ?? null)}`, ...(restart ? [`(hub restarted)\n${restart}`] : []), `(${STATUS_QUESTION}) ${JSON.stringify(allDone?.json ?? null)}`);
    sideProof(folder, variant, { d, events, terminals, seen: seen[variant] });
    return { variant, d, stop, claim, allDone, events, ...(restart ? { restart } : {}) };
  } catch (error) {
    seen[variant] = await watch.stop();
    sideProof(folder, variant, { d, events: await eventsNow(h), terminals, seen: seen[variant] });
    throw error;
  }
}
/** AC3's and AC6's worlds, one home and hub, as ../helpers.ts `sideWorld` runs them: zero tests, a masked exit, and a check cut short by a hub restart (last). */
export async function sideWorldLinux(folder: string): Promise<LinuxSideWorld> {
  const { h, lx } = await linuxHome('#669', { fast: true });
  const { unit } = await setUpLinux(h, lx, checkout(h, 'main'));
  proof(folder, 'side-systemd.txt', unit);
  const seen: Record<Variant, Sighting[]> = { main: [], 'zero-tests': [], masked: [], slow: [] };
  const tryRun = async (variant: Variant) => { try { return await sideRun(h, lx, variant, folder, seen); } catch (error) { return { error: error as Error }; } };
  const zero = await tryRun('zero-tests');
  const masked = await tryRun('masked');
  const cut = await tryRun('slow');
  proof(folder, 'machine.txt', `${distro()}; ${machine()}\n`);
  return { zero, masked, cut, seen };
}

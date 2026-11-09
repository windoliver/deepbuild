// AC5 #70.7f24fc90: on a filesystem without copy-on-write, a destructive command whose reach can't be known becomes an
// ask.
//
// The file system is tmpfs at /dev/shm, the one real no-copy-on-write file system both distributions give an
// unprivileged user: HOME, the hub's root and the worktree all sit there, so a clone can't fail for crossing a device,
// and a control reads `cp --reflink=always` failing there first. The commands are the design's two examples, a glob
// over a folder and an agent-written script, each through setup's PreToolUse entry to the real hub, its `build/` ignored
// so git can't restore it. The ask isn't answered.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AC5, allEvents, callId, cleanup, failure, notBlocked, payload, requireLinux, sleep, tag, world, type Ev, type HookRun, type World,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const NO_COW = '/dev/shm';
const GLOB = 'rm -rf build/*';
const SCRIPT = 'bash wipe.sh';
const WIPE = '#!/bin/sh\n# Clear the build output before a fresh build.\nset -eu\nOUT=build\nrm -rf "$OUT"/*\n';
const REACH_UNKNOWN = /\breach\b[^.?!]*\b(unknown|not known|can(?:'|no|’)t be (?:known|worked out))|\bunknown reach\b/i;
/** deep-hook's own words when it decides without the hub (crates/deep-hook `forward`, `watchdog`), as #347's suite reads them. */
const ALONE = /which holds while the hub doesn't answer|^deep-hook: (?:spooled|could not spool)|deep-hook couldn't read/m;
const TRIES = 5;

/** The control: this file system refuses a reflink, or the test would read nothing. */
function requireNoCow(dir: string): void {
  const a = join(dir, `cow-${tag()}`);
  writeFileSync(a, 'control\n');
  const cloned = spawnSync('cp', ['--reflink=always', a, `${a}.clone`], { encoding: 'utf8' });
  rmSync(a, { force: true });
  rmSync(`${a}.clone`, { force: true });
  if (cloned.status === 0) throw Error(`BLOCKED: ${dir} made a reflink, so it isn't a file system without copy-on-write`);
}
const denied = (r: HookRun): boolean => {
  if (r.code === 2) return true;
  const said = (() => { try { return JSON.parse(r.stdout.trim()) as { hookSpecificOutput?: { permissionDecision?: string }; decision?: string }; } catch { return undefined; } })();
  return said?.hookSpecificOutput?.permissionDecision === 'deny' || said?.decision === 'block';
};

/** The folder the commands reach: files named for this world, each with its own bytes. */
function fill(w: World): { dir: string; digest(): string } {
  const dir = join(w.worktree, 'build');
  mkdirSync(dir);
  for (let i = 0; i < 20; i++) writeFileSync(join(dir, `obj-${i}.dat`), `${tag(32)}\n`);
  return { dir, digest: () => createHash('sha256').update(readdirSync(dir).sort().map((f) => `${f}:${readFileSync(join(dir, f), 'utf8')}`).join('')).digest('hex') };
}

/** The agent writes wipe.sh with its Write tool, through the hooks, so the script is one this session wrote. */
async function agentWrites(w: World): Promise<void> {
  const file = join(w.worktree, 'wipe.sh');
  const input = { file_path: file, content: WIPE };
  const id = callId();
  await w.claude.hook('PreToolUse', payload(w.s, 'PreToolUse', { tool_name: 'Write', tool_input: input, tool_use_id: id }));
  writeFileSync(file, WIPE);
  await w.claude.hook('PostToolUse', payload(w.s, 'PostToolUse', { tool_name: 'Write', tool_input: input, tool_use_id: id, tool_response: { type: 'create', filePath: file } }));
}

/**
 * The agent's `command` isn't let through, and the record holds an authority ask naming it whose words say its reach is
 * unknown, no staging, and the folder as it was. A reply deep-hook made alone, the hub late under load, is tried again.
 */
async function expectAsked(w: World, command: string, folder: { digest(): string }): Promise<Ev> {
  const before = folder.digest();
  const since = (await allEvents(w.hub)).at(-1)?.log_pos ?? 0;
  let runs: HookRun[] = [];
  let id = '';
  for (let i = 0; i < TRIES; i++) {
    id = callId();
    runs = await w.claude.hook('PreToolUse', payload(w.s, 'PreToolUse', { tool_name: 'Bash', tool_input: { command, description: command }, tool_use_id: id }));
    if (!runs.length) throw Error('BLOCKED: no entry of DeepBuild\'s ran for the PreToolUse');
    if (!runs.some((r) => ALONE.test(r.stderr))) break;
    await sleep(500);
    if (i === TRIES - 1) throw Error(`INCONCLUSIVE: in ${TRIES} tries the hub never decided \`${command}\` (deep-hook decided alone); the machine is too loaded to read this`);
  }
  if (!runs.some(denied)) throw Error(`${AC5} \`${command}\` was let through with no ask on a file system without copy-on-write: ${JSON.stringify(runs.map((r) => [r.code, r.stdout.slice(0, 300)]))}`);
  const events = await allEvents(w.hub, since);
  const ask = events.find((e) => e.kind === 'ask.created' && String(e.data?.question).includes(command));
  expect(ask, `${AC5} \`${command}\` must become an ask: nothing asked names it; the hook said ${JSON.stringify(runs.map((r) => r.stdout.slice(0, 300)))}`).toBeDefined();
  expect(ask!.data.kind, `${AC5} the ask for \`${command}\` is an authority ask`).toBe('authority');
  expect(String(ask!.data.question), `${AC5} the ask for \`${command}\` says its reach is unknown`).toMatch(REACH_UNKNOWN);
  expect(events.filter((e) => e.kind === 'command.staged').map((e) => e.id), `${AC5} nothing can be staged here, so \`${command}\` must record no staging`).toEqual([]);
  expect(folder.digest(), `${AC5} the ask for \`${command}\` leaves build/ as it was`).toBe(before);
  return ask!;
}

async function scenario(plant?: string): Promise<void> {
  requireLinux();
  const w = await world({ plant, under: NO_COW });
  requireNoCow(w.worktree);
  const folder = fill(w);
  await expectAsked(w, GLOB, folder);
  await agentWrites(w);
  await expectAsked(w, SCRIPT, folder);
}

describe(`${AC5} On a filesystem without copy-on-write, a destructive command whose reach can't be known becomes an ask`, () => {
  it(`${AC5} on tmpfs, \`${GLOB}\` and the agent-written \`${SCRIPT}\` each become an authority ask that says their reach is unknown, nothing is staged and build/ keeps its files`, () => scenario(), 600_000);

  it(`${AC5} (wrong program) a hub that records a staging it can't have made (stages-without-copy) lets the command through and fails, naming it`, async () => {
    const message = await failure(() => scenario('stages-without-copy'));
    notBlocked(message);
    expect(message).toContain(`\`${GLOB}\` was let through with no ask`);
  }, 600_000);
});

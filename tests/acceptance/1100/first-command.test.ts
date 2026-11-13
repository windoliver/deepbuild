// AC8, AC9, AC11 and AC12: the first `deep` command in a fresh home, through the built CLI with HOME a fixture machine's
// (Claude Code and Codex installed), the hub started by the login service stand-in. AC8's hub has its wiki folder made one
// nobody may write before it starts, so the wiki read setup asks for is refused; its wrong program is the merge base.
// AC9 fires a fixture session's Bash call through the hook entries setup wrote (#19's Claude Code stand-in); AC11 has
// `paseo` on the PATH, which setup reports on, and pipes the command through `cat`; AC12 runs a scratch copy of the
// checkout with nothing built, whose `cargo` takes 5 s to build deep-hook. Their wrong programs are CLI plants selected by
// DEEP_HUB_PLANT (README, Pinned 7).
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { callId, Claude, cleanup as cleanup19, denied, firedShown, newSession, ours, payload, toolCall, typedPrompt } from '../19/setup/helpers.ts';
import {
  blocked, buildHook, cleanup, deep, guardLineFailures, hubAnswers, ID, lines, makeHome, MIN, notTheList, PLANT, said, scratchCheckout, setUpLine,
  shippedEntries, shown, statusThroughCat, timedLines, type Ran,
} from './helpers.ts';

afterAll(async () => { await cleanup19(); await cleanup(); }, 120_000);

describe(`AC8 ${ID.firstCommand} the set-up line, whatever setup's exit code`, () => {
  it(`AC8 ${ID.firstCommand}: in a fresh home with a hub whose wiki read is refused, the first deep status prints the set-up line naming deep setup --undo on stderr, then the session list`, async () => {
    const h = makeHome({ hub: 'wiki-refused' });
    const first = await deep(h, ['status']);
    const later = await deep(h, ['status']);
    const failures: string[] = [];
    const line = timedLines(first, 'stderr').find((l) => l.text.includes('deep setup --undo'));
    if (!line) failures.push(`the first deep status's stderr names no undo (deep setup --undo): ${shown(first)}`);
    const listAt = first.chunks.find((c) => c.stream === 'stdout')?.at;
    if (listAt === undefined) failures.push(`the first deep status printed no session list, so the command you typed didn't run: ${shown(first)}`);
    else if (line && listAt < line.at) failures.push(`the first deep status printed the session list ${line.at - listAt} ms before the set-up line`);
    for (const l of notTheList(first.stdout, later.stdout)) failures.push(`the first deep status printed a line on stdout that isn't the session list ${said(lines(later.stdout))}: ${said(l)}`);
    expect(failures).toEqual([]);
  }, 30 * MIN);
});

/** The first deep command, then a fixture session's `pkill -f vite`, which the shipped guard entry no-kill-by-name blocks. */
async function guardRun(plant?: string): Promise<string[]> {
  const h = makeHome();
  const first = await deep(h, ['status'], plant ? { plant } : {});
  if (!(await hubAnswers(h))) blocked(`after the first deep command no hub answers: ${shown(first)}`);
  const repo = join(h.tmp, 'shop');
  mkdirSync(repo);
  const claude = Claude.start(h.home);
  const s = newSession(h.home, repo);
  await claude.hook('SessionStart', payload(s, 'SessionStart'));
  typedPrompt(s, 'Stop the dev server.');
  await claude.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: 'Stop the dev server.' }));
  const command = 'pkill -f vite';
  const id = callId();
  toolCall(s, id, 'Bash', { command, description: command });
  const fired = await claude.hook('PreToolUse', payload(s, 'PreToolUse', { tool_name: 'Bash', tool_input: { command, description: command }, tool_use_id: id }));
  if (!denied(fired)) return [`after setup the session's ${command}, which the shipped guard entry no-kill-by-name blocks, went through: ${firedShown(fired)}`];
  const reply = ours(fired).map((r) => `${r.stdout}\n${r.stderr}`).join('\n');
  const entry = shippedEntries().map((e) => e.name).find((name) => reply.includes(name)) ?? 'no-kill-by-name';
  return guardLineFailures(setUpLine(first) ?? lines(first.stderr)[0], entry);
}

describe(`AC9 ${ID.guards} the set-up line says the guard entries block`, () => {
  it(`AC9 ${ID.guards}: after setup a fixture session's call that a shipped guard entry blocks is blocked, and the set-up line says the guard entries block, with how many the shipped list holds`, async () => {
    expect(await guardRun()).toEqual([]);
  }, 30 * MIN);

  it(`AC9 ${ID.guards} wrong program: a set-up line that says nothing blocks fails, naming the entry that did`, async () => {
    expect((await guardRun(PLANT.saysNothingBlocks)).join('\n')).toMatch(/yet no-kill-by-name blocked/);
  }, 30 * MIN);
});

/** The first `deep status | cat` with paseo on the PATH: the lines of its stdout that aren't the session list. */
async function stdoutRun(plant?: string): Promise<string[]> {
  const h = makeHome({ paseo: true });
  const first = await statusThroughCat(h, plant ? { plant } : {});
  const later = await statusThroughCat(h);
  if (setUpLine(later)) blocked(`the first deep status | cat didn't finish setup, so a later one sets up again and its list can't be told apart: ${shown(first)}; later ${shown(later)}`);
  if (!lines(later.stdout).length) blocked(`a later deep status | cat prints no session list: ${shown(later)}`);
  return notTheList(first.stdout, later.stdout).map((l) => `the first deep status | cat printed a line that isn't the session list: ${said(l)}`);
}

describe(`AC11 ${ID.stdout} only the session list on stdout`, () => {
  it(`AC11 ${ID.stdout}: with paseo on the PATH, which setup reports on, the first deep status | cat holds only the session list`, async () => {
    expect(await stdoutRun()).toEqual([]);
  }, 30 * MIN);

  it(`AC11 ${ID.stdout} wrong program: a set-up line written to stdout fails, naming the line`, async () => {
    expect((await stdoutRun(PLANT.lineToStdout)).join('\n')).toMatch(/isn't the session list: ".*deep setup --undo/);
  }, 30 * MIN);
});

/** A line naming the build step: it says what is built, the hook program. */
const NAMES_STEP = (text: string): boolean => /\b(build|compil)/i.test(text) && /hook/i.test(text);
/** The first command from a scratch copy with nothing built, whose `cargo` takes 5 s to build deep-hook. */
async function slowStepRun(plant?: string): Promise<string[]> {
  const hook = await buildHook();
  const copy = scratchCheckout();
  const h = makeHome({ cargo: hook });
  const first: Ran = await deep(h, ['status'], { cli: join(copy, 'packages/cli/dist/main.js'), ...(plant ? { plant } : {}) });
  const log = existsSync(h.cargoLog) ? lines(readFileSync(h.cargoLog, 'utf8')) : [];
  const end = log.find((l) => l.startsWith('end '));
  if (!log.some((l) => l.startsWith('start ')) || !end) blocked(`the first command ran no build of deep-hook, so there was no 5 s step: cargo logged ${said(log)}; ${shown(first)}`);
  const endAt = Number(end!.split(' ')[1]);
  const naming = timedLines(first, 'stderr').filter((l) => NAMES_STEP(l.text));
  if (!naming.length) return [`the first command printed no line naming the step (cargo build -p deep-hook, 5 s) before it ended: its stderr ${said(first.stderr, 1500)}`];
  const out: string[] = [];
  if (naming.length > 1) out.push(`the first command named the step ${naming.length} times, not once: ${said(naming.map((l) => l.text), 800)}`);
  if (naming[0]!.at > endAt) out.push(`the first command named the step (cargo build -p deep-hook) ${naming[0]!.at - endAt} ms after it ended: ${said(naming[0]!.text)}`);
  return out;
}

describe(`AC12 ${ID.slowStep} a slow step says what it's doing`, () => {
  it(`AC12 ${ID.slowStep}: with a build step that takes 5 s, the first command prints one line naming the step before it ends`, async () => {
    expect(await slowStepRun()).toEqual([]);
  }, 30 * MIN);

  it(`AC12 ${ID.slowStep} wrong program: a planted silent step fails, naming it`, async () => {
    expect((await slowStepRun(PLANT.silentSteps)).join('\n')).toMatch(/no line naming the step \(cargo build -p deep-hook, 5 s\)/);
  }, 30 * MIN);
});

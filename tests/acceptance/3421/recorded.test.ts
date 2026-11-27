// #3421 AC1: deep-hook's replies for #316's recorded calls are byte for byte the merge base's.
//
// The calls are the ones #316's suite holds in its files (README, "#316's recorded calls"): every call its AC1 to AC8
// tests make, and each default entry's planted call with the four mention shapes from its corpus. They are made
// through that suite's own surface (tests/acceptance/316/helpers.ts): its homes with the shipped default entries
// installed as rules.json, its sessions and payloads, its real git checkouts and symlinks, its `hook` runner and its
// real hub (`deep hub run`).
//
// Each call is made by two binaries in one world (same home, session, folders and hub): the merge base's deep-hook,
// built from the pinned base commit, and this checkout's. A reply is what the agent reads: the exit code and the bytes
// of stdout and stderr. Each call is made twice over: with the hub stopped, where deep-hook answers by itself, and with
// the hub up, where it reads the hub's acknowledgement and reply, the two lines this issue changes the reading of.
//
// One call's reply can take more than one form by the machine's timing, in either binary. With the hub up, a busy hub
// can miss the 20 ms it has to acknowledge, and deep-hook then answers as it does with the hub stopped. With the hub
// away, deep-hook adds a line to stderr when a busy disk didn't sync its spooled request in the hook's time. So the two
// binaries make each call in turn, up to eight times each, until a reply of one is byte for byte a reply of the other;
// a call with no such pair after eight fails, naming the call. With the hub up, once either binary has shown the hub's
// own reply (one that isn't the call's hub-stopped reply), only the hub's own reply counts. A ULID in a reply is
// compared as a ULID, not by its characters: deep-hook mints the event's ID anew at each run, and its spool line
// names it.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import {
  addWorktree, bash, cleanup as cleanup316, edit, gitDirOf, hook, installDefaults, link, makeHome, makeRepo, newSession,
  startHub, stopHub, write, type Line, type Ran, type Session,
} from '../316/helpers.ts';
import { BASE, buildBase, buildChange, loadNow } from './helpers.ts';

afterAll(cleanup316, 120_000);

interface Call { name: string; body(s: Session): Line }
interface World { name: string; home: string; session: Session; calls: Call[] }
const shell = (command: string, extra: Line = {}): Call => ({ name: command.replace(/\n/g, '⏎'), body: (s) => bash(s, command, extra) });

// ---- #316's calls, world by world as its files make them.
/** blocked.test.ts (AC1, AC4, AC7), dispatch.test.ts (AC5) and corpus.test.ts's kill and dispatch entries: a plain session. */
function plainWorld(): World {
  const home = makeHome();
  installDefaults(home);
  const dispatch = 'gh workflow run deploy.yml --ref release-1 -f env=prod -f tag=v1';
  return {
    name: 'a plain session', home, session: newSession(home),
    calls: [
      'pkill -f node', 'echo hi',
      'killall node', 'fuser -k 8080/tcp', 'kill-port 3000', 'lsof -t -i:3000 | xargs kill', 'pgrep -f node | xargs kill -9',
      'for p in $(pgrep -f node); do kill "$p"; done', 'env killall node', 'sudo pkill -f node', "bash <<'EOF'\npkill -f node\nEOF",
      'lsof -i:3000', 'pgrep -f node',
      "rg 'pkill' src/", "git commit -m 'remove the pkill call'", "cat > notes.txt <<'EOF'\npkill -f node\nkillall x\nEOF",
      dispatch, 'gh api repos/acme/app/actions/workflows/deploy.yml/dispatches -f ref=release-1',
      `curl -X POST -H 'Accept: application/vnd.github+json' https://api.github.com/repos/acme/app/actions/workflows/deploy.yml/dispatches -d '{"ref":"release-1"}'`,
      'gh run rerun 123456',
      // corpus.test.ts: the dispatch entry's planted call, and the kill entry's words as an argument, a quoted string,
      // a comment and a heredoc written to a file.
      'gh workflow run deploy.yml --ref main',
      'echo pkill -f node', "rg 'pkill -f node' .", 'true  # pkill -f node', "cat > notes.txt <<'EOF'\npkill -f node\nEOF",
    ].map((command) => shell(command)),
  };
}
/** git.test.ts (AC2, AC6) and corpus.test.ts's stash and other-checkout entries: a session in a real worktree. */
function gitWorld(): World {
  const home = makeHome();
  installDefaults(home);
  const repo = makeRepo();
  const w1 = addWorktree(repo, 'w1');
  const w2 = addWorktree(repo, 'w2');
  const main = repo.dir;
  const gitDir = gitDirOf(repo);
  return {
    name: 'a session in a worktree', home, session: newSession(home, w1),
    calls: [
      shell('git stash'), shell(`git -C ${w2} status`), shell('git stash push -m wip-tag'), shell('git status'), shell('git stash pop'),
      shell(`cd ${main} && git status`), shell(`git --git-dir=${gitDir} --work-tree=${main} status`), shell(`git --git-dir=${gitDir} log -1`),
      shell(`GIT_DIR=${gitDir} git status`), shell(`git -C ${main} status`, { agent_id: 'ad649ec810ae38d1e', agent_type: 'general-purpose' }),
      shell(`git -C ${w1} status`), shell('git log -1'), shell(`git -C ${main} status`),
    ],
  };
}
/** config.test.ts (AC3) and corpus.test.ts's agent-config entry: the agents' config files and a skills folder. */
function configWorld(): World {
  const home = makeHome();
  installDefaults(home);
  const session = newSession(home);
  const codex = join(home, '.codex', 'config.toml');
  const claude = join(home, '.claude', 'settings.json');
  const skill = join(home, '.claude', 'skills', 'mine', 'SKILL.md');
  const ordinary = join(session.cwd, 'notes.md');
  for (const f of [codex, claude, skill, ordinary]) { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, ''); }
  return {
    name: 'a session beside agent config files', home, session,
    calls: [
      { name: 'Edit ~/.claude/settings.json', body: (s) => edit(s, claude) },
      { name: 'Write ~/.codex/config.toml', body: (s) => write(s, codex) },
      shell(`sed -i s/a/b/ ${codex}`),
      { name: 'Edit ~/.claude/skills/mine/SKILL.md', body: (s) => edit(s, skill) },
      { name: 'Edit notes.md', body: (s) => edit(s, ordinary) },
      { name: 'Write out.txt', body: (s) => write(s, join(s.cwd, 'out.txt')) },
      shell(`sed -i s/a/b/ ${claude}`),
    ],
  };
}
/** symlink.test.ts (AC8): ~/.claude/settings.json links to a dotfiles file, and a fresh symlink names it too. */
function symlinkWorld(): World {
  const home = makeHome();
  installDefaults(home);
  const parent = dirname(home);
  const target = join(parent, 'dotfiles', 'claude.json');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, '{}');
  link(target, join(home, '.claude', 'settings.json'));
  const viaLink = join(parent, 's');
  link(target, viaLink);
  return {
    name: 'a session whose config is a symlink', home, session: newSession(home, home),
    calls: [
      { name: 'Edit the linked target', body: (s) => edit(s, target) },
      shell('sed -i s/a/b/ ../dotfiles/claude.json'),
      { name: 'Write through a fresh symlink', body: (s) => write(s, viaLink) },
      { name: 'Write work/x.md', body: (s) => write(s, join(home, 'work', 'x.md')) },
    ],
  };
}

const ULID = /\b[0-9A-HJKMNP-TV-Z]{26}\b/g;
const reply = (r: Ran) => ({ exit: r.timedOut ? 'killed at the timeout' : (r.code ?? r.signal), stdout: r.stdout.replace(ULID, '<a ULID>'), stderr: r.stderr.replace(ULID, '<a ULID>') });
type Reply = ReturnType<typeof reply>;
/** Where two texts first differ, with the bytes around it. */
function firstDifference(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return `at character ${i}: the merge base's ${JSON.stringify(a.slice(Math.max(0, i - 40), i + 40))}, this checkout's ${JSON.stringify(b.slice(Math.max(0, i - 40), i + 40))}`;
}
function differs(b: Reply, c: Reply): string {
  if (b.exit !== c.exit) return `exit ${b.exit} on the merge base, ${c.exit} here`;
  if (b.stdout !== c.stdout) return `stdout differs ${firstDifference(b.stdout, c.stdout)}`;
  return `stderr differs ${firstDifference(b.stderr, c.stderr)}`;
}
const ROUNDS = 8;
/**
 * Makes one call with both binaries in turn until a reply of one is a reply of the other. Returns that reply, or the
 * first round's difference when eight rounds give none, with the rounds made. `alone` is the call's agreed reply with
 * the hub stopped, given for the pass with the hub up: once either binary has shown a reply that isn't that one (the
 * hub's own), only such a reply counts as agreed, so a binary that never takes the hub's answer can't agree through a
 * round where the other was late.
 */
async function agreed(once: (bin: string) => Promise<Ran>, baseBin: string, changeBin: string, alone?: string): Promise<{ reply?: string; difference: string; rounds: number }> {
  const base = new Map<string, Reply>();
  const change = new Map<string, Reply>();
  let first = '';
  for (let round = 1; round <= ROUNDS; round++) {
    const [b, c] = [reply(await once(baseBin)), reply(await once(changeBin))];
    base.set(JSON.stringify(b), b);
    change.set(JSON.stringify(c), c);
    first ||= differs(b, c);
    const fromHub = alone !== undefined && [...base.keys(), ...change.keys()].some((key) => key !== alone);
    const common = [...change.keys()].find((key) => base.has(key) && !(fromHub && key === alone));
    if (common !== undefined) return { reply: common, difference: '', rounds: round };
  }
  const shownForms = (forms: Map<string, Reply>): string => [...forms.values()].map((f) => `exit ${f.exit}, stdout ${JSON.stringify(f.stdout.slice(0, 200))}, stderr ${JSON.stringify(f.stderr.slice(0, 200))}`).join(' | ');
  return { difference: `${first || 'the two never gave the same reply from the hub'} (in ${ROUNDS} rounds the merge base replied ${shownForms(base)}; this checkout replied ${shownForms(change)})`, rounds: ROUNDS };
}

describe("#3421 AC1 deep-hook's replies for #316's recorded calls", () => {
  test("#3421.8b9bca28 deep-hook's replies for #316's recorded calls are byte for byte the merge base's, with the hub stopped and with it up", async () => {
    const base = buildBase();
    expect(base.error, `the merge base ${BASE.slice(0, 12)} builds deep-hook: cargo build --locked -q -p deep-hook`).toBe('');
    const change = buildChange();
    expect(change.error, 'this checkout builds deep-hook: cargo build --locked -q -p deep-hook').toBe('');

    const faults: string[] = [];
    let calls = 0;
    let answeredByHub = 0;
    let remade = 0;
    for (const make of [plainWorld, gitWorld, configWorld, symlinkWorld]) {
      const w = make();
      const maker = (call: Call) => (bin: string): Promise<Ran> => hook(w.home, w.session, 'PreToolUse', call.body(w.session), { binary: bin, cwd: w.session.cwd });
      // The hub stopped: no hub at the address, as #316's criteria 1 to 8 run.
      const stopped = new Map<Call, string | undefined>();
      for (const call of w.calls) {
        calls++;
        const got = await agreed(maker(call), base.bin, change.bin);
        remade += got.rounds - 1;
        stopped.set(call, got.reply);
        if (got.reply === undefined) faults.push(`hub stopped, ${w.name}: \`${call.name}\`: ${got.difference}`);
      }
      // The hub up: a real `deep hub run` on this world's home, as #316's corpus runs its second pass.
      let hub: Awaited<ReturnType<typeof startHub>> | undefined;
      let hubError = '';
      try { hub = await startHub(w.home); } catch (error) { hubError = (error as Error).message; }
      expect(hubError, `a real hub starts for ${w.name} (deep hub run)`).toBe('');
      try {
        for (const call of w.calls) {
          const got = await agreed(maker(call), base.bin, change.bin, stopped.get(call));
          remade += got.rounds - 1;
          if (got.reply === undefined) faults.push(`hub up, ${w.name}: \`${call.name}\`: ${got.difference}`);
          else if (stopped.get(call) !== undefined && got.reply !== stopped.get(call)) answeredByHub++;
        }
      } finally {
        await stopHub(hub!);
      }
    }
    process.stdout.write(`#3421 AC1: ${calls} calls, each made by both binaries with the hub stopped and with it up; ${answeredByHub} replies with the hub up are the hub's own, not the hub-stopped reply; ${remade} rounds made again; load ${loadNow()}\n`);
    expect(faults, "every reply is the merge base's, byte for byte; each line names a call whose reply differs").toEqual([]);
    // Without one reply the hub wrote, no acknowledgement or reply line was shown to have been read at all.
    expect(answeredByHub, "calls whose reply with the hub up is the hub's own, read through its acknowledgement and reply").toBeGreaterThan(0);
  }, 60 * 60_000);
});

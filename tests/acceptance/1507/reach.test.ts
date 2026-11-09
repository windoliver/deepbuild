import { afterEach, test, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AC, TIMEOUT, Session, asks, cleanup, decision, digest, events, file, git, live, must, position, shown, stagedUndo, staging, startHub, stopHub, world } from './helpers.ts';

// Keep the same budget when affected.mjs invokes Vitest without the documented CLI flag.
vi.setConfig({ testTimeout: 600000, hookTimeout: 600000 });
afterEach(cleanup);

test(`AC1 ${AC[0]} home-containing delete past ceiling is an authority ask saying its reach`, async () => {
  const who = `AC1 ${AC[0]}`;
  const w = world(2);
  const kept = [file(w, 'personal/a'), file(w, 'personal/b'), file(w, 'personal/c'), file(w, 'work/repo/tests/a'), file(w, 'work/repo/plan/a')];
  const hub = await startHub(w);
  const s = new Session(w); await s.begin();
  const since = await position(hub);
  const p = await s.pre('rm -rf tests/ plan/ ~/');
  // Read evidence before an incorrectly allowed call destroys the test hub's home and control token.
  const before = await live(hub, p);
  if (decision(p.r) === 'allow') {
    const r = await s.execute(p);
    must(false, `${who} HOME_NEVER_UNSTAGED: rm -rf tests/ plan/ ~/ was allowed and ran; command.staged=${Boolean(staging(before, p))}, files kept=${kept.filter((f) => digest(f.path) === f.digest).length}/${kept.length}; ${shown(r)}`);
  }
  must(decision(p.r) === 'deny' && !p.r.timedOut && p.r.ms < TIMEOUT, `${who} HOME_HELD_BEFORE_TIMEOUT: ${shown(p.r)}`);
  const all = await events(hub);
  const raised = asks(all, since);
  must(raised.length === 1 && raised[0]!.data.kind === 'authority', `${who} HOME_AUTHORITY_ASK: exactly one authority ask, got ${JSON.stringify(raised)}`);
  const question = String(raised[0]!.data.question);
  must(question.includes(p.command), `${who} HOME_ASK_COMMAND: ask must identify the command: ${question}`);
  must(/\b(reach|outside|beyond|past|contain|hold|home)\b/i.test(question) && (question.includes(w.home) || /\bhome\b/i.test(question)) && !/reach\s+is\s+unknown/i.test(question), `${who} HOME_ASK_REACH: ask must describe the known home reach, not call it unknown: ${question}`);
  must(kept.every((f) => digest(f.path) === f.digest), `${who} HOME_FILES_KEPT: all test home files must keep their bytes`);
  must(!staging(all, p), `${who} HOME_CEILING: no completed staging past the files ceiling`);
});

test(`AC2 ${AC[1]} untracked sibling is staged and undo restores it`, async () => {
  const w = world();
  const lost = [file(w, 'work/sibling/a'), file(w, 'work/sibling/nested/b')];
  const hub = await startHub(w); const s = new Session(w); await s.begin();
  await stagedUndo(w, hub, s, 'rm -rf ../sibling', lost, `AC2 ${AC[1]}`);
});

test(`AC3 ${AC[2]} forced git clean stages ignored and untracked files and undo restores each`, async () => {
  // Collect both command failures: the first missing staging must not hide the other case's base evidence.
  const failures: string[] = [];
  for (const [command, path] of [['git clean -fdx', '.env'], ['git clean -fd', 'untracked.txt']] as const) {
    const w = world(); const lost = file(w, `work/repo/${path}`);
    if (path === '.env') must(git(w, ['check-ignore', path]).trim() === path, 'BLOCKED: .env must be ignored');
    else must(git(w, ['ls-files', '--others', '--exclude-standard']).trim() === path, 'BLOCKED: fixture must be untracked');
    const hub = await startHub(w); const s = new Session(w); await s.begin();
    try { await stagedUndo(w, hub, s, command, [lost], `AC3 ${AC[2]}`); }
    catch (error) { failures.push(error instanceof Error ? error.message : String(error)); }
  }
  must(!failures.length, failures.join('\n'));
});

test(`AC4 ${AC[3]} in-worktree deletes, temp delete and clean dry run are free`, async () => {
  const who = `AC4 ${AC[3]}`;
  const w = world();
  const modules = file(w, 'work/repo/node_modules/a');
  const build = file(w, 'work/repo/build/a');
  const untracked = file(w, 'work/repo/untracked.txt');
  const hub = await startHub(w); const s = new Session(w); await s.begin();
  for (const command of ['rm -rf node_modules', 'rm -rf build/', 'rm /tmp/x', 'git clean -n']) {
    const since = await position(hub);
    const p = await s.pre(command);
    await live(hub, p);
    must(decision(p.r) === 'allow', `${who} FREE_ALLOW: ${command}: ${shown(p.r)}`);
    // /tmp/x is the criterion's literal matcher input, not ours to delete. Never execute it.
    // The other three calls run for real and prove that an empty/no-op driver cannot pass.
    if (command !== 'rm /tmp/x') {
      const r = await s.execute(p);
      must(r.code === 0, `BLOCKED: ${command}: ${shown(r)}`);
    }
    const all = await live(hub, p);
    must(!staging(all, p), `${who} FREE_NO_STAGE: ${command}`);
    must(asks(all, since).length === 0, `${who} FREE_NO_ASK: ${command}`);
  }
  must(!existsSync(modules.path) && !existsSync(build.path) && digest(untracked.path) === untracked.digest, `${who} FREE_EFFECTS: local deletes run; dry run keeps the untracked file`);
});

test(`AC5 ${AC[4]} stopped hub denies a home delete and names the guard`, async () => {
  const who = `AC5 ${AC[4]}`;
  const w = world(); const kept = file(w, 'personal/a');
  const hub = await startHub(w); const s = new Session(w); await s.begin();
  await stopHub(hub);
  const p = await s.pre('rm -rf ~/');
  if (decision(p.r) === 'allow') {
    const r = await s.execute(p);
    must(false, `${who} HUB_DOWN_DENY: rm -rf ~/ was allowed and ran with hub stopped; home file kept=${digest(kept.path) === kept.digest}; ${shown(r)}`);
  }
  must(decision(p.r) === 'deny', `${who} HUB_DOWN_DENY: ${shown(p.r)}`);
  const words = `${p.r.stdout}\n${p.r.stderr}`;
  // The guard ID is deliberately not hard-coded: an entry may be renamed or a dedicated one added.
  must(/\bguard\s+[a-z0-9][a-z0-9_-]+/i.test(words), `${who} HUB_DOWN_GUARD: denial must name the guard: ${words}`);
  must(digest(kept.path) === kept.digest && existsSync(join(w.home, 'work/repo')), `${who} HUB_DOWN_FILES_KEPT: home and worktree must remain`);
});

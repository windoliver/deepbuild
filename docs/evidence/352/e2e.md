# #352 by hand: two worktrees, a Claude Code and a Codex session, and the notices each received

Run 2026-11-08 on the Linux dev box (load average ~12 on 20 cores), at head c078011f (the branch merged with main e10229c1), with a real
`deep hub run` in a temporary home, real git worktrees of one repo, and each session's hooks fired through the real
`target/debug/deep-hook` (Claude Code and Codex payloads shaped like the corpus's, through the suite's
`tests/acceptance/352/helpers.ts`). Nothing stands in for the hub. The script is below the transcript.

"Was told" is exactly what the hook replies carried to the agent (its `hookSpecificOutput.additionalContext`), filtered
to DeepBuild's notice lines. Step 7 is the record (`events.read`).

```text
World: repo /tmp/dl352-w8OBeV/repo; A = Claude Code in wa on claude/issue-90-rounding; B = Codex in wb on codex/issue-91-empty-lines.

1. A edits src/cart.js (lines 2) and package.json.

2. B (Codex) starts: who else is in the repo, and on what.
  B was told:
    DeepBuild: session a1bafe8a (claude-code) is also in this repo, on issue #90; it changed src/cart.js (a behavior change).
    DeepBuild: session a1bafe8a (claude-code) is also in this repo, on issue #90; it changed package.json (a dependency change).

3. B patches src/cart.js (*** Update File: src/../src/cart.js): before the edit it hears A changed it.
  B was told:
    DeepBuild: session a1bafe8a (claude-code) also changed src/cart.js, line 2, in its worktree (a behavior change), and this session changes it too.

4. A's next tool call: B changed a file A changed.
  A was told:
    DeepBuild: session 200b13ca (codex) also changed src/cart.js in its worktree (a behavior change), and this session changes it too.

5. B commits; its pull request #91 merges into main; A's next tool call says to rebase.
  A was told:
    DeepBuild: session 200b13ca (codex)'s pull request #91 merged into main and touched src/cart.js, which this session changed (a behavior change). Rebase onto main before you say done.

5b. The session map (sessions.read), while A runs `npm test`:
  200b13ca codex: {"repo":"/tmp/dl352-w8OBeV/repo","branch":"codex/issue-91-empty-lines","issue":91,"files":[{"path":"src/cart.js","lines":""}],"running":[],"leases":[],"state":"finished"}
  a1bafe8a claude-code: {"repo":"/tmp/dl352-w8OBeV/repo","branch":"claude/issue-90-rounding","issue":90,"files":[{"path":"src/cart.js","lines":"2"},{"path":"package.json","lines":"4"}],"running":["shell call toolu_9d6a71d7297cd3b096d45 (`npm test`)"],"leases":[],"state":"working"}

5c. A stops, idle with its waiter; B changes package.json too and its pull request #93 merges: A is woken through its waiter.
  A's waiter exited 2; A was woken with:
    DeepBuild: session 200b13ca (codex)'s pull request #93 merged into main and touched package.json, which this session changed (a dependency change). Rebase onto main before you say done.

6. A third session on issue #90 (Claude Code, worktree wc on claude/issue-90-again): one "keep which?" ask.
  deep inbox:
    ask:01M6XA9GD704A7B728J8DHYF4D  choice  11bb731b-4e98-4690-bbc9-dfcd313dd8ba  3s  shown  Sessions a1bafe8a-9a34-4df5-b10e-a2a92732501c (claude-code) and 11bb731b-4e98-4690-bbc9-dfcd313dd8ba (claude-code) both work on issue #90 in repo. Keep which?  [keep-0 | keep-1 | keep-both]

7. The record: each notice.delivered (type, source, files, PR, via).
  200b13ca ← behavior   from a1bafe8a files ["src/cart.js"] pr null via SessionStart
  200b13ca ← dependency from a1bafe8a files ["package.json"] pr null via SessionStart
  200b13ca ← behavior   from a1bafe8a files ["src/cart.js"] pr null via PreToolUse
  a1bafe8a ← behavior   from 200b13ca files ["src/cart.js"] pr null via PreToolUse
  a1bafe8a ← behavior   from 200b13ca files ["src/cart.js"] pr 91 via PreToolUse
  200b13ca ← dependency from a1bafe8a files ["package.json"] pr null via PreToolUse
  a1bafe8a ← dependency from 200b13ca files ["package.json"] pr 93 via waiter
  11bb731b ← behavior   from a1bafe8a files ["src/cart.js"] pr null via SessionStart
  11bb731b ← dependency from a1bafe8a files ["package.json"] pr null via SessionStart
  11bb731b ← behavior   from 200b13ca files ["src/cart.js"] pr null via SessionStart
  11bb731b ← dependency from 200b13ca files ["package.json"] pr null via SessionStart
  merge.dry_run {"a":"session:200b13ca3559451dae38d10ea9801f14","b":"session:a1bafe8a9a344df5b10ea2a92732501c","conflicts":[]}
  pr.merged {"pr":91,"merge_sha":"0573e4f0b2e9205bd28ca2e167b888e309882cd4"}
  merge.dry_run {"a":"session:200b13ca3559451dae38d10ea9801f14","b":"session:a1bafe8a9a344df5b10ea2a92732501c","conflicts":[]}
  pr.merged {"pr":93,"merge_sha":"7bef7e9f9da79685068926b8041c15276e928e63"}
  ask.created {"kind":"choice","question":"Sessions a1bafe8a-9a34-4df5-b10e-a2a92732501c (claude-code) and 11bb731b-4e98-4690-bbc9-dfcd313dd8ba (claude-code) both work on issue #90 in repo. Keep which?","options":[{"id":"keep-0","label":"Keep a1bafe8a (claude-code), stop the other","decision":"none"},{"id":"keep-1","label":"Keep 11bb731b (claude-code), stop the other","decision":"none"},{"id":"keep-both","label
  ask.batched {"batch":"now:2026-11-08T10:12:02.112Z","asks":[{"ask":"ask:01M6XA9GD704A7B728J8DHYF4D","plan_hash":null}]}

8. `deep race 92` from your terminal:
  exit 0: A race on issue #92 started: its sessions settle on the first PASS.
```

What it shows, step by step:

1. At B's start, it hears who else is in the repo and on what: session, agent, issue (from the branch), files, one
   notice per kind of change (behavior, dependency).
2. Before B's Codex patch edits `src/cart.js` (named as `src/../src/cart.js` in the patch, resolved against its
   worktree), B hears that A changed it, with A's line range from Claude Code's `structuredPatch`.
3. A hears of B's change at its next tool call.
4. When B's pull request #91 merges into main, A's next tool call tells it to rebase, and that notice replaces the
   one about B's uncommitted change to the same file.
5. The session map (`sessions.read`, each row's `map`): repo, branch, issue, the files each session changed with their
   lines, the command it runs now, its leases and its state.
6. A stopped, idle Claude Code session is woken through its waiter when a sibling's pull request (#93) merges over its
   files (a session BLOCKED on you, or held on an open ask, is not: AC7's suite).
7. A third session on issue #90 raises one "keep which?" ask, shown in `deep inbox`.
8. Every notice is in the record as `notice.delivered`, with its type, source, files, pull request and the hook that
   carried it; the dry merge of the two branch tips and the merge are recorded too.
9. `deep race 92` from your terminal starts a race (the OS confirmation is the test stand-in, `DEEP_HUB_TEST_CONFIRM`).

No notice holds any agent's text: the texts are built from paths, line ranges, issue and PR numbers, session IDs and
agent names only (AC2's suite plants agent text in prompts, messages, patches, shell calls, commits, last words and
the PR title, and asserts none reaches a notice or the other agent).

## The script

```ts
// By-hand end-to-end run of #352: a real hub, two worktrees, a Claude Code session and a Codex session through the
// real deep-hook; prints what each agent was told, the notices the record holds, your inbox and the loop hold.
import { writeFileSync } from 'node:fs';
const H = process.env.E2E_HELPERS!;
const out: string[] = [];
const log = (s: string) => { out.push(s); };
it('e2e', async () => {
  const h = await import(H);
  const w = h.makeWorld();
  const wa = h.worktree(w, 'wa', 'claude/issue-90-rounding');
  const wb = h.worktree(w, 'wb', 'codex/issue-91-empty-lines');
  const wc = h.worktree(w, 'wc', 'claude/issue-90-again');
  await h.trust(w, [wa, wb, wc]);
  const hub = await h.startHub(w);
  const told = (who: string, s: any, from: number) => { const t = s.toldSince(from); log(`  ${who} was told:${t ? `\n    ${t.split('\n').filter((l: string) => l.includes('DeepBuild: session') || l.includes('pull request') || l.includes('held')).join('\n    ')}` : ' (nothing)'}`); };
  log(`World: repo ${w.repo}; A = Claude Code in wa on claude/issue-90-rounding; B = Codex in wb on codex/issue-91-empty-lines.`);
  const a = h.ClaudeSession.open(w, wa);
  await a.start(); await a.typed('Round each cart line to cents.');
  log('\n1. A edits src/cart.js (lines 2) and package.json.');
  await a.edit('src/cart.js', '  total: (xs) => xs.reduce((a, b) => a + b, 0),', '  total: (xs) => xs.reduce((a, b) => a + Math.round(b * 100) / 100, 0),');
  await a.edit('package.json', '"dependencies": {}', '"dependencies": { "dayjs": "1.11.13" }');
  const b = h.CodexSession.open(w, wb);
  log('\n2. B (Codex) starts: who else is in the repo, and on what.');
  let f = b.fired.length; await b.start(); told('B', b, f);
  await b.typed('Make the cart skip empty lines.');
  log('\n3. B patches src/cart.js (*** Update File: src/../src/cart.js): before the edit it hears A changed it.');
  f = b.fired.length;
  await b.patch(['*** Begin Patch', '*** Update File: src/../src/cart.js', '@@', '-  // end of cart', '+  skipEmpty: true,', '+  // end of cart', '*** End Patch', ''].join('\n'), () => h.change(`${wb}/src/cart.js`, '  // end of cart', '  skipEmpty: true,\n  // end of cart'));
  told('B', b, f);
  log('\n4. A\'s next tool call: B changed a file A changed.');
  f = a.fired.length; await a.read('src/cart.js'); told('A', a, f);
  log('\n5. B commits; its pull request #91 merges into main; A\'s next tool call says to rebase.');
  await b.bash('git commit -am "Skip empty lines"', { effect: () => h.commitAll(wb, 'Skip empty lines') });
  await b.stop('Done.');
  h.mergePr(w, 'codex/issue-91-empty-lines', 91, 'Skip empty cart lines');
  await h.sleep(6000);
  f = a.fired.length; await a.bash('npm test', { stdout: 'ok' }); told('A', a, f);
  log('\n5b. The session map (sessions.read), while A runs `npm test`:');
  const run = await a.begin('Bash', { command: 'npm test', description: 'run the tests' });
  const rows = (await h.control(hub, 'sessions.read', {})).sessions as any[];
  for (const r of rows.filter((x: any) => x.map)) log(`  ${String(r.id).slice(0, 8)} ${r.agent}: ${JSON.stringify(r.map)}`);
  await a.finish(run, { stdout: 'ok', stderr: '', interrupted: false, isImage: false });
  log('\n5c. A stops, idle with its waiter; B changes package.json too and its pull request #93 merges: A is woken through its waiter.');
  await a.stop('Done: rounded.');
  const woke = a.waiter('Done: rounded.', 120_000);
  await b.typed('Add left-pad.');
  await b.patch(['*** Begin Patch', '*** Update File: package.json', '@@', '-  "dependencies": {}', '+  "dependencies": { "left-pad": "1.3.0" }', '*** End Patch', ''].join('\n'), () => h.change(`${wb}/package.json`, '"dependencies": {}', '"dependencies": { "left-pad": "1.3.0" }'));
  await b.bash('git commit -am "Add left-pad"', { effect: () => h.commitAll(wb, 'Add left-pad') });
  await b.stop('Done.');
  h.mergePr(w, 'codex/issue-91-empty-lines', 93, 'Add left-pad');
  const woken = await Promise.race([woke, h.sleep(60_000).then(() => undefined)]);
  log(woken ? `  A's waiter exited ${woken.code}; A was woken with:\n    ${woken.stderr.trim().split('\n').join('\n    ')}` : '  A was not woken within 60 s');
  log('\n6. A third session on issue #90 (Claude Code, worktree wc on claude/issue-90-again): one "keep which?" ask.');
  const c = h.ClaudeSession.open(w, wc);
  await c.start(); await c.typed('Round the cart.'); await c.read('src/cart.js');
  await h.sleep(8000);
  const inbox = await h.deep(w, ['inbox']);
  log(`  deep inbox:\n    ${inbox.stdout.trim().split('\n').join('\n    ')}`);
  const events = await h.allEvents(hub);
  log('\n7. The record: each notice.delivered (type, source, files, PR, via).');
  for (const e of events.filter((x: any) => x.kind === 'notice.delivered')) log(`  ${String(e.session).slice(0, 8)} ← ${e.data.type.padEnd(10)} from ${String(e.data.source).slice(8, 16)} files ${JSON.stringify(e.data.files)} pr ${e.data.pr} via ${e.data.via}`);
  for (const e of events.filter((x: any) => x.kind === 'pr.merged' || x.kind === 'merge.dry_run')) log(`  ${e.kind} ${JSON.stringify(e.data)}`);
  for (const e of events.filter((x: any) => x.kind.startsWith('ask.') || x.kind === 'session.child_started')) log(`  ${e.kind} ${JSON.stringify(e.data).slice(0, 400)}`);
    log('\n8. `deep race 92` from your terminal:');
  const r = await h.deep(w, ['race', '92']);
  log(`  exit ${r.code}: ${r.stdout.trim()}${r.stderr.trim()}`);
  writeFileSync(process.env.E2E_OUT!, `${out.join('\n')}\n`);
  await h.cleanup();
}, 600_000);
```

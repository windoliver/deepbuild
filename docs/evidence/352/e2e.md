# #352 by hand: two worktrees, a Claude Code and a Codex session, and the notices each received

Run 2026-11-06 on the Linux dev box (load average ~9 on 20 cores), at head 1bbb1dfc (the branch merged with main 1972c9de), with a real
`deep hub run` in a temporary home, real git worktrees of one repo, and each session's hooks fired through the real
`target/debug/deep-hook` (Claude Code and Codex payloads shaped like the corpus's, through the suite's
`tests/acceptance/352/helpers.ts`). Nothing stands in for the hub. The script is below the transcript.

"Was told" is exactly what the hook replies carried to the agent (its `hookSpecificOutput.additionalContext`), filtered
to DeepBuild's notice lines. Step 7 is the record (`events.read`).

```text
World: repo /tmp/dl352-n4a7OM/repo; A = Claude Code in wa on claude/issue-90-rounding; B = Codex in wb on codex/issue-91-empty-lines.

1. A edits src/cart.js (lines 2) and package.json.

2. B (Codex) starts: who else is in the repo, and on what.
  B was told:
    DeepBuild: session 49f129ba (claude-code) is also in this repo, on issue #90; it changed src/cart.js (a behavior change).
    DeepBuild: session 49f129ba (claude-code) is also in this repo, on issue #90; it changed package.json (a dependency change).

3. B patches src/cart.js (*** Update File: src/../src/cart.js): before the edit it hears A changed it.
  B was told:
    DeepBuild: session 49f129ba (claude-code) also changed src/cart.js, line 2, in its worktree (a behavior change), and this session changes it too.

4. A's next tool call: B changed a file A changed.
  A was told:
    DeepBuild: session 175ce4e0 (codex) also changed src/cart.js in its worktree (a behavior change), and this session changes it too.

5. B commits; its pull request #91 merges into main; A's next tool call says to rebase.
  A was told:
    DeepBuild: session 175ce4e0 (codex)'s pull request #91 merged into main and touched src/cart.js, which this session changed (a behavior change). Rebase onto main before you say done.

5b. The session map (sessions.read), while A runs `npm test`:
  175ce4e0 codex: {"repo":"/tmp/dl352-n4a7OM/repo","branch":"codex/issue-91-empty-lines","issue":91,"files":[{"path":"src/cart.js","lines":""}],"running":[],"leases":[],"state":"finished"}
  49f129ba claude-code: {"repo":"/tmp/dl352-n4a7OM/repo","branch":"claude/issue-90-rounding","issue":90,"files":[{"path":"src/cart.js","lines":"2"},{"path":"package.json","lines":"4"}],"running":["shell call toolu_90725ae937eadd4f63d55 (`npm test`)"],"leases":[],"state":"working"}

5c. A stops, idle with its waiter; B changes package.json too and its pull request #93 merges: A is woken through its waiter.
  A's waiter exited 2; A was woken with:
    DeepBuild: session 175ce4e0 (codex)'s pull request #93 merged into main and touched package.json, which this session changed (a dependency change). Rebase onto main before you say done.

6. A third session on issue #90 (Claude Code, worktree wc on claude/issue-90-again): one "keep which?" ask.
  deep inbox:
    ask:01M6RR151VWMX9WZ5C4Q1X44JF  choice  26f47c27-4e9c-4b9d-b113-68a645c4d864  3s  shown  Sessions 49f129ba-9b58-4e40-aaf8-1dedbb596bdb (claude-code) and 26f47c27-4e9c-4b9d-b113-68a645c4d864 (claude-code) both work on issue #90 in repo. Keep which?  [keep-0 | keep-1 | keep-both]

7. The record: each notice.delivered (type, source, files, PR, via).
  175ce4e0 ← behavior   from 49f129ba files ["src/cart.js"] pr null via SessionStart
  175ce4e0 ← dependency from 49f129ba files ["package.json"] pr null via SessionStart
  175ce4e0 ← behavior   from 49f129ba files ["src/cart.js"] pr null via PreToolUse
  49f129ba ← behavior   from 175ce4e0 files ["src/cart.js"] pr null via PreToolUse
  49f129ba ← behavior   from 175ce4e0 files ["src/cart.js"] pr 91 via PreToolUse
  175ce4e0 ← dependency from 49f129ba files ["package.json"] pr null via PreToolUse
  49f129ba ← dependency from 175ce4e0 files ["package.json"] pr 93 via waiter
  26f47c27 ← behavior   from 49f129ba files ["src/cart.js"] pr null via SessionStart
  26f47c27 ← dependency from 49f129ba files ["package.json"] pr null via SessionStart
  26f47c27 ← behavior   from 175ce4e0 files ["src/cart.js"] pr null via SessionStart
  26f47c27 ← dependency from 175ce4e0 files ["package.json"] pr null via SessionStart
  merge.dry_run {"a":"session:175ce4e08f454538b90c07867d83a1c5","b":"session:49f129ba9b584e40aaf81dedbb596bdb","conflicts":[]}
  pr.merged {"pr":91,"merge_sha":"e6217dfca9091cd08955891bb6650165d30e27e5"}
  merge.dry_run {"a":"session:175ce4e08f454538b90c07867d83a1c5","b":"session:49f129ba9b584e40aaf81dedbb596bdb","conflicts":[]}
  pr.merged {"pr":93,"merge_sha":"962ed727f8e526bac099a1b0d4f674267137bbcf"}
  ask.created {"kind":"choice","question":"Sessions 49f129ba-9b58-4e40-aaf8-1dedbb596bdb (claude-code) and 26f47c27-4e9c-4b9d-b113-68a645c4d864 (claude-code) both work on issue #90 in repo. Keep which?","options":[{"id":"keep-0","label":"Keep 49f129ba (claude-code), stop the other","decision":"none"},{"id":"keep-1","label":"Keep 26f47c27 (claude-code), stop the other","decision":"none"},{"id":"keep-both","label
  ask.batched {"batch":"now:2026-11-06T15:35:56.226Z","asks":[{"ask":"ask:01M6RR151VWMX9WZ5C4Q1X44JF","plan_hash":null}]}

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

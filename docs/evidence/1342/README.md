# Evidence for #1342: one input to one card to a running project

Runs on this Mac (18 cores, 1-minute load about 200 to 250), Node v24.22.2, on 2026-11-14, against the change in this
branch. The blind suite is `tests/acceptance/1342/`, committed first and unchanged.

## The blind suite as written can't reach a card

Run unchanged, `lisbon.test.ts` failed all 7 tests at `lisbon.test.ts:94`: `deep "<words>"` was still waiting after
10 minutes, and no `brief.drafted` reached the record. The research job was on the runner, held:

```
{"job":"run:…","kind":"read","agent":"claude-code","account":null,"state":"waiting",
 "blocked":{"status":"BLOCKED","cause":"first reading","owner":"you","on":[],"account":"unknown",
 "why":"waiting for unknown's first window reading"}}
```

Every job on the runner waits for its account's first plan-window reading (`packages/runner/src/runner.ts`, `window`),
and after 30 minutes with none it raises a `runner.window` ask. The suites that run a runner job give the account a
sign-in and report one reading first (`tests/acceptance/1328/helpers.ts`, "A window reading with room";
`tests/acceptance/63/world.ts`). The 1342 world does neither, so no right program can pass it. That is disputed and
sent to a blind redraft of the job (AGENTS.md, Proof); the redraft is `tests/acceptance/1342-redraft/` once it lands,
and swapping it in needs your approval.

## The blind suite with only a window reading added

To check everything else, the unchanged test files ran with one setup file outside the folder that, after each
`World.open`, writes `.claude.json` with an `oauthAccount` into the world's home and sends one `windows.report` with
room, exactly as 1328 does. It touches nothing else, and isn't committed:

```ts
const open = World.open.bind(World);
World.open = async (o = {}) => {
  const w = await open(o);
  writeFileSync(join(w.home, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: ACCOUNT, emailAddress: 'dh1342@example.invalid' }, mcpServers: {}, projects: {} }));
  await control(w.hub, 'windows.report', { agent: 'claude-code', account: ACCOUNT, rate_limits: { five_hour: { used_percentage: 5, resets_at: now + 10_800 }, seven_day: { used_percentage: 20, resets_at: now + 400_000 } } });
  return w;
};
```

| File | Result | Log |
| --- | --- | --- |
| `home.test.ts` (AC2, AC4, AC5, AC6, AC11, and the plants `asks-which-home`, `creates-before-approval`, `repo-public-by-default`, `empty-list-while-researching`) | 5 of 5 pass | `home.txt` |
| `lisbon.test.ts` (AC1, AC3, AC7, AC8, AC9, AC10, AC12) | 6 of 7 pass; AC9 failed | `lisbon.txt` |
| `lisbon.test.ts -t AC9`, after the fix below | passes | `ac9.txt` |

AC9 failed because the research prompt listed your projects by name: the Lisbon workspace's name holds "five-day trip
to Lisbon", so the played agent, which answers the first entry whose words are in its prompt, gave the birthday job
the Lisbon answer. The prompt now lists projects by id alone. AC12 passed rather than reading INCONCLUSIVE, so the card came within
5 minutes of Send at that load.

## Unit tests

`packages/briefs/test/brief.test.ts`, 14 tests: each no-model check holds on a right draft and fails on one that breaks
it (a claim with no source, a quote not at its source, a page's line taken as a requirement, a task serving only a
source's text or nothing, a promise with no kind or an unknown one, a task waiting on itself or on nothing, an unknown
result kind, a fitting project that isn't yours).

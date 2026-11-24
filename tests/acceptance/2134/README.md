# Acceptance tests for #2134: the hook's matcher reads the owner of the creating run, and never an option's value as the subcommand

Written first, blind, from issue #2134 (its report, Scope, the 2 checkbox criteria and Proof; no comments), the design
sections it links ([Hook protocol (deep-hook and the hub)], [Before each command]), Dogfooding and Wrong programs,
`AGENTS.md`, and base commit `512d194bb` (origin/main), by a job that never saw an implementation; none existed, and
no other branch, worktree, pull request or session's notes were read. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

| AC | ID | File (tests) |
|---|---|---|
| AC1 a standing rule for profile `dev`'s owner, no hub: `aws s3 ls --profile dev; aws kms create-key --profile prod` exits 2 with the `no-unnamed-cloud-resource` denial | `#2134.c62f68e2` | `standing-owner.test.ts` (1); passes on the base, wrong program in `twins.json` |
| AC1, scope coverage (Scope bullet 1): the same two runs joined by ` ; `, `&&` or a newline, or with `--profile` before the service or as `--profile=`, are denied the same | `#2134.c62f68e2` | `standing-owner.test.ts` (1) |
| AC1, scope coverage: the owner is the creating run's, so one create under `dev` beside a run under `prod` that creates nothing is still covered | `#2134.c62f68e2` | `standing-owner.test.ts` (1) |
| AC1, scope coverage: `AWS_PROFILE` in the creating run's own environment names its owner (`AWS_PROFILE=prod aws kms create-key` is not covered, `AWS_PROFILE=dev aws kms create-key` is) | `#2134.c62f68e2` | `standing-owner.test.ts` (1) |
| AC1, scope coverage: a line with two creating runs, under one owner or under different ones, is not covered | `#2134.c62f68e2` | `standing-owner.test.ts` (1) |
| AC2 `pulumi -C infra up` and `cdk --profile prod deploy` match `effect:cloud-resource`, `npm --prefix web install left-pad` matches `effect:dependency` | `#2134.45c65c46` | `valued-options.test.ts` (1) |
| AC2, its title: an option's value that spells a subcommand (`pulumi -C up preview`, `cdk --profile deploy diff`, `npm -C install run build`) is not read as one, and a run that creates or installs nothing matches nothing | `#2134.45c65c46` | `valued-options.test.ts` (1) |
| AC2, scope coverage (Scope bullet 2): each valued option the issue lists for pulumi and cdk, and for npm, pnpm and bun, before the subcommand | `#2134.45c65c46` | `valued-options.test.ts` (2) |
| AC2, what the report says goes wrong: with the first-party entries and no hub, `pulumi -C infra up` and `cdk --profile prod deploy` exit 2 with the `no-unnamed-cloud-resource` denial | `#2134.45c65c46` | `valued-options.test.ts` (1) |

IDs are `scripts/proof-change.mjs`'s `criterionId` over each criterion's text in the live issue body. Each test's name
starts with its ID. Every criterion is decided by a vitest `expect` in the test file; setup and controls throw plain
`BLOCKED` or `INCONCLUSIVE` errors, so a broken setup or a loaded machine is never read as proof.

## What was read

- The issue (`gh issue view 2134`, body only).
- `docs/technical-design.md`: the two linked sections, "Dogfooding" and "Wrong programs".
- At the base: `crates/deep-hook/src/main.rs` (`rules`, `standing`, `cloud_owner`, `covered`, `denials`, `check`,
  `matching`, `forward`, `unanswered`, `main`), `crates/deep-hook/src/matcher.rs` (`creates_cloud`, `plain`, `past`,
  `first_two`, the `*_VALUED` lists), `crates/deep-hook/src/matcher/deps.rs` (`added`, `JS_VALUED`),
  `crates/deep-hook/src/matcher_tests.rs` (`bash`), `crates/deep-hook/default-rules.json`
  (`no-unnamed-cloud-resource`, `record-new-dependency`), `packages/hub/src/standing.ts` (`profileOf`, `cloudOf`),
  `scripts/proof-change.mjs` (`criterionId`), `scripts/proof-runs.mjs` (`atAssertion`, `twinsOf`, how twins are laid).
- Suite `2042/` for the house format and helpers (adapted into `helpers.ts`), `23/permissions/helpers.ts` for the
  `~/.aws/config` and the `standing` member.

## The surface

The real `deep-hook` (`target/debug/deep-hook`, built by the suite with `cargo build --locked -q -p deep-hook`):

- as Claude Code's hook entry runs it, `deep-hook claude-code PreToolUse`, with Claude Code's payload for a Bash call
  on stdin, in a temp `HOME` under `/tmp/dh2134-*` holding `.deepbuild/rules.json`, `.deepbuild/setup-finished.json`
  and `.aws/config`, with no hub: none is ever started in these homes;
- in its check mode, `deep-hook check`, with `{"entry": <guard@1>, "call": <a Bash call>}` on stdin, which prints
  `{"matched": true | false}`: the way the design says the hub runs the one matcher at install.

Nothing is imported from the packages, nothing stands in for the hook, and no cloud or package command is ever run:
each is a hook payload or a check input.

## What the base does, where it isn't what the issue says

The issue's findings "were read from the code, not reproduced". Two of its "today" lines don't hold at `512d194bb`:

- **AC1's exact line is already denied.** `cloud_owner` splits on whitespace only, so in
  `aws s3 ls --profile dev; aws kms create-key --profile prod` the first profile is the word `dev;`. No profile has
  that name, the owner reads `aws-profile:dev;`, no rule covers it, and the call exits 2. The defect is there for every
  other way to write the two runs: ` ; ` with a space, `&&`, a newline, `--profile=dev`, `--profile` before the
  service; each is allowed at the base, and the scope test holds them. So AC1's own test passes on the base; its wrong
  program is `twins/owner-from-the-lines-first-profile` (`twins/README.md`), on which it fails at its assertion.
- **`npm --prefix web install left-pad` already matches `effect:dependency`.** `deps::added` skips the value of each
  option in `JS_VALUED`, which holds `--prefix`, `-w`, `--workspace`. Of the issue's npm, pnpm and bun options only
  `-C` is read wrongly at the base. AC2's own test still fails on the base, on its pulumi and cdk commands.

Neither changes an assertion: the tests hold the issue's expected values as written.

## Readings where the issue leaves a choice

- **"A rules file whose standing list holds the owner of profile `dev`".** `rules.json` is the shipped
  `crates/deep-hook/default-rules.json` with one member added, `"standing": [{"effect": "cloud-resource", "owner":
  "aws:111111111111"}]`, the shape the base's `standing` reads and the hub copies. `~/.aws/config` has
  `[profile dev]` with `sso_account_id = 111111111111` and `[profile prod]` with `222222222222`, so the owner of `dev`
  is `aws:111111111111`, as the base and the hub name an account. A `setup-finished.json` sits beside it, as setup
  writes it.
- **"No hub".** A home no hub ever ran in: nothing listens at its address.
- **"Exits 2 with the `no-unnamed-cloud-resource` denial".** Exit code 2, and what the hook printed (stdout and
  stderr) names `no-unnamed-cloud-resource`. The denial's other words are free.
- **"Allowed" / "covered".** Exit 0, no deny decision on stdout, and nothing printed names the entry.
- **Controls.** Each standing-rule test first checks, in its own home, that `aws kms create-key --profile dev` is
  allowed and `aws kms create-key --profile prod` is denied by the entry, and throws `BLOCKED` otherwise. AC1's own
  test also checks that with no standing rule its line is denied. AC2's check-mode tests first check that `pulumi up`,
  `cdk deploy` and `npm install left-pad` match and `pulumi preview`, `cdk diff` and `npm run build` don't, as at the
  base; its hub-away test, that `pulumi up` is denied and `pulumi -C infra preview` allowed.
- **A hook the machine gave no time.** Past 500 ms with the call unread, deep-hook's watchdog denies it unchecked,
  naming no entry ("... within 500 ms ..."). That isn't a reading of the call: such a try is made again, 10 times,
  then `INCONCLUSIVE`.
- **"Read the owner from the run the matcher matched" (Scope).** Read both ways: a create under `prod` beside a run
  under `dev` is not covered (AC1), and one create under `dev` beside a run under `prod` that creates nothing, or
  beside an `echo --profile prod`, is covered, since the rule covers the account it runs under. A fix that refused
  every line of more than one run would fail the second test; if the owner meant that, it is a redraft.
- **"`AWS_PROFILE` in that run's environment".** An assignment written before the run, `AWS_PROFILE=prod aws kms
  create-key`. It is held in a home whose `[default]` profile signs into the covered account, so a reading that
  passes over the assignment would cover the create; and `AWS_PROFILE=dev aws kms create-key`, in a home with no
  default profile, is covered. The hook's own process environment holds no `AWS_` setting.
- **"More than one creating run, or creating runs under different owners".** `aws kms create-key --profile dev &&
  aws kms create-key --profile dev` (two runs, one covered owner), the same with the second under `prod`, and
  `aws kms create-key --profile dev && pulumi up`. Each is denied by the entry.
- **"The matcher's table test" (AC2).** The table test is a cargo test inside the crate
  (`crates/deep-hook/src/matcher_tests.rs`, `bash(...)`), which this job can't write to. The same matcher is asked
  here through `deep-hook check`, with an entry `{match, scope: all_repos, mode: block, reason, next_step,
  fail_closed: true}` and the call `{tool_name: "Bash", tool_input: {command}, cwd}`; "matches" is `{"matched":true}`.
  The crate's own table rows are the implementer's.
- **"Never read as the subcommand" (AC2's title).** Besides the three commands that must match, a value that spells a
  subcommand must not make a match: `pulumi -C up preview`, `pulumi --cwd up preview`, `cdk --profile deploy diff`,
  `cdk --app deploy diff`, and `-C install run build` for npm, pnpm and bun, each matched at the base. With them,
  `pulumi -C infra preview`, `cdk --profile prod diff`, `npm --prefix install run build` and `npm --prefix web run
  build` must still match nothing.
- **The valued options (Scope bullet 2).** Exactly the issue's lists, each written as the option, a space and a
  value, before the subcommand: pulumi `-C`, `--cwd`, `-s`, `--stack`, `--color` with `up`; cdk `--profile`, `--app`,
  `-a`, `-o`, `--output`, `-c`, `--context` with `deploy`; npm, pnpm and bun `--prefix`, `-C`, `-w`, `--workspace`
  with `install left-pad`. The issue lists them for all three package managers alike, so each is held for each.

## Open questions (not guessed, not tested)

- **The hub's `cloudOf`** (Scope: "give the hub's `cloudOf` the same reading") is in no criterion, and AC1 says "no
  hub". Reading it needs a running hub that answers within the hook's 50 ms and a standing rule answering an ask;
  not tested here. `packages/hub/src/standing.ts` `profileOf` at the base takes the line's first `--profile`.
- **`--profile` and `AWS_PROFILE` on one run** (`AWS_PROFILE=prod aws kms create-key --profile dev`): the issue
  doesn't say which names the owner.
- **`AWS_PROFILE` set earlier in the line** (`export AWS_PROFILE=prod; aws kms create-key`, or through `env`): the
  issue says "in that run's environment" and no more.
- **The `=` spelling of the valued options** (`pulumi --cwd=infra up`) is one word and was never read as a
  subcommand; not tested.
- **That `record-new-dependency` records** `npm --prefix web install left-pad` with the hub up is the hub's record;
  the match is tested, the record isn't.

## Run them

```sh
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$HOME/.cargo/bin:$PATH   # when node, npm and cargo aren't on PATH
npm ci                                                 # once: vitest
cargo build --locked -q -p deep-hook                   # warm; the suite runs it again, a no-op when fresh
npx vitest run tests/acceptance/2134 --reporter=verbose
node node_modules/typescript/bin/tsc -p tests/acceptance/2134/tsconfig.json   # type-check
```

Two files, ten tests, no hub and no timing assertion. Each test makes its own homes and removes them. Each hook or
check run is one short process, run to its end.

## Base results

`BASE-FAILURE.txt` is the one whole run at the base (10 tests: 9 fail at their assertion, 1 passes, none blocked or
inconclusive; at load average 93), then the twin laid over a copy of the base.

- **AC1's own test passes** on the base (above). On `twins/owner-from-the-lines-first-profile` it fails at its
  assertion: exit 0, nothing printed, where exit 2 is required.
- **AC1's scope tests fail** (4): the other spellings of the two runs are allowed; a create under `dev` beside a run
  under `prod` is denied; `AWS_PROFILE=dev aws kms create-key` is denied; two creating runs are allowed.
- **AC2 fails** (5): `pulumi -C infra up` and `cdk --profile prod deploy` don't match (the npm command does); seven
  values that spell a subcommand match; every listed pulumi and cdk option fails, and `-C` for npm, pnpm and bun; with
  no hub both cloud commands are allowed.

The twin was run in a copy of the checkout (`cp -cR`) with the twin's `main.rs` laid over, `-t '#2134.c62f68e2'`.

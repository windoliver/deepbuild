# Acceptance tests for #1885: every command presents the token of the hub it calls

Written first, blind, from issue #1885 (its report, Scope, three acceptance criteria and Proof) as the brief quoted it,
the design and base commit `eb027b613` ("Merge pull request #2928 …"), by a job that never saw an implementation; none
existed, and no other branch, worktree, pull request or stash was read, nor the live issue. The implementing agent
doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

| AC | ID | File (tests) |
|---|---|---|
| AC1 | `#1885.a4029057` | `commands.test.ts` (3): `deep inbox`, `deep undo`, `deep memory` with `hub.address` at a dev hub run with `--root` in another folder |
| AC2 | `#1885.44a33ba0` | `commands.test.ts` (3): the same three commands with no config file, the installed hub running |
| AC3 | `#1885.704c440e` | `sources.test.ts` (1): the command packages' sources, read with the TypeScript compiler |

Each ID is `scripts/proof-change.mjs`'s `criterionId` (sha256 of the criterion's text after `- [ ] `, whitespace
collapsed, first 8 hex) over the text as the brief gave it; the live issue body wasn't read, so it isn't checked
against it. Every test's name starts with its ID.

## What was read

- `AGENTS.md`; `docs/technical-design.md`: Socket roles and contract versions; One hub per user, a tiny hook client,
  and extensions in-process.
- At the base, under `packages/hub/src`: `paths.ts` (`rootOf`, whose `token` is `<root>/control.token`; `Root`;
  `hubAddress`, following `hub.use` for the worktree holding the cwd, then `hub.address`, else the installed socket),
  `inbox.ts`, `undo.ts`, `memory.ts` (each reads `rootOf(installedRoot()).token` and calls `hubAddress().path`),
  `client.ts` (`call`: on the hub's hello it sends `{hello:'cli', token}`; a refusal of that hello is a line with
  `id: null` it doesn't read, then the close, which it reports as "the hub closed the connection before it answered";
  `failure`/`notAnswered`), `server.ts` (`hello`: a cli hello whose token isn't the one this hub wrote is refused with
  code `credential`; `writeToken`), `list.ts` (`databaseRead`, `hubDown`), `staging.ts` (`undo`'s `not_found`
  wording), `hub-control.ts` (`inbox.read`, `staged.undo`, `memory.list`), `hub-command.ts` and `authority.ts`
  (`deep hub use --root` writes `hub.use`, only once the OS confirms you), `status.ts` and `list.ts` (the token beside
  the socket first). `packages/cli/src/main.ts` (first-run setup gate; command dispatch). `tests/acceptance/16/helpers.ts`
  (reused as other suites import it), `tests/acceptance/2564/` (this README's form).

## Readings where the issue leaves a choice

- **"the config pointing at a hub run with `--root` in another folder"**: `hub.address` in `~/.deepbuild/config.json`,
  `unix:<dev root>/hub.sock`, written as #16's `setAddress` writes it. Not `hub.use`: `deep hub use --root` writes it
  only once the OS confirms you, which a test can't do, and it applies only to commands run inside the worktree it
  names; `hub.address` is the one address setting every client reads, whatever the cwd. Both keys come back through
  `hubAddress()`, the function the issue's one helper starts from, so a fix through it covers `hub.use` too; `hub.use`
  isn't tested separately. The dev hub's root is a fresh folder under `/tmp/dh16-*`, started as `deep hub run --root
  <folder>`.
- **The installed hub in AC1**: it ran once (`deep hub run`, root `~/.deepbuild`) and was stopped by its PID, so its
  `control.token` is there (the token the base presents) and nothing answers at its socket. So an answer can only come
  from the dev hub: a program that ignored the config and reached the installed hub would get "isn't answering", and
  fail. The home counts as set up (`~/.deepbuild` exists, no `setup-stopped.json`), so no command runs first-run setup.
- **The situation the issue names**, checked before any command, on the hubs alone (`BLOCKED:` otherwise): a cli hello
  to the dev hub presenting the installed root's token is refused with code `credential`, and one presenting the dev
  root's own token is taken (`role: cli`). The test reads both token files to send them and never prints or keeps a
  value; each AC1 failure message names that refusal code.
- **"answered by that hub"**, per command, a subcommand that calls the hub and a check only a hub's method answer gives:
  - `deep inbox` (`inbox.read`): the last stdout line is `Nothing needs you`, exit 0, and nothing says the hub "isn't
    answering". When the call fails, `deep inbox` reads the database beside the socket and says the hub isn't
    answering, exit 3; so the check tells a hub's answer from that.
  - `deep undo staged:<fresh ULID>` (`staged.undo`): stderr holds `No staging staged:<id> in the record.`, the hub's
    `not_found` refusal of the handle after reading its record, exit 1. A refusal at the door never says this.
  - `deep memory` (`memory.list`): stdout holds `No lessons to keep or remove.`, exit 0.
  The worlds are fresh, so these are the words an empty record gives; that the answer is the dev hub's follows from it
  being the only hub running.
- **"On the merge base each is refused with the credential refusal"**: the dev hub refuses the hello carrying the
  installed token with `credential` (the precondition shows it); the CLI then reports the close it sees, not the
  refusal's words. `BASE-FAILURE.txt` shows what each command printed at the base.
- **"each command reaches the installed hub as before"** (AC2): a fresh home, the installed hub running, no
  `config.json` at all; the same three commands and checks. These pass at the base: they guard that the fix doesn't
  break the default.
- **AC3's rule** ("a command site that reads `control.token` itself fails a test that reads the sources, naming the
  file"):
  - Scanned: every TypeScript source of the deep command's packages, `packages/hub/src` and `packages/cli/src`
    (`*.ts`, not `*.d.ts`, `*.test.ts` or `*.spec.ts`, nothing under a `test`, `tests`, `__tests__` or `fixtures`
    folder), each through the TypeScript compiler with its package's `tsconfig.json`, for the type checker. Other
    packages (conformance's harness, say) aren't commands and aren't scanned.
  - A file **reads a control token itself** when it holds a call to `readFileSync`, `readFile` or `createReadStream`
    (by name, on whatever object) whose first argument names the control token's file: the argument's expression, or
    the initializer of a variable it names (followed through such variables), holds a string literal containing
    `control.token`, or a `.token` read off a value of paths.ts's `Root` type (`rootOf(…).token`, `at.token` after
    `const at = rootOf(…)`, a `Root` parameter's `.token`). Building the path (`rootOf`) and writing the file
    (`server.ts`) aren't reads. A function that reads a token path it is handed as a plain string parameter isn't
    flagged by itself; the path's origin is.
  - **At most one** scanned file may read it: the file of the one helper that returns a socket with the token that
    belongs to it. Where that helper lives (`paths.ts`, `client.ts` or a new file) is the implementer's choice. With
    two or more, the test fails naming every reader with its lines, so a stray site is named next to the helper.
  - A precondition: `packages/hub/src/paths.ts` still declares `Root` (else `BLOCKED:`), since the rule follows it.
  - The issue's list is from an older commit; at the base the scan finds more readers than it names (`deep debug
    bundle` in `packages/cli/src/main.ts`, `doctor.ts`, `service.ts`, `env.ts`, `show.ts`, …). The Scope says no
    command reads a token file by itself, so they count too.

## Run them

With the repo's Node (24), on macOS or Linux:

```sh
npm ci                                  # once, if node_modules is missing
npm run build --workspaces              # the CLI runs from packages/*/dist
cargo build -p deep-hook --locked       # the hub needs target/debug/deep-hook to start
node node_modules/vitest/vitest.mjs run tests/acceptance/1885
node node_modules/typescript/bin/tsc -p tests/acceptance/1885/tsconfig.json
```

After a change to `packages/hub/src`, build again: `commands.test.ts` runs `dist`; `sources.test.ts` reads `src`.
Each world lives in `/tmp/dh16-*` with its own `HOME`, removed after the file; the suite stops only the processes it
started, by PID. No network, sign-in or model call.

## Base results

`BASE-FAILURE.txt` is the run at the base, whole, with the checkout's path replaced by `<repo>` and no token in it, on
macOS (arm64) at load about 9. Seven tests: 4 fail, 3 pass, and nothing is BLOCKED. The precondition held: the dev hub
refused the installed root's token with `credential` and took its own.

- AC1, all three fail for the issue's reason. The CLI presented the installed root's token to the dev hub, which
  refused the hello. `deep undo` and `deep memory` printed `the hub closed the connection before it answered` and
  exited 3. `deep inbox` fell back to the dev hub's database and printed `The hub isn't answering, since HH:MM; start
  it with deep hub start. This is the list its database holds.`, exiting 3.
- AC2, all three pass at the base, as they should. They guard the default path.
- AC3 fails, naming 23 files: in `packages/hub/src`, authority, backup, client, doctor, env, eval-report,
  fix-command, heavy, hosts, inbox, land-command, list, mcp-exec, memory, service, setup, show, start-command,
  status, undo, words-command and workspace-command; and `packages/cli/src/main.ts`. Every file the issue lists is
  among them. Nothing that only builds the path (`paths.ts`) or writes it (`server.ts`) was flagged.

That a right fix passes wasn't checked: no fix exists. AC3 passes exactly when one scanned file or none reads the
token by this rule.

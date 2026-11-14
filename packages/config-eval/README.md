# @deepbuild/config-eval

## What it is for

Configuration evals (#112). A change to instruction files, skills, hooks, guards or policy is replayed on real past tasks from the transcript archive, once with the base's files and once with the change's, each repeat graded blind by a judge of another model family and compared by the record's one comparison rule under a plan frozen before either side runs. A replay touches nothing (#1108): each agent runs in the platform sandbox, which refuses every host but its model endpoint and this machine, from a throwaway home holding only its model sign-in, and each outside call it makes (an MCP tool call, a web fetch or search, or a shell command that reaches the network, past wrappers such as `timeout` and `xargs`) gets the original session's recorded result, each recorded call once and in its order, or an error saying it isn't in the recording. A pair that made a call the recording can't answer reads diverged and counts as failed. `scripts/config-eval.mjs` calls `runEval`; no package does. The learned layer starts no replay: its check (`replayCheck` in `@deepbuild/record`) reads the replays a change cites, by the same comparison rule.

## Where new code goes

- `src/index.ts`: the eval (`runEval`) and its shapes.
- `src/archive.ts`: reading real past tasks from the archive (`archivedTasks`), each with its session's outside calls.
- `src/launcher.ts`: the default launcher, the real agents and judge on your plan, headless as the adapters' facts launch them; the replayed agent's throwaway home and sandbox.
- `src/recording.ts`: what counts as an outside call, matching one to the recording, and the replay's answering server (the recorded MCP servers, the shell hook, the tunnel to the model endpoint).
- Tests: `test/`, against fake `claude` and `codex` executables; the acceptance suites are `tests/acceptance/112/` (with the live run) and `tests/acceptance/1108/`.

## What it may import

Extension layer. It reaches `@deepbuild/record`, `@deepbuild/gate` (`errorShape`) and `@deepbuild/supervisor` (the sandbox backends) through their package entries (and `@deepbuild/evidence` in tests only), plus `node:` built-ins. It never imports the hub, the CLI or the app. It runs on your machine or in a lane you dispatch, never in hosted CI on push.

## Deviations

- The replayed agent's throwaway home holds none of DeepBuild's own hook and MCP entries, though #1108's scope allows them: inside the sandbox they would reach the hub that records your real sessions, and a replay's claims or proposals there would be outside calls too.
- Only Claude Code agents replay: a `gpt-*` agent is refused, saying so, until Codex's outside calls can be answered from a recording. The judge still runs on Codex.
- The throwaway home holds your sign-in's access token without its refresh token, so a replay can't rotate it and sign you out. An eval whose agents' deadline falls after the token expires is refused, naming both times.
- A model endpoint off this machine over plain `http://` is refused: the replay's one way out is a tunnel for https.
- A recorded web fetch or search reaches the agent as the hook's refusal, with the original result as its text: a PreToolUse hook can't hand back a result for those tools, so the call is never made, and the agent reads the result marked as an error.
- A shell command that matches the recording is answered whole: its local pieces don't run either. `npm test && gh pr create` prints the original session's output, and the tests and any file they write are left as they are. Running only the pieces that reach no host would mean taking the command apart and joining their output with the recorded output, which #1108 doesn't ask for.
- A web fetch matches the recording by its URL alone, since what it asks of the page is the agent's wording. A command that only looks a program up (`command -v gh`) or asks for its help or version (`gh --version`, `gh pr create --help`, the flag right after the program or its subcommands) runs in the sandbox. The same flag after an argument (`ssh host node --version`) belongs to what the program runs, so that command is an outside call.
- The replay is refused if the folder it would read Claude Code or node from holds your home or Claude config home, for example claude installed in your home's top folder, reached directly or through a link.
- The replayed agent's shell commands that reach no network run without asking, where the original session asked under your allow rules: the sandbox, which writes only the checkout and the throwaway home, is what holds them.
- On macOS, Claude Code keeps its sign-in in the Keychain, which a throwaway config home can't copy: give the eval `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) or `ANTHROPIC_API_KEY`. Seatbelt's profile also refuses writes to any `.claude.json`, which Claude Code writes in its config home, so a replay there may fail until the supervisor's profile allows the throwaway one. Not yet run on macOS.

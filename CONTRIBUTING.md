# Contributing

DeepBuild is in its design phase. The [issues](https://github.com/windoliver/deepbuild/issues) are the plan: each epic is a release step, and each task lists its acceptance criteria, the proof it needs, and what it depends on.

## Where work goes

- **The core** is the record, gates, asks and adapters. It stays small. Open an issue before changing it. Pull requests to the core that weren't agreed in an issue may be closed and reviewed in a batch.
- **Extensions** are where most features live: checks, resolvers, sources, environments, views and adapters. New extensions are welcome.

## Work in parallel

- Pick an open issue whose "Depends on" issues are closed, and say in a comment that you're taking it.
- The issue is the spec: its design links, fields and acceptance criteria. Read the linked sections of [docs/](docs/) first. If the docs and the issue disagree, stop and say so in the issue rather than picking one.
- Keep to one issue per branch, worktree and pull request, as AGENTS.md says.
- The design docs are the source of the design: `docs/technical-design.md` and `docs/canvas-primitives.md`, edited in this repo like code. An issue's live body is the source of that task. Nothing generates either, and research notes stay private and feed neither.
- Change the design by pull request, in the change that needs it or on its own. It lands on the doc lanes like any other change: design links and names, catalogue drift and public text. A person is asked only when it changes one of the four invariants in [AGENTS.md](AGENTS.md) or a row under [Decided](docs/technical-design.md#decided).
- Every `deep` command and agent tool an open issue names must be in the design, or in `scripts/planned-names.txt` with the open issue that plans it.
- Public text, issues and commit messages included, names only our design and what DeepBuild runs, links, calls, reads or writes. The public text lane checks each change and the open issues against salted hashes in `scripts/studied-names.json`, so the list itself stays private.
- Tasks with an Oracle line are also checked against outside references kept in the maintainers' private oracle repo; without one, that lane reports BLOCKED and the rest of the checks still run.

## Every pull request carries proof

- Link the issue with `Closes #n` only when every acceptance criterion is proven. Otherwise use `Part of #n`.
- Show the check failing before your change and passing after: the command and its output, or a link to the evidence.
- Add screenshots or a video for anything a user sees.
- List anything still open.

## Agents

Agent-written contributions are welcome. Say which agent and model you used. You're responsible for the change, and [AGENTS.md](AGENTS.md) applies to you and your agent.

## License

By contributing, you agree that your contributions are licensed under the [Apache License 2.0](LICENSE).

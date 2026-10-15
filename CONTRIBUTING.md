# Contributing

DeepBuild is in its design phase. The [issues](https://github.com/windoliver/deepbuild/issues) are the plan: each epic is a release step, and each task lists its acceptance criteria, the proof it needs, and what it depends on.

## Where work goes

- **The core** is the record, gates, asks and adapters. It stays small. Open an issue before changing it. Pull requests to the core that weren't agreed in an issue may be closed and reviewed in a batch.
- **Extensions** are where most features live: checks, resolvers, sources, environments, views and adapters. New extensions are welcome.

## Work in parallel

- Pick an open issue whose "Depends on" issues are closed, and say in a comment that you're taking it.
- The issue is the spec: its design links, fields and acceptance criteria. Read the linked sections of [docs/](docs/) first. If the docs and the issue disagree, stop and say so in the issue rather than picking one.
- Keep to one issue per branch, worktree and pull request, as AGENTS.md says.
- `docs/` is generated from the design, so don't edit it in a feature pull request. Propose a design change in an issue.
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

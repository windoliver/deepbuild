# @deepbuild/otlp

## What it is for

The OTLP receiver (#42), an optional first-party extension: it listens on 127.0.0.1 for an agent's own OpenTelemetry traces and logs and maps Claude Code's tool spans to `tool.span` and each model request's cost to `request.cost`, plus its `deep doctor` item. The CLI's doctor calls that item; nothing in the workspace starts the receiver yet, only its tests.

## Where new code goes

- `src/index.ts`: the receiver and the mapping to events; every time comes from the export, never a clock.
- `src/wire.ts`: reading OTLP/HTTP requests, protobuf or JSON, into one shape; `src/doctor.ts`: the doctor item.
- Regression tests go in `test/`; acceptance tests live in `tests/acceptance/42` and are never edited.

## What it may import

A first-party extension: only `@deepbuild/record` and `node:` built-ins, through its public entry. It never imports the hub, CLI or app, and never reads a repo's `.claude/settings.json`.

## Deviations

- `src/wire.ts`: decodes protobuf by hand with no dependency, and a record's attributes take its resource's as their prototype, never a copy, since a copy would cost records times attributes; `for…in` lists both.

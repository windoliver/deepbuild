# @deepbuild/wiki

## What it is for

The wiki's claims and pages (#355), a first-party extension: every line of a page is a claim that keeps its exact quote, its source and how it was known, and each claim is a learned change the core checks and can roll back. The hub writes through it and `@deepbuild/reading` hands it the findings it keeps.

## Where new code goes

- `src/index.ts`: claims, pages, standing questions and your edits kept as decisions.
- Regression tests go in `test/`; acceptance tests live in `tests/acceptance/355` and are never edited.

## What it may import

A first-party extension on the core: only `@deepbuild/record`, `@deepbuild/extension-host` (for project trust) and `node:` built-ins, through public entries. It never imports `@deepbuild/reading` (which stands on it), the hub, the CLI or the app, and never fetches a link.

## Deviations

- `src/index.ts`: the `plant` option `quote-present-only` is a planted wrong program the tests select, so they are shown to fail on a wrong program (AGENTS.md, Proof).

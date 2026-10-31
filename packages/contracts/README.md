# @deepbuild/contracts

## What it is for

The published shapes and their tooling: every event and interface schema (`name@major`), their fixtures and frozen digests, the validator, canonical JSON and hashing, the one error shape, the extension API and hub-slot table, and the TypeScript and Rust types generated from the schemas. Nearly every package stands on it.

## Where new code goes

- `schemas/<name>@<n>.json`: a new or next-version contract; `fixtures/<name>@<n>/`: its valid instances. A changed published shape takes a new minor or a new name, never an edit in place.
- `slots/<slot>@<n>.json`: a hub slot's interface; `hub-slots.json` and `extension-api.json`: the slot table and the `deep.*` API.
- `src/`: validator (`validate.ts`), lint, codegen, canonical JSON, digests, handles, manifest rules; `src/index.ts` is the public entry.
- Generated, never hand-edited: `src/generated/types.ts` and `crates/deep-contracts/src/generated.rs`, plus the digests in `digests.json`, `extension-api.json` and `hub-slots.json`. Run `npm run generate -w @deepbuild/contracts`.
- Tests: `test/`.

## What it may import

The bottom of the core: `node:` built-ins only, no workspace package and no dependency. It never imports anything above it.

## Deviations

- `src/generated/types.ts`: a generated file checked in, headed "Do not edit"; `src/generate.ts` writes it from the schemas, so change a schema and regenerate instead.
- `digests.json`: the frozen digest of each schema; the generator only adds missing ones and never refreezes, so a changed published shape keeps failing the contract test until it takes a new minor or name (`src/generate.ts`).

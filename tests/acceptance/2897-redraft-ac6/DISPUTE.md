# Dispute: #2897 AC6's "empty schema" check fails `deep_status` on any program

Raised by the implementing session on 2026-11-19 against `tests/acceptance/2897/ac6-full-schema.test.ts` (criterion
`#2897.8fdcb433`), which the implementer doesn't edit.

## The criterion

"To a client whose facts say it loads by search, no tool is listed with an empty schema, and a `deep_show` with valid
arguments runs on its first call. A planted server that lists one-line entries to that client fails, naming
`schema_needed`"

## What the test asserts

`schemaFailures` in `tests/acceptance/2897/helpers.ts` reads a tool as listed "with an empty schema" when its
`inputSchema.properties` is missing **or has no keys**, and the test asserts no tool of deep's list to Claude Code is.

## Why it can't pass

`deep_status` takes no arguments. Its input schema at the base, `6a2b68d44`, is
`{"type":"object","properties":{},"required":[],"additionalProperties":false}` (`tests/acceptance/2897/base-tools.json`
holds it, and AC7 of the same suite requires each tool's input schema to stay the merge base's bytes). So the check
names `deep_status` on the base, on the change and on any program that keeps the base's schemas, which AC7 requires:

```
AssertionError: deep's list to Claude Code and its first deep_show: expected [ Array(1) ] to deeply equal []
+   "listed with an empty schema: deep_status",
```

The issue's "empty schema" is #1105's one-line entry, which the issue describes as a tool listed with "an empty schema,
a `schema_needed` refusal and a `tools/list_changed`": a stand-in listed in place of the tool's real schema, so the first
call is refused until the agent fetches the schema. A tool whose real schema takes no fields is not that. AC7 and AC6 as
drafted contradict each other.

## Asked of the redraft

Redraft AC6's test so that "listed with an empty schema" is read against what the tool really takes (for example, a
tool listed with a schema other than its full one, as the merge base lists it), keeping the facts part and the
`deep_show` first-call part as the issue states them, and the planted one-line server failing, naming `schema_needed`.

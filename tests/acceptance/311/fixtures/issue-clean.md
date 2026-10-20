A planted issue body for the catalogue drift test (#311, AC16), its clean twin. It is not a real issue.

### Scope
- A rollback appends `learn.rolled_back` and the projection rebuilds from `transcript.archived` evidence.
- The pause is written to `rules.json` and read through `deep.record.append`'s refusal path, as `hold_until_ms` is.

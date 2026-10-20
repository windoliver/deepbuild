A planted issue body for the catalogue drift test (#311, AC16). It is not a real issue.

### Scope
- When you pause the learned layer, the hub appends `learn.paused`, and `learn.applied` stops until it resumes.
- The pause is written to `rules.json` and read through `deep.record.append`'s refusal path, as `hold_until_ms` is.

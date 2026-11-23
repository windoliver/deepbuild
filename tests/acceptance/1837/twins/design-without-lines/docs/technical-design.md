# Technical design

A planted wrong design for #1837.78b8f3bb (tests/acceptance/1837/twins/README.md): the design before the owed lines,
with the sections the issue links and none of the eight items' lines.

## One event log, with tables built from it

The hub appends `verdict.made` once a check runs, and `claim.made` when the agent says it is done.

### The learned layer

A learned change is replayed on past tasks before it applies.

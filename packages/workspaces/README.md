# Workspaces

## What it is for

A home for work that isn't code (#67): a git repo holding its definitions, scripts and notes, and naming what it touches. This package holds the parts with no hub in them: the four state sources DeepBuild ships (`git`, `host`, `api`, `document`), each with the fixture `state-source@1`'s kit drives, a reading's digest, the plan of a change through a source, and a workspace's own git work. The hub's side, which keeps them in the record, pins readings and re-runs what drifted, is `packages/hub/src/workspaces.ts`.

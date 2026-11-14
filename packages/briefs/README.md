# Briefs

## What it is for

One input (#1342): your words, with any file or link, as one brief on one card, with no model in any of it. The research job's draft is held to the findings the reading core kept: a line no kept finding says is gone, a requirement only your own words make (text from a page or a file stays that source's text), every promise maps to a check of a named kind or a taste call, and every task serves a line of the brief. It also reads the input itself (links, files, the heading a new project's row shows, a cadence such as "every month") and writes the brief's page and the card. The hub's side, which keeps the record, raises the card and applies it on your yes, is `packages/hub/src/intake.ts`.

## Where new code goes

- `src/index.ts`: everything here: the input (`sourcesOf`, `repoLink`, `headingOf`, `cadenceOf`, `pageText`), the brief's checks (`briefOf`), its page (`pageOf`) and its card (`cardOf`).
- Anything that fetches, keeps evidence, writes to the record, raises an ask or makes a project goes in `packages/hub/src/intake.ts`, not here.
- The acceptance suite is `tests/acceptance/1342`, never edited.

## What it may import

Extension layer, with no hub in it: `node:` built-ins only. It never imports the record, the asks core, the hub, the CLI or the app; the hub imports it.

## Deviations

None.

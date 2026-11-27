---
name: comment-pass
description: Take the comments out of one folder of this repo, the way docs/adr/0001 says. Use when asked to do a comment pass, to lower a folder's entries in scripts/comment-ceilings.json, or to move decisions from comments into docs/adr.
---

# A comment pass over one folder

The rule is `docs/adr/0001-code-carries-no-comments.md`: code carries no comments, the lint lane's comment ratchet only goes down, and a decision lives in `docs/adr/`. A pass takes one folder there. It changes comments and white space only, and one pull request holds one folder.

## Before

1. Pick one folder, such as `packages/gate`, and branch from `origin/main`.
2. Read its counts: the folder's entries in `scripts/comment-ceilings.json`. A file under `tests/acceptance/` or `vendor/`, and a generated file, is out of the ratchet and out of the pass.
3. Read the package's README card and the design sections its files name. You need them to tell a decision that is already written from one that isn't.

## Sort every comment

Read each comment against the code it sits on, and put it in exactly one row. Keep a tally by row for the pull request.

| The comment | What you do |
|---|---|
| repeats what the code beside it says, or only labels a section | delete it |
| is stale: the code no longer does what it says | delete it, and list it in the pull request |
| explains why the code does less than an open criterion asks | delete it, and list the criterion and its issue in the pull request; never close the gap in the pass |
| records a decision the design or the README card already states | delete it |
| records a decision written nowhere else | write it into a page under `docs/adr/`, then delete it |
| says only what a name means: a unit, a default, an invariant | leave it, until #3456 is ruled |
| is a marker another lint reads, with its reason, or a license notice | leave it; the ratchet doesn't count it |

When unsure between "repeats the code" and "what a name means", delete the comment in your head and read the name alone: if nothing is lost, it repeats the code.

## Write the decisions down

- One page per module topic, `docs/adr/<next number>-<topic>.md`, added to the list in `docs/adr/0001`.
- Each decision is one bullet: the decision in bold, the file and the symbol it governs, then why, with the issue number the comment gave.
- Write what the comment said, in full sentences. Don't add a decision the comment didn't hold, and don't repeat what the design already states.

## Prove the pass removed nothing else

Run each once, after the last edit:

```
node scripts/comment-only.mjs <folder>
node scripts/comment-ratchet.mjs --write
node scripts/comment-ratchet.mjs
```

- `comment-only.mjs` must print PASS: every file changed under the folder holds the code its merge base does, comments and white space aside. A FAIL names the file and line; put that code back.
- `--write` lowers the folder's ceilings to the new counts and drops the entry of a file with none left. It never raises one.
- Then run the folder's own tests and the type check, since a deleted comment can still be a directive (`@ts-expect-error`, `eslint-disable`, `#[allow]` is code, not a comment).

## In the pull request

State the folder, its comment lines before and after, the tally by row, the stale comments and the excuses you deleted with their issues, the pages you added, and the three commands' output.

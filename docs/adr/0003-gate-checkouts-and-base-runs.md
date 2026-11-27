# 0003: The gate's temporary checkouts and base runs

Status: accepted. Moved from comments in `packages/gate` by #3454's first pass ([0001](0001-code-carries-no-comments.md)). The design states the rule these serve under Fail before, pass after and A base with nothing to start; the decisions below are the ones written nowhere else.

## Cloned folders

- **A folder git tracks a file in is still cloned.** `packages/gate/src/checkouts.ts`, `cloneIn`. Git doesn't call a folder ignored once it tracks a file in it, though the rest of it still is.
- **A folder that is itself a link is cloned from where it points.** `packages/gate/src/checkouts.ts`, `cloneIn`. Nothing written in the checkout then reaches the shared install.
- **A read-only folder is made writable in the clone.** `packages/gate/src/checkouts.ts`, `cloneIn`. It keeps its mode when cloned, and the tree's files must still go into it.
- **What isn't ignored in a cloned folder comes from the tree alone.** `packages/gate/src/checkouts.ts`, `cloneIn`. A file only the worktree has isn't left behind, and a link the clone keeps on the way to one is removed itself, never what it points at.
- **The clone goes in before the tree.** `packages/gate/src/checkouts.ts`, `openCheckouts` (`checkout`). A file the tree holds in a cloned folder is the tree's, never the worktree's.

## The base checkout

- **A stand-in is never written through a link.** `packages/gate/src/checkouts.ts`, `buildStandIns`. Through a link it would land outside the checkout, so the surface gets no stand-in and the check can't import it.
- **A base checkout is a tree of its own.** `packages/gate/src/checkouts.ts`, `openCheckouts` (`baseCheckout`). The check's own files come from the claim's commit and the rest from the merge base. The tree is written to the store, and since it has no ref a prune waits until it is written out.

## Which runs happen

- **A base run cut short is run again, never carried.** `packages/gate/src/checkouts.ts`, `carried`. It proved nothing either way.
- **A carried result compares both names of a rename.** `packages/gate/src/checkouts.ts`, `carried`. The diff is read with `--no-renames` and `-z`, so a rename or a quoted name can't hide an input that changed.
- **An uncounted run ends a check's retries.** `packages/gate/src/checkouts.ts`, `claimOn`. A failed run starts up to two more, as the design says of any check; nothing says another run would count after an uncounted one.
- **Which checks run on the base.** `packages/gate/src/checkouts.ts`, `claimOn`. A fix check always does. A check of what must not change does only when it failed, to find what the change inherits.
- **A base run's reasons are kept by name.** `packages/gate/src/checkouts.ts`, `claimOn`. The verdict engine says only that a base run failed off its named assertions, so the gate names what each failed to prove.
